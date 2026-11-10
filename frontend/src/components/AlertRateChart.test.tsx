import { render, screen } from "@testing-library/react";
import AlertRateChart from "./AlertRateChart";
import type { Event } from "../lib/types";

const T0 = "2026-01-01T00:00:00.000Z";
const ev = (sec: number, level: Event["level"] = "error"): Event => ({
  id: `e${sec}${level}`,
  timestamp: new Date(Date.parse(T0) + sec * 1000).toISOString(),
  source: "simulator",
  service: "svc",
  type: "log",
  level,
  message: "m",
  fingerprint: "f",
  metric: null,
  trace_id: null,
  tags: {},
});
// buckets: 0:1, 5:3, 10:0, 15:1  -> total 5 over 20 s, peak 3 at T+5s
const events = [ev(0), ev(5), ev(6), ev(7), ev(16)];

test("renders one bar per bucket, labels and aria-label", () => {
  const { container } = render(<AlertRateChart events={events} startTime={T0} shownAtS={null} />);
  expect(container.querySelectorAll("[data-bar]")).toHaveLength(4);
  expect(screen.getByText("Alerts / 5 s")).toBeInTheDocument();
  expect(screen.getByText("peak 3 at T+5s")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "5 alerts over 20s, peaking at 3 around T+5s" })).toBeInTheDocument();
  expect(screen.getByTitle("anomalous alerts in this incident, per 5-second window")).toBeInTheDocument();
});

test("marks the first-anomaly bucket", () => {
  const { container } = render(<AlertRateChart events={events} startTime={T0} shownAtS={null} />);
  const first = container.querySelectorAll("[data-bar]")[0];
  expect(first).toHaveAttribute("data-first", "true");
  expect(container.querySelectorAll("[data-first]")).toHaveLength(1);
});

test("dims buckets after the shown moment only", () => {
  const { container } = render(<AlertRateChart events={events} startTime={T0} shownAtS={6} />);
  const dim = [...container.querySelectorAll("[data-bar]")].map((b) => b.getAttribute("data-dim"));
  expect(dim).toEqual(["false", "false", "true", "true"]);
  const live = render(<AlertRateChart events={events} startTime={T0} shownAtS={null} />);
  expect(live.container.querySelectorAll('[data-dim="true"]')).toHaveLength(0);
});

test("renders nothing without anomalous events", () => {
  const { container } = render(<AlertRateChart events={[ev(1, "info")]} startTime={T0} shownAtS={null} />);
  expect(container).toBeEmptyDOMElement();
});
