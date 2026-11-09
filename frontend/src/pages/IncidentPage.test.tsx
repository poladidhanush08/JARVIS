import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, type Mock } from "vitest";
import { useLive } from "../hooks/useLive";
import { getIncident, HttpError } from "../lib/api";
import type { Incident } from "../lib/types";
import IncidentPage from "./IncidentPage";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string; data: { status: string } }[] }) => (
    <ul data-testid="flow">
      {nodes.map((n) => (
        <li key={n.id} data-status={n.data.status}>
          {n.id}
        </li>
      ))}
    </ul>
  ),
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));
vi.mock("../hooks/useLive");
vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return {
    ...actual,
    getIncident: vi.fn(),
    getGraph: vi.fn(() =>
      Promise.resolve({
        nodes: [
          { id: "auth-service", tier: "service" },
          { id: "user-db", tier: "datastore" },
        ],
        edges: [{ source: "auth-service", target: "user-db" }],
      }),
    ),
  };
});

const start = "2026-11-09T10:00:00Z";
const base: Incident = {
  id: "inc-1",
  title: "Logins failing because user-db ran out of connections",
  status: "investigating",
  severity: "SEV1",
  start_time: start,
  last_event_time: "2026-11-09T10:00:10Z",
  event_ids: ["e1", "e2"],
  affected_services: ["user-db", "auth-service"],
  promoted: true,
  root_cause_candidates: [
    { service: "user-db", cause_type: "db_pool_exhaustion", confidence: 70, factors: {}, evidence: ["a"] },
  ],
  impact: { users_affected: 1200, failed_transactions: 0, endpoints: [], services: [], minutes_since_start: 3 },
  recommendations: [],
  key_moments: [
    { timestamp: start, service: "user-db", label: "first anomaly", event_id: "e1" },
    { timestamp: "2026-11-09T10:00:04Z", service: "auth-service", label: "auth-service affected", event_id: "e2" },
  ],
  correlation_reasons: {},
  runner_up_note: "",
  cause_phrase: "ran out of connections",
};

const live = (incidents: Incident[]) =>
  (useLive as Mock).mockReturnValue({ stats: {}, incidents, recentEvents: [], connected: true });

function renderPage(id = "inc-1") {
  return render(
    <MemoryRouter initialEntries={[`/incidents/${id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/incidents/:id" element={<IncidentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  live([]);
});

test("shows a calm not-found state for an unknown id", async () => {
  (getIncident as Mock).mockRejectedValue(new HttpError("Unknown incident nope", 404));
  renderPage("nope");
  expect(await screen.findByText("Incident not found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Incidents" })).toHaveAttribute("href", "/");
});

test("renders the answer first and refetches when the live copy changes", async () => {
  (getIncident as Mock).mockResolvedValue({ incident: base, events: [] });
  const view = renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: base.title })).toBeInTheDocument();
  expect(screen.getByText(/confidence steady/)).toBeInTheDocument();
  expect(screen.getByText("user-db — ran out of connections")).toBeInTheDocument();
  expect(screen.getByTitle("sum of failed_logins metrics")).toHaveTextContent("1,200");
  expect(screen.getByRole("link", { name: /Download report/ })).toHaveAttribute("href", "/api/incidents/inc-1/report");

  const newer: Incident = {
    ...base,
    last_event_time: "2026-11-09T10:00:20Z",
    event_ids: ["e1", "e2", "e3"],
    root_cause_candidates: [{ ...base.root_cause_candidates[0], confidence: 85 }],
  };
  (getIncident as Mock).mockResolvedValue({ incident: newer, events: [] });
  live([newer]);
  view.rerender(
    <MemoryRouter initialEntries={["/incidents/inc-1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/incidents/:id" element={<IncidentPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/confidence rising/)).toBeInTheDocument();
  expect(getIncident).toHaveBeenCalledTimes(2);
});

test("replay reveals services moment by moment and disables the button while running", async () => {
  (getIncident as Mock).mockResolvedValue({ incident: base, events: [] });
  renderPage();
  const auth = await screen.findByText("auth-service", { selector: "li" });
  expect(auth).toHaveAttribute("data-status", "impacted");

  vi.useFakeTimers();
  const button = screen.getByRole("button", { name: "Replay" });
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: /Replaying/ })).toBeDisabled();
  expect(screen.getByText("user-db", { selector: "li" })).toHaveAttribute("data-status", "root");
  expect(screen.getByText("auth-service", { selector: "li" })).toHaveAttribute("data-status", "healthy");

  act(() => {
    vi.advanceTimersByTime(700);
  });
  expect(screen.getByText("auth-service", { selector: "li" })).toHaveAttribute("data-status", "impacted");
  act(() => {
    vi.advanceTimersByTime(700);
  });
  expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  vi.useRealTimers();
});
