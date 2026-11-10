import { fireEvent, render, screen } from "@testing-library/react";
import RootCauseCard from "./RootCauseCard";

test("root cause card shows verdict, confidence ring and top evidence", () => {
  render(
    <RootCauseCard
      candidate={{
        service: "user-db",
        cause_type: "db_pool_exhaustion",
        score: 80,
        confidence: 89,
        factors: { first: 1, graph: 1, change: 0, own: 1 },
        evidence: ["First anomaly in the incident at T+0s", "5 of 5 other affected services depend on it", "y", "x"],
      }}
      phrase="ran out of connections"
      runnerUp="auth-service ranked lower: its errors point at user-db"
      runnerUpCandidate={{ service: "auth-service", score: 49 }}
    />,
  );
  expect(screen.getByText("user-db — ran out of connections")).toBeInTheDocument();
  expect(screen.getByText("High, 89%")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "Root-cause confidence" })).toHaveAttribute("aria-valuenow", "89");
  expect(screen.getByText("First anomaly in the incident at T+0s")).toBeInTheDocument();
  expect(screen.getByText("y")).toBeInTheDocument();
  expect(screen.queryByText("x")).not.toBeInTheDocument();
  expect(screen.getByText(/ranked lower/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Show evidence"));
  expect(screen.getByText("x")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "graph" })).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getByRole("meter", { name: "change" })).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByText("Evidence score 80/100 · next best: auth-service 49/100")).toBeInTheDocument();
});

test("verdict omits the dash when there is no cause phrase", () => {
  render(
    <RootCauseCard
      candidate={{ service: "user-db", cause_type: "", score: 40, confidence: 40, factors: {}, evidence: [] }}
      phrase=""
      runnerUp=""
    />,
  );
  expect(screen.getByText("user-db")).toBeInTheDocument();
  expect(screen.getByText("Low, 40%")).toBeInTheDocument();
  expect(screen.queryByText(/user-db —/)).not.toBeInTheDocument();
});

test("evidence score line omits next best when there is no runner-up", () => {
  render(
    <RootCauseCard
      candidate={{ service: "user-db", cause_type: "", score: 70, confidence: 70, factors: { first: 1 }, evidence: [] }}
      phrase=""
      runnerUp=""
    />,
  );
  fireEvent.click(screen.getByText("Show evidence"));
  expect(screen.getByText("Evidence score 70/100")).toBeInTheDocument();
});

test("old backend without score: no evidence score line, no undefined", () => {
  render(
    <RootCauseCard
      candidate={{ service: "user-db", cause_type: "", confidence: 70, factors: { first: 1 }, evidence: ["e"] }}
      phrase=""
      runnerUp=""
      runnerUpCandidate={{ service: "auth-service" }}
    />,
  );
  fireEvent.click(screen.getByText("Show evidence"));
  expect(screen.queryByText(/Evidence score/)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("undefined");
});
