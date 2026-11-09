from collections import Counter

from jarvis.graph import ServiceGraph
from jarvis.models import Event, RootCauseCandidate

DEPLOY_WINDOW_S = 600


def _names(message: str, service: str) -> bool:
    return service.lower() in message.lower()


def _named_services(message: str, service: str, known: list[str]) -> list[str]:
    return [other for other in known if other != service and _names(message, other)]


def _most_common(messages: list[str]) -> str:
    # Counter preserves first-occurrence order on ties.
    return Counter(messages).most_common(1)[0][0]


def rank_root_causes(
    incident_events: list[Event], all_events: list[Event], graph: ServiceGraph
) -> list[RootCauseCandidate]:
    anomalous = sorted((e for e in incident_events if e.is_anomalous), key=lambda e: e.timestamp)
    if not anomalous:
        return []
    known = [n["id"] for n in graph.nodes()]
    t0, t_last = anomalous[0].timestamp, anomalous[-1].timestamp
    span = max((t_last - t0).total_seconds(), 1.0)

    by_service: dict[str, list[Event]] = {}
    for e in anomalous:
        by_service.setdefault(e.service, []).append(e)
    affected = list(by_service)

    out: list[RootCauseCandidate] = []
    for s, evs in by_service.items():
        onset = evs[0].timestamp
        onset_s = int((onset - t0).total_seconds())
        first = 1 - (onset - t0).total_seconds() / span
        k = sum(1 for x in affected if x != s and graph.depends_on(x, s))
        n_other = len(affected) - 1
        g = k / max(n_other, 1)
        deploy = None
        for d in all_events:
            if d.type == "deploy" and d.service == s:
                dt = (onset - d.timestamp).total_seconds()
                if 0 <= dt <= DEPLOY_WINDOW_S and (deploy is None or d.timestamp > deploy.timestamp):
                    deploy = d
        change = 1.0 if deploy else 0.0
        own_msgs = [e.message for e in evs if not _named_services(e.message, s, known)]
        own = len(own_msgs) / len(evs)

        factors = {"first": first, "graph": g, "change": change, "own": own}
        conf = min(99, round(100 * (0.35 * first + 0.30 * g + 0.20 * change + 0.15 * own)))

        evidence: list[str] = []
        if first > 0:
            evidence.append(
                f"First anomaly in the incident at T+{onset_s}s" if first == 1 else f"First anomaly at T+{onset_s}s"
            )
        if g > 0:
            evidence.append(f"{k} of {n_other} other affected services depend on it")
        if deploy:
            evidence.append(f"Deployed {deploy.message} {int((onset - deploy.timestamp).total_seconds())}s before onset")
        if own > 0:
            evidence.append(f'Its own errors: "{_most_common(own_msgs)}"')
        out.append(RootCauseCandidate(service=s, cause_type="", confidence=conf, factors=factors, evidence=evidence))

    out.sort(key=lambda c: (-c.confidence, c.service))
    return out


def runner_up_note(
    cands: list[RootCauseCandidate], incident_events: list[Event], graph: ServiceGraph | None = None
) -> str:
    if len(cands) < 2:
        return ""
    top, run = cands[0], cands[1]
    known = [n["id"] for n in (graph or ServiceGraph.default()).nodes()]
    anomalous = [e for e in incident_events if e.is_anomalous]
    mine = [e for e in anomalous if e.service == run.service]
    if mine:
        msgs = [e.message for e in mine]
        counts = Counter(o for m in msgs for o in _named_services(m, run.service, known))
        if counts:
            return f"{run.service} ranked lower: its errors point at {counts.most_common(1)[0][0]}"
    top_first = min((e.timestamp for e in anomalous if e.service == top.service), default=None)
    run_first = min((e.timestamp for e in mine), default=None)
    if top_first and run_first and run_first > top_first:
        d = int((run_first - top_first).total_seconds())
        return f"{run.service} ranked lower: its first anomaly came {d}s later"
    return f"{run.service} ranked lower: fewer affected services depend on it"
