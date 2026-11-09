import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "./Sidebar";

test("each nav link keeps its label as accessible name and hover title when collapsed to icons", () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>,
  );
  for (const label of ["Incidents", "Sources", "Events"]) {
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("title", label);
  }
});

test("sidebar is icon-width below md and 200 px from md up", () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>,
  );
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(nav.className).toMatch(/\bw-14\b/);
  expect(nav.className).toMatch(/\bmd:w-\[200px\]/);
});
