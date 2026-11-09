import type { Event, Incident, KeyMoment } from "./types";
import { confidenceTrend, edgeLabel, graphElements, needsRefetch, nodeTooltip, replayStatus } from "./incidentView";

const start = "2026-11-09T10:00:00Z";
const ev = (id: string, service: string, message: string, secs: number): Event => ({
  id,
  timestamp: new Date(Date.parse(start) + secs * 1000).toISOString(),
  source: "simulator",
  service,
  type: "log",
  level: "error",
  message,
  fingerprint: id,
  metric: null,
  trace_id: null,
  tags: {},
});
const events = [
  ev("e1", "user-db", "pool exhausted", 0),
  ev("e2", "auth-service", "timeout calling user-db", 4),
  ev("e3", "auth-service", "User-DB refused connection", 9),
  ev("e4", "auth-service", "token cache miss", 12),
];

test("node tooltip counts events and first time", () => {
  expect(nodeTooltip("auth-service", events, start)).toBe("3 events, first at T+4s");
  expect(nodeTooltip("user-db", events, start)).toBe("1 events, first at T+0s");
  expect(nodeTooltip("gateway", events, start)).toBe("No events in this incident");
});

test("edge label counts source events naming the target, case-insensitively", () => {
  expect(edgeLabel("auth-service", "user-db", events)).toBe("2 events from auth-service naming user-db");
  expect(edgeLabel("gateway", "auth-service", events)).toBe("dependency");
});

const moments: KeyMoment[] = [
  { timestamp: start, service: "user-db", label: "first anomaly", event_id: "e1" },
  { timestamp: start, service: "auth-service", label: "auth-service affected", event_id: "e2" },
];

test("replay reveals services by their first-anomaly moment", () => {
  expect(replayStatus("root", "user-db", moments, 0)).toBe("root");
  expect(replayStatus("impacted", "auth-service", moments, 0)).toBe("healthy");
  expect(replayStatus("impacted", "auth-service", moments, 1)).toBe("impacted");
  expect(replayStatus("healthy", "gateway", moments, 1)).toBe("healthy");
  // impacted service without a moment shows at the last moment
  expect(replayStatus("impacted", "web", moments, 0)).toBe("healthy");
  expect(replayStatus("impacted", "web", moments, 1)).toBe("impacted");
  // no replay running: base status
  expect(replayStatus("impacted", "auth-service", moments, null)).toBe("impacted");
});

test("confidence trend", () => {
  expect(confidenceTrend(70, 80)).toBe("rising");
  expect(confidenceTrend(80, 80)).toBe("steady");
  expect(confidenceTrend(80, 70)).toBe("steady");
  expect(confidenceTrend(undefined, 80)).toBe("steady");
});

test("needs refetch when the live copy changed", () => {
  const loaded = { id: "i1", last_event_time: "a", event_ids: ["x"] } as Incident;
  expect(needsRefetch(loaded, [])).toBe(false);
  expect(needsRefetch(loaded, [{ ...loaded }])).toBe(false);
  expect(needsRefetch(loaded, [{ ...loaded, last_event_time: "b" }])).toBe(true);
  expect(needsRefetch(loaded, [{ ...loaded, event_ids: ["x", "y"] }])).toBe(true);
  expect(needsRefetch(loaded, [{ ...loaded, id: "other", last_event_time: "b" }])).toBe(false);
  expect(needsRefetch(null, [{ ...loaded }])).toBe(false);
});

test("graph elements apply replay status, edge activity and hover label", () => {
  const layout = {
    nodes: [
      { id: "auth-service", x: 0, y: 200, status: "impacted" as const, label: "auth-service" },
      { id: "user-db", x: 0, y: 300, status: "root" as const, label: "user-db" },
      { id: "gateway", x: 0, y: 100, status: "healthy" as const, label: "gateway" },
    ],
    edges: [
      { id: "auth-service->user-db", source: "auth-service", target: "user-db", active: true },
      { id: "gateway->auth-service", source: "gateway", target: "auth-service", active: false },
    ],
  };
  const inc = { key_moments: moments, start_time: start };

  const live = graphElements(layout, inc, events, null, "auth-service->user-db");
  expect(live.nodes.find((n) => n.id === "auth-service")!.data).toEqual({
    label: "auth-service",
    status: "impacted",
    tooltip: "3 events, first at T+4s",
  });
  expect(live.edges[0]).toMatchObject({ data: { active: true }, label: "2 events from auth-service naming user-db" });
  expect(live.edges[1].data.active).toBe(false);
  expect(live.edges[1].label).toBeUndefined();

  const replay = graphElements(layout, inc, events, 0, "auth-service->user-db");
  expect(replay.nodes.find((n) => n.id === "auth-service")!.data.status).toBe("healthy");
  expect(replay.nodes.find((n) => n.id === "user-db")!.data.status).toBe("root");
  expect(replay.edges[0].data.active).toBe(false);
  expect(replay.edges[0].label).toBeUndefined();
});
