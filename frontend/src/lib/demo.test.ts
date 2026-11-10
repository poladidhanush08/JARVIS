import { demoAnnouncement, demoCaption } from "./demo";
import type { Event, Incident, Stats } from "./types";

const stats = (raw_alerts: number, incidents = 0): Stats => ({ raw_alerts, incidents, isolated: 0 });

function ev(id: string, service: string, level: Event["level"], type: Event["type"] = "log"): Event {
  return {
    id,
    timestamp: "2026-11-09T10:00:00Z",
    source: "simulator",
    service,
    type,
    level,
    message: "m",
    fingerprint: "f",
    metric: null,
    trace_id: null,
    tags: {},
  };
}

function inc(id: string, start: string, service: string, confidence: number, promoted = true): Incident {
  return {
    id,
    title: id,
    status: "open",
    severity: "SEV1",
    start_time: start,
    last_event_time: start,
    event_ids: [],
    affected_services: [service],
    promoted,
    root_cause_candidates: [{ service, cause_type: "resource", score: confidence, confidence, factors: {}, evidence: [] }],
    impact: { users_affected: 0, failed_transactions: 0, endpoints: [], services: [], minutes_since_start: 0 },
    recommendations: [],
    key_moments: [],
    correlation_reasons: {},
    runner_up_note: "",
    cause_phrase: "",
    updated_at: null,
  };
}

test("branch 1: no anomalous alerts yet", () => {
  expect(demoCaption(stats(0), [], [ev("e1", "web", "info")])).toEqual({ stage: 1, text: "Starting scenario A…" });
});

test("branch 2: alerts but no incident, counts distinct anomalous services", () => {
  const events = [
    ev("e1", "postgres", "error"),
    ev("e2", "postgres", "critical"),
    ev("e3", "checkout", "warn"),
    ev("e4", "auth", "info", "alert"),
    ev("e5", "search", "info"),
  ];
  expect(demoCaption(stats(4), [], events)).toEqual({ stage: 2, text: "4 alerts arriving from 3 services…" });
});

test("branch 2: singular wording", () => {
  expect(demoCaption(stats(1), [], [ev("e1", "postgres", "error")])).toEqual({
    stage: 2,
    text: "1 alert arriving from 1 service…",
  });
});

test("branch 3: an incident exists and fewer than 15 alerts", () => {
  const i = inc("inc-1", "2026-11-09T10:00:00Z", "postgres", 88);
  expect(demoCaption(stats(14, 1), [i], [ev("e1", "postgres", "error")])).toEqual({
    stage: 3,
    text: "Grouping related alerts into one incident…",
  });
});

test("branch 4: one incident with root cause and link target", () => {
  const i = inc("inc-1", "2026-11-09T10:00:00Z", "postgres", 88);
  expect(demoCaption(stats(27, 1), [i], [])).toEqual({
    stage: 4,
    text: "27 alerts → 1 incident. Root cause: postgres (High, 88%)",
    incidentId: "inc-1",
  });
});

test("branch 4: several incidents use the newest promoted one", () => {
  const older = inc("inc-old", "2026-11-09T10:00:00Z", "postgres", 88);
  const newest = inc("inc-new", "2026-11-09T10:05:00Z", "redis", 60);
  const unpromoted = inc("inc-cand", "2026-11-09T10:09:00Z", "search", 30, false);
  expect(demoCaption(stats(40, 2), [older, newest, unpromoted], [])).toEqual({
    stage: 4,
    text: "40 alerts → 2 incidents. Top root cause: redis (Medium, 60%)",
    incidentId: "inc-new",
  });
});

test("announcements name the stage, not the live counts", () => {
  expect(demoAnnouncement({ stage: 1, text: "Starting scenario A…" })).toBe("Starting scenario A");
  expect(demoAnnouncement({ stage: 2, text: "9 alerts arriving from 3 services…" })).toBe("Alerts arriving");
  expect(demoAnnouncement({ stage: 3, text: "Grouping related alerts into one incident…" })).toBe("Grouping alerts");
  const done = "27 alerts → 1 incident. Root cause: postgres (High, 88%)";
  expect(demoAnnouncement({ stage: 4, text: done, incidentId: "inc-1" })).toBe(
    "Grouped into 1 incident. Root cause: postgres (High, 88%)",
  );
  expect(
    demoAnnouncement({ stage: 4, text: "40 alerts → 2 incidents. Top root cause: redis (Medium, 60%)", incidentId: "i" }),
  ).toBe("Grouped into 2 incidents. Top root cause: redis (Medium, 60%)");
});
