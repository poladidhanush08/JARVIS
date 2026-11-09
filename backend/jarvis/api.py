from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from jarvis.engine import Engine, utcnow
from jarvis.graph import ServiceGraph
from jarvis.models import Event, Metric
from jarvis.parsers import parse_log_file
from jarvis.report import render_markdown
from jarvis.simulator import Simulator, list_scenarios

log = logging.getLogger(__name__)


class EventIn(BaseModel):
    """Event as accepted over REST: timestamp optional, source always forced to "api"."""

    id: str | None = None
    timestamp: datetime | None = None
    service: str
    type: Literal["log", "alert", "metric", "deploy"] = "log"
    level: Literal["debug", "info", "warn", "error", "critical"] = "info"
    message: str
    metric: Metric | None = None
    trace_id: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)

    def to_event(self) -> Event:
        data = self.model_dump(exclude_none=True)
        data.setdefault("timestamp", utcnow())
        return Event(**data, source="api")


class StartBody(BaseModel):
    scenario_id: str
    speed: float = 1.0


class SpeedBody(BaseModel):
    speed: float


class Hub:
    """Tracks WebSocket connections and fans out engine updates to them."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.connections: set[WebSocket] = set()

    def snapshot(self, kind: str) -> dict:
        return {
            "type": kind,
            "stats": self.engine.stats(),
            "incidents": [i.model_dump(mode="json") for i in self.engine.incidents()],
        }

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.add(ws)
        await ws.send_json(self.snapshot("snapshot"))

    def disconnect(self, ws: WebSocket) -> None:
        self.connections.discard(ws)

    async def _send_all(self, message: dict) -> None:
        for ws in list(self.connections):
            try:
                await ws.send_json(message)
            except Exception:
                self.connections.discard(ws)

    async def broadcast(self, events: list[Event]) -> None:
        if events:
            await self._send_all({"type": "events", "events": [e.model_dump(mode="json") for e in events]})
        await self._send_all(self.snapshot("update"))


def create_app() -> FastAPI:
    engine = Engine()
    hub = Hub(engine)
    sim = Simulator(engine, hub.broadcast)
    graph = ServiceGraph.default()

    app = FastAPI(title="J.A.R.V.I.S.")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    async def ingest(events: list[Event]) -> int:
        engine.ingest(events)
        await hub.broadcast(events)
        return len(events)

    @app.post("/api/events")
    async def post_events(body: EventIn | list[EventIn]) -> dict:
        items = body if isinstance(body, list) else [body]
        return {"accepted": await ingest([i.to_event() for i in items])}

    @app.post("/api/upload")
    async def upload(file: UploadFile = File(...)) -> dict:
        content = (await file.read()).decode("utf-8", errors="replace")
        try:
            result = parse_log_file(content, file.filename or "")
        except Exception as exc:
            log.exception("upload parse failed")
            raise HTTPException(400, f"Could not parse file: {exc}") from exc
        await ingest(result.events)
        return {
            "accepted": len(result.events),
            "skipped": result.skipped,
            "format": result.format,
            "preview": [e.model_dump(mode="json") for e in result.events[:5]],
        }

    @app.get("/api/stats")
    async def stats() -> dict:
        return engine.stats()

    @app.get("/api/incidents")
    async def incidents(include_candidates: bool = False) -> list[dict]:
        return [i.model_dump(mode="json") for i in engine.incidents(include_candidates)]

    def _get_incident(incident_id: str):
        inc = engine.incident(incident_id)
        if inc is None:
            raise HTTPException(404, f"Unknown incident {incident_id}")
        return inc

    @app.get("/api/incidents/{incident_id}")
    async def incident_detail(incident_id: str) -> dict:
        inc = _get_incident(incident_id)
        return {
            "incident": inc.model_dump(mode="json"),
            "events": [e.model_dump(mode="json") for e in engine.incident_events(incident_id)],
        }

    @app.get("/api/incidents/{incident_id}/report")
    async def incident_report(incident_id: str) -> Response:
        inc = _get_incident(incident_id)
        md = render_markdown(inc, engine.incident_events(incident_id))
        return Response(
            md,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{incident_id}.md"'},
        )

    @app.get("/api/events")
    async def events(service: str | None = None, level: str | None = None, limit: int = 500) -> list[dict]:
        rows = []
        for e in reversed(engine.events(service=service, level=level)):
            inc_id = engine.event_incident(e.id)
            inc = engine.incident(inc_id) if inc_id else None
            rows.append({
                "event": e.model_dump(mode="json"),
                "incident_id": inc_id,
                "reasons": inc.correlation_reasons.get(e.id, []) if inc else [],
            })
            if len(rows) >= max(limit, 0):
                break
        return rows

    @app.get("/api/graph")
    async def get_graph() -> dict:
        return {"nodes": graph.nodes(), "edges": graph.edges()}

    @app.get("/api/scenarios")
    async def scenarios() -> list[dict]:
        return [{"id": s.id, "name": s.name, "description": s.description} for s in list_scenarios()]

    @app.get("/api/simulator")
    async def sim_status() -> dict:
        return sim.status()

    @app.post("/api/simulator/start")
    async def sim_start(body: StartBody) -> dict:
        try:
            await sim.start(body.scenario_id, body.speed)
        except KeyError:
            raise HTTPException(404, f"Unknown scenario {body.scenario_id}") from None
        await hub.broadcast([])  # the engine was reset; clear dashboards
        return sim.status()

    @app.post("/api/simulator/pause")
    async def sim_pause() -> dict:
        await sim.pause()
        return sim.status()

    @app.post("/api/simulator/resume")
    async def sim_resume() -> dict:
        await sim.resume()
        return sim.status()

    @app.post("/api/simulator/reset")
    async def sim_reset() -> dict:
        await sim.reset()
        await hub.broadcast([])
        return sim.status()

    @app.post("/api/simulator/speed")
    async def sim_speed(body: SpeedBody) -> dict:
        await sim.set_speed(body.speed)
        return sim.status()

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await hub.connect(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            hub.disconnect(ws)

    return app


app = create_app()
