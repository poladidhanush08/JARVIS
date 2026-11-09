import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { Recommendation } from "../lib/types";
import NextStepCard from "./NextStepCard";

const recs: Recommendation[] = [1, 2, 3, 4].map((n) => ({
  step: n,
  action: `Action ${n}`,
  effect: `Effect ${n}`,
  command: n === 1 ? "kubectl rollout restart deploy/user-db" : null,
  verify: `Check ${n}`,
}));

test("next step card shows two steps then expands", () => {
  render(<NextStepCard recommendations={recs} />);
  expect(screen.getByText("Action 1")).toBeInTheDocument();
  expect(screen.getByText("Action 2")).toBeInTheDocument();
  expect(screen.queryByText("Action 3")).not.toBeInTheDocument();
  expect(screen.queryByText(/Verify:/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("All 4 steps + verify checks"));
  for (const n of [1, 2, 3, 4]) expect(screen.getByText(`Action ${n}`)).toBeInTheDocument();
  expect(screen.getByText("Effect 3")).toBeInTheDocument();
  expect(screen.getAllByText(/Verify:/)).toHaveLength(4);
  expect(screen.getByText("kubectl rollout restart deploy/user-db")).toBeInTheDocument();
});

test("copy button writes the command and confirms briefly", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<NextStepCard recommendations={recs} />);
  fireEvent.click(screen.getByText("All 4 steps + verify checks"));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
  });
  expect(writeText).toHaveBeenCalledWith("kubectl rollout restart deploy/user-db");
  expect(screen.getByText("Copied")).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  expect(screen.getByText("Copy")).toBeInTheDocument();
  vi.useRealTimers();
});
