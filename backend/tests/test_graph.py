from jarvis.graph import ServiceGraph

g = ServiceGraph.default()


def test_hops():
    assert g.hops("auth-service", "user-db") == 1
    assert g.hops("notification-service", "api-gateway") == 2
    assert g.hops("user-db", "user-db") == 0


def test_unknown_service_is_none_not_error():
    assert g.hops("staging-host-3", "user-db") is None
    assert g.tier("staging-host-3") is None
    assert g.depends_on("staging-host-3", "user-db") is False


def test_transitive_dependency():
    assert g.depends_on("web-frontend", "user-db")
    assert not g.depends_on("user-db", "auth-service")


def test_export_shapes():
    assert {"id": "user-db", "tier": "datastore"} in g.nodes()
    assert {"source": "payment-service", "target": "bank-gateway"} in g.edges()
