import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import type { LayoutEdge, LayoutNode, NodeStatus } from "../lib/graphLayout";
import { graphElements, type ServiceNodeData } from "../lib/incidentView";
import type { Event, Incident } from "../lib/types";

const NODE_STYLE: Record<NodeStatus, string> = {
  root: "border-2 border-root bg-root/10",
  impacted: "border border-impacted bg-impacted/10",
  healthy: "border border-line bg-surface opacity-50",
};
const STATUS_WORD: Record<NodeStatus, string> = { root: "root cause", impacted: "impacted", healthy: "" };

type ServiceNode = Node<ServiceNodeData, "service">;

function ServiceNodeView({ data }: NodeProps<ServiceNode>) {
  return (
    <div
      title={data.tooltip}
      className={`flex w-36 flex-col items-center rounded-lg px-2 py-1.5 text-center text-ink transition-[background-color,border-color,opacity] duration-200 ${NODE_STYLE[data.status]}`}
    >
      <Handle type="target" position={Position.Top} className="!invisible" isConnectable={false} />
      <span className="max-w-full truncate text-label font-semibold">{data.label}</span>
      {data.status !== "healthy" && <span className="text-label text-muted">{STATUS_WORD[data.status]}</span>}
      <Handle type="source" position={Position.Bottom} className="!invisible" isConnectable={false} />
    </div>
  );
}

const nodeTypes = { service: ServiceNodeView };

export default function AffectedGraph({
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
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const els = graphElements(layout, incident, events, replayIndex, hovered);
    const flowEdges: Edge[] = els.edges.map((e) => ({
      ...e,
      style: e.data.active
        ? { stroke: "var(--muted)", strokeWidth: 1.5 }
        : { stroke: "var(--line)", strokeWidth: 1 },
      labelStyle: { fill: "var(--ink)", fontSize: 13 },
      labelBgStyle: { fill: "var(--surface)" },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
    }));
    return { nodes: els.nodes as ServiceNode[], edges: flowEdges };
  }, [layout, incident, events, replayIndex, hovered]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        colorMode="system"
        onEdgeMouseEnter={(_, edge) => setHovered(edge.id)}
        onEdgeMouseLeave={() => setHovered(null)}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
