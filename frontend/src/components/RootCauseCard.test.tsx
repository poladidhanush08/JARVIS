import { fireEvent, render, screen } from "@testing-library/react";
import RootCauseCard from "./RootCauseCard";

test("root cause card shows verdict and confidence words", () => {
  render(
    <RootCauseCard
      candidate={{
        service: "user-db",
        cause_type: "db_pool_exhaustion",
        confidence: 80,
        factors: { first: 1, graph: 1, change: 0, own: 1 },
        evidence: ["First anomaly in the incident at T+0s", "5 of 5 other affected services depend on it", "x"],
      }}
      phrase="ran out of connections"
      runnerUp="auth-service ranked lower: its errors point at user-db"
    />,
  );
  expect(screen.getByText("user-db — ran out of connections")).toBeInTheDocument();
  expect(screen.getByText(/High confidence, 80%/)).toBeInTheDocument();
  expect(screen.getByText("First anomaly in the incident at T+0s")).toBeInTheDocument();
  expect(screen.queryByText("x")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Show evidence"));
  expect(screen.getByText("x")).toBeInTheDocument();
  expect(screen.getByText(/ranked lower/)).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "graph" })).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getByRole("meter", { name: "change" })).toHaveAttribute("aria-valuenow", "0");
});

test("verdict omits the dash when there is no cause phrase", () => {
  render(
    <RootCauseCard
      candidate={{ service: "user-db", cause_type: "", confidence: 40, factors: {}, evidence: [] }}
      phrase=""
      runnerUp=""
    />,
  );
  expect(screen.getByText("user-db")).toBeInTheDocument();
  expect(screen.queryByText(/user-db —/)).not.toBeInTheDocument();
});
