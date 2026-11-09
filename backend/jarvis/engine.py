from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from jarvis.correlation import Correlator
from jarvis.graph import ServiceGraph
from jarvis.impact import compute_impact, key_moments, make_title, severity
from jarvis.models import Event, Incident
from jarvis.playbook import Playbook
from jarvis.rca import rank_root_causes, runner_up_note


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Engine:
    """Stores events, correlates them into incidents and enriches each touched incident."""

    def __init__(
        self,
        graph: ServiceGraph | None = None,
        playbook: Playbook | None = None,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.graph = graph or ServiceGraph.default()
        self.playbook = playbook or Playbook.default()
        self.clock = clock
        self._correlator = Correlator(self.graph)
        self._events: list[Event] = []
        self._event_incident: dict[str, str] = {}

    def reset(self) -> None:
        self._correlator.reset()
        self._events = []
        self._event_incident = {}

    def ingest(self, events: list[Event]) -> list[str]:
        self._events.extend(events)
        touched: list[str] = []
        for event in events:
            inc_id = self._correlator.add(event)
            if inc_id is not None and inc_id not in touched:
                touched.append(inc_id)
        changed = [i for i in touched if i in self._correlator.incidents]  # merges may delete ids
        for inc_id in changed:
            self._enrich(self._correlator.incidents[inc_id])
        return changed

    def _enrich(self, inc: Incident) -> None:
        evs = self._correlator.events_for(inc.id)
        for e in evs:
            self._event_incident[e.id] = inc.id  # follows merges
        cands = rank_root_causes(evs, self._events, self.graph)
        for c in cands:
            c.cause_type = self.playbook.cause_type(c, [e for e in evs if e.service == c.service], self.graph)
        inc.root_cause_candidates = cands
        inc.impact = compute_impact(evs, self.clock())
        inc.severity = severity(inc.impact, self.graph)
        inc.key_moments = key_moments(evs)
        inc.status = "investigating"
        if cands:
            top = cands[0]
            inc.cause_phrase = self.playbook.phrase(top.cause_type)
            inc.recommendations = self.playbook.recommend(top.cause_type, top.service)
            inc.title = make_title(inc.impact, top.service, inc.cause_phrase)
            inc.runner_up_note = runner_up_note(cands, evs, self.graph)
        else:
            inc.cause_phrase, inc.recommendations, inc.title, inc.runner_up_note = "", [], "", ""

    def events(
        self, service: str | None = None, level: str | None = None, since: datetime | None = None
    ) -> list[Event]:
        out = [
            e for e in self._events
            if (service is None or e.service == service)
            and (level is None or e.level == level)
            and (since is None or e.timestamp >= since)
        ]
        return sorted(out, key=lambda e: e.timestamp)

    def event_incident(self, event_id: str) -> str | None:
        return self._event_incident.get(event_id)

    def incidents(self, include_candidates: bool = False) -> list[Incident]:
        incs = [i for i in self._correlator.incidents.values() if include_candidates or i.promoted]
        return sorted(incs, key=lambda i: i.start_time, reverse=True)

    def incident(self, incident_id: str) -> Incident | None:
        return self._correlator.incidents.get(incident_id)

    def incident_events(self, incident_id: str) -> list[Event]:
        return self._correlator.events_for(incident_id)

    def stats(self) -> dict:
        incs = self._correlator.incidents.values()
        promoted = sum(1 for i in incs if i.promoted)
        return {
            "raw_alerts": sum(1 for e in self._events if e.is_anomalous),
            "incidents": promoted,
            "isolated": len(incs) - promoted,
        }
