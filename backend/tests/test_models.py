from datetime import datetime, timezone

from jarvis.models import Event


def test_naive_timestamp_is_utc():
    e = Event(timestamp=datetime(2026, 11, 9, 10, 0, 0), service="a", message="x")
    assert e.timestamp.tzinfo == timezone.utc


def test_fingerprint_autofilled_and_anomaly_flag():
    e = Event(timestamp="2026-11-09T10:00:00Z", service="auth-service", level="error", message="DB timeout after 2000ms on user-db")
    assert e.fingerprint == "db timeout after <n>ms on user-db" and e.is_anomalous
    assert not Event(timestamp="2026-11-09T10:00:00Z", service="a", level="info", message="ok").is_anomalous
    assert Event(timestamp="2026-11-09T10:00:00Z", service="a", type="alert", level="info", message="x").is_anomalous
