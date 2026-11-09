import { confidenceLabel, relativeTime, tPlus } from "./format";

test("confidence labels", () => {
  expect(confidenceLabel(87)).toBe("High");
  expect(confidenceLabel(60)).toBe("Medium");
  expect(confidenceLabel(20)).toBe("Low");
});
test("tPlus", () => expect(tPlus("2026-11-09T10:00:18Z", "2026-11-09T10:00:00Z")).toBe("T+18s"));
test("relativeTime", () => {
  const now = new Date("2026-11-09T10:05:00Z");
  expect(relativeTime("2026-11-09T10:04:57Z", now)).toBe("3 s ago");
  expect(relativeTime("2026-11-09T10:01:00Z", now)).toBe("4 min ago");
});
