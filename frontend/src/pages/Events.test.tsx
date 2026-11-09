import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import EventsPage from "./Events";

vi.mock("../hooks/useLive", () => ({
  useLive: () => ({ stats: { raw_alerts: 0, incidents: 0, isolated: 0 }, incidents: [], recentEvents: [], connected: true }),
}));
vi.mock("../lib/api", () => ({
  getEvents: vi.fn(() =>
    Promise.resolve([
      {
        event: {
          id: "e1",
          timestamp: "2026-01-01T00:00:00Z",
          source: "simulator",
          service: "postgres",
          type: "log",
          level: "error",
          message: "pool exhausted",
          fingerprint: "fp",
          metric: null,
          trace_id: null,
          tags: {},
        },
        incident_id: "inc-1",
        reasons: ["time", "signature"],
      },
    ]),
  ),
}));

test("clicking a row shows reason chips", async () => {
  render(
    <MemoryRouter>
      <EventsPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "pool exhausted" }));
  expect(screen.getByText("time")).toBeInTheDocument();
  expect(screen.getByText("signature")).toBeInTheDocument();
  expect(screen.getByText("same error signature")).toBeInTheDocument();
});
