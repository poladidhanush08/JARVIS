import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { animate } from "motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { canAnimate } from "../hooks/useCountUp";
import type { LayoutEdge, LayoutNode, NodeStatus } from "../lib/graphLayout";
import { edgeEvidence, edgeLabel, graphElements, type ServiceNodeData } from "../lib/incidentView";
import type { Event, Incident } from "../lib/types";

const NODE_STYLE: Record<NodeStatus, string> = {
  root: "border-root bg-[color-mix(in_srgb,var(--root)_14%,var(--surface))] root-pulse",
  impacted: "border-impacted/70 bg-[color-mix(in_srgb,var(--impacted)_10%,var(--surface))]",
  healthy: "border-line bg-surface opacity-45",
};
const STATUS_WORD: Record<NodeStatus, string> = { root: "root cause", impacted: "impacted", healthy: "healthy" };
const WORD_STYLE: Record<NodeStatus, string> = { root: "text-root", impacted: "text-impacted", healthy: "text-muted" };

type ServiceNode = Node<ServiceNodeData, "service">;

interface PulseData extends Record<string, unknown> {
  active: boolean;
  /** Replay is running and this edge is lit: send a red pulse along it. */
  pulse: boolean;
  /** Changes on every replay step so each step sends a fresh pulse. */
  pulseKey: number;
  hovered: boolean;
  title: string;
  summary: string;
  evidence: string[];
}
type PulseEdge = Edge<PulseData, "pulse">;

function ServiceNodeView({ data }: NodeProps<ServiceNode>) {
  return (
    <div
      title={data.tooltip}
      className={`flex w-44 flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center text-ink transition-[background-color,border-color,opacity] duration-300 ease-out ${NODE_STYLE[data.status]}`}
    >
      <Handle type="target" position={Position.Top} className="!invisible" isConnectable={false} />
      <span className="max-w-full break-words font-mono text-[13px] font-semibold leading-tight">{data.label}</span>
      <span className={`text-[12px] ${WORD_STYLE[data.status]}`}>{STATUS_WORD[data.status]}</span>
      <Handle type="source" position={Position.Bottom} className="!invisible" isConnectable={false} />
    </div>
  );
}

/** A red dot that runs once along `path`, from its end (the dependency) to its start. */
function PulseDot({ path }: { path: string }) {
  const guide = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const p = guide.current;
    const c = dot.current;
    if (!p || !c || typeof p.getTotalLength !== "function" || !canAnimate()) return;
    const len = p.getTotalLength();
    const controls = animate(0, 1, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (t) => {
        const pt = p.getPointAtLength(len * (1 - t));
        c.setAttribute("cx", String(pt.x));
        c.setAttribute("cy", String(pt.y));
        c.setAttribute("opacity", String(t < 0.85 ? 1 : (1 - t) / 0.15));
      },
    });
    return () => controls.stop();
  }, [path]);
  return (
    <g pointerEvents="none">
      <path ref={guide} d={path} fill="none" stroke="none" />
      <circle ref={dot} r="4" fill="var(--root)" opacity="0" />
    </g>
  );
}

/** Dependency edge: failure travels from the dependency (target) up to its caller (source). */
function PulseEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<PulseEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const active = !!data?.active;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: data?.hovered ? "var(--ink)" : active ? "var(--muted)" : "var(--line)",
          strokeWidth: active ? 1.5 : 1,
          transition: "stroke 200ms ease-out",
        }}
      />
      {data?.pulse && <PulseDot key={data.pulseKey} path={path} />}
      {data?.hovered && (
        <EdgeLabelRenderer>
          <div
            role="tooltip"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="nodrag nopan pointer-events-none absolute z-10 w-64 rounded-lg border border-line bg-surface-2 p-3 text-label text-ink shadow-lg"
          >
            <div className="font-mono font-semibold">{data.title}</div>
            <div className="text-muted">{data.summary}</div>
            {data.evidence.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {data.evidence.map((m) => (
                  <li key={m} className="line-clamp-2 border-l-2 border-line pl-2 text-[12px] text-muted">
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { service: ServiceNodeView };
const edgeTypes = { pulse: PulseEdgeView };

export default function AffectedGraph({
  layout,
  incident,
  events,
  replayIndex,
  replaying = false,
}: {
  layout: { nodes: LayoutNode[]; edges: LayoutEdge[] };
  incident: Incident;
  events: Event[];
  /** Moment the graph shows (replay step or a clicked key moment); null = live. */
  replayIndex: number | null;
  replaying?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const els = graphElements(layout, incident, events, replayIndex, hovered);
    const flowEdges: PulseEdge[] = els.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "pulse",
      data: {
        active: e.data.active,
        pulse: replaying && e.data.active,
        pulseKey: replayIndex ?? -1,
        hovered: e.id === hovered,
        title: `${e.source} → ${e.target}`,
        summary: e.data.active ? edgeLabel(e.source, e.target, events) : "dependency (not involved)",
        evidence: e.data.active ? edgeEvidence(e.source, e.target, events) : [],
      },
    }));
    return { nodes: els.nodes as ServiceNode[], edges: flowEdges };
  }, [layout, incident, events, replayIndex, hovered, replaying]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        colorMode="dark"
        onEdgeMouseEnter={(_, edge) => setHovered(edge.id)}
        onEdgeMouseLeave={() => setHovered(null)}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
