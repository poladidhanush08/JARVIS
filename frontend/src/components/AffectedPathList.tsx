import { useMemo } from "react";
import { tPlus } from "../lib/format";
import type { LayoutEdge, LayoutNode, NodeStatus } from "../lib/graphLayout";
import { graphElements } from "../lib/incidentView";
import type { Event, Incident } from "../lib/types";

const DOT: Record<NodeStatus, string> = { root: "bg-root", impacted: "bg-impacted", healthy: "bg-healthy/50" };
const WORD: Record<NodeStatus, string> = { root: "root cause", impacted: "impacted", healthy: "waiting" };
const WORD_STYLE: Record<NodeStatus, string> = { root: "text-root", impacted: "text-impacted", healthy: "text-muted" };

interface Row {
  id: string;
  status: NodeStatus;
  base: NodeStatus;
  first: string | null;
  count: number;
}

/**
 * Phone-sized stand-in for the dependency graph: the affected services as a vertical list,
 * root cause first, then the rest in order of first anomaly. Statuses come from the same
 * `graphElements` call the graph uses, so replay and selected moments match exactly.
 */
export default function AffectedPathList({
  layout,
  incident,
  events,
  replayIndex,
}: {
  layout: { nodes: LayoutNode[]; edges: LayoutEdge[] };
  incident: Incident;
  events: Event[];
  replayIndex: number | null;
}) {
  const { rows, healthy } = useMemo(() => {
    const shown = new Map(graphElements(layout, incident, events, replayIndex, null).nodes.map((n) => [n.id, n.data.status]));
    const all: Row[] = layout.nodes
      .filter((n) => n.status !== "healthy")
      .map((n) => {
        const own = events.filter((e) => e.service === n.id);
        const times = own.map((e) => e.timestamp);
        if (times.length === 0) {
          const m = incident.key_moments.find((k) => k.service === n.id);
          if (m) times.push(m.timestamp);
        }
        const first = times.length ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
        return { id: n.id, status: shown.get(n.id) ?? n.status, base: n.status, first, count: own.length };
      });
    const at = (r: Row) => (r.first ? Date.parse(r.first) : Infinity);
    all.sort((a, b) => Number(b.base === "root") - Number(a.base === "root") || at(a) - at(b) || a.id.localeCompare(b.id));
    return { rows: all, healthy: layout.nodes.filter((n) => n.status === "healthy").length };
  }, [layout, incident, events, replayIndex]);

  return (
    <div className="flex flex-col gap-3 px-5 py-4" role="group" aria-label="Affected services graph">
      <ol aria-label="Affected services" className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 transition-colors duration-200 ease-out"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-200 ease-out ${DOT[r.status]}`}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="break-words font-mono text-[13px] font-semibold leading-tight text-ink">{r.id}</span>
              <span className={`text-label transition-colors duration-200 ease-out ${WORD_STYLE[r.status]}`}>
                {WORD[r.status]}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end text-label text-muted">
              {r.first && <span>{tPlus(r.first, incident.start_time)}</span>}
              <span>{r.count === 1 ? "1 event" : `${r.count} events`}</span>
            </div>
          </li>
        ))}
      </ol>
      {healthy > 0 && (
        <p className="text-label text-muted">
          {healthy === 1 ? "1 healthy service not involved" : `${healthy} healthy services not involved`}
        </p>
      )}
    </div>
  );
}
