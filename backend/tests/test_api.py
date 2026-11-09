import pytest
from fastapi.testclient import TestClient

from jarvis.api import Hub, create_app
from jarvis.engine import Engine
from jarvis.models import Event

DB_EVENTS = [
    {"timestamp": f"2026-11-09T10:00:0{i}Z", "service": "user-db", "level": "error",
     "message": "connection pool exhausted"}
    for i in range(3)
]


@pytest.fixture
def client():
    return TestClient(create_app())


@pytest.fixture
def client_with_incident(client):
    client.post("/api/events", json=DB_EVENTS)
    return client


def test_post_events_then_incident_visible(client):
    assert client.post("/api/events", json=DB_EVENTS).json() == {"accepted": 3}
    [inc] = client.get("/api/incidents").json()
    detail = client.get(f"/api/incidents/{inc['id']}").json()
    assert len(detail["events"]) == 3
    assert detail["incident"]["id"] == inc["id"]


def test_post_single_event_defaults(client):
    r = client.post("/api/events", json={"service": "user-db", "message": "x", "source": "simulator"})
    assert r.json() == {"accepted": 1}
    [row] = client.get("/api/events").json()
    assert row["event"]["source"] == "api"
    assert row["event"]["timestamp"]


def test_post_invalid_event_422(client):
    assert client.post("/api/events", json={"service": "user-db"}).status_code == 422


def test_upload_reports_skipped(client):
    r = client.post("/api/upload", files={"file": ("x.log", b"2026-11-09 10:00:05 ERROR auth-service: boom\ngarbage\n")}).json()
    assert (r["accepted"], r["skipped"], r["format"]) == (1, 1, "text")
    assert len(r["preview"]) == 1


def test_upload_bad_bytes_does_not_500(client):
    r = client.post("/api/upload", files={"file": ("x.log", b"\xff\xfe\x00garbage")})
    assert r.status_code == 200
    body = r.json()
    assert (body["accepted"], body["skipped"]) == (0, 1)


def test_unknown_incident_404(client):
    assert client.get("/api/incidents/INC-999").status_code == 404
    assert client.get("/api/incidents/INC-999/report").status_code == 404


def test_report_download(client_with_incident):
    [inc] = client_with_incident.get("/api/incidents").json()
    r = client_with_incident.get(f"/api/incidents/{inc['id']}/report")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert r.headers["content-disposition"] == f'attachment; filename="{inc["id"]}.md"'
    assert "## Root cause" in r.text


def test_events_listing_with_reasons_and_filters(client_with_incident):
    rows = client_with_incident.get("/api/events").json()
    assert len(rows) == 3
    assert rows[0]["event"]["timestamp"] >= rows[-1]["event"]["timestamp"]
    assert rows[0]["incident_id"] is not None
    assert isinstance(rows[0]["reasons"], list)
    assert client_with_incident.get("/api/events?service=nope").json() == []
    assert len(client_with_incident.get("/api/events?limit=2").json()) == 2


def test_stats_graph_scenarios(client_with_incident):
    assert client_with_incident.get("/api/stats").json()["raw_alerts"] == 3
    g = client_with_incident.get("/api/graph").json()
    assert g["nodes"] and g["edges"]
    ids = [s["id"] for s in client_with_incident.get("/api/scenarios").json()]
    assert "a_db_pool" in ids


def test_simulator_controls(client):
    assert client.post("/api/simulator/start", json={"scenario_id": "nope", "speed": 1}).status_code == 404
    assert client.get("/api/simulator").json()["state"] == "idle"
    assert client.post("/api/simulator/start", json={"scenario_id": "a_db_pool", "speed": 10}).status_code == 200
    assert client.get("/api/simulator").json()["state"] == "running"
    client.post("/api/simulator/pause")
    assert client.get("/api/simulator").json()["state"] == "paused"
    client.post("/api/simulator/resume")
    client.post("/api/simulator/speed", json={"speed": 5})
    assert client.get("/api/simulator").json()["speed"] == 5
    client.post("/api/simulator/reset")
    assert client.get("/api/simulator").json()["state"] == "idle"


def test_websocket_snapshot_then_update(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        client.post("/api/events", json={"service": "user-db", "level": "error", "message": "pool exhausted"})
        assert ws.receive_json()["type"] == "events"
        assert ws.receive_json()["type"] == "update"


def test_reset_broadcasts_update(client_with_incident):
    with client_with_incident.websocket_connect("/ws") as ws:
        assert len(ws.receive_json()["incidents"]) == 1
        client_with_incident.post("/api/simulator/reset")
        msg = ws.receive_json()
        assert msg["type"] == "update" and msg["incidents"] == []


def test_cors_allows_dev_origin(client):
    r = client.get("/api/stats", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_allows_vercel_deployments_but_not_other_sites(client):
    ok = client.get("/api/stats", headers={"Origin": "https://jarvis-git-main-team.vercel.app"})
    assert ok.headers["access-control-allow-origin"] == "https://jarvis-git-main-team.vercel.app"
    other = client.get("/api/stats", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


def test_events_limit_must_be_positive(client):
    assert client.get("/api/events?limit=0").status_code == 422
    assert client.get("/api/events?limit=-1").status_code == 422


@pytest.mark.parametrize("speed", [0, -5])
def test_simulator_speed_is_clamped(client, speed):
    assert client.post("/api/simulator/start", json={"scenario_id": "a_db_pool", "speed": speed}).status_code == 200
    assert client.get("/api/simulator").json()["speed"] == 1
    client.post("/api/simulator/speed", json={"speed": 10})
    client.post("/api/simulator/speed", json={"speed": speed})
    assert client.get("/api/simulator").json()["speed"] == 1
    client.post("/api/simulator/reset")


class FakeWS:
    def __init__(self, fail=False):
        self.fail, self.sent = fail, []

    async def send_json(self, msg):
        if self.fail:
            raise RuntimeError("closed")
        self.sent.append(msg)


async def test_hub_broadcast_survives_dead_socket():
    hub = Hub(Engine())
    dead, healthy = FakeWS(fail=True), FakeWS()
    hub.connections.update({dead, healthy})
    await hub.broadcast([Event(timestamp="2026-11-09T10:00:00Z", service="user-db", message="x")])
    assert [m["type"] for m in healthy.sent] == ["events", "update"]
    assert hub.connections == {healthy}


def test_events_of_hidden_incidents_have_no_incident(client):
    from conftest import T0
    from jarvis.simulator import load_scenario, scenario_events

    evs = scenario_events(load_scenario("a_db_pool"), T0)
    client.post("/api/events", json=[e.model_dump(mode="json") for e in evs])
    rows = {r["event"]["message"]: r for r in client.get("/api/events").json()}
    noise = rows["TLS certificate expires in 6 days"]
    assert noise["incident_id"] is None and noise["reasons"] == []
    [inc] = client.get("/api/incidents").json()
    assert any(r["incident_id"] == inc["id"] for r in rows.values())
