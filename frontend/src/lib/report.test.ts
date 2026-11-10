import { buildReport, reportFileName } from "./report";
import type { Incident } from "./types";

const start = "2026-11-09T10:00:00Z";
const incident: Incident = {
  id: "INC-001",
  title: "Logins failing because user-db ran out of connections",
  status: "investigating",
  severity: "SEV1",
  start_time: start,
  last_event_time: "2026-11-09T10:00:30Z",
  event_ids: ["e1", "e2", "e3"],
  affected_services: ["user-db", "auth-service"],
  promoted: true,
  root_cause_candidates: [
    {
      service: "user-db",
      cause_type: "db_pool_exhaustion",
      score: 80,
      confidence: 87,
      factors: {},
      evidence: ["First anomaly at T+0s", "auth-service errors name user-db"],
    },
  ],
  impact: { users_affected: 1200, failed_transactions: 34, endpoints: ["/login"], services: ["auth-service"], minutes_since_start: 3 },
  recommendations: [
    { step: 1, action: "Raise the pool size", effect: "logins recover", command: "kubectl scale deploy/user-db", verify: "errors drop" },
  ],
  key_moments: [{ timestamp: "2026-11-09T10:00:05Z", service: "user-db", label: "pool exhausted", event_id: "e1" }],
  correlation_reasons: {},
  runner_up_note: "auth-service ranked lower: its errors point at user-db",
  cause_phrase: "ran out of connections",
  updated_at: null,
};

test("report has every section, built from the incident", () => {
  const md = buildReport(incident);
  expect(md.startsWith("# Logins failing because user-db ran out of connections")).toBe(true);
  for (const h of ["## Summary", "## Impact", "## Timeline", "## Root cause", "## Recommendations"]) expect(md).toContain(h);
  expect(md).toContain("- **Severity:** SEV1");
  expect(md).toContain("**user-db ran out of connections** (High confidence, 87%)");
  expect(md).toContain("- Users affected: 1,200");
  expect(md).toContain("- Failed transactions: 34");
  expect(md).toContain("- T+5s (2026-11-09T10:00:05Z) — **user-db**: pool exhausted");
  expect(md).toContain("- auth-service errors name user-db");
  expect(md).toContain("_auth-service ranked lower: its errors point at user-db_");
  expect(md).toContain("1. **Raise the pool size** — logins recover");
  expect(md).toContain("   kubectl scale deploy/user-db");
});

test("missing values become dashes, never invented", () => {
  const md = buildReport({
    ...incident,
    root_cause_candidates: [],
    recommendations: [],
    key_moments: [],
    impact: { users_affected: undefined, failed_transactions: 0, endpoints: [], services: [], minutes_since_start: 1 } as unknown as Incident["impact"],
  });
  expect(md).toContain("- Users affected: —");
  expect(md).toContain("- Failed transactions: 0");
  expect(md).toContain("- Endpoints: —");
  expect(md).toContain("root cause still being analysed");
});

test("file name is safe", () => {
  expect(reportFileName({ id: "INC/001 x" })).toBe("jarvis-INC_001_x-report.md");
});
