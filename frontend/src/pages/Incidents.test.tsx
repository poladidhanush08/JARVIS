import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, type Mock } from "vitest";
import { useLive } from "../hooks/useLive";
import type { Incident } from "../lib/types";
import IncidentsPage from "./Incidents";

vi.mock("../hooks/useLive");
vi.mock("../lib/api", () => ({
  getGraph: vi.fn(() =>
    Promise.resolve({
      nodes: [
        { id: "postgres", tier: "data" },
        { id: "checkout", tier: "app" },
        { id: "search", tier: "app" },
      ],
      edges: [],
    }),
  ),
}));

const incident: Incident = {
  id: "inc-1",
  title: "Checkout failing: postgres connection pool exhausted",
  status: "open",
  severity: "SEV1",
  start_time: new Date(Date.now() - 120_000).toISOString(),
  last_event_time: new Date().toISOString(),
  event_ids: ["e1", "e2", "e3"],
  affected_services: ["postgres", "checkout"],
  promoted: true,
  root_cause_candidates: [
    { service: "postgres", cause_type: "resource", confidence: 88, factors: {}, evidence: [] },
  ],
  impact: { users_affected: 0, failed_transactions: 0, endpoints: [], services: [], minutes_since_start: 2 },
  recommendations: [],
  key_moments: [],
  correlation_reasons: {},
  runner_up_note: "",
  cause_phrase: "",
  updated_at: null,
};

function mockLive(incidents: Incident[], isolated = 3) {
  (useLive as Mock).mockReturnValue({
    stats: { raw_alerts: 27, incidents: incidents.length, isolated },
    incidents,
    recentEvents: [],
    receivedAt: new Map(),
    snapshotIds: [],
    connected: true,
  });
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <IncidentsPage />
    </MemoryRouter>,
  );
}

test("shows headline numbers and the incident row", async () => {
  mockLive([incident]);
  renderPage();
  expect(screen.getByText("27")).toBeInTheDocument();
  expect(screen.getByText("raw alerts")).toBeInTheDocument();
  expect(screen.getByText("3 unrelated alerts excluded")).toBeInTheDocument();
  const row = screen.getByRole("link", { name: /Checkout failing/ });
  expect(row).toHaveAttribute("href", "/incidents/inc-1");
  expect(within(row).getByText("SEV1")).toBeInTheDocument();
  expect(within(row).getByText("3 alerts")).toBeInTheDocument();
  expect(within(row).getByText("2 min ago")).toBeInTheDocument();
  // service dots: root cause red, impacted amber, others healthy
  expect(await screen.findByLabelText("postgres: root cause")).toBeInTheDocument();
  expect(screen.getByLabelText("checkout: impacted")).toBeInTheDocument();
  expect(screen.getByLabelText("search: healthy")).toBeInTheDocument();
});

test("numbers explain their source on hover; counts are pluralized", async () => {
  mockLive([{ ...incident, event_ids: ["e1"] }], 1);
  renderPage();
  expect(screen.getByTitle("warn/error/critical events and alerts received")).toHaveTextContent("27");
  expect(screen.getByTitle("groups of 3 or more correlated alerts")).toHaveTextContent("1");
  expect(screen.getByTitle("anomalous alerts that matched no incident")).toHaveTextContent("1 unrelated alert excluded");
  expect(screen.getByTitle("events grouped into this incident")).toHaveTextContent("1 alert");
  await screen.findByLabelText("search: healthy");
});

test("shows the empty state when there are no incidents", async () => {
  mockLive([]);
  renderPage();
  expect(screen.getByText(/All quiet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/sources");
  await screen.findByLabelText("search: healthy");
});
