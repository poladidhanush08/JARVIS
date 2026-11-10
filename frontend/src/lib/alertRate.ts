import type { Event } from "./types";

export interface RateBucket {
  /** Bucket start, seconds after the incident's first anomaly. */
  t: number;
  count: number;
}

export function isAnomalous(e: Event): boolean {
  return e.level === "warn" || e.level === "error" || e.level === "critical" || e.type === "alert";
}

/**
 * Anomalous events per `bucketS`-second window, from the first to the last anomalous event
 * inclusive (empty windows between are kept as zero). Order of `events` does not matter.
 */
export function alertRate(events: Event[], startIso: string, bucketS = 5): RateBucket[] {
  const start = Date.parse(startIso);
  const idx: number[] = [];
  for (const e of events) {
    if (!isAnomalous(e)) continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms) || Number.isNaN(start)) continue;
    idx.push(Math.floor((ms - start) / 1000 / bucketS));
  }
  if (idx.length === 0) return [];
  const lo = Math.min(...idx);
  const hi = Math.max(...idx);
  const out: RateBucket[] = [];
  for (let i = lo; i <= hi; i++) out.push({ t: i * bucketS, count: 0 });
  for (const i of idx) out[i - lo].count += 1;
  return out;
}
