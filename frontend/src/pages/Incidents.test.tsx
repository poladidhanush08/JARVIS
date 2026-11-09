import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, type Mock } from "vitest";
import { useLive } from "../hooks/useLive";
import { simulator } from "../lib/api";
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
  simulator: {
    start: vi.fn(),
    status: vi.fn(),
  },
}));

const idle = { scenario: null, state: "idle", speed: 1, emitted: 0, total: 0 };

beforeEach(() => {
  (simulator.status as Mock).mockReset().mockResolvedValue(idle);
  (simulator.start as Mock).mockReset().mockResolvedValue({ ...idle, scenario: "a_db_pool", state: "running", speed: 2 });
});

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

function mockLive(incidents: Incident[], isolated = 3, raw_alerts = 27) {
  (useLive as Mock).mockReturnValue({
    stats: { raw_alerts, incidents: incidents.length, isolated },
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

test("shows the empty state with the Run the demo button when there are no incidents", async () => {
  mockLive([], 0, 0);
  renderPage();
  expect(screen.getByText("No incidents yet.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Run the demo" })).toBeEnabled();
  expect(
    screen.getByText(
      "Plays scenario A: a payment platform where logins, slow APIs and failed payments share one cause.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/to upload logs or send events by API/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/sources");
  expect(screen.queryByText(/All quiet/)).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("Run the demo starts scenario A at 2x and shows live captions", async () => {
  mockLive([], 0, 0);
  const view = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Run the demo" }));
  expect(simulator.start).toHaveBeenCalledWith("a_db_pool", 2);
  const bar = await screen.findByRole("status");
  expect(bar).toHaveAttribute("aria-live", "polite");
  expect(bar).toHaveTextContent("Starting scenario A…");

  // the story finishes: caption links to the incident
  mockLive([incident], 0, 27);
  view.rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <IncidentsPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("27 alerts → 1 incident. Root cause: postgres (High, 88%)");
  expect(within(screen.getByRole("status")).getByRole("link", { name: "Open the incident" })).toHaveAttribute(
    "href",
    "/incidents/inc-1",
  );

  fireEvent.click(screen.getByRole("button", { name: "Close demo captions" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("hides Run the demo while a run is already in progress", async () => {
  (simulator.status as Mock).mockResolvedValue({ ...idle, scenario: "a_db_pool", state: "running" });
  mockLive([], 0, 0);
  renderPage();
  await act(async () => {});
  expect(simulator.status).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Run the demo" })).not.toBeInTheDocument();
  expect(screen.getByText("No incidents yet.")).toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("a failed start shows the error inline and re-enables the button", async () => {
  (simulator.start as Mock).mockRejectedValue(new Error("Backend unavailable"));
  mockLive([], 0, 0);
  renderPage();
  const button = await screen.findByRole("button", { name: "Run the demo" });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(await screen.findByText("Backend unavailable")).toBeInTheDocument();
  expect(button).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});
