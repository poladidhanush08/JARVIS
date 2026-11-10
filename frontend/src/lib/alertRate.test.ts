import { alertRate } from "./alertRate";
import type { Event } from "./types";

const T0 = "2026-01-01T00:00:00.000Z";
const ev = (
  sec: number,
  level: Event["level"] = "error",
  type: Event["type"] = "log",
): Event => ({
  id: `e${sec}${level}${type}`,
  timestamp: new Date(Date.parse(T0) + sec * 1000).toISOString(),
  source: "simulator",
  service: "svc",
  type,
  level,
  message: "m",
  fingerprint: "f",
  metric: null,
  trace_id: null,
  tags: {},
});

describe("alertRate", () => {
  it("returns [] for empty or all-benign input", () => {
    expect(alertRate([], T0)).toEqual([]);
    expect(alertRate([ev(1, "info")], T0)).toEqual([]);
  });
  it("splits at exactly 5 s and keeps empty buckets between", () => {
    const r = alertRate([ev(0), ev(4.9), ev(5), ev(16)], T0);
    expect(r).toEqual([
      { t: 0, count: 2 },
      { t: 5, count: 1 },
      { t: 10, count: 0 },
      { t: 15, count: 1 },
    ]);
  });
  it("ignores non-anomalous events but counts alert-type", () => {
    const r = alertRate(
      [ev(0, "info"), ev(1, "warn"), ev(2, "info", "alert"), ev(30, "info")],
      T0,
    );
    expect(r).toEqual([{ t: 0, count: 2 }]);
  });
  it("is robust to out-of-order input", () => {
    expect(alertRate([ev(11), ev(0), ev(6)], T0)).toEqual([
      { t: 0, count: 1 },
      { t: 5, count: 1 },
      { t: 10, count: 1 },
    ]);
  });
});

describe("alertRate hardening", () => {
  it("ignores unparsable timestamps", () => {
    const bad = { ...ev(0), timestamp: "not a date" };
    expect(alertRate([bad, ev(1)], T0)).toEqual([{ t: 0, count: 1 }]);
  });
  it("caps the span so a far outlier cannot allocate millions of buckets", () => {
    const t = Date.now();
    const r = alertRate([ev(0), ev(60 * 60 * 24 * 365 * 30)], T0);
    expect(Date.now() - t).toBeLessThan(500);
    expect(r.length).toBeLessThanOrEqual(2000);
    expect(r.reduce((s, b) => s + b.count, 0)).toBeGreaterThanOrEqual(1);
  });
});
