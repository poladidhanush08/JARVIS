import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import SourcesPage from "./Sources";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  getScenarios: vi.fn(() => Promise.resolve([{ id: "s1", name: "Checkout outage", description: "desc" }])),
  uploadLog: vi.fn(() =>
    Promise.resolve({
      accepted: 1,
      skipped: 1,
      format: "text",
      preview: [{ id: "e1", timestamp: "2026-01-01T00:00:00Z", service: "api", level: "error", message: "boom" }],
    }),
  ),
  simulator: {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    reset: vi.fn(),
    speed: vi.fn(),
    status: vi.fn(() => Promise.resolve({ scenario: null, state: "idle", speed: 1, emitted: 0, total: 0 })),
  },
}));

test("uploading a file shows the import summary", async () => {
  render(<SourcesPage />);
  const file = new File(["x"], "app.log", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("Log file"), { target: { files: [file] } });
  expect(await screen.findByText("Imported 1 events · skipped 1 lines · format text")).toBeInTheDocument();
  expect(screen.getByText("boom")).toBeInTheDocument();
});
