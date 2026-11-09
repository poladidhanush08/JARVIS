import { confidenceLabel } from "./format";
import type { Event, Incident, Stats } from "./types";

export interface DemoCaption {
  text: string;
  /** Set once the story is complete: the incident to open. */
  incidentId?: string;
}

/** Below this many raw alerts the engine is still grouping; the root cause is not settled yet. */
const SETTLED_ALERTS = 15;

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function isAnomalous(e: Event): boolean {
  return e.type === "alert" || e.level === "warn" || e.level === "error" || e.level === "critical";
}

/** Live caption for the guided demo; returns the first stage that applies. */
export function demoCaption(stats: Stats, incidents: Incident[], recentEvents: Event[]): DemoCaption {
  const anomalous = recentEvents.filter(isAnomalous);
  if (stats.raw_alerts === 0 && anomalous.length === 0) return { text: "Starting scenario A…" };

  if (incidents.length === 0) {
    const n = Math.max(stats.raw_alerts, anomalous.length);
    const k = new Set(anomalous.map((e) => e.service)).size;
    return { text: k > 0 ? `${plural(n, "alert")} arriving from ${plural(k, "service")}…` : `${plural(n, "alert")} arriving…` };
  }

  const grouping = { text: "Grouping related alerts into one incident…" };
  if (stats.raw_alerts < SETTLED_ALERTS) return grouping;

  const promoted = incidents
    .filter((i) => i.promoted)
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const newest = promoted[0];
  const top = newest?.root_cause_candidates[0];
  if (!newest || !top) return grouping;

  const cause = `${top.service} (${confidenceLabel(top.confidence)}, ${top.confidence}%)`;
  const text =
    promoted.length === 1
      ? `${stats.raw_alerts} alerts → 1 incident. Root cause: ${cause}`
      : `${stats.raw_alerts} alerts → ${promoted.length} incidents. Top root cause: ${cause}`;
  return { text, incidentId: newest.id };
}
