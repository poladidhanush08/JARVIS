from conftest import ev
from jarvis.graph import ServiceGraph
from jarvis.rca import rank_root_causes, runner_up_note


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


def test_runner_up_started_earlier_uses_depend_wording():
    dep = ev(-30, "auth-service", "auth-service v2.3.1", "info", type="deploy")
    evs = [ev(0, "staging-host-3", "queue backlog"), ev(10, "auth-service", "config error"),
           ev(12, "api-gateway", "5xx on /login", type="alert")]
    c = rank_root_causes(evs, [dep, *evs], ServiceGraph.default())
    assert c[0].service == "auth-service" and c[1].service == "staging-host-3"
    assert runner_up_note(c, evs) == "staging-host-3 ranked lower: fewer affected services depend on it"


def test_unknown_service_mixed_with_known_services():
    g = ServiceGraph.default()
    evs = [ev(0, "staging-host-3", "disk full"), ev(1, "user-db", "pool exhausted", "warn"),
           ev(5, "auth-service", "token refresh failing")]
    c = {x.service: x for x in rank_root_causes(evs, evs, g)}
    assert c["staging-host-3"].factors["graph"] == 0
    assert c["user-db"].factors["graph"] == (1 if g.depends_on("auth-service", "user-db") else 0) / 2
    assert c["user-db"].factors["graph"] > 0


def test_runner_up_points_at_most_named_service_overall():
    evs = [ev(0, "user-db", "pool exhausted", "warn")]
    evs += [ev(5 + i, "payment-service", "bank-gateway err") for i in range(3)]
    evs += [ev(10 + i, "payment-service", f"user-db err {i}") for i in range(4)]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[1].service == "payment-service"
    assert runner_up_note(c, evs) == "payment-service ranked lower: its errors point at user-db"


def test_confidence_is_softmax_over_raw_scores():
    from jarvis.rca import CONFIDENCE_TEMPERATURE, softmax_confidences

    assert CONFIDENCE_TEMPERATURE == 10
    assert softmax_confidences([0.60, 0.55]) == [62, 38]  # close call -> Medium
    assert softmax_confidences([0.80]) == [80]  # single candidate: confidence == score
    assert softmax_confidences([0.99, 0.0])[0] == 99  # capped
    assert softmax_confidences([1.0, 1.0]) == [50, 50]


def test_score_keeps_raw_formula_and_confidence_diverges():
    evs = [ev(0, "user-db", "connection pool exhausted", "warn"), ev(5, "auth-service", "DB timeout after 2000ms on user-db")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[0].score >= c[1].score
    assert c[0].confidence != c[0].score
    assert [x.score for x in c] == sorted((x.score for x in c), reverse=True)
