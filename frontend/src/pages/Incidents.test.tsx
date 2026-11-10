import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, type Mock } from "vitest";
import { useLive } from "../hooks/useLive";
import { simulator } from "../lib/api";
import type { Event, Incident } from "../lib/types";
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

function mockLive(
  incidents: Incident[],
  isolated = 3,
  raw_alerts = 27,
  recentEvents: Event[] = [],
  snapshotIds: string[] | null = incidents.map((i) => i.id),
) {
  (useLive as Mock).mockReturnValue({
    stats: { raw_alerts, incidents: incidents.length, isolated },
    incidents,
    recentEvents,
    receivedAt: new Map(),
    snapshotIds,
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

function rerenderPage(view: ReturnType<typeof render>) {
  view.rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <IncidentsPage />
    </MemoryRouter>,
  );
}

function alert(id: string, service: string): Event {
  return {
    id,
    timestamp: new Date().toISOString(),
    source: "simulator",
    service,
    type: "log",
    level: "error",
    message: "boom",
    fingerprint: "f",
    metric: null,
    trace_id: null,
    tags: {},
  };
}

test("Run the demo starts scenario A at 2x and shows live captions", async () => {
  mockLive([], 0, 0);
  const view = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Run the demo" }));
  expect(simulator.start).toHaveBeenCalledWith("a_db_pool", 2);
  const caption = await screen.findByTestId("demo-caption");
  expect(caption).toHaveAttribute("aria-live", "off");
  expect(caption).not.toHaveAttribute("role");
  expect(caption).toHaveTextContent("Starting scenario A…");
  const live = screen.getByRole("status");
  expect(live).toHaveAttribute("aria-live", "polite");
  expect(live).toHaveTextContent("Starting scenario A");

  // the story finishes: caption links to the incident
  mockLive([incident], 0, 27);
  rerenderPage(view);
  const done = "27 alerts → 1 incident. Root cause: postgres (High, 88%)";
  expect(screen.getByTestId("demo-caption")).toHaveTextContent(done);
  expect(screen.getByRole("status")).toHaveTextContent("Grouped into 1 incident. Root cause: postgres (High, 88%)");
  expect(within(screen.getByTestId("demo-caption")).getByRole("link", { name: "Open the incident" })).toHaveAttribute(
    "href",
    "/incidents/inc-1",
  );

  fireEvent.click(screen.getByRole("button", { name: "Close demo captions" }));
  expect(screen.queryByTestId("demo-caption")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("the live region announces stage changes, not every count change", async () => {
  mockLive([], 0, 0);
  const view = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Run the demo" }));
  await screen.findByTestId("demo-caption");

  mockLive([], 0, 2, [alert("e1", "postgres"), alert("e2", "checkout")]);
  rerenderPage(view);
  expect(screen.getByTestId("demo-caption")).toHaveTextContent("2 alerts arriving from 2 services…");
  expect(screen.getByRole("status")).toHaveTextContent(/^Alerts arriving$/);

  mockLive([], 0, 3, [alert("e3", "auth"), alert("e1", "postgres"), alert("e2", "checkout")]);
  rerenderPage(view);
  expect(screen.getByTestId("demo-caption")).toHaveTextContent("3 alerts arriving from 3 services…");
  expect(screen.getByRole("status")).toHaveTextContent(/^Alerts arriving$/);
  await screen.findByLabelText("search: healthy");
});

test("shows Connecting… instead of the button until the first snapshot arrives", async () => {
  mockLive([], 0, 0, [], null);
  const view = renderPage();
  await act(async () => {});
  expect(screen.getByText("Connecting…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Run the demo" })).not.toBeInTheDocument();

  mockLive([], 0, 0, [], []);
  rerenderPage(view);
  expect(await screen.findByRole("button", { name: "Run the demo" })).toBeInTheDocument();
  expect(screen.queryByText("Connecting…")).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("no Run the demo button when the snapshot has incidents", async () => {
  mockLive([incident], 0, 27, [], ["inc-1"]);
  renderPage();
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Run the demo" })).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});

test("the button comes back once the run is reset elsewhere", async () => {
  (simulator.status as Mock).mockResolvedValue({ ...idle, scenario: "a_db_pool", state: "running" });
  mockLive([], 0, 5);
  const view = renderPage();
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Run the demo" })).not.toBeInTheDocument();

  (simulator.status as Mock).mockResolvedValue(idle);
  mockLive([], 0, 0);
  rerenderPage(view);
  expect(await screen.findByRole("button", { name: "Run the demo" })).toBeInTheDocument();
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Backend unavailable");
  expect(button).toBeEnabled();
  expect(screen.queryByTestId("demo-caption")).not.toBeInTheDocument();
  await screen.findByLabelText("search: healthy");
});
