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


def test_merge_through_engine_follows_survivor():
    e = Engine(clock=lambda: T0 + timedelta(minutes=5))
    [a] = e.ingest([ev(0, "user-db", "boom a", "critical", tags={"endpoint": "/x"})])
    b = next(i for i in e.ingest([ev(180, "payment-service", "kaboom", "critical")]) if i != a)
    assert a != b
    absorbed_events = [x.id for x in e.incident_events(b)]
    bridge = ev(90, "user-db", "fail talking to payment-service", "error", tags={"endpoint": "/x"})
    changed = e.ingest([bridge])
    assert changed == [a] and e.incident(b) is None  # absorbed id is never reported
    for eid in absorbed_events + [bridge.id]:
        assert e.event_incident(eid) == a
    inc = e.incident(a)
    assert len(inc.event_ids) == 3
    assert {c.service for c in inc.root_cause_candidates} == {"user-db", "payment-service"}
    assert set(inc.impact.services) == {"user-db", "payment-service"} and inc.impact.minutes_since_start == 5
    assert inc.title


def test_late_deploy_reranks_untouched_incident():
    e = Engine()
    [inc_id] = e.ingest([ev(60 + i, "user-db", "pool exhausted") for i in range(3)])
    assert e.incident(inc_id).root_cause_candidates[0].factors["change"] == 0
    changed = e.ingest([ev(0, "user-db", "deployed v2", "info", type="deploy")])
    assert inc_id in changed
    assert e.incident(inc_id).root_cause_candidates[0].factors["change"] == 1.0


def test_resent_events_are_ignored():
    e = Engine()
    batch = [ev(0, "user-db", "pool exhausted"), ev(1, "user-db", "pool exhausted")]
    e.ingest(batch)
    assert e.ingest(batch) == []
    assert e.stats()["raw_alerts"] == 2 and len(e.events()) == 2


def test_perf_single_ingest_under_200ms():
    e = Engine(clock=lambda: T0)
    msgs = ["connection pool exhausted", "DB timeout after 2000ms on user-db", "5xx on /login"]
    svcs = ["user-db", "auth-service", "api-gateway"]
    batch = []
    for n in range(5000):
        burst, k = divmod(n, 200)  # 25 bursts of 200 events, 310 s apart (> WINDOW_S) over ~2 hours
        batch.append(ev(burst * 310 + k * 0.5, svcs[k % 3], msgs[k % 3], "error" if k < 4 else "info"))
    e.ingest(batch)
    assert len(e.incidents(include_candidates=True)) > 1
    start = time.perf_counter()
    e.ingest([ev(25 * 310 + 400, "user-db", "connection pool exhausted")])
    assert time.perf_counter() - start < 0.2
