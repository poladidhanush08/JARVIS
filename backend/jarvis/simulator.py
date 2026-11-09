from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml
from pydantic import BaseModel

from jarvis.engine import Engine
from jarvis.models import Event, Metric

log = logging.getLogger(__name__)
DEFAULT_DIR = Path(__file__).resolve().parent.parent / "data" / "scenarios"


class Step(BaseModel):
    at: float
    service: str
    type: str = "log"
    level: str = "info"
    message: str
    metric: Metric | None = None
    tags: dict[str, str] = {}
    repeat: int = 1
    every: float = 0


_SAFE_ID = re.compile(r"[a-z0-9_]+")


class Scenario(BaseModel):
    id: str
    name: str
    description: str
    duration: int
    steps: list[Step]


def _load(path: Path) -> Scenario:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    data["id"] = path.stem
    return Scenario(**data)


def list_scenarios(scenarios_dir: Path | None = None) -> list[Scenario]:
    d = scenarios_dir or DEFAULT_DIR
    return sorted((_load(p) for p in d.glob("*.yaml")), key=lambda s: s.id)


def load_scenario(scenario_id: str, scenarios_dir: Path | None = None) -> Scenario:
    if not _SAFE_ID.fullmatch(scenario_id):
        raise KeyError(scenario_id)
    path = (scenarios_dir or DEFAULT_DIR) / f"{scenario_id}.yaml"
    if not path.is_file():
        raise KeyError(scenario_id)
    return _load(path)


def scenario_events(s: Scenario, start: datetime) -> list[Event]:
    out: list[Event] = []
    for i, step in enumerate(s.steps):
        for r in range(step.repeat):
            out.append(Event(
                id=f"{s.id}-{i:03d}-{r:02d}",
                timestamp=start + timedelta(seconds=step.at + r * step.every),
                source="simulator",
                service=step.service,
                type=step.type,
                level=step.level,
                message=step.message,
                metric=step.metric,
                tags=dict(step.tags),
            ))
    out.sort(key=lambda e: (e.timestamp, e.id))
    return out


def _clamp_speed(speed: float) -> float:
    if not math.isfinite(speed):
        return 1.0
    return min(10.0, max(1.0, speed))


class Simulator:
    def __init__(
        self,
        engine: Engine,
        on_events: Callable[[list[Event]], Awaitable[None]],
        scenarios_dir: Path | None = None,
    ) -> None:
        self.engine = engine
        self.on_events = on_events
        self.scenarios_dir = scenarios_dir
        self._task: asyncio.Task | None = None
        self._gate = asyncio.Event()
        self._gate.set()
        self._scenario: str | None = None
        self._state = "idle"
        self._speed = 1.0
        self._emitted = 0
        self._total = 0

    async def _cancel(self) -> None:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def start(self, scenario_id: str, speed: float = 1.0) -> None:
        scenario = load_scenario(scenario_id, self.scenarios_dir)
        await self._cancel()
        self.engine.reset()
        self._speed = _clamp_speed(speed)
        events = scenario_events(scenario, datetime.now(timezone.utc))
        self._scenario, self._emitted, self._total = scenario_id, 0, len(events)
        self._gate.set()
        self._state = "running"
        self._task = asyncio.create_task(self._run(events))

    async def _run(self, events: list[Event]) -> None:
        try:
            prev = events[0].timestamp if events else None
            for event in events:
                await self._gate.wait()
                delta = (event.timestamp - prev).total_seconds()
                prev = event.timestamp
                if delta > 0:
                    await asyncio.sleep(delta / self._speed)
                await self._gate.wait()
                self.engine.ingest([event])
                self._emitted += 1
                await self.on_events([event])
        except Exception:
            log.exception("simulator run failed")
        self._state = "finished"

    async def pause(self) -> None:
        if self._state == "running":
            self._gate.clear()
            self._state = "paused"

    async def resume(self) -> None:
        if self._state == "paused":
            self._state = "running"
            self._gate.set()

    async def reset(self) -> None:
        await self._cancel()
        self.engine.reset()
        self._gate.set()
        self._scenario, self._state, self._emitted, self._total = None, "idle", 0, 0

    async def set_speed(self, speed: float) -> None:
        self._speed = _clamp_speed(speed)

    def status(self) -> dict:
        speed = int(self._speed) if self._speed == int(self._speed) else self._speed
        return {"scenario": self._scenario, "state": self._state, "speed": speed,
                "emitted": self._emitted, "total": self._total}
