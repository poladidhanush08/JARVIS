import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { HttpError, simulator, uploadLog } from "../lib/api";
import type { SimulatorStatus } from "../lib/types";
import SourcesPage, { SCENARIO_RETRY_MS } from "./Sources";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  getScenarios: vi.fn(() =>
    Promise.resolve([
      { id: "s1", name: "Checkout outage", description: "desc" },
      { id: "s2", name: "Cache storm", description: "other" },
    ]),
  ),
  uploadLog: vi.fn(),
  getEvents: vi.fn(() =>
    Promise.resolve([
      { event: { id: "a", source: "simulator" }, incident_id: null, reasons: [] },
      { event: { id: "b", source: "simulator" }, incident_id: null, reasons: [] },
      { event: { id: "c", source: "api" }, incident_id: null, reasons: [] },
    ]),
  ),
  simulator: {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    reset: vi.fn(),
    speed: vi.fn(),
    status: vi.fn(),
  },
}));

const st = (over: Partial<SimulatorStatus>): SimulatorStatus => ({
  scenario: null,
  state: "idle",
  speed: 1,
  emitted: 0,
  total: 0,
  ...over,
});

async function renderWith(status: SimulatorStatus) {
  vi.mocked(simulator.status).mockResolvedValue(status);
  const view = render(
    <MemoryRouter initialEntries={["/sources"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/" element={<p>incidents page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
  return view;
}

const has = (name: string) => screen.queryByRole("button", { name }) !== null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

test("idle shows only Play", async () => {
  await renderWith(st({}));
  expect(has("Play")).toBe(true);
  expect(has("Pause") || has("Resume") || has("Reset")).toBe(false);
  expect(screen.getByText("Idle")).toBeInTheDocument();
});

test("running shows Pause and Reset; paused shows Resume and Reset", async () => {
  const { unmount } = await renderWith(st({ state: "running", scenario: "s2", speed: 5, emitted: 14, total: 31 }));
  expect(has("Pause") && has("Reset")).toBe(true);
  expect(has("Play") || has("Resume")).toBe(false);
  expect(screen.getByText("Running · 14 of 31 events")).toBeInTheDocument();
  unmount();
  await renderWith(st({ state: "paused", total: 31, emitted: 3 }));
  expect(has("Resume") && has("Reset")).toBe(true);
  expect(has("Play") || has("Pause")).toBe(false);
});

test("seeds speed and scenario from a running server state", async () => {
  await renderWith(st({ state: "running", scenario: "s2", speed: 5, total: 10 }));
  expect(screen.getByRole("button", { name: "5x" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("radio", { name: /Cache storm/ })).toHaveAttribute("aria-checked", "true");
});

test("polls every second while running, stops when finished and on unmount", async () => {
  const { unmount } = await renderWith(st({ state: "running", total: 10 }));
  const calls = () => vi.mocked(simulator.status).mock.calls.length;
  const before = calls();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(calls()).toBe(before + 3);

  vi.mocked(simulator.status).mockResolvedValue(st({ state: "finished", emitted: 10, total: 10 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText("Finished · 10 of 10 events")).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
  expect(has("Play")).toBe(true);

  vi.mocked(simulator.status).mockResolvedValue(st({ state: "running", total: 10 }));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("unmount while running clears the poll timer", async () => {
  const { unmount } = await renderWith(st({ state: "running", total: 10 }));
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("speed change calls the server while running and while paused, not while idle", async () => {
  vi.mocked(simulator.speed).mockImplementation((n) => Promise.resolve(st({ state: "running", speed: n, total: 10 })));
  const { unmount } = await renderWith(st({ state: "running", total: 10 }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
  });
  expect(simulator.speed).toHaveBeenCalledWith(2);
  unmount();

  vi.mocked(simulator.speed).mockClear();
  vi.mocked(simulator.speed).mockImplementation((n) => Promise.resolve(st({ state: "paused", speed: n, total: 10 })));
  const paused = await renderWith(st({ state: "paused", total: 10 }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "10x" }));
  });
  expect(simulator.speed).toHaveBeenCalledWith(10);
  expect(screen.getByRole("button", { name: "10x" })).toHaveAttribute("aria-pressed", "true");
  paused.unmount();

  vi.mocked(simulator.speed).mockClear();
  await renderWith(st({}));
  fireEvent.click(screen.getByRole("button", { name: "5x" }));
  expect(simulator.speed).not.toHaveBeenCalled();
});

test("uploading a file shows the import summary and preview", async () => {
  vi.mocked(uploadLog).mockResolvedValue({
    accepted: 1,
    skipped: 1,
    format: "text",
    preview: [
      {
        id: "e1",
        timestamp: "2026-01-01T00:00:00Z",
        source: "log_file",
        service: "api",
        type: "log",
        level: "error",
        message: "boom",
        fingerprint: "f",
        metric: null,
        trace_id: null,
        tags: {},
      },
    ],
  });
  await renderWith(st({}));
  const file = new File(["x"], "app.log", { type: "text/plain" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Log file"), { target: { files: [file] } });
  });
  expect(screen.getByText("Imported 1 events · skipped 1 lines · format text")).toBeInTheDocument();
  expect(screen.getByText("boom")).toBeInTheDocument();
});

test("upload failure shows the HttpError message inline", async () => {
  vi.mocked(uploadLog).mockRejectedValue(new HttpError("Unsupported file format", 400));
  await renderWith(st({}));
  const file = new File(["x"], "bad.bin");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Log file"), { target: { files: [file] } });
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Unsupported file format");
});

test("finished keeps the last scenario and speed and offers Play and Reset", async () => {
  await renderWith(st({ state: "finished", scenario: "s2", speed: 10, emitted: 14, total: 14 }));
  expect(screen.getByRole("radio", { name: /Cache storm/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "10x" })).toHaveAttribute("aria-pressed", "true");
  expect(has("Play") && has("Reset")).toBe(true);
  expect(has("Pause") || has("Resume")).toBe(false);
});

test("Play starts the scenario and goes to Incidents; a failed start stays on Sources", async () => {
  vi.mocked(simulator.start).mockRejectedValueOnce(new HttpError("Unknown scenario", 404));
  await renderWith(st({}));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
  });
  expect(screen.getByText("Unknown scenario")).toBeInTheDocument();
  expect(screen.queryByText("incidents page")).toBeNull();

  vi.mocked(simulator.start).mockResolvedValueOnce(st({ state: "running", scenario: "s1", total: 10 }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
  });
  expect(simulator.start).toHaveBeenLastCalledWith("s1", 1);
  expect(screen.getByText("incidents page")).toBeInTheDocument();
});

test("scenario cards are lettered and each source shows its events-received counter", async () => {
  await renderWith(st({}));
  expect(screen.getByRole("radio", { name: /Checkout outage/ })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("radio", { name: /Cache storm/ }));
  expect(screen.getByRole("radio", { name: /Cache storm/ })).toHaveAttribute("aria-checked", "true");
  const counters = screen.getAllByText("events received").map((el) => el.previousElementSibling?.textContent);
  expect(counters).toEqual(["2", "0", "1"]);
});

test("keeps retrying the scenario list while the backend wakes up", async () => {
  const { getScenarios } = await import("../lib/api");
  vi.mocked(getScenarios)
    .mockRejectedValueOnce(new Error("Failed to fetch"))
    .mockRejectedValueOnce(new Error("Failed to fetch"));
  await renderWith(st({}));
  expect(screen.getByText(/Waiting for the analysis engine to start/)).toBeInTheDocument();
  expect(screen.queryByText("Checkout outage")).not.toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCENARIO_RETRY_MS * 2);
  });
  expect(screen.getByText("Checkout outage")).toBeInTheDocument();
  expect(screen.queryByText(/Waiting for the analysis engine/)).not.toBeInTheDocument();
  expect(getScenarios).toHaveBeenCalledTimes(3);
});
