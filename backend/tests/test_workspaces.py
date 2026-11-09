import asyncio

import pytest
from fastapi.testclient import TestClient

from jarvis.api import create_app
from jarvis.workspaces import DEFAULT_ID, MAX_WORKSPACES, WORKSPACE_TTL_S, WorkspaceStore

S1 = "session-one-1111"
S2 = "session-two-2222"
EVENT = {"service": "user-db", "level": "error", "message": "connection pool exhausted"}


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class FakeSocket:
    def __init__(self, fail: bool = False) -> None:
        self.fail, self.closed, self.sent = fail, False, []

    async def send_json(self, msg: dict) -> None:
        self.sent.append(msg)

    async def close(self, code: int = 1000) -> None:
        if self.fail:
            raise RuntimeError("already closed")
        self.closed = True


def hdr(sid: str) -> dict:
    return {"X-Jarvis-Session": sid}


# ---- WorkspaceStore unit tests ------------------------------------------------------------

def test_limits_match_contract():
    assert (MAX_WORKSPACES, WORKSPACE_TTL_S, DEFAULT_ID) == (50, 1800, "default")


@pytest.mark.parametrize("sid", [None, "", "short", "has space 12345", "x" * 65, "bad/chars!123"])
async def test_missing_or_invalid_id_uses_default(sid):
    store = WorkspaceStore()
    ws = await store.get(sid)
    assert ws.id == "default"
    assert await store.get(None) is ws
    assert len(store) == 1


async def test_valid_ids_get_own_workspace_with_own_parts():
    store = WorkspaceStore()
    a, b = await store.get(S1), await store.get(S2)
    assert (a.id, b.id) == (S1, S2)
    assert a.engine is not b.engine and a.hub is not b.hub and a.sim is not b.sim
    assert a.hub.engine is a.engine and a.sim.engine is a.engine
    assert await store.get(S1) is a
    assert len(store) == 2


async def test_get_touches_last_used():
    clock = FakeClock()
    store = WorkspaceStore(clock=clock)
    ws = await store.get(S1)
    assert ws.last_used == 1000.0
    clock.t = 1500.0
    await store.get(S1)
    assert ws.last_used == 1500.0


async def test_ttl_eviction_with_fake_clock():
    clock = FakeClock()
    store = WorkspaceStore(ttl_s=100, clock=clock)
    default = await store.get(None)
    old = await store.get(S1)
    clock.t += 60
    fresh = await store.get(S2)
    clock.t += 50  # S1 idle 110 s (expired), S2 idle 50 s, default idle 110 s
    assert await store.get(S2) is fresh
    assert len(store) == 2
    assert await store.get(None) is default  # default is never evicted
    again = await store.get(S1)
    assert again is not old  # a fresh workspace replaced the evicted one


async def test_lru_limit_never_evicts_default():
    clock = FakeClock()
    store = WorkspaceStore(max_workspaces=2, clock=clock)
    default = await store.get(None)
    clock.t += 1
    a = await store.get(S1)
    clock.t += 1
    b = await store.get(S2)  # store full: evicts S1, the LRU non-default
    assert len(store) == 2
    assert await store.get(None) is default
    assert await store.get(S2) is b
    clock.t += 1
    assert await store.get(S1) is not a  # evicts S2 now; default still survives
    assert len(store) == 2
    assert await store.get(None) is default


async def test_lru_uses_last_used_not_creation_order():
    clock = FakeClock()
    store = WorkspaceStore(max_workspaces=2, clock=clock)
    a = await store.get(S1)
    clock.t += 1
    await store.get(S2)
    clock.t += 1
    await store.get(S1)  # S1 is now the most recent
    clock.t += 1
    await store.get("session-three-3333")
    assert await store.get(S1) is a


async def test_eviction_cancels_simulator():
    clock = FakeClock()
    store = WorkspaceStore(ttl_s=10, clock=clock)
    ws = await store.get(S1)
    await ws.sim.start("a_db_pool", 10)
    await asyncio.sleep(0.05)
    assert len(ws.engine.events()) >= 1
    clock.t += 11
    await store.get(None)  # any request triggers the TTL check
    assert S1 not in store.ids()
    await store.drain()
    assert ws.sim.status()["state"] == "idle"
    await asyncio.sleep(0.4)  # scenario A would emit more events by now if still running
    assert ws.engine.events() == []


async def test_eviction_closes_sockets_even_failing_ones():
    store = WorkspaceStore(max_workspaces=1)
    ws = await store.get(S1)
    good, dead = FakeSocket(), FakeSocket(fail=True)
    ws.hub.connections.update({good, dead})
    await store.get(S2)  # every candidate is connected, so the LRU one goes anyway
    await store.drain()
    assert good.closed
    assert ws.hub.connections == set()


async def test_connected_silent_workspace_survives_ttl():
    clock = FakeClock()
    store = WorkspaceStore(ttl_s=10, clock=clock)
    watched = await store.get(S1)
    watched.hub.connections.add(FakeSocket())  # an open dashboard that never sends frames
    await store.get(S2)
    clock.t += 1000
    await store.get(None)
    assert S1 in store.ids() and S2 not in store.ids()
    assert await store.get(S1) is watched
    watched.hub.connections.clear()  # once the dashboard closes, the TTL applies again
    clock.t += 11
    await store.get(None)
    assert S1 not in store.ids()
    await store.drain()


async def test_lru_skips_connected_workspaces():
    clock = FakeClock()
    store = WorkspaceStore(max_workspaces=3, clock=clock)
    await store.get(None)
    oldest = await store.get(S1)
    oldest.hub.connections.add(FakeSocket())
    clock.t += 1
    await store.get(S2)
    clock.t += 1
    await store.get("session-three-3333")  # full: S1 is older but connected, so S2 goes
    assert set(store.ids()) == {"default", S1, "session-three-3333"}
    await store.drain()


async def test_cleanup_survives_cancelled_request():
    store = WorkspaceStore(max_workspaces=1)
    ws = await store.get(S1)
    blocker = asyncio.Event()

    class SlowSocket(FakeSocket):
        async def close(self, code: int = 1000) -> None:
            await blocker.wait()
            self.closed = True

    slow = SlowSocket()
    ws.hub.connections.add(slow)
    request = asyncio.create_task(store.get(S2))
    await asyncio.wait_for(request, 1)  # returns without waiting for the cleanup
    request.cancel()
    blocker.set()
    await store.drain()
    assert slow.closed and ws.sim.status()["state"] == "idle"


class GatedSocket(FakeSocket):
    """A socket whose first send (the snapshot) waits until released."""

    def __init__(self) -> None:
        super().__init__()
        self.release = asyncio.Event()

    async def accept(self) -> None:
        pass

    async def send_json(self, msg: dict) -> None:
        if not self.sent:
            await self.release.wait()
        self.sent.append(msg)


async def test_socket_mid_snapshot_is_closed_by_close_all_and_gets_snapshot_first():
    ws = await WorkspaceStore().get(S1)
    sock = GatedSocket()
    connecting = asyncio.create_task(ws.hub.connect(sock))
    await asyncio.sleep(0)
    assert sock in ws.hub.connections
    await ws.hub.broadcast([])  # skipped: its snapshot is not out yet
    await ws.hub.close_all()
    assert sock.closed
    sock.release.set()
    await connecting
    assert [m["type"] for m in sock.sent] == ["snapshot"]
    assert ws.hub.connections == set()


async def test_workspaces_share_loaded_graph_and_playbook():
    store = WorkspaceStore()
    a, b = await store.get(S1), await store.get(S2)
    assert a.engine.graph is b.engine.graph is store.graph
    assert a.engine.playbook is b.engine.playbook is store.playbook


# ---- API ----------------------------------------------------------------------------------

@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def test_events_with_header_land_only_in_that_session(client):
    assert client.post("/api/events", json=EVENT, headers=hdr(S1)).json() == {"accepted": 1}
    assert len(client.get("/api/events", headers=hdr(S1)).json()) == 1
    assert client.get("/api/events", headers=hdr(S2)).json() == []
    assert client.get("/api/events").json() == []
    assert client.get("/api/stats", headers=hdr(S2)).json()["raw_alerts"] == 0


def test_no_header_uses_default_workspace(client):
    client.post("/api/events", json=EVENT)
    assert client.get("/api/stats").json()["raw_alerts"] == 1
    assert client.get("/api/stats", headers=hdr(S1)).json()["raw_alerts"] == 0


def test_invalid_header_falls_back_to_default(client):
    client.post("/api/events", json=EVENT, headers=hdr("bad id!"))
    assert client.get("/api/stats").json()["raw_alerts"] == 1
    assert client.get("/api/stats?session=nope").json()["raw_alerts"] == 1


def test_query_param_session_and_header_wins(client):
    client.post(f"/api/events?session={S1}", json=EVENT)
    assert client.get("/api/stats", headers=hdr(S1)).json()["raw_alerts"] == 1
    client.post(f"/api/events?session={S1}", json=EVENT, headers=hdr(S2))
    assert client.get(f"/api/stats?session={S2}").json()["raw_alerts"] == 1
    assert client.get(f"/api/stats?session={S1}").json()["raw_alerts"] == 1


def test_report_link_works_with_query_session(client):
    client.post("/api/events", json=[EVENT] * 3, headers=hdr(S1))
    [inc] = client.get("/api/incidents", headers=hdr(S1)).json()
    assert client.get(f"/api/incidents/{inc['id']}/report?session={S1}").status_code == 200
    assert client.get(f"/api/incidents/{inc['id']}/report").status_code == 404


def test_two_sessions_isolated_while_scenario_runs(client):
    r = client.post("/api/simulator/start", json={"scenario_id": "a_db_pool", "speed": 10}, headers=hdr(S1))
    assert r.json()["state"] == "running"
    for _ in range(100):
        if client.get("/api/stats", headers=hdr(S1)).json()["raw_alerts"] > 0:
            break
        client.portal.call(asyncio.sleep, 0.02)
    assert client.get("/api/stats", headers=hdr(S1)).json()["raw_alerts"] > 0
    assert client.get("/api/stats", headers=hdr(S2)).json() == {"raw_alerts": 0, "incidents": 0, "isolated": 0}
    assert client.get("/api/simulator", headers=hdr(S2)).json()["state"] == "idle"
    assert client.get("/api/stats").json()["raw_alerts"] == 0
    client.post("/api/simulator/reset", headers=hdr(S1))


def test_websocket_only_receives_own_session_updates(client):
    with client.websocket_connect(f"/ws?session={S2}") as ws2:
        assert ws2.receive_json()["type"] == "snapshot"
        with client.websocket_connect(f"/ws?session={S1}") as ws1:
            assert ws1.receive_json()["type"] == "snapshot"
            client.post("/api/events", json={**EVENT, "message": "from session 1"}, headers=hdr(S1))
            assert ws1.receive_json()["events"][0]["message"] == "from session 1"
            assert ws1.receive_json()["type"] == "update"
            client.post("/api/events", json={**EVENT, "message": "from session 2"}, headers=hdr(S2))
            first = ws2.receive_json()  # if S1's frames leaked, they would arrive first
            assert first["type"] == "events"
            assert [e["message"] for e in first["events"]] == ["from session 2"]
            update = ws2.receive_json()
            assert update["type"] == "update" and update["stats"]["raw_alerts"] == 1


def test_websocket_without_session_uses_default(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        client.post("/api/events", json=EVENT)
        assert ws.receive_json()["type"] == "events"


def test_health_ok_and_creates_no_workspace(client):
    store = client.app.state.workspaces
    before = len(store)
    r = client.get("/api/health", headers=hdr(S1))
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert len(store) == before
    assert S1 not in store.ids()


def test_graph_and_scenarios_create_no_workspace(client):
    store = client.app.state.workspaces
    client.get("/api/graph", headers=hdr(S1))
    client.get("/api/scenarios", headers=hdr(S1))
    assert S1 not in store.ids()


def test_connected_websocket_survives_ttl_but_lru_closes_it(client):
    from starlette.websockets import WebSocketDisconnect

    store = client.app.state.workspaces
    clock = FakeClock()
    store.clock = clock
    with client.websocket_connect(f"/ws?session={S1}") as ws:
        ws.receive_json()
        clock.t += WORKSPACE_TTL_S + 1
        client.get("/api/stats")  # TTL check runs, but an open dashboard keeps S1 alive
        assert S1 in store.ids()
        store.max_workspaces = 2  # default + S1: a new visitor forces S1 out
        client.get("/api/stats", headers=hdr(S2))
        assert S1 not in store.ids()
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
