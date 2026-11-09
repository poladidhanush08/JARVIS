import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { Event, Incident, Stats } from "../lib/types";
import { useLive } from "./useLive";

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  close() {}
  send(frame: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) }));
  }
}

const ev = (id: string): Event =>
  ({ id, timestamp: "2026-11-09T10:00:00Z", service: "user-db", type: "log", level: "error" }) as Event;
const inc = (id: string): Incident => ({ id, event_ids: [] }) as unknown as Incident;
const stats = (raw_alerts: number): Stats => ({ raw_alerts, incidents: 0, isolated: 0 });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z"), toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("snapshot seeds snapshotIds, events are stamped on arrival, updates bring new incidents", () => {
  const { result } = renderHook(() => useLive());
  const ws = FakeSocket.last!;
  expect(result.current.snapshotIds).toBeNull();

  ws.send({ type: "snapshot", stats: stats(2), incidents: [inc("INC-001")] });
  expect(result.current.snapshotIds).toEqual(["INC-001"]);
  expect(result.current.incidents.map((i) => i.id)).toEqual(["INC-001"]);

  const t1 = Date.now();
  ws.send({ type: "events", events: [ev("e1"), ev("e2")] });
  vi.setSystemTime(t1 + 5000);
  ws.send({ type: "events", events: [ev("e3")] });
  expect(result.current.recentEvents.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  expect(result.current.receivedAt.get("e1")).toBe(t1);
  expect(result.current.receivedAt.get("e3")).toBe(t1 + 5000);

  ws.send({ type: "update", stats: stats(5), incidents: [inc("INC-001"), inc("INC-002")] });
  expect(result.current.incidents.map((i) => i.id)).toEqual(["INC-001", "INC-002"]);
  expect(result.current.snapshotIds).toEqual(["INC-001"]); // later frames never reseed
  expect(result.current.recentEvents).toHaveLength(3);
});

test("an update with zero raw alerts (engine reset) clears recent events", () => {
  const { result } = renderHook(() => useLive());
  const ws = FakeSocket.last!;
  ws.send({ type: "snapshot", stats: stats(0), incidents: [] });
  ws.send({ type: "events", events: [ev("e1")] });
  expect(result.current.recentEvents).toHaveLength(1);
  ws.send({ type: "update", stats: stats(0), incidents: [] });
  expect(result.current.recentEvents).toHaveLength(0);
  expect(result.current.receivedAt.size).toBe(0);
});
