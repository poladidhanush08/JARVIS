from conftest import ev
from jarvis.graph import ServiceGraph
from jarvis.models import RootCauseCandidate
from jarvis.playbook import Playbook


def _root(service, change=0):
    return RootCauseCandidate(service=service, cause_type="", confidence=80, factors={"first": 1, "graph": 1, "change": change, "own": 1}, evidence=[])


def test_cause_type_and_recommendations():
    pb = Playbook.default(); g = ServiceGraph.default()
    assert pb.cause_type(_root("user-db"), [ev(0, "user-db", "Connection POOL exhausted")], g) == "db_pool_exhaustion"
    recs = pb.recommend("db_pool_exhaustion", "user-db")
    assert recs[0].step == 1 and "user-db" in recs[0].action and recs[0].verify
    assert recs[0].command == "kubectl set env deploy/user-db POOL_MAX=400"
    assert recs[3].command is None and len(recs) == 4


def test_cause_type_order():
    pb = Playbook.default(); g = ServiceGraph.default()
    assert pb.cause_type(_root("auth-service", 1), [ev(0, "auth-service", "pool exhausted")], g) == "bad_deploy"
    assert pb.cause_type(_root("bank-gateway"), [ev(0, "bank-gateway", "slow")], g) == "external_dependency"
    assert pb.cause_type(_root("auth-service"), [ev(0, "auth-service", "weird")], g) == "generic"


def test_phrases():
    pb = Playbook.default()
    assert pb.phrase("db_pool_exhaustion") == "ran out of connections"
    assert pb.phrase("bad_deploy") == "had a bad deploy"
    assert pb.phrase("external_dependency") == "is degraded"
    assert pb.phrase("generic") == "is failing"
    assert pb.phrase("unknown") == "is failing"
