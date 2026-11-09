import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { RETRY_MS, useBackendReady, WAKING_AFTER_MS } from "./useBackendReady";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a fast backend never shows the waking state", async () => {
  fetchMock.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useBackendReady());
  await act(async () => {});
  expect(result.current).toBe("ready");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WAKING_AFTER_MS * 2);
  });
  expect(result.current).toBe("ready");
});

test("a sleeping backend shows waking, retries, then becomes ready", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useBackendReady());
  await act(async () => {});
  expect(result.current).toBe("waking");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_MS);
  });
  expect(result.current).toBe("ready");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a slow first answer shows waking until it arrives", async () => {
  let answer: (v: { ok: boolean }) => void = () => {};
  fetchMock.mockReturnValue(new Promise((r) => (answer = r)));
  const { result } = renderHook(() => useBackendReady());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WAKING_AFTER_MS + 10);
  });
  expect(result.current).toBe("waking");
  await act(async () => {
    answer({ ok: true });
  });
  expect(result.current).toBe("ready");
});

test("pings /api/health", async () => {
  fetchMock.mockResolvedValue({ ok: true });
  renderHook(() => useBackendReady());
  await act(async () => {});
  expect(fetchMock.mock.calls[0][0]).toBe("/api/health");
});
