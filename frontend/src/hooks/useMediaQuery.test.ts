import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

afterEach(() => {
  // @ts-expect-error cleanup of the test stub
  delete window.matchMedia;
});

function stub(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
  };
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return {
    fire(next: boolean) {
      mql.matches = next;
      listeners.forEach((l) => l({ matches: next }));
    },
    listeners,
  };
}

test("returns false when matchMedia is missing", () => {
  const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
  expect(result.current).toBe(false);
});

test("returns the initial value and follows change events", () => {
  const mq = stub(true);
  const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
  expect(result.current).toBe(true);
  act(() => mq.fire(false));
  expect(result.current).toBe(false);
  unmount();
  expect(mq.listeners.size).toBe(0);
});
