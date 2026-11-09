import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import ErrorBoundary, { RouteErrorBoundary } from "./ErrorBoundary";

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

test("RouteErrorBoundary recovers from the error screen when the route changes", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={["/broken"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/fine">Go elsewhere</Link>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/broken" element={<Boom />} />
          <Route path="/fine" element={<p>fine page</p>} />
        </Routes>
      </RouteErrorBoundary>
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Go elsewhere" }));
  expect(screen.getByText("fine page")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
