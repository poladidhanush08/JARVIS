import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { Event, Incident } from "../lib/types";
import CollapseStream, { COLLAPSE_DURATION_MS, SNAPSHOT_GRACE_MS } from "./CollapseStream";

const T0 = new Date("2026-11-09T12:00:00Z");
const FLIGHT_BUDGET_MS = 2000;

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

function Harness({ events, incidents }: { events: Event[]; incidents: Incident[] }) {
  return (
    <>
      {incidents.map((i) => (
        <div key={i.id} data-incident-row={i.id}>
          {i.id}
        </div>
      ))}
      <CollapseStream recentEvents={events} incidents={incidents} />
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

/** Mount with no incidents and let the snapshot grace window pass, then show two pending cards. */
function mountWithPending() {
  const view = render(<Harness events={[]} incidents={[]} />);
  advance(SNAPSHOT_GRACE_MS + 100);
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
  advance(COLLAPSE_DURATION_MS + 200);
  expect(cards()).toHaveLength(0);
});

test("only cards whose events the new incident absorbed fly", () => {
  const { rerender, events } = mountWithPending();
  rerender(<Harness events={events} incidents={[inc("inc-1", ["e1"])]} />);
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
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("incidents present at mount never animate", () => {
  const events = [ev("e1")];
  const { rerender } = render(<Harness events={events} incidents={[inc("old", [])]} />);
  advance(SNAPSHOT_GRACE_MS + 100);
  expect(cards()).toHaveLength(1);
  rerender(<Harness events={events} incidents={[inc("old", ["e1"])]} />);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
});

test("an incident snapshot arriving just after events on load does not animate", () => {
  const events = [ev("e1")];
  const { rerender } = render(<Harness events={events} incidents={[]} />);
  expect(cards()).toHaveLength(1);
  rerender(<Harness events={events} incidents={[inc("existing", ["e1"])]} />);
  expect(screen.queryByText("Grouping")).not.toBeInTheDocument();
  expect(cards()).toHaveLength(0);
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
  expect(screen.getByText("Grouping")).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
