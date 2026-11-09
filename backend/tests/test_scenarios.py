import pytest

from conftest import T0
from jarvis.engine import Engine
from jarvis.simulator import list_scenarios, load_scenario, scenario_events


def run(sid):
    e = Engine()
    e.ingest(scenario_events(load_scenario(sid), T0))
    return e


def test_list_scenarios_sorted():
    assert [s.id for s in list_scenarios()] == ["a_db_pool", "b_bad_deploy", "c_bank_gateway"]


def test_events_are_deterministic_and_sorted():
    s = load_scenario("a_db_pool")
    a, b = scenario_events(s, T0), scenario_events(s, T0)
    assert [e.id for e in a] == [e.id for e in b]
    assert len({e.id for e in a}) == len(a)
    assert [e.timestamp for e in a] == sorted(e.timestamp for e in a)
    assert all(e.source == "simulator" for e in a)


@pytest.mark.parametrize("sid,root,cause", [("a_db_pool", "user-db", "db_pool_exhaustion"),
                                            ("b_bad_deploy", "auth-service", "bad_deploy"),
                                            ("c_bank_gateway", "bank-gateway", "external_dependency")])
def test_scenario_root_cause(sid, root, cause):
    e = run(sid)
    [inc] = e.incidents()
    assert inc.root_cause_candidates[0].service == root and inc.root_cause_candidates[0].cause_type == cause


def test_scenario_a_collapses_and_excludes_noise():
    e = run("a_db_pool")
    [inc] = e.incidents()
    msgs = {ev.message for ev in e.incident_events(inc.id)}
    assert len(inc.event_ids) >= 15
    assert not msgs & {"CPU 91% for 30s", "TLS certificate expires in 6 days", "slow response 1800ms"}
    assert inc.title == "Logins and payments failing because user-db ran out of connections" and inc.severity == "SEV1"


def test_scenario_c_does_not_blame_db():
    e = run("c_bank_gateway")
    [inc] = e.incidents()
    assert "user-db" not in inc.affected_services
