/** A per-visitor workspace id, sent to the backend so each visitor gets an isolated demo. */
export const SESSION_HEADER = "X-Jarvis-Session";
export const SESSION_KEY = "jarvis.session";
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

let cached: string | null = null;

function generate(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  let id = "";
  while (id.length < 24) id += Math.random().toString(36).slice(2);
  return id.slice(0, 24);
}

/** The visitor's session id: stable for the page and persisted when storage allows. */
export function sessionId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try {
    id = localStorage.getItem(SESSION_KEY);
  } catch {
    /* storage unavailable (private mode): fall through to an in-memory id */
  }
  if (!id || !VALID.test(id)) {
    id = generate();
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* keep it in memory for this page */
    }
  }
  cached = id;
  return id;
}

/** Test hook: forget the in-memory id, as a fresh page load would. */
export function resetSessionCache(): void {
  cached = null;
}
