import { isAnomalous } from "./collapse";
import type { Event } from "./types";

export { isAnomalous };

export interface RateBucket {
  /** Bucket start, seconds after the incident's first anomaly. */
  t: number;
  count: number;
}

const MAX_BUCKETS = 2000;

/**
 * Anomalous events per `bucketS`-second window, from the first to the last anomalous event
 * inclusive (empty windows between are kept as zero). Order of `events` does not matter.
 */
export function alertRate(
  events: Event[],
  startIso: string,
  bucketS = 5,
): RateBucket[] {
  const start = Date.parse(startIso);
  const idx: number[] = [];
  for (const e of events) {
    if (!isAnomalous(e)) continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms) || Number.isNaN(start)) continue;
    idx.push(Math.floor((ms - start) / 1000 / bucketS));
  }
  if (idx.length === 0) return [];
  let lo = idx[0];
  let hi = idx[0];
  for (const i of idx) {
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  // A clock-skewed outlier must not allocate millions of empty buckets: keep the latest window.
  if (hi - lo + 1 > MAX_BUCKETS) lo = hi - MAX_BUCKETS + 1;
  const out: RateBucket[] = [];
  for (let i = lo; i <= hi; i++) out.push({ t: i * bucketS, count: 0 });
  for (const i of idx) if (i >= lo) out[i - lo].count += 1;
  return out;
}
