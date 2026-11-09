import type { Event, Incident } from "./types";

export const PENDING_WINDOW_MS = 10_000;

const ANOMALOUS_LEVELS = new Set<Event["level"]>(["warn", "error", "critical"]);

export function isAnomalous(e: Event): boolean {
  return e.type === "alert" || ANOMALOUS_LEVELS.has(e.level);
}

/** Anomalous events from the last `windowMs` that no listed incident has absorbed yet. */
export function pendingEvents(
  events: Event[],
  incidents: Incident[],
  now: Date = new Date(),
  windowMs: number = PENDING_WINDOW_MS,
): Event[] {
  const grouped = new Set(incidents.flatMap((i) => i.event_ids));
  const cutoff = now.getTime() - windowMs;
  return events.filter((e) => isAnomalous(e) && !grouped.has(e.id) && new Date(e.timestamp).getTime() >= cutoff);
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
