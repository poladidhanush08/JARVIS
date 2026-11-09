import type { Event, Incident } from "./types";

export const PENDING_WINDOW_MS = 10_000;

const ANOMALOUS_LEVELS = new Set<Event["level"]>(["warn", "error", "critical"]);

export function isAnomalous(e: Event): boolean {
  return e.type === "alert" || ANOMALOUS_LEVELS.has(e.level);
}

/**
 * Anomalous events from the last `windowMs` that no listed incident has absorbed yet.
 * Age is measured from `receivedAt` (client arrival, ms) when known, since simulator
 * timestamps are compressed and drift from the wall clock; else from the event timestamp.
 */
export function pendingEvents(
  events: Event[],
  incidents: Incident[],
  now: Date = new Date(),
  receivedAt: ReadonlyMap<string, number> = new Map(),
  windowMs: number = PENDING_WINDOW_MS,
): Event[] {
  const grouped = new Set(incidents.flatMap((i) => i.event_ids));
  const cutoff = now.getTime() - windowMs;
  const at = (e: Event) => receivedAt.get(e.id) ?? new Date(e.timestamp).getTime();
  return events.filter((e) => isAnomalous(e) && !grouped.has(e.id) && at(e) >= cutoff);
}

export type ServiceStatus = "root" | "impacted" | "healthy";

/** Red if the top root-cause candidate of any incident, amber if affected by any, else grey. */
export function serviceStatus(service: string, incidents: Incident[]): ServiceStatus {
  if (incidents.some((i) => i.root_cause_candidates[0]?.service === service)) return "root";
  if (incidents.some((i) => i.affected_services.includes(service))) return "impacted";
  return "healthy";
}

/** Per-card stagger for the collapse: capped at 200 ms, and stagger * (n - 1) + duration stays within 2 s. */
export function collapseStagger(count: number, durationMs: number, totalMs = 2000, capMs = 200): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(capMs, Math.floor((totalMs - durationMs) / (count - 1))));
}
