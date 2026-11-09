import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
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
  updated_at: null,
};

const live = (incidents: Incident[]) =>
  (useLive as Mock).mockReturnValue({
    stats: {},
    incidents,
    recentEvents: [],
    receivedAt: new Map(),
    snapshotIds: [],
    connected: true,
  });

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

const other: Incident = { ...base, id: "inc-2", title: "Payments failing because bank-gateway timed out" };

function GoToB() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/incidents/inc-2")}>go to B</button>;
}

function renderWithNav() {
  return render(
    <MemoryRouter initialEntries={["/incidents/inc-1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GoToB />
      <Routes>
        <Route path="/incidents/:id" element={<IncidentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("a late response for the previous incident does not overwrite the new one", async () => {
  let resolveA!: (v: unknown) => void;
  (getIncident as Mock).mockImplementation((id: string) =>
    id === "inc-1"
      ? new Promise((r) => {
          resolveA = r;
        })
      : Promise.resolve({ incident: other, events: [] }),
  );
  renderWithNav();
  fireEvent.click(screen.getByText("go to B"));
  expect(await screen.findByRole("heading", { level: 1, name: other.title })).toBeInTheDocument();

  await act(async () => {
    resolveA({ incident: base, events: [] });
  });
  expect(screen.getByRole("heading", { level: 1, name: other.title })).toBeInTheDocument();
  expect(screen.queryByText(base.title)).not.toBeInTheDocument();
});

test("navigating away resets replay and leaves no replay timer running", async () => {
  (getIncident as Mock).mockImplementation((id: string) =>
    Promise.resolve({ incident: id === "inc-1" ? base : other, events: [] }),
  );
  vi.useFakeTimers();
  try {
    renderWithNav();
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 1, name: base.title })).toBeInTheDocument();
    // baseline: the status line clock only
    const baseline = vi.getTimerCount();
    expect(baseline).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(vi.getTimerCount()).toBe(baseline + 1);

    fireEvent.click(screen.getByText("go to B"));
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 1, name: other.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
    expect(vi.getTimerCount()).toBe(baseline);
  } finally {
    vi.useRealTimers();
  }
});

const rerenderPage = (view: ReturnType<typeof render>) =>
  view.rerender(
    <MemoryRouter initialEntries={["/incidents/inc-1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/incidents/:id" element={<IncidentPage />} />
      </Routes>
    </MemoryRouter>,
  );

test("refetches when the engine re-ranks without new events", async () => {
  (getIncident as Mock).mockResolvedValue({ incident: base, events: [] });
  live([base]);
  const view = renderPage();
  expect(await screen.findByText("user-db — ran out of connections")).toBeInTheDocument();
  const reranked: Incident = {
    ...base,
    title: "Logins failing because auth-service is failing",
    root_cause_candidates: [{ ...base.root_cause_candidates[0], service: "auth-service", confidence: 60 }],
    cause_phrase: "is failing",
  };
  (getIncident as Mock).mockResolvedValue({ incident: reranked, events: [] });
  live([reranked]);
  rerenderPage(view);
  expect(await screen.findByRole("heading", { level: 1, name: reranked.title })).toBeInTheDocument();
  expect(getIncident).toHaveBeenCalledTimes(2);
});

test("shows not-found once the incident disappears from the live list (merged or reset)", async () => {
  (getIncident as Mock).mockResolvedValue({ incident: base, events: [] });
  live([base]);
  const view = renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: base.title })).toBeInTheDocument();
  (getIncident as Mock).mockRejectedValue(new HttpError("Unknown incident inc-1", 404));
  live([]);
  rerenderPage(view);
  expect(await screen.findByText("Incident not found")).toBeInTheDocument();
});

test("'updated' uses the engine's wall-clock updated_at; numbers explain themselves", async () => {
  const updated = new Date(Date.now() - 4000).toISOString();
  const incident: Incident = {
    ...base,
    updated_at: updated,
    impact: { ...base.impact, endpoints: ["/login", "/pay"] },
    key_moments: [
      { timestamp: start, service: "auth-service", label: "auth-service affected", event_id: "e2" },
      { timestamp: "2026-11-09T10:00:04Z", service: "user-db", label: "pool exhausted", event_id: "e1" },
    ],
  };
  (getIncident as Mock).mockResolvedValue({ incident, events: [] });
  renderPage();
  expect(await screen.findByText(/updated 4 s ago/)).toBeInTheDocument();
  expect(screen.getByText("Endpoints: /login, /pay")).toBeInTheDocument();
  expect(screen.getByText(/confidence, 70%/)).toHaveAttribute("title", expect.stringContaining("0.35 × came first"));
  expect(screen.getAllByTitle("seconds after the incident's first anomaly")).toHaveLength(2);
  // the red dot follows the top root-cause candidate (user-db), not the first moment
  const dots = screen
    .getByRole("region", { name: "Key moments" })
    .querySelectorAll("li > span:nth-child(2) > span:first-child");
  expect(dots[0].className).toContain("bg-impacted");
  expect(dots[1].className).toContain("bg-root");
});
