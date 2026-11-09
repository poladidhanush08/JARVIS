import { afterEach, beforeEach, vi } from "vitest";
import { getStats, postEvents, reportUrl, uploadLog } from "./api";
import { SESSION_HEADER, sessionId } from "./session";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const headersOf = (call = 0) => new Headers(fetchMock.mock.calls[call][1]?.headers);

test("GET sends the session header", async () => {
  await getStats();
  expect(headersOf().get(SESSION_HEADER)).toBe(sessionId());
});

test("POST sends the session header and keeps the JSON content type", async () => {
  await postEvents({ service: "a", level: "error", message: "m" } as never);
  expect(headersOf().get(SESSION_HEADER)).toBe(sessionId());
  expect(headersOf().get("Content-Type")).toBe("application/json");
});

test("file uploads send the session header but never set Content-Type", async () => {
  await uploadLog(new File(["x"], "a.log"));
  expect(headersOf().get(SESSION_HEADER)).toBe(sessionId());
  expect(headersOf().has("Content-Type")).toBe(false);
});

test("reportUrl carries the session as a query parameter", () => {
  expect(reportUrl("INC-001")).toBe(`/api/incidents/INC-001/report?session=${encodeURIComponent(sessionId())}`);
});
