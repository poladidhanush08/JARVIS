import type { Event, Incident } from "./types";
import { collapseStagger, pendingEvents, serviceStatus } from "./collapse";

const NOW = new Date("2026-11-09T12:00:00Z");

function ev(id: string, secsAgo: number, over: Partial<Event> = {}): Event {
  return {
    id,
    timestamp: new Date(NOW.getTime() - secsAgo * 1000).toISOString(),
    source: "simulator",
    service: "checkout",
    type: "log",
    level: "error",
    message: "boom",
    fingerprint: id,
    metric: null,
    trace_id: null,
    tags: {},
    ...over,
  };
}

function inc(over: Partial<Incident>): Incident {
  return { id: "inc", event_ids: [], affected_services: [], root_cause_candidates: [], ...over } as Incident;
}

test("pendingEvents keeps recent anomalous events not yet in an incident", () => {
  const events = [
    ev("fresh-error", 2),
    ev("fresh-alert", 3, { type: "alert", level: "info" }),
    ev("fresh-warn", 4, { level: "warn" }),
    ev("fresh-critical", 5, { level: "critical" }),
    ev("fresh-info", 1, { level: "info" }),
    ev("old-error", 11),
    ev("grouped", 1),
  ];
  const ids = pendingEvents(events, [inc({ event_ids: ["grouped"] })], NOW).map((e) => e.id);
  expect(ids).toEqual(["fresh-error", "fresh-alert", "fresh-warn", "fresh-critical"]);
});

test("pendingEvents ages events by client arrival time when known", () => {
  // simulator timestamps are compressed and drift from the wall clock
  const events = [ev("arrived-now", 3600), ev("arrived-long-ago", 0), ev("unknown", 2)];
  const receivedAt = new Map([
    ["arrived-now", NOW.getTime() - 1000],
    ["arrived-long-ago", NOW.getTime() - 11_000],
  ]);
  const ids = pendingEvents(events, [], NOW, receivedAt).map((e) => e.id);
  expect(ids).toEqual(["arrived-now", "unknown"]);
});

test("serviceStatus: root of any incident wins over impacted", () => {
  const incidents = [
    inc({ affected_services: ["api", "db"], root_cause_candidates: [{ service: "db" } as Incident["root_cause_candidates"][0]] }),
    inc({ affected_services: ["cache"], root_cause_candidates: [] }),
  ];
  expect(serviceStatus("db", incidents)).toBe("root");
  expect(serviceStatus("api", incidents)).toBe("impacted");
  expect(serviceStatus("cache", incidents)).toBe("impacted");
  expect(serviceStatus("search", incidents)).toBe("healthy");
});

test("collapseStagger caps per-card delay and keeps the whole collapse within 2 s", () => {
  expect(collapseStagger(1, 300)).toBe(0);
  expect(collapseStagger(4, 300)).toBe(200);
  const n = 40;
  const s = collapseStagger(n, 300);
  expect(s * (n - 1) + 300).toBeLessThanOrEqual(2000);
});

test("excluded events are anomalous, ungrouped and older than the window", async () => {
  const { excludedEvents } = await import("./collapse");
  const now = new Date("2026-11-09T12:00:30Z");
  const mk = (id: string, at: string, level: "error" | "info" = "error") =>
    ({ id, timestamp: at, type: "log", level, service: "s", message: "m" }) as unknown as import("./types").Event;
  const events = [
    mk("old", "2026-11-09T12:00:00Z"),
    mk("fresh", "2026-11-09T12:00:25Z"),
    mk("quiet", "2026-11-09T12:00:00Z", "info"),
    mk("grouped", "2026-11-09T12:00:00Z"),
  ];
  const incidents = [{ id: "i", event_ids: ["grouped"] }] as unknown as import("./types").Incident[];
  expect(excludedEvents(events, incidents, now).map((e) => e.id)).toEqual(["old"]);
});
