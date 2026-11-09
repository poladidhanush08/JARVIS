from __future__ import annotations

from pathlib import Path

import networkx as nx
import yaml


class ServiceGraph:
    """Service dependency graph; an edge A -> B means A depends on B."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self._g = graph
        self._undirected = graph.to_undirected()

    @classmethod
    def load(cls, path: Path) -> ServiceGraph:
        with open(path, encoding="utf-8") as f:
            services = (yaml.safe_load(f) or {}).get("services", {})
        g = nx.DiGraph()
        for name, spec in services.items():
            g.add_node(name, tier=spec.get("tier"))
        for name, spec in services.items():
            for dep in spec.get("depends_on") or []:
                g.add_edge(name, dep)
        return cls(g)

    @classmethod
    def default(cls) -> ServiceGraph:
        return cls.load(Path(__file__).resolve().parent.parent / "data" / "services.yaml")

    def tier(self, service: str) -> str | None:
        if service not in self._g:
            return None
        return self._g.nodes[service].get("tier")

    def hops(self, a: str, b: str) -> int | None:
        if a not in self._g or b not in self._g:
            return None
        try:
            return nx.shortest_path_length(self._undirected, a, b)
        except nx.NetworkXNoPath:
            return None

    def depends_on(self, a: str, b: str) -> bool:
        if a not in self._g or b not in self._g:
            return False
        return nx.has_path(self._g, a, b)

    def nodes(self) -> list[dict]:
        return [{"id": n, "tier": d.get("tier")} for n, d in self._g.nodes(data=True)]

    def edges(self) -> list[dict]:
        return [{"source": s, "target": t} for s, t in self._g.edges()]
