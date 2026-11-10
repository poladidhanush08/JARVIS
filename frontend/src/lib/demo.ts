import { confidenceLabel } from "./format";
import type { Event, Incident, Stats } from "./types";

export type DemoStage = 1 | 2 | 3 | 4;

export interface DemoCaption {
  /** 1 starting, 2 alerts arriving, 3 grouping, 4 root cause found. */
  stage: DemoStage;
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
  if (stats.raw_alerts === 0 && anomalous.length === 0) return { stage: 1, text: "Starting scenario A…" };

  if (incidents.length === 0) {
    const n = Math.max(stats.raw_alerts, anomalous.length);
    const k = new Set(anomalous.map((e) => e.service)).size;
    const text = k > 0 ? `${plural(n, "alert")} arriving from ${plural(k, "service")}…` : `${plural(n, "alert")} arriving…`;
    return { stage: 2, text };
  }

  const grouping: DemoCaption = { stage: 3, text: "Grouping related alerts into one incident…" };
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
  return { stage: 4, text, incidentId: newest.id };
}

const STAGE_MESSAGES: Record<Exclude<DemoStage, 4>, string> = {
  1: "Starting scenario A",
  2: "Alerts arriving",
  3: "Grouping alerts",
};

/**
 * Screen-reader message for a stage: stable while counts climb. The final message is announced
 * once, the moment the root cause is found, so it leaves out the alert count, which keeps rising.
 */
export function demoAnnouncement(caption: DemoCaption): string {
  if (caption.stage !== 4) return STAGE_MESSAGES[caption.stage];
  const [, verdict] = caption.text.split(" → ");
  return verdict ? `Grouped into ${verdict}` : caption.text;
}
