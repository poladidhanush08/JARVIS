import type { Event, Incident } from "./types";
import { describe } from "vitest";
import {
  FLASH_THROTTLE_MS,
  FLIGHT_BATCH_MS,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  INITIAL_COLLAPSE,
  MAX_VISIBLE_CARDS,
  MIN_DWELL_MS,
  collapseStagger,
  flightTiming,
  pendingEvents,
  rowsToFlash,
  serviceStatus,
  stepCollapse,
  type CollapseInput,
  type CollapseState,
} from "./collapse";

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

describe("stepCollapse", () => {
  type State = CollapseState;

  const T = NOW.getTime();
  const alert = (id: string) => ev(id, 0, { type: "alert" });
  // newest first, like useLive
  const input = (
    events: Event[],
    incidents: Incident[] = [],
    over: Partial<CollapseInput> = {},
  ) => ({
    events,
    incidents,
    receivedAt: new Map(events.map((e) => [e.id, T])),
    snapshotIds: [] as string[] | null,
    reducedMotion: false,
    ...over,
  });
  const ids = (s: State) => s.shown.map((c) => c.event.id);
  const flying = (s: State) => s.flight?.cards.map((c) => c.event.id) ?? [];
  /** State after an empty first snapshot: everything that follows is live. */
  const seeded = () => stepCollapse(INITIAL_COLLAPSE, input([]), T);

  test("constants match the spec", () => {
    expect(MIN_DWELL_MS).toBe(600);
    expect(MAX_VISIBLE_CARDS).toBe(8);
    expect(FLIGHT_MS).toBe(300);
    expect(FLIGHT_STAGGER_MS).toBe(120);
    expect(FLIGHT_BATCH_MS).toBe(2000);
    expect(FLASH_THROTTLE_MS).toBe(600);
  });

  test("a card absorbed by an existing incident is shown, waits the dwell, then flies", () => {
    const events = [alert("e1")];
    const incidents = [inc({ id: "old", event_ids: ["e1"] })];
    let s = stepCollapse(INITIAL_COLLAPSE, input([], incidents.map((i) => ({ ...i, event_ids: [] }))), T);
    // the events and update frames land back to back: already absorbed when first seen
    s = stepCollapse(s, input(events, incidents), T);
    expect(ids(s)).toEqual(["e1"]);
    expect(s.flight).toBeNull();
    expect(s.nextWakeAt).toBe(T + MIN_DWELL_MS);
    s = stepCollapse(s, input(events, incidents), T + MIN_DWELL_MS - 1);
    expect(s.flight).toBeNull();
    s = stepCollapse(s, input(events, incidents), T + MIN_DWELL_MS);
    expect(flying(s)).toEqual(["e1"]);
    expect(s.flight!.cards[0].incidentId).toBe("old");
    expect(s.nextWakeAt).toBe(s.flight!.endsAt);
    s = stepCollapse(s, input(events, incidents), s.flight!.endsAt);
    expect(s.flight).toBeNull();
    expect(ids(s)).toEqual([]);
    expect(s.nextWakeAt).toBeNull();
  });

  test("at most MAX_VISIBLE_CARDS are shown, oldest first; the rest count as overflow", () => {
    const events = Array.from({ length: 12 }, (_, i) => alert(`e${i + 1}`)).reverse();
    const s = stepCollapse(seeded(), input(events), T);
    expect(ids(s)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]);
    expect(s.overflow).toBe(4);
  });

  test("absorbed overflow cards take free slots before unabsorbed ones", () => {
    const events = Array.from({ length: 10 }, (_, i) => alert(`e${i + 1}`)).reverse();
    let s = stepCollapse(seeded(), input(events), T);
    const incidents = [inc({ id: "i", event_ids: ["e1", "e10"] })];
    s = stepCollapse(s, input(events, incidents), T + MIN_DWELL_MS);
    expect(flying(s)).toEqual(["e1"]);
    s = stepCollapse(s, input(events, incidents), s.flight!.endsAt);
    // e1 left a slot: e10 (absorbed) wins it over e9 (still waiting)
    expect(ids(s)).toContain("e10");
    expect(ids(s)).not.toContain("e9");
    expect(s.overflow).toBe(1);
  });

  test("events seen before the snapshot are never flown, even into a new incident", () => {
    const events = [alert("e1")];
    let s = stepCollapse(INITIAL_COLLAPSE, input(events, [], { snapshotIds: null }), T);
    expect(ids(s)).toEqual(["e1"]);
    s = stepCollapse(s, input(events, [], { snapshotIds: [] }), T + 100);
    s = stepCollapse(s, input(events, [inc({ id: "new", event_ids: ["e1"] })]), T + 2000);
    expect(s.flight).toBeNull();
    expect(ids(s)).toEqual([]);
  });

  test("reduced motion removes absorbed cards after the dwell, without a flight", () => {
    const events = [alert("e1")];
    const incidents = [inc({ id: "i", event_ids: ["e1"] })];
    let s = stepCollapse(seeded(), input(events, incidents, { reducedMotion: true }), T);
    expect(ids(s)).toEqual(["e1"]);
    s = stepCollapse(s, input(events, incidents, { reducedMotion: true }), T + MIN_DWELL_MS);
    expect(s.flight).toBeNull();
    expect(ids(s)).toEqual([]);
  });

  test("unabsorbed cards expire after the window and the wake-up points at the expiry", () => {
    const events = [alert("e1")];
    let s = stepCollapse(seeded(), input(events), T);
    expect(s.nextWakeAt).toBe(T + 10_001);
    s = stepCollapse(s, input(events), T + 10_001);
    expect(ids(s)).toEqual([]);
    expect(s.nextWakeAt).toBeNull();
  });

  test("a batch never starts while another is flying", () => {
    const events = [alert("e2"), alert("e1")];
    let s = stepCollapse(seeded(), input(events, [inc({ id: "i", event_ids: ["e1"] })]), T);
    s = stepCollapse(s, input(events, [inc({ id: "i", event_ids: ["e1"] })]), T + MIN_DWELL_MS);
    const both = [inc({ id: "i", event_ids: ["e1", "e2"] })];
    s = stepCollapse(s, input(events, both), T + MIN_DWELL_MS + 50);
    expect(flying(s)).toEqual(["e1"]);
  });

  test("flightTiming keeps 300 ms per card, ≤120 ms stagger and ≤2 s per batch", () => {
    expect(flightTiming(1)).toEqual({ stagger: 0, total: 300 });
    expect(flightTiming(4).stagger).toBe(120);
    for (const n of [2, 8, 40]) {
      const { stagger, total } = flightTiming(n);
      expect(stagger).toBeLessThanOrEqual(120);
      expect(total).toBeLessThanOrEqual(2000);
      expect(total).toBe(300 + stagger * (n - 1));
    }
  });

  test("rowsToFlash flashes each row at most once per 600 ms", () => {
    const last = new Map([["a", T - 500], ["b", T - 600]]);
    expect(rowsToFlash(["a", "b", "c"], last, T)).toEqual(["b", "c"]);
  });
});
