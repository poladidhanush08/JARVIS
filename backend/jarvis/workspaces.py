"""Per-visitor workspaces: each session id gets its own Engine, Hub and Simulator."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from collections.abc import Callable

from fastapi import WebSocket

from jarvis.engine import Engine
from jarvis.graph import ServiceGraph
from jarvis.models import Event
from jarvis.playbook import Playbook
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
        # Registered sockets whose snapshot is still being sent. Broadcasts skip them so the
        # snapshot is always their first frame, but close_all() still reaches them.
        self._starting: set[WebSocket] = set()

    def snapshot(self, kind: str) -> dict:
        return {
            "type": kind,
            "stats": self.engine.stats(),
            "incidents": [i.model_dump(mode="json") for i in self.engine.incidents()],
        }

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.add(ws)
        self._starting.add(ws)
        try:
            await ws.send_json(self.snapshot("snapshot"))
        except BaseException:
            self.connections.discard(ws)
            raise
        finally:
            self._starting.discard(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.connections.discard(ws)

    async def _send_all(self, message: dict) -> None:
        for ws in list(self.connections):
            if ws in self._starting:
                continue
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

    def __init__(
        self,
        id: str,
        last_used: float = 0.0,
        graph: ServiceGraph | None = None,
        playbook: Playbook | None = None,
    ) -> None:
        self.id = id
        self.engine = Engine(graph, playbook)
        self.hub = Hub(self.engine)
        self.sim = Simulator(self.engine, self.hub.broadcast)
        self.last_used = last_used

    @property
    def connected(self) -> bool:
        return bool(self.hub.connections)

    async def close(self) -> None:
        """Stop the simulator and drop every socket. Errors are logged, never raised."""
        try:
            await self.sim.reset()
        except Exception:
            log.exception("resetting evicted workspace %s failed", self.id)
        try:
            await self.hub.close_all()
        except Exception:
            log.exception("closing sockets of evicted workspace %s failed", self.id)


class WorkspaceStore:
    def __init__(
        self,
        max_workspaces: int = MAX_WORKSPACES,
        ttl_s: float = WORKSPACE_TTL_S,
        clock: Callable[[], float] = time.monotonic,
        graph: ServiceGraph | None = None,
        playbook: Playbook | None = None,
    ) -> None:
        self.max_workspaces = max_workspaces
        self.ttl_s = ttl_s
        self.clock = clock
        # Loaded once and shared read-only by every workspace's engine.
        self.graph = graph or ServiceGraph.default()
        self.playbook = playbook or Playbook.default()
        self._items: dict[str, Workspace] = {}
        self._cleanups: set[asyncio.Task] = set()

    def __len__(self) -> int:
        return len(self._items)

    def ids(self) -> list[str]:
        return list(self._items)

    def touch(self, ws: Workspace) -> None:
        ws.last_used = self.clock()

    def _expired(self, w: Workspace, now: float) -> bool:
        # A workspace with an open dashboard is in use even when its viewer sends nothing.
        return w.id != DEFAULT_ID and not w.connected and now - w.last_used > self.ttl_s

    def _lru_victim(self) -> Workspace | None:
        candidates = [w for w in self._items.values() if w.id != DEFAULT_ID]
        idle = [w for w in candidates if not w.connected]
        pool = idle or candidates
        return min(pool, key=lambda w: w.last_used) if pool else None

    async def get(self, session_id: str | None) -> Workspace:
        sid = session_id if valid_session_id(session_id) else DEFAULT_ID
        now = self.clock()
        # All bookkeeping happens synchronously, so concurrent requests never see a
        # half-updated store.
        evicted = [w for w in self._items.values() if self._expired(w, now)]
        for w in evicted:
            del self._items[w.id]
        ws = self._items.get(sid)
        if ws is None:
            while len(self._items) >= self.max_workspaces:
                victim = self._lru_victim()
                if victim is None:
                    break
                del self._items[victim.id]
                evicted.append(victim)
            ws = self._items[sid] = Workspace(sid, now, self.graph, self.playbook)
        ws.last_used = now
        if evicted:
            self._schedule_cleanup(evicted)
        return ws

    def _schedule_cleanup(self, evicted: list[Workspace]) -> None:
        # A background task, so cancelling the triggering request cannot stop cleanup partway
        # and an unrelated visitor's request does not wait for it.
        task = asyncio.create_task(self._close(evicted))
        self._cleanups.add(task)
        task.add_done_callback(self._cleanups.discard)

    @staticmethod
    async def _close(evicted: list[Workspace]) -> None:
        for w in evicted:
            await w.close()  # never raises

    async def drain(self) -> None:
        """Wait for pending eviction cleanups (used by tests and shutdown)."""
        while self._cleanups:
            await asyncio.gather(*list(self._cleanups), return_exceptions=True)
