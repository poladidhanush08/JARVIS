from jarvis.models import Event, Incident

_FOLLOW_UPS = [
    "Hold a blameless post-incident review",
    "Add or tune alerting for the first-anomaly signal",
    "Track completion of the prevention steps above",
]


def render_markdown(incident: Incident, events: list[Event]) -> str:
    imp = incident.impact
    started = incident.start_time.strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# {incident.title}",
        "",
        f"**Severity:** {incident.severity} · **Status:** {incident.status} · **Started:** {started} UTC",
        "",
        "## Summary",
        f"{incident.title}. {len(incident.affected_services)} services affected "
        f"({', '.join(incident.affected_services)}) across {len(events)} events.",
        "",
        "## Impact",
        f"- Users affected: {imp.users_affected}",
        f"- Failed transactions: {imp.failed_transactions}",
        f"- Endpoints: {', '.join(imp.endpoints) or 'none'}",
        f"- Services: {', '.join(imp.services) or 'none'}",
        f"- Minutes since start: {imp.minutes_since_start}",
        "",
        "## Timeline",
        "| Time (UTC) | Service | Moment |",
        "| --- | --- | --- |",
    ]
    for m in incident.key_moments:
        lines.append(f"| {m.timestamp.strftime('%H:%M:%S')} | {m.service} | {m.label} |")
    lines += ["", "## Root cause"]
    if incident.root_cause_candidates:
        top = incident.root_cause_candidates[0]
        lines.append(f"**{top.service}** ({top.cause_type or 'unclassified'}), confidence {top.confidence}% (evidence score {top.score}/100)")
        lines += [f"- {e}" for e in top.evidence]
        if incident.runner_up_note:
            lines.append(f"- {incident.runner_up_note}")
    else:
        lines.append("No root cause candidate identified.")
    lines += ["", "## Recommended actions"]
    for r in incident.recommendations:
        lines.append(f"{r.step}. {r.action} ({r.effect})")
        if r.command:
            lines.append(f"   `{r.command}`")
        lines.append(f"   Verify: {r.verify}")
    lines += ["", "## Follow-ups"]
    lines += [f"- {f}" for f in _FOLLOW_UPS]
    return "\n".join(lines) + "\n"
