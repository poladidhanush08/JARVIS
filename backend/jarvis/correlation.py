from __future__ import annotations

from jarvis.graph import ServiceGraph
from jarvis.models import Event, Incident

WEIGHTS = {"time": 0.35, "dependency": 0.35, "signature": 0.2, "trace": 0.1}
THRESHOLD = 0.6
WINDOW_S = 300
PROMOTE_MIN_EVENTS = 3
_HOP_SCORES = {1: 0.6, 2: 0.3}


def _names(message: str, service: str) -> bool:
    return service.lower() in message.lower()


class Correlator:
    """Groups anomalous events into incidents using weighted signals."""

    def __init__(self, graph: ServiceGraph) -> None:
        self.graph = graph
        self.incidents: dict[str, Incident] = {}
        self._events: dict[str, list[Event]] = {}
        self._counter = 0

    def reset(self) -> None:
        self.incidents = {}
        self._events = {}
        self._counter = 0

    def events_for(self, incident_id: str) -> list[Event]:
        return list(self._events.get(incident_id, []))

    def score(self, event: Event, incident: Incident) -> tuple[float, list[str]]:
        events = self._events.get(incident.id, [])
        services = set(incident.affected_services)

        gap = abs((event.timestamp - incident.last_event_time).total_seconds())
        time_s = max(0.0, 1 - gap / WINDOW_S)

        if event.service in services:
            dep_s = 1.0
        else:
            hops = [h for s in services if (h := self.graph.hops(event.service, s)) is not None]
            dep_s = _HOP_SCORES.get(min(hops), 0.0) if hops else 0.0

        sig_s = 0.0
        if any(e.fingerprint == event.fingerprint for e in events):
            sig_s = 1.0
        else:
            names_incident = any(s != event.service and _names(event.message, s) for s in services)
            named_by_incident = any(e.service != event.service and _names(e.message, event.service) for e in events)
            if names_incident or named_by_incident:
                sig_s = 0.8
            endpoint = event.tags.get("endpoint")
            if endpoint and any(e.tags.get("endpoint") == endpoint for e in events):
                sig_s = max(sig_s, 0.6)

        trace_s = 1.0 if event.trace_id and any(e.trace_id == event.trace_id for e in events) else 0.0

        parts = {"time": time_s, "dependency": dep_s, "signature": sig_s, "trace": trace_s}
        total = sum(WEIGHTS[k] * v for k, v in parts.items())
        return total, [k for k, v in parts.items() if v > 0]

    def add(self, event: Event) -> str | None:
        if not event.is_anomalous:
            return None
        scored = []
        for inc in self.incidents.values():
            s, reasons = self.score(event, inc)
            if s >= THRESHOLD:
                scored.append((s, inc, reasons))

        if scored:
            # highest score wins; ties go to the oldest incident (dict is in creation order)
            _, target, reasons = max(scored, key=lambda x: x[0])
            others = [inc for _, inc, _ in scored if inc is not target]
        else:
            target, reasons, others = self._new_incident(event), [], []  # the founding event has no reasons

        self._attach(target, event, reasons)
        for other in others:
            if target.promoted and other.promoted:
                target = self._merge(target, other)
        return target.id

    def _new_incident(self, event: Event) -> Incident:
        self._counter += 1
        inc = Incident(id=f"INC-{self._counter:03d}", start_time=event.timestamp, last_event_time=event.timestamp)
        self.incidents[inc.id] = inc
        self._events[inc.id] = []
        return inc

    def _attach(self, inc: Incident, event: Event, reasons: list[str]) -> None:
        self._events[inc.id].append(event)
        inc.event_ids.append(event.id)
        if event.service not in inc.affected_services:
            inc.affected_services.append(event.service)
        inc.start_time = min(inc.start_time, event.timestamp)
        inc.last_event_time = max(inc.last_event_time, event.timestamp)
        inc.correlation_reasons[event.id] = reasons
        if len(inc.event_ids) >= PROMOTE_MIN_EVENTS or any(e.level == "critical" for e in self._events[inc.id]):
            inc.promoted = True

    def _merge(self, a: Incident, b: Incident) -> Incident:
        keep, gone = (a, b) if a.id <= b.id else (b, a)  # zero-padded ids sort by creation
        self._events[keep.id].extend(self._events.pop(gone.id))
        self._events[keep.id].sort(key=lambda e: e.timestamp)
        keep.event_ids = [e.id for e in self._events[keep.id]]
        for s in gone.affected_services:
            if s not in keep.affected_services:
                keep.affected_services.append(s)
        keep.correlation_reasons.update(gone.correlation_reasons)
        keep.start_time = min(keep.start_time, gone.start_time)
        keep.last_event_time = max(keep.last_event_time, gone.last_event_time)
        keep.promoted = True
        del self.incidents[gone.id]
        return keep
