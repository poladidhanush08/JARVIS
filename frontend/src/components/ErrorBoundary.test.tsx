import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error("kaboom");
}

test("renders children when nothing throws", () => {
  render(
    <ErrorBoundary>
      <p>fine</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("fine")).toBeInTheDocument();
});

test("renders the fallback, logs, and Reload reloads the page", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  expect(err).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
