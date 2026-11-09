import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { getEvents } from "../lib/api";
import type { Event, EventRow } from "../lib/types";
import { useLive } from "../hooks/useLive";
import EventsPage from "./Events";

vi.mock("../hooks/useLive");
vi.mock("../lib/api", () => ({ getEvents: vi.fn() }));

const ev = (id: string, over: Partial<Event> = {}): Event => ({
  id,
  timestamp: "2026-01-01T00:00:00Z",
  source: "simulator",
  service: "postgres",
  type: "log",
  level: "error",
  message: `msg ${id}`,
  fingerprint: "fp",
  metric: null,
  trace_id: null,
  tags: {},
  ...over,
});
const row = (e: Event, incident_id: string | null = null, reasons: string[] = []): EventRow => ({
  event: e,
  incident_id,
  reasons,
});

function live(recentEvents: Event[]) {
  vi.mocked(useLive).mockReturnValue({
    stats: { raw_alerts: 0, incidents: 0, isolated: 0 },
    incidents: [],
    recentEvents,
    receivedAt: new Map(),
    snapshotIds: [],
    connected: true,
  });
}

function page() {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventsPage />
    </MemoryRouter>
  );
}
const flush = () => act(async () => {});
const messages = () => screen.getAllByRole("button", { name: /^msg / }).map((b) => b.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  live([]);
});
afterEach(() => {
  vi.useRealTimers();
});

test("clicking a row shows reason chips with readable labels", async () => {
  vi.mocked(getEvents).mockResolvedValue([row(ev("e1"), "inc-1", ["time", "signature"])]);
  render(page());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "msg e1" }));
  expect(screen.getByText("time")).toBeInTheDocument();
  expect(screen.getByText("signature")).toBeInTheDocument();
  expect(screen.getByText("same error signature")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "inc-1" })).toHaveAttribute("href", "/incidents/inc-1");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the founding event of an incident says it started it", async () => {
  vi.mocked(getEvents).mockResolvedValue([row(ev("e1"), "inc-1", []), row(ev("e2"))]);
  render(page());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "msg e1" }));
  expect(within(screen.getByRole("dialog")).getByText("Started this incident")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "msg e2" }));
  expect(within(screen.getByRole("dialog")).queryByText("Started this incident")).toBeNull();
});

test("live events are merged newest first and deduped by id", async () => {
  vi.mocked(getEvents).mockResolvedValue([row(ev("e2"), "inc-1"), row(ev("e1"))]);
  live([ev("e3"), ev("e2")]);
  render(page());
  await flush();
  expect(messages()).toEqual(["msg e3", "msg e2", "msg e1"]);
  // live-only row has no incident yet
  const r3 = screen.getByRole("button", { name: "msg e3" }).closest("tr")!;
  expect(within(r3).getByText("—")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "msg e3" }));
  expect(screen.getByText("Assigning to an incident…")).toBeInTheDocument();
});

test("service, level and text filters narrow the rows", async () => {
  vi.mocked(getEvents).mockResolvedValue([
    row(ev("e1", { service: "postgres", level: "error", message: "msg pool exhausted" })),
    row(ev("e2", { service: "checkout", level: "warn", message: "msg slow" })),
    row(ev("e3", { service: "checkout", level: "error", message: "msg 500s" })),
  ]);
  render(page());
  await flush();
  fireEvent.change(screen.getByLabelText("Service"), { target: { value: "checkout" } });
  expect(messages()).toEqual(["msg slow", "msg 500s"]);
  fireEvent.change(screen.getByLabelText("Level"), { target: { value: "error" } });
  expect(messages()).toEqual(["msg 500s"]);
  fireEvent.change(screen.getByLabelText("Service"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Level"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Search message"), { target: { value: "POOL" } });
  expect(messages()).toEqual(["msg pool exhausted"]);
});

test("refetch on live updates is throttled to one per 2 seconds", async () => {
  vi.mocked(getEvents).mockResolvedValue([]);
  const { rerender } = render(page());
  await flush();
  expect(getEvents).toHaveBeenCalledTimes(1);
  expect(getEvents).toHaveBeenCalledWith({ limit: 500 });

  live([ev("a")]);
  rerender(page());
  live([ev("b"), ev("a")]);
  rerender(page());
  live([ev("c"), ev("b"), ev("a")]);
  rerender(page());
  await flush();
  expect(getEvents).toHaveBeenCalledTimes(1); // deferred, not immediate

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(getEvents).toHaveBeenCalledTimes(2);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(getEvents).toHaveBeenCalledTimes(2);

  // after the window has passed, the next update refetches immediately
  live([ev("d"), ev("c")]);
  rerender(page());
  await flush();
  expect(getEvents).toHaveBeenCalledTimes(3);
});
