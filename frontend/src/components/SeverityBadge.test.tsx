import { render, screen } from "@testing-library/react";
import SeverityBadge from "./SeverityBadge";

test("severity badge shows text, not color alone", () => {
  render(<SeverityBadge severity="SEV1" />);
  expect(screen.getByText("SEV1")).toBeInTheDocument();
});
