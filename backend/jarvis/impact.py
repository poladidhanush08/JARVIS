from datetime import datetime

from jarvis.graph import ServiceGraph
from jarvis.models import Event, Impact, KeyMoment

MAX_KEY_MOMENTS = 6
USER_FACING_TIERS = {"frontend", "gateway"}


def _metric_sum(events: list[Event], name: str) -> int:
    return int(sum(e.metric.value for e in events if e.metric and e.metric.name == name))


def compute_impact(incident_events: list[Event], now: datetime) -> Impact:
    if not incident_events:
        return Impact()
    first = min(e.timestamp for e in incident_events)
    return Impact(
        users_affected=_metric_sum(incident_events, "failed_logins"),
        failed_transactions=_metric_sum(incident_events, "failed_payments"),
        endpoints=sorted({e.tags["endpoint"] for e in incident_events if "endpoint" in e.tags}),
        services=sorted({e.service for e in incident_events}),
        minutes_since_start=max(0, int((now - first).total_seconds() // 60)),
    )


def severity(impact: Impact, graph: ServiceGraph) -> str:
    user_facing = any(graph.tier(s) in USER_FACING_TIERS for s in impact.services)
    if user_facing and (impact.failed_transactions >= 1 or impact.users_affected >= 500):
        return "SEV1"
    if user_facing:
        return "SEV2"
    if len(impact.services) >= 3:
        return "SEV3"
    return "SEV4"


def key_moments(incident_events: list[Event]) -> list[KeyMoment]:
    moments: list[KeyMoment] = []
    seen: set[str] = set()
    for e in sorted(incident_events, key=lambda x: x.timestamp):
        if not e.is_anomalous or e.service in seen:
            continue
        seen.add(e.service)
        label = "first anomaly" if not moments else f"{e.service} affected"
        moments.append(KeyMoment(timestamp=e.timestamp, service=e.service, label=label, event_id=e.id))
        if len(moments) == MAX_KEY_MOMENTS:
            break
    return moments


def make_title(impact: Impact, root_service: str, phrase: str) -> str:
    logins, payments = impact.users_affected > 0, impact.failed_transactions > 0
    if logins and payments:
        symptom = "Logins and payments failing"
    elif payments:
        symptom = "Payments failing"
    elif logins:
        symptom = "Logins failing"
    else:
        symptom = f"{len(impact.services)} services degraded"
    return f"{symptom} because {root_service} {phrase}"
