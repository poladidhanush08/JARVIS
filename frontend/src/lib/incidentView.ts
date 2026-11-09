import { tPlus } from "./format";
import type { LayoutEdge, LayoutNode, NodeStatus } from "./graphLayout";
import type { Event, Incident, KeyMoment } from "./types";

const names = (message: string, service: string) => message.toLowerCase().includes(service.toLowerCase());

const firstEvent = (evs: Event[]) => evs.reduce((a, b) => (Date.parse(a.timestamp) <= Date.parse(b.timestamp) ? a : b));

/** Tooltip for a graph node: how much this service contributed to the incident. */
export function nodeTooltip(service: string, events: Event[], startIso: string): string {
  const own = events.filter((e) => e.service === service);
  if (own.length === 0) return "No events in this incident";
  const first = firstEvent(own);
  return `${own.length} ${own.length === 1 ? "event" : "events"}, first at ${tPlus(first.timestamp, startIso)}`;
}

/** Hover label for an active edge: why the source is linked to the target. */
export function edgeLabel(source: string, target: string, events: Event[]): string {
  const k = events.filter((e) => e.service === source && names(e.message, target)).length;
  return k === 0 ? "dependency" : `${k} events from ${source} naming ${target}`;
}

/**
 * Status of a service while replay is at moment `index` (null = no replay running).
 * The root shows from moment 0; others once their first-anomaly moment is reached.
 * Affected services without a moment of their own appear once their first incident event
 * is at or before the current moment's time (or at the last moment if they have no events).
 */
export function replayStatus(
  base: NodeStatus,
  service: string,
  moments: KeyMoment[],
  index: number | null,
  events: Event[] = [],
): NodeStatus {
  if (index === null || base === "healthy" || base === "root") return base;
  const at = moments.findIndex((m) => m.service === service);
  if (at !== -1) return at <= index ? base : "healthy";
  const own = events.filter((e) => e.service === service);
  if (own.length === 0) return index >= moments.length - 1 ? base : "healthy";
  const current = moments[Math.min(index, moments.length - 1)];
  return current && Date.parse(firstEvent(own).timestamp) <= Date.parse(current.timestamp) ? base : "healthy";
}

export function confidenceTrend(previous: number | undefined, current: number | undefined): "rising" | "steady" {
  return previous !== undefined && current !== undefined && current > previous ? "rising" : "steady";
}

/**
 * True when the live feed carries a newer version of the loaded incident (new events, or a
 * re-rank that changed the top candidate, its confidence, severity or title), or when the
 * incident was in the previous live list (`wasLive`) but is gone now (merged away or reset).
 */
export function needsRefetch(loaded: Incident | null, live: Incident[], wasLive = false): boolean {
  if (!loaded) return false;
  const fresh = live.find((i) => i.id === loaded.id);
  if (!fresh) return wasLive;
  const top = (i: Incident) => i.root_cause_candidates?.[0];
  return (
    fresh.last_event_time !== loaded.last_event_time ||
    fresh.event_ids.length !== loaded.event_ids.length ||
    top(fresh)?.service !== top(loaded)?.service ||
    top(fresh)?.confidence !== top(loaded)?.confidence ||
    fresh.severity !== loaded.severity ||
    fresh.title !== loaded.title
  );
}

export interface ServiceNodeData extends Record<string, unknown> {
  label: string;
  status: NodeStatus;
  tooltip: string;
}

export interface FlowNode {
  id: string;
  type: "service";
  position: { x: number; y: number };
  data: ServiceNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data: { active: boolean };
}

/**
 * React Flow nodes and edges for the incident graph. `replayIndex` limits which services
 * show as non-healthy; an edge is active when both ends are non-healthy. Only the hovered
 * active edge carries a label.
 */
export function graphElements(
  layout: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  incident: Pick<Incident, "key_moments" | "start_time">,
  events: Event[],
  replayIndex: number | null,
  hoveredEdge: string | null,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const status = new Map(
    layout.nodes.map((n) => [n.id, replayStatus(n.status, n.id, incident.key_moments, replayIndex, events)]),
  );
  const nodes: FlowNode[] = layout.nodes.map((n) => ({
    id: n.id,
    type: "service",
    position: { x: n.x, y: n.y },
    data: { label: n.label, status: status.get(n.id) ?? n.status, tooltip: nodeTooltip(n.id, events, incident.start_time) },
  }));
  const edges: FlowEdge[] = layout.edges.map((e) => {
    const active = status.get(e.source) !== "healthy" && status.get(e.target) !== "healthy";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      data: { active },
      ...(active && e.id === hoveredEdge ? { label: edgeLabel(e.source, e.target, events) } : {}),
    };
  });
  return { nodes, edges };
}

/** Up to `max` distinct messages from `source` that name `target`: the evidence behind an edge. */
export function edgeEvidence(source: string, target: string, events: Event[], max = 2): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.service !== source || !names(e.message, target) || out.includes(e.message)) continue;
    out.push(e.message);
    if (out.length >= max) break;
  }
  return out;
}
