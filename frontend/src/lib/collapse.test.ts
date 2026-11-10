import type { Event, Incident } from "./types";
import { describe } from "vitest";
import {
  FLASH_THROTTLE_MS,
  FLIGHT_BATCH_MS,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  INITIAL_COLLAPSE,
  LAYOUT_SETTLE_MS,
  MAX_VISIBLE_CARDS,
  MIN_DWELL_MS,
  collapseStagger,
  flightTiming,
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
    s = stepCollapse(s, input(events, incidents), T + 100); // the new row settles by +400 ms
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

  test("a re-sort of the incident rows holds batches until the rows settle", () => {
    const events = [alert("e1")];
    const one = [inc({ id: "i1", event_ids: ["e1"] })];
    let s = stepCollapse(stepCollapse(seeded(), input([], [inc({ id: "i1" })]), T), input(events, one), T);
    // a second incident appears on top just before e1's dwell ends
    const two = [inc({ id: "i2" }), ...one];
    s = stepCollapse(s, input(events, two), T + 500);
    expect(s.settleUntil).toBe(T + 500 + LAYOUT_SETTLE_MS);
    expect(s.nextWakeAt).toBe(T + 500 + LAYOUT_SETTLE_MS);
    s = stepCollapse(s, input(events, two), T + MIN_DWELL_MS);
    expect(s.flight).toBeNull();
    s = stepCollapse(s, input(events, two), T + 500 + LAYOUT_SETTLE_MS);
    expect(flying(s)).toEqual(["e1"]);
    expect(s.flight!.cards[0].incidentId).toBe("i1");
  });

  test("an overflow card's exclusion window starts when it is first shown", () => {
    const events = Array.from({ length: 9 }, (_, i) => alert(`e${i + 1}`)).reverse();
    let s = stepCollapse(seeded(), input(events), T);
    expect(s.overflow).toBe(1);
    // the eight on screen expire; e9 waited off-screen and is only now shown, not excluded
    s = stepCollapse(s, input(events), T + 10_001);
    expect(s.excluded.map((e) => e.id)).toEqual(["e8", "e7", "e6", "e5", "e4"]);
    expect(ids(s)).toEqual(["e9"]);
    expect(s.nextWakeAt).toBe(T + 10_001 + 10_001);
    s = stepCollapse(s, input(events), T + 20_002);
    expect(ids(s)).toEqual([]);
    expect(s.excluded[0].id).toBe("e9");
  });

  test("an overflow card absorbed off-screen is shown for the dwell, then flies", () => {
    const events = Array.from({ length: 9 }, (_, i) => alert(`e${i + 1}`)).reverse();
    const incidents = [inc({ id: "i", event_ids: ["e1", "e9"] })];
    let s = stepCollapse(seeded(), input(events, [inc({ id: "i" })]), T);
    s = stepCollapse(s, input(events, incidents), T + 9_500);
    expect(flying(s)).toEqual(["e1"]);
    s = stepCollapse(s, input(events, incidents), s.flight!.endsAt);
    expect(ids(s)).toContain("e9");
    const shownAt = s.shown.find((c) => c.event.id === "e9")!.shownAt;
    // its dwell runs past 10 s after it arrived: it must not be dropped
    s = stepCollapse(s, input(events, incidents), shownAt + MIN_DWELL_MS - 1);
    expect(s.flight).toBeNull();
    expect(ids(s)).toContain("e9");
    while (!s.flight && s.nextWakeAt !== null) s = stepCollapse(s, input(events, incidents), s.nextWakeAt);
    expect(flying(s)).toEqual(["e9"]);
    expect(s.flight!.startedAt).toBeGreaterThanOrEqual(shownAt + MIN_DWELL_MS);
  });

  test("when some flying events drop out, the rest land at once instead of lingering", () => {
    const events = [alert("e2"), alert("e1")];
    const incidents = [inc({ id: "i", event_ids: ["e1", "e2"] })];
    let s = stepCollapse(seeded(), input(events, incidents), T);
    s = stepCollapse(s, input(events, incidents), T + MIN_DWELL_MS);
    expect(flying(s)).toEqual(["e1", "e2"]);
    s = stepCollapse(s, input([alert("e2")], incidents), T + MIN_DWELL_MS + 50);
    expect(s.flight).toBeNull();
    expect(ids(s)).toEqual([]);
    expect(s.nextWakeAt).toBeNull();
  });

  test("the header stays on Grouping from the batch start until the settle ends", () => {
    const events = [alert("e2"), alert("e1")];
    const incidents = [inc({ id: "i", event_ids: ["e1"] })];
    let s = stepCollapse(seeded(), input(events, incidents), T);
    expect(s.grouping).toBe(false);
    s = stepCollapse(s, input(events, incidents), T + MIN_DWELL_MS);
    expect(s.grouping).toBe(true);
    const landsAt = s.flight!.endsAt;
    s = stepCollapse(s, input(events, incidents), landsAt);
    expect(s.flight).toBeNull();
    expect(s.grouping).toBe(true); // e2 slides up into e1's place
    expect(s.nextWakeAt).toBe(s.settleUntil);
    s = stepCollapse(s, input(events, incidents), s.settleUntil);
    expect(s.grouping).toBe(false);
  });

  test("excluded cards are listed newest first and drop out once absorbed", () => {
    const events = [alert("e2"), alert("e1")];
    let s = stepCollapse(seeded(), input(events), T);
    s = stepCollapse(s, input(events), T + 10_001);
    expect(s.excluded.map((e) => e.id)).toEqual(["e2", "e1"]);
    s = stepCollapse(s, input(events, [inc({ id: "late", event_ids: ["e1"] })]), T + 11_000);
    expect(s.excluded.map((e) => e.id)).toEqual(["e2"]);
    expect(ids(s)).toEqual([]); // an excluded card never comes back to fly
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
