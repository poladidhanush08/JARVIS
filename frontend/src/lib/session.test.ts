import { afterEach, beforeEach, vi } from "vitest";
import { SESSION_HEADER, SESSION_KEY, resetSessionCache, sessionId } from "./session";

const VALID = /^[A-Za-z0-9_-]{8,64}$/;

beforeEach(() => {
  localStorage.clear();
  resetSessionCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("exports the header name", () => {
  expect(SESSION_HEADER).toBe("X-Jarvis-Session");
});

test("creates a valid id, stores it and returns the same one every call", () => {
  const id = sessionId();
  expect(id).toMatch(VALID);
  expect(localStorage.getItem(SESSION_KEY)).toBe(id);
  expect(sessionId()).toBe(id);
});

test("persists across a reload", () => {
  const id = sessionId();
  resetSessionCache(); // simulates a fresh page load
  expect(sessionId()).toBe(id);
});

test("an invalid stored value is replaced", () => {
  localStorage.setItem(SESSION_KEY, "bad id!");
  const id = sessionId();
  expect(id).toMatch(VALID);
  expect(localStorage.getItem(SESSION_KEY)).toBe(id);
});

test("falls back to a base36 id when randomUUID is missing", () => {
  vi.stubGlobal("crypto", {});
  expect(sessionId()).toMatch(VALID);
});

test("when localStorage throws the id is kept in memory", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const id = sessionId();
  expect(id).toMatch(VALID);
  expect(sessionId()).toBe(id);
});
