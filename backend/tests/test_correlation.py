from datetime import timedelta

from conftest import T0, ev
from jarvis.correlation import Correlator
from jarvis.graph import ServiceGraph


def test_dependency_plus_signature_joins():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "connection pool exhausted", "warn"))
    assert c.add(ev(5, "auth-service", "DB timeout after 2000ms on user-db")) == i1


def test_neighbor_without_signature_does_not_join():  # bank-gateway noise case
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "payment-service", "DB timeout after 2000ms on user-db"))
    assert c.add(ev(10, "bank-gateway", "slow response 1800ms", "warn")) != i1


def test_shared_endpoint_joins_gateway():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "auth-service", "DB timeout on user-db", tags={"endpoint": "/login"}))
    assert c.add(ev(7, "api-gateway", "5xx rate 35% on /login", "error", type="alert", tags={"endpoint": "/login"})) == i1


def test_unknown_service_starts_own_incident():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    assert c.add(ev(3, "staging-host-3", "TLS certificate expires in 6 days", "warn", type="alert")) != i1


def test_info_events_are_not_correlated():
    c = Correlator(ServiceGraph.default())
    assert c.add(ev(0, "user-db", "nightly vacuum complete", "info")) is None


def test_out_of_order_event_uses_absolute_time():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(100, "user-db", "pool exhausted"))
    assert c.add(ev(95, "user-db", "pool exhausted")) == i1


def test_reasons_recorded_and_promotion():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    e2 = ev(1, "user-db", "pool exhausted")
    c.add(e2)
    c.add(ev(2, "user-db", "pool exhausted"))
    inc = c.incidents[i1]
    assert inc.promoted and "dependency" in inc.correlation_reasons[e2.id]


def test_outside_window_starts_new():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    assert c.add(ev(400, "auth-service", "unrelated thing")) != i1


def test_ids_sequential_and_reset():
    c = Correlator(ServiceGraph.default())
    assert c.add(ev(0, "user-db", "x")) == "INC-001"
    assert c.add(ev(1000, "user-db", "y")) == "INC-002"
    c.reset()
    assert c.incidents == {} and c.add(ev(0, "user-db", "x")) == "INC-001"


def test_critical_promotes_immediately():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "down", "critical"))
    assert c.incidents[i1].promoted


def test_merge_promoted_incidents_into_oldest():
    c = Correlator(ServiceGraph.default())
    a = c.add(ev(0, "user-db", "boom a", "critical", tags={"endpoint": "/x"}))
    b = c.add(ev(180, "payment-service", "kaboom", "critical"))
    assert a != b  # time decayed, no dependency
    bridge = ev(90, "user-db", "fail talking to payment-service", "error", tags={"endpoint": "/x"})
    # sanity: bridge qualifies against both
    assert c.score(bridge, c.incidents[a])[0] >= 0.6
    assert c.score(bridge, c.incidents[b])[0] >= 0.6
    assert c.add(bridge) == a
    assert b not in c.incidents
    inc = c.incidents[a]
    assert len(inc.event_ids) == 3
    assert {"user-db", "payment-service"} == set(inc.affected_services)
    assert inc.start_time == T0 and inc.last_event_time == T0 + timedelta(seconds=180)
