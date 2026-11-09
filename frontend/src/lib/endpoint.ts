/**
 * Where the backend lives.
 *
 * Locally (and when the backend serves the site) the API is on the same origin, so
 * VITE_API_URL is unset and every path stays relative. On Vercel the backend runs
 * elsewhere (e.g. Render): set VITE_API_URL=https://your-api.onrender.com at build time.
 */
const configured: string | undefined = import.meta.env.VITE_API_URL;

/** The API origin with no trailing slash, or "" for same-origin. */
export function apiBase(value: string | undefined = configured): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

/** Absolute or relative URL for an `/api/...` path. */
export function apiUrl(path: string, base: string = apiBase()): string {
  return `${base}${path}`;
}

/** WebSocket URL for live updates: follows the API origin, else the page's own host. */
export function wsUrl(base: string = apiBase(), loc: Pick<Location, "protocol" | "host"> = location): string {
  if (base) return `${base.replace(/^http/, "ws")}/ws`;
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${loc.host}/ws`;
}

/** The public origin to show in copy-paste examples such as the curl command. */
export function publicApiOrigin(base: string = apiBase(), loc: Pick<Location, "origin"> = location): string {
  return base || loc.origin;
}
