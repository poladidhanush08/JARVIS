from datetime import timedelta

from conftest import T0, ev
from jarvis.graph import ServiceGraph
from jarvis.impact import compute_impact, key_moments, make_title, severity
from jarvis.models import Impact


def test_impact_sums_metrics_and_endpoints():
    evs = [ev(0, "auth-service", "login failures", type="metric", metric={"name": "failed_logins", "value": 420}, tags={"endpoint": "/login"}),
           ev(10, "payment-service", "txn failures", type="metric", metric={"name": "failed_payments", "value": 104}, tags={"endpoint": "/pay"})]
    imp = compute_impact(evs, now=T0 + timedelta(minutes=4, seconds=10))
    assert (imp.users_affected, imp.failed_transactions, imp.endpoints, imp.minutes_since_start) == (420, 104, ["/login", "/pay"], 4)
    assert imp.services == ["auth-service", "payment-service"]


def test_severity_rules():
    g = ServiceGraph.default()
    assert severity(Impact(failed_transactions=1, services=["api-gateway"]), g) == "SEV1"
    assert severity(Impact(users_affected=500, services=["web-frontend"]), g) == "SEV1"
    assert severity(Impact(services=["api-gateway"]), g) == "SEV2"
    assert severity(Impact(services=["a", "b", "c"]), g) == "SEV3"
    assert severity(Impact(services=["user-db"]), g) == "SEV4"


def test_title():
    assert make_title(Impact(users_affected=5, failed_transactions=2), "user-db", "ran out of connections") == \
        "Logins and payments failing because user-db ran out of connections"
    assert make_title(Impact(failed_transactions=2), "x", "is failing") == "Payments failing because x is failing"
    assert make_title(Impact(users_affected=2), "x", "is failing") == "Logins failing because x is failing"
    assert make_title(Impact(services=["a", "b"]), "x", "is failing") == "2 services degraded because x is failing"
    assert make_title(Impact(services=["a"]), "x", "is failing") == "1 service degraded because x is failing"


def test_key_moments_first_anomaly_per_service_capped():
    evs = [ev(0, "user-db", "pool", "warn"), ev(1, "user-db", "again"), ev(2, "auth-service", "ok", "info"),
           ev(5, "auth-service", "timeout"), ev(9, "api-gateway", "5xx", type="alert")]
    km = key_moments(evs)
    assert [(m.service, m.label) for m in km] == [("user-db", "first anomaly"), ("auth-service", "auth-service affected"),
                                                   ("api-gateway", "api-gateway affected")]
    assert km[1].event_id == evs[3].id
    many = [ev(i, f"s{i}", "boom") for i in range(9)]
    assert len(key_moments(many)) == 6
