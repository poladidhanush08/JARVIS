from __future__ import annotations

from pathlib import Path

import yaml

from jarvis.graph import ServiceGraph
from jarvis.models import Event, Recommendation, RootCauseCandidate

DEFAULT_TYPE = "generic"


def _fill(text: str, service: str) -> str:
    return text.replace("{service}", service)


class Playbook:
    def __init__(self, types: dict[str, dict]) -> None:
        self._types = types

    @classmethod
    def load(cls, path: Path) -> Playbook:
        with open(path, encoding="utf-8") as f:
            return cls(yaml.safe_load(f) or {})

    @classmethod
    def default(cls) -> Playbook:
        return cls.load(Path(__file__).resolve().parent.parent / "data" / "playbooks.yaml")

    def cause_type(self, root: RootCauseCandidate, root_events: list[Event], graph: ServiceGraph) -> str:
        if root.factors.get("change") == 1:
            return "bad_deploy"
        if graph.tier(root.service) == "external":
            return "external_dependency"
        messages = [e.message.lower() for e in root_events]
        for name, spec in self._types.items():
            if any(m.lower() in msg for m in spec.get("match") or [] for msg in messages):
                return name
        return DEFAULT_TYPE

    def _spec(self, cause_type: str) -> dict:
        return self._types.get(cause_type) or self._types[DEFAULT_TYPE]

    def recommend(self, cause_type: str, service: str) -> list[Recommendation]:
        recs = []
        for i, s in enumerate(self._spec(cause_type).get("steps", []), start=1):
            command = s.get("command")
            recs.append(Recommendation(
                step=i,
                action=_fill(s["action"], service),
                effect=_fill(s["effect"], service),
                command=_fill(command, service) if command else None,
                verify=_fill(s["verify"], service),
            ))
        return recs

    def phrase(self, cause_type: str) -> str:
        return self._spec(cause_type)["phrase"]
