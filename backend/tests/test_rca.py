from datetime import datetime, timedelta, timezone

from jarvis.graph import ServiceGraph
from jarvis.models import Event
from jarvis.rca import rank_root_causes, runner_up_note

T0 = datetime(2026, 11, 9, 10, 0, 0, tzinfo=timezone.utc)


def ev(t, service, msg, level="error", **kw):
    return Event(timestamp=T0 + timedelta(seconds=t), service=service, message=msg, level=level, **kw)


def test_db_is_root_when_first_and_depended_on():
    evs = [ev(0, "user-db", "connection pool exhausted", "warn"), ev(5, "auth-service", "DB timeout after 2000ms on user-db"),
           ev(18, "payment-service", "DB timeout after 2000ms on user-db"), ev(25, "api-gateway", "5xx on /login", type="alert")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[0].service == "user-db" and c[0].confidence >= 75
    assert any("depend on it" in s for s in c[0].evidence)


def test_recent_deploy_boosts_change_factor():
    dep = ev(-30, "auth-service", "auth-service v2.3.1", "info", type="deploy")
    evs = [ev(0, "auth-service", "config error: invalid JWT signing key"), ev(5, "api-gateway", "5xx on /login", type="alert")]
    c = rank_root_causes(evs, [dep, *evs], ServiceGraph.default())
    assert c[0].service == "auth-service" and c[0].factors["change"] == 1.0
    assert "Deployed auth-service v2.3.1 30s before onset" in c[0].evidence


def test_unknown_service_ranked_without_crash():
    evs = [ev(0, "staging-host-3", "disk full"), ev(1, "staging-host-3", "disk full")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[0].service == "staging-host-3" and c[0].factors["graph"] == 0


def test_runner_up_note_names_pointed_service():
    evs = [ev(0, "user-db", "pool exhausted", "warn"), ev(5, "auth-service", "DB timeout after 2000ms on user-db")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert runner_up_note(c, evs) == "auth-service ranked lower: its errors point at user-db"


def test_runner_up_note_later_onset_and_short_list():
    evs = [ev(0, "user-db", "pool exhausted", "warn"), ev(7, "auth-service", "token refresh failing")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert runner_up_note(c, evs) == "auth-service ranked lower: its first anomaly came 7s later"
    assert runner_up_note(c[:1], evs) == ""
