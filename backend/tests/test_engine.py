import time
from datetime import timedelta

from conftest import T0, ev
from jarvis.engine import Engine


def test_ingest_enriches_incident():
    e = Engine(clock=lambda: T0 + timedelta(minutes=2))
    e.ingest([ev(0, "user-db", "connection pool exhausted", "warn"), ev(2, "user-db", "connection pool exhausted"),
              ev(5, "auth-service", "DB timeout after 2000ms on user-db", tags={"endpoint": "/login"})])
    [inc] = e.incidents()
    assert inc.root_cause_candidates[0].service == "user-db"
    assert inc.title.endswith("because user-db ran out of connections") and inc.recommendations
    assert e.stats() == {"raw_alerts": 3, "incidents": 1, "isolated": 0}
    assert len(e.incident_events(inc.id)) == 3
    assert e.incident(inc.id) is inc


def test_candidates_hidden_by_default():
    e = Engine()
    e.ingest([ev(0, "staging-host-3", "TLS certificate expires in 6 days", "warn", type="alert")])
    assert e.incidents() == [] and len(e.incidents(include_candidates=True)) == 1 and e.stats()["isolated"] == 1


def test_reset_clears_everything():
    e = Engine()
    e.ingest([ev(0, "user-db", "pool exhausted")])
    e.reset()
    assert e.events() == [] and e.stats()["raw_alerts"] == 0


def test_events_filters_and_event_incident():
    e = Engine()
    evs = [ev(10, "user-db", "pool exhausted"), ev(0, "api-gateway", "ok", "info"), ev(4, "user-db", "pool exhausted")]
    e.ingest(evs)
    assert [x.timestamp for x in e.events()] == sorted(x.timestamp for x in evs)
    assert len(e.events(service="user-db")) == 2 and len(e.events(level="info")) == 1
    assert len(e.events(since=T0 + timedelta(seconds=5))) == 1
    assert e.event_incident(evs[0].id) is not None and e.event_incident(evs[1].id) is None


def test_event_incident_consistent_with_incidents_and_changed_ids_valid():
    e = Engine()
    ids = e.ingest([ev(0, "user-db", "pool exhausted", "critical"), ev(1, "user-db", "pool exhausted")])
    ids += e.ingest([ev(2, "auth-service", "DB timeout on user-db")])
    for i in ids:
        assert e.incident(i) is not None
    for inc in e.incidents(include_candidates=True):
        for eid in inc.event_ids:
            assert e.event_incident(eid) == inc.id


def test_perf_single_ingest_under_200ms():
    e = Engine(clock=lambda: T0)
    msgs = ["connection pool exhausted", "DB timeout after 2000ms on user-db", "5xx on /login"]
    svcs = ["user-db", "auth-service", "api-gateway"]
    batch = [
        ev(n * 1.44, svcs[n % 3], msgs[n % 3], "error" if n % 25 < 3 else "info")  # ~2 hours, mostly closed bursts
        for n in range(5000)
    ]
    e.ingest(batch)
    start = time.perf_counter()
    e.ingest([ev(7300, "user-db", "connection pool exhausted")])
    assert time.perf_counter() - start < 0.2
