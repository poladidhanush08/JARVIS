import { render, screen, within } from "@testing-library/react";
import type { LayoutNode } from "../lib/graphLayout";
import type { Event, Incident } from "../lib/types";
import AffectedPathList from "./AffectedPathList";

const start = "2026-11-09T10:00:00Z";
const node = (id: string, status: LayoutNode["status"]): LayoutNode => ({ id, x: 0, y: 0, status, label: id });
const layout = (healthy: number) => ({
  nodes: [
    node("auth-service", "impacted"),
    node("user-db", "root"),
    node("gateway", "impacted"),
    ...Array.from({ length: healthy }, (_, i) => node(`ok-${i}`, "healthy")),
  ],
  edges: [],
});
const ev = (id: string, service: string, ts: string): Event =>
  ({ id, service, timestamp: ts, message: "m" }) as unknown as Event;
const events = [
  ev("1", "user-db", "2026-11-09T10:00:00Z"),
  ev("2", "user-db", "2026-11-09T10:00:01Z"),
  ev("3", "gateway", "2026-11-09T10:00:09Z"),
  ev("4", "auth-service", "2026-11-09T10:00:04Z"),
];
const incident = {
  start_time: start,
  key_moments: [
    { timestamp: start, service: "user-db", label: "first", event_id: "1" },
    { timestamp: "2026-11-09T10:00:04Z", service: "auth-service", label: "auth", event_id: "4" },
    { timestamp: "2026-11-09T10:00:09Z", service: "gateway", label: "gw", event_id: "3" },
  ],
} as unknown as Incident;

const rows = () => within(screen.getByRole("list", { name: "Affected services" })).getAllByRole("listitem");

test("lists root first, then impacted by first anomaly, with words, times and counts", () => {
  render(<AffectedPathList layout={layout(2)} incident={incident} events={events} replayIndex={null} />);
  const r = rows();
  expect(r.map((x) => x.textContent)).toEqual([
    expect.stringMatching(/user-db.*root cause.*T\+0s.*2 events/),
    expect.stringMatching(/auth-service.*impacted.*T\+4s.*1 event(?!s)/),
    expect.stringMatching(/gateway.*impacted.*T\+9s.*1 event(?!s)/),
  ]);
  expect(screen.getByText("2 healthy services not involved")).toBeInTheDocument();
});

test("pluralises the healthy line and omits it at zero", () => {
  const { rerender } = render(
    <AffectedPathList layout={layout(1)} incident={incident} events={events} replayIndex={null} />,
  );
  expect(screen.getByText("1 healthy service not involved")).toBeInTheDocument();
  rerender(<AffectedPathList layout={layout(0)} incident={incident} events={events} replayIndex={null} />);
  expect(screen.queryByText(/not involved/)).not.toBeInTheDocument();
});

test("services not yet reached during replay show as waiting", () => {
  render(<AffectedPathList layout={layout(2)} incident={incident} events={events} replayIndex={0} />);
  const r = rows();
  expect(r[0]).toHaveTextContent("root cause");
  expect(r[1]).toHaveTextContent("waiting");
  expect(r[2]).toHaveTextContent("waiting");
  expect(screen.getByText("2 healthy services not involved")).toBeInTheDocument();
});
