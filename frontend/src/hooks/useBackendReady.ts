import { useEffect, useState } from "react";
import { apiUrl } from "../lib/endpoint";

export type BackendStatus = "checking" | "waking" | "ready";

/** Show "waking" only if the backend hasn't answered within this long. */
export const WAKING_AFTER_MS = 1200;
export const RETRY_MS = 3000;
const REQUEST_TIMEOUT_MS = 8000;

async function ping(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/api/health"), { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the backend is answering. The free hosting plan sleeps when idle and takes up to a
 * minute to wake; this keeps pinging until it answers so the UI can say so instead of
 * looking broken.
 */
export function useBackendReady(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const slow = setTimeout(() => {
      if (alive) setStatus((s) => (s === "ready" ? s : "waking"));
    }, WAKING_AFTER_MS);

    const attempt = async () => {
      const ok = await ping();
      if (!alive) return;
      if (ok) {
        clearTimeout(slow);
        setStatus("ready");
      } else {
        setStatus("waking");
        retry = setTimeout(attempt, RETRY_MS);
      }
    };
    void attempt();

    return () => {
      alive = false;
      clearTimeout(slow);
      clearTimeout(retry);
    };
  }, []);

  return status;
}
