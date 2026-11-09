import type { GraphData, Incident } from "./types";

export type NodeStatus = "root" | "impacted" | "healthy";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  status: NodeStatus;
  label: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  active: boolean;
}

const ROW_Y: Record<string, number> = { frontend: 0, gateway: 100, service: 200, datastore: 300, external: 300 };
const COL_GAP = 200;

export function graphLayout(graph: GraphData, incident?: Incident): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const root = incident?.root_cause_candidates[0]?.service;
  const affected = new Set(incident?.affected_services ?? []);
  const status = (id: string): NodeStatus => (id === root ? "root" : affected.has(id) ? "impacted" : "healthy");

  const rows = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const y = (n.tier ? ROW_Y[n.tier] : undefined) ?? ROW_Y.service;
    rows.set(y, [...(rows.get(y) ?? []), n.id]);
  }

  const nodes: LayoutNode[] = [];
  for (const [y, ids] of rows) {
    ids.sort();
    ids.forEach((id, i) => {
      nodes.push({ id, x: (i - (ids.length - 1) / 2) * COL_GAP, y, status: status(id), label: id });
    });
  }

  const edges = graph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    active: status(e.source) !== "healthy" && status(e.target) !== "healthy",
  }));
  return { nodes, edges };
}
