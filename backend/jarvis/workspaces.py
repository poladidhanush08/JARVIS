"""Per-visitor workspaces: each session id gets its own Engine, Hub and Simulator."""
from __future__ import annotations

import contextlib
import logging
import re
import time
from collections.abc import Callable

from fastapi import WebSocket

from jarvis.engine import Engine
from jarvis.models import Event
from jarvis.simulator import Simulator

log = logging.getLogger(__name__)

MAX_WORKSPACES = 50
WORKSPACE_TTL_S = 1800
DEFAULT_ID = "default"
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def valid_session_id(session_id: str | None) -> bool:
    return isinstance(session_id, str) and SESSION_ID_RE.fullmatch(session_id) is not None


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
        await ws.send_json(self.snapshot("snapshot"))
        self.connections.add(ws)

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

    async def close_all(self) -> None:
        for ws in list(self.connections):
            self.connections.discard(ws)
            with contextlib.suppress(Exception):
                await ws.close()


class Workspace:
    """One visitor's isolated state. The simulator broadcasts only to this workspace's hub."""

    def __init__(self, id: str, last_used: float = 0.0) -> None:
        self.id = id
        self.engine = Engine()
        self.hub = Hub(self.engine)
        self.sim = Simulator(self.engine, self.hub.broadcast)
        self.last_used = last_used

    async def close(self) -> None:
        """Stop the simulator and drop every socket. Errors are logged, never raised."""
        try:
            await self.sim.reset()
        except Exception:
            log.exception("resetting evicted workspace %s failed", self.id)
        await self.hub.close_all()


class WorkspaceStore:
    def __init__(
        self,
        max_workspaces: int = MAX_WORKSPACES,
        ttl_s: float = WORKSPACE_TTL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_workspaces = max_workspaces
        self.ttl_s = ttl_s
        self.clock = clock
        self._items: dict[str, Workspace] = {}

    def __len__(self) -> int:
        return len(self._items)

    def ids(self) -> list[str]:
        return list(self._items)

    def touch(self, ws: Workspace) -> None:
        ws.last_used = self.clock()

    async def get(self, session_id: str | None) -> Workspace:
        sid = session_id if valid_session_id(session_id) else DEFAULT_ID
        now = self.clock()
        # All bookkeeping happens synchronously before the first await, so concurrent
        # requests never see a half-updated store.
        evicted = [w for w in self._items.values() if w.id != DEFAULT_ID and now - w.last_used > self.ttl_s]
        for w in evicted:
            del self._items[w.id]
        ws = self._items.get(sid)
        if ws is None:
            while len(self._items) >= self.max_workspaces:
                candidates = [w for w in self._items.values() if w.id != DEFAULT_ID]
                if not candidates:
                    break
                lru = min(candidates, key=lambda w: w.last_used)
                del self._items[lru.id]
                evicted.append(lru)
            ws = self._items[sid] = Workspace(sid, now)
        ws.last_used = now
        for w in evicted:
            await w.close()
        return ws
