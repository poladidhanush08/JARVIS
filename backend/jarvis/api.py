from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Literal

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from jarvis.engine import utcnow
from jarvis.graph import ServiceGraph
from jarvis.models import Event, Metric
from jarvis.parsers import parse_log_file
from jarvis.playbook import Playbook
from jarvis.report import render_markdown
from jarvis.simulator import list_scenarios
from jarvis.workspaces import Hub, Workspace, WorkspaceStore

__all__ = ["Hub", "create_app", "app"]

log = logging.getLogger(__name__)

# Browsers may call the API from these sites. Override when deploying, e.g. on Render:
#   JARVIS_CORS_ORIGINS=https://my-site.example     (comma-separated exact origins)
#   JARVIS_CORS_ORIGIN_REGEX=https://.*\.vercel\.app  (default: any Vercel deployment)
CORS_ORIGINS = [
    o.strip() for o in os.environ.get("JARVIS_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]
CORS_ORIGIN_REGEX = os.environ.get("JARVIS_CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app") or None

# Memory caps: one visitor must not be able to exhaust the (small) server.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_EVENTS_PER_REQUEST = 5_000
MAX_WORKSPACE_EVENTS = 50_000


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


def create_app() -> FastAPI:
    graph = ServiceGraph.default()
    store = WorkspaceStore(graph=graph, playbook=Playbook.default())

    app = FastAPI(title="J.A.R.V.I.S.")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_origin_regex=CORS_ORIGIN_REGEX,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.workspaces = store

    async def workspace(
        x_jarvis_session: str | None = Header(None),
        session: str | None = Query(None),
    ) -> Workspace:
        """The caller's workspace: header `X-Jarvis-Session` wins over `?session=`."""
        return await store.get(x_jarvis_session if x_jarvis_session is not None else session)

    WS = Depends(workspace)

    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok"}

    async def ingest(w: Workspace, events: list[Event]) -> int:
        if w.engine.event_count() + len(events) > MAX_WORKSPACE_EVENTS:
            raise HTTPException(413, "Workspace is full; reset it to continue")
        w.engine.ingest(events)
        await w.hub.broadcast(events)
        return len(events)

    @app.post("/api/events")
    async def post_events(body: EventIn | list[EventIn], w: Workspace = WS) -> dict:
        items = body if isinstance(body, list) else [body]
        if len(items) > MAX_EVENTS_PER_REQUEST:
            raise HTTPException(413, f"Too many events in one request (max {MAX_EVENTS_PER_REQUEST:,})")
        return {"accepted": await ingest(w, [i.to_event() for i in items])}

    @app.post("/api/upload")
    async def upload(file: UploadFile = File(...), w: Workspace = WS) -> dict:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large (max 5 MB)")
        content = raw.decode("utf-8", errors="replace")
        try:
            result = parse_log_file(content, file.filename or "")
        except Exception as exc:
            log.exception("upload parse failed")
            raise HTTPException(400, f"Could not parse file: {exc}") from exc
        await ingest(w, result.events)
        return {
            "accepted": len(result.events),
            "skipped": result.skipped,
            "format": result.format,
            "preview": [e.model_dump(mode="json") for e in result.events[:5]],
        }

    @app.get("/api/stats")
    async def stats(w: Workspace = WS) -> dict:
        return w.engine.stats()

    @app.get("/api/incidents")
    async def incidents(include_candidates: bool = False, w: Workspace = WS) -> list[dict]:
        return [i.model_dump(mode="json") for i in w.engine.incidents(include_candidates)]

    def _get_incident(w: Workspace, incident_id: str):
        inc = w.engine.incident(incident_id)
        if inc is None:
            raise HTTPException(404, f"Unknown incident {incident_id}")
        return inc

    @app.get("/api/incidents/{incident_id}")
    async def incident_detail(incident_id: str, w: Workspace = WS) -> dict:
        inc = _get_incident(w, incident_id)
        return {
            "incident": inc.model_dump(mode="json"),
            "events": [e.model_dump(mode="json") for e in w.engine.incident_events(incident_id)],
        }

    @app.get("/api/incidents/{incident_id}/report")
    async def incident_report(incident_id: str, w: Workspace = WS) -> Response:
        inc = _get_incident(w, incident_id)
        md = render_markdown(inc, w.engine.incident_events(incident_id))
        return Response(
            md,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{incident_id}.md"'},
        )

    @app.get("/api/events")
    async def events(
        service: str | None = None, level: str | None = None, limit: int = Query(500, ge=1), w: Workspace = WS,
    ) -> list[dict]:
        rows = []
        for e in reversed(w.engine.events(service=service, level=level)):
            inc_id = w.engine.event_incident(e.id)
            inc = w.engine.incident(inc_id) if inc_id else None
            if inc is not None and not inc.promoted:
                inc = None  # hidden candidate groups are not incidents
            rows.append({
                "event": e.model_dump(mode="json"),
                "incident_id": inc.id if inc else None,
                "reasons": inc.correlation_reasons.get(e.id, []) if inc else [],
            })
            if len(rows) >= limit:
                break
        return rows

    @app.get("/api/graph")
    async def get_graph() -> dict:
        return {"nodes": graph.nodes(), "edges": graph.edges()}

    @app.get("/api/scenarios")
    async def scenarios() -> list[dict]:
        return [{"id": s.id, "name": s.name, "description": s.description} for s in list_scenarios()]

    @app.get("/api/simulator")
    async def sim_status(w: Workspace = WS) -> dict:
        return w.sim.status()

    @app.post("/api/simulator/start")
    async def sim_start(body: StartBody, w: Workspace = WS) -> dict:
        try:
            await w.sim.start(body.scenario_id, body.speed)
        except KeyError:
            raise HTTPException(404, f"Unknown scenario {body.scenario_id}") from None
        await w.hub.broadcast([])  # the engine was reset; clear dashboards
        return w.sim.status()

    @app.post("/api/simulator/pause")
    async def sim_pause(w: Workspace = WS) -> dict:
        await w.sim.pause()
        return w.sim.status()

    @app.post("/api/simulator/resume")
    async def sim_resume(w: Workspace = WS) -> dict:
        await w.sim.resume()
        return w.sim.status()

    @app.post("/api/simulator/reset")
    async def sim_reset(w: Workspace = WS) -> dict:
        await w.sim.reset()
        await w.hub.broadcast([])
        return w.sim.status()

    @app.post("/api/simulator/speed")
    async def sim_speed(body: SpeedBody, w: Workspace = WS) -> dict:
        await w.sim.set_speed(body.speed)
        return w.sim.status()

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        w = await store.get(ws.query_params.get("session"))
        try:
            await w.hub.connect(ws)
            while True:
                await ws.receive_text()
                store.touch(w)
        except (WebSocketDisconnect, RuntimeError):
            pass  # RuntimeError: the workspace was evicted and closed this socket
        finally:
            w.hub.disconnect(ws)

    return app


app = create_app()
