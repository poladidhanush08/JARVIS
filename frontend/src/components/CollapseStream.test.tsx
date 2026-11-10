import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { Event, Incident } from "../lib/types";
import { FLIGHT_BATCH_MS, FLIGHT_MS, LAYOUT_SETTLE_MS, MIN_DWELL_MS } from "../lib/collapse";
import CollapseStream from "./CollapseStream";

const T0 = new Date("2026-11-09T12:00:00Z");
const FLIGHT_BUDGET_MS = FLIGHT_BATCH_MS;

function ev(id: string): Event {
  return {
    id,
    timestamp: new Date(Date.now()).toISOString(),
    source: "simulator",
    service: `svc-${id}`,
    type: "alert",
    level: "error",
    message: `message ${id}`,
    fingerprint: id,
    metric: null,
    trace_id: null,
    tags: {},
  };
}

function inc(id: string, event_ids: string[]): Incident {
  return { id, event_ids, affected_services: [], root_cause_candidates: [] } as unknown as Incident;
}

function Harness({
  events,
  incidents,
  snapshotIds = [],
  receivedAt,
}: {
  events: Event[];
  incidents: Incident[];
  snapshotIds?: string[] | null;
  receivedAt?: Map<string, number>;
}) {
  return (
    <>
      {incidents.map((i) => (
        <div key={i.id} data-incident-row={i.id}>
          {i.id}
        </div>
      ))}
      <CollapseStream recentEvents={events} incidents={incidents} snapshotIds={snapshotIds} receivedAt={receivedAt} />
    </>
  );
}

let reducedMotion = false;

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") && reducedMotion,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const cards = () => screen.queryAllByTestId("pending-card");
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** Advance one animation frame at a time, letting React commit between frames as a browser would. */
const frames = (ms: number) => {
  for (let t = 0; t < ms; t += 16) advance(16);
};

/** Mount after an empty snapshot, then show two pending cards. */
function mountWithPending() {
  const view = render(<Harness events={[]} incidents={[]} />);
  const events = [ev("e1"), ev("e2")];
  view.rerender(<Harness events={events} incidents={[]} />);
  return { ...view, events };
}

test("pending cards fly into a new incident's row, then the column empties", () => {
  const { rerender, events } = mountWithPending();
  expect(cards()).toHaveLength(2);
  expect(screen.getByText("Waiting to be grouped")).toBeInTheDocument();

  const incidents = [inc("inc-1", ["e1", "e2"])];
  rerender(<Harness events={events} incidents={incidents} />);
  advance(MIN_DWELL_MS); // each card stays visible for the dwell first
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  expect(cards()).toHaveLength(2);

  advance(16); // animation frame applies the transforms
  expect(cards()[0].style.transform).toContain("translate(");
  expect(cards()[0].style.opacity).toBe("0");

  advance(FLIGHT_BUDGET_MS);
  expect(cards()).toHaveLength(0);

  // Same incident ids again: no second flight.
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("the flight finishes within the 2 s budget", () => {
  const { rerender, events } = mountWithPending();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
  advance(MIN_DWELL_MS);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  advance(FLIGHT_BUDGET_MS);
  expect(cards()).toHaveLength(0);
});

test("only cards whose events the new incident absorbed fly", () => {
  const { rerender, events } = mountWithPending();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1"])]} />);
  advance(MIN_DWELL_MS);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  advance(16);
  const cardOf = (service: string) => screen.getByText(service).closest("li")!;
  expect(cardOf("svc-e1").style.transform).toContain("translate(");
  expect(cardOf("svc-e2").style.transform).toBe("");
  advance(FLIGHT_BUDGET_MS);
  expect(cards()).toHaveLength(1);
  expect(screen.getByText("svc-e2")).toBeInTheDocument();
});

test("with reduced motion the cards are removed without a flight", () => {
  reducedMotion = true;
  const { rerender, events } = mountWithPending();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
  expect(cards()).toHaveLength(2); // still shown for the dwell
  advance(MIN_DWELL_MS);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("incidents in the first snapshot never animate", () => {
  const events = [ev("e1")];
  const { rerender } = render(<Harness events={events} incidents={[inc("old", [])]} snapshotIds={["old"]} />);
  advance(1500);
  expect(cards()).toHaveLength(1);
  rerender(<Harness events={events} incidents={[inc("old", ["e1"])]} snapshotIds={["old"]} />);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("nothing animates before the snapshot; its incidents are seeded when it arrives", () => {
  const events = [ev("e1")];
  const { rerender } = render(<Harness events={events} incidents={[]} snapshotIds={null} />);
  expect(cards()).toHaveLength(1);
  rerender(<Harness events={events} incidents={[inc("existing", ["e1"])]} snapshotIds={["existing"]} />);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("an incident first seen right after an empty snapshot animates (no time grace)", () => {
  const events = [ev("e1"), ev("e2")];
  const { rerender } = render(<Harness events={[]} incidents={[]} snapshotIds={[]} />);
  advance(100);
  rerender(<Harness events={events} incidents={[]} snapshotIds={[]} />);
  advance(400);
  rerender(<Harness events={events} incidents={[inc("INC-001", ["e1", "e2"])]} snapshotIds={[]} />);
  advance(LAYOUT_SETTLE_MS); // dwell ends at +700 ms; the new row has settled by +800 ms
  expect(screen.getByText("Grouping")).toBeInTheDocument();
});

test("the pending window follows client arrival time, not the event timestamp", () => {
  const stale = { ...ev("e1"), timestamp: new Date(Date.now() - 3_600_000).toISOString() };
  render(<Harness events={[stale]} incidents={[]} receivedAt={new Map([["e1", Date.now()]])} />);
  expect(cards()).toHaveLength(1);
  advance(11_000);
  expect(cards()).toHaveLength(0);
  // it never joined an incident: it stays, greyed, labelled excluded
  expect(screen.getAllByTestId("excluded-card")).toHaveLength(1);
  expect(screen.getByText("excluded")).toBeInTheDocument();
});

test("the expiry tick runs only while cards are pending", () => {
  const { rerender } = render(<Harness events={[]} incidents={[]} />);
  expect(vi.getTimerCount()).toBe(0);
  rerender(<Harness events={[ev("e1")]} incidents={[]} />);
  expect(vi.getTimerCount()).toBe(1);
  advance(11_000); // card expires after 10 s
  expect(cards()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("unmounting mid-flight leaves no pending timers", () => {
  const { rerender, unmount, events } = mountWithPending();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
  advance(MIN_DWELL_MS);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("a card absorbed into an existing incident flies into its row", () => {
  const { rerender } = render(<Harness events={[]} incidents={[inc("old", [])]} snapshotIds={["old"]} />);
  const events = [ev("e1")];
  rerender(<Harness events={events} incidents={[inc("old", [])]} snapshotIds={["old"]} />);
  rerender(<Harness events={events} incidents={[inc("old", ["e1"])]} snapshotIds={["old"]} />);
  advance(MIN_DWELL_MS);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  advance(16);
  expect(cards()[0].style.transform).toContain("translate(");
  expect(cards()[0].style.transition).toContain(`transform ${FLIGHT_MS}ms`);
  advance(FLIGHT_MS);
  expect(cards()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("a card absorbed before it was ever shown is still shown for the dwell first", () => {
  const { rerender } = render(<Harness events={[]} incidents={[inc("old", [])]} snapshotIds={["old"]} />);
  // events and update frames land in the same render
  rerender(<Harness events={[ev("e1")]} incidents={[inc("old", ["e1"])]} snapshotIds={["old"]} />);
  expect(cards()).toHaveLength(1);
  advance(MIN_DWELL_MS - 1);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()[0].style.transform).toBe("");
  advance(1);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
});

test("at most 8 cards are visible; the rest wait as '+N more arriving'", () => {
  const { rerender } = render(<Harness events={[]} incidents={[]} />);
  const events = Array.from({ length: 12 }, (_, i) => ev(`e${i + 1}`)).reverse();
  rerender(<Harness events={events} incidents={[]} />);
  expect(cards()).toHaveLength(8);
  expect(screen.getByText("+4 more arriving")).toBeInTheDocument();
  expect(screen.getByText("svc-e1")).toBeInTheDocument();
  expect(screen.queryByText("svc-e12")).not.toBeInTheDocument();

  const all = [inc("inc-1", events.map((e) => e.id))];
  rerender(<Harness events={events} incidents={all} />);
  frames(MIN_DWELL_MS);
  frames(FLIGHT_BUDGET_MS);
  // the first eight landed; the waiting four take their place
  expect(cards()).toHaveLength(4);
  expect(screen.queryByText(/more arriving/)).not.toBeInTheDocument();
  frames(MIN_DWELL_MS);
  frames(FLIGHT_BUDGET_MS);
  expect(cards()).toHaveLength(0);
});

test("the receiving row flashes at most once per 600 ms", () => {
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true, writable: true });
  try {
    const view = render(<Harness events={[]} incidents={[]} />);
    const events = [ev("e3"), ev("e2"), ev("e1")];
    view.rerender(<Harness events={events} incidents={[inc("inc-1", ["e1"])]} />);
    frames(MIN_DWELL_MS + 32);
    expect(animate).toHaveBeenCalledTimes(1);
    view.rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
    // the second batch flies about 500 ms after the first flash: no second flash
    frames(1000);
    expect(screen.queryByText("svc-e2")).not.toBeInTheDocument();
    expect(animate).toHaveBeenCalledTimes(1);
    // a later batch, well past the throttle window, flashes again
    view.rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2", "e3"])]} />);
    frames(1000);
    expect(cards()).toHaveLength(0);
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  }
});

test("events that arrived before the snapshot never fly, even into a later incident", () => {
  const events = [ev("e1"), ev("e2")];
  const { rerender } = render(<Harness events={events} incidents={[]} snapshotIds={null} />);
  rerender(<Harness events={events} incidents={[]} snapshotIds={[]} />);
  advance(1000);
  rerender(<Harness events={events} incidents={[inc("INC-002", ["e1", "e2"])]} snapshotIds={[]} />);
  advance(MIN_DWELL_MS);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("unmounting with queued cards leaves no pending timers", () => {
  const { rerender, unmount } = render(<Harness events={[]} incidents={[]} />);
  const events = Array.from({ length: 12 }, (_, i) => ev(`e${i + 1}`)).reverse();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1", "e2"])]} />);
  advance(MIN_DWELL_MS + 16);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("when a new incident lands on top mid-run, cards wait for the rows to settle and aim at their own row", () => {
  // each incident row sits 100 px below the previous one, by its current DOM position
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rows = Array.from(document.querySelectorAll("[data-incident-row]"));
    const top = this.dataset.incidentRow ? rows.indexOf(this) * 100 : 0;
    return { left: 0, top, right: 100, bottom: top + 40, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  const { rerender } = render(<Harness events={[]} incidents={[inc("inc-1", [])]} />);
  const events = [ev("e1")];
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1"])]} />);
  advance(500);
  // the second outage appears above the first just before e1's dwell ends
  rerender(<Harness events={events} incidents={[inc("inc-2", []), inc("inc-1", ["e1"])]} />);
  advance(MIN_DWELL_MS - 500);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  advance(LAYOUT_SETTLE_MS - 100);
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  advance(16);
  // inc-1 is now the second row: centre at 120 px, card centre at 20 px
  expect(cards()[0].style.transform).toBe("translate(24px, 100px) scale(0.6)");
});
