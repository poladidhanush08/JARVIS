from datetime import datetime, timedelta, timezone

import pytest

from jarvis.graph import ServiceGraph
from jarvis.impact import compute_impact, key_moments, make_title, severity
from jarvis.models import Event, Incident, RootCauseCandidate
from jarvis.playbook import Playbook

T0 = datetime(2026, 11, 9, 10, 0, 0, tzinfo=timezone.utc)


def ev(t, service, msg, level="error", **kw):
    return Event(timestamp=T0 + timedelta(seconds=t), service=service, message=msg, level=level, **kw)


@pytest.fixture
def sample_events():
    return [
        ev(0, "user-db", "connection pool exhausted", "warn"),
        ev(5, "auth-service", "DB timeout after 2000ms on user-db", type="metric",
           metric={"name": "failed_logins", "value": 420}, tags={"endpoint": "/login"}),
        ev(18, "payment-service", "DB timeout after 2000ms on user-db", type="metric",
           metric={"name": "failed_payments", "value": 104}, tags={"endpoint": "/pay"}),
        ev(25, "api-gateway", "5xx on /login", type="alert"),
    ]


@pytest.fixture
def sample_incident(sample_events):
    g, pb = ServiceGraph.default(), Playbook.default()
    impact = compute_impact(sample_events, now=T0 + timedelta(minutes=4))
    root = RootCauseCandidate(
        service="user-db", cause_type="", score=82, confidence=82,
        factors={"first": 1, "graph": 1, "change": 0, "own": 1},
        evidence=["First anomaly in the incident", "3 of 3 other affected services depend on it"],
    )
    cause = pb.cause_type(root, sample_events[:1], g)
    root.cause_type = cause
    return Incident(
        id="INC-001",
        title=make_title(impact, root.service, pb.phrase(cause)),
        severity=severity(impact, g),
        start_time=sample_events[0].timestamp,
        last_event_time=sample_events[-1].timestamp,
        event_ids=[e.id for e in sample_events],
        affected_services=impact.services,
        root_cause_candidates=[root],
        impact=impact,
        recommendations=pb.recommend(cause, root.service),
        key_moments=key_moments(sample_events),
        runner_up_note="auth-service ranked lower: its errors point at user-db",
        cause_phrase=pb.phrase(cause),
    )
