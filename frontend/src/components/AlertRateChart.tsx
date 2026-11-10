import { alertRate, type RateBucket } from "../lib/alertRate";
import type { Event } from "../lib/types";

const W = 180;
const H = 32;
const BUCKET_S = 5;
const MAX_BARS = 90;

/** Sum consecutive groups of k buckets; each merged bucket starts where its first one did. */
function merge(buckets: RateBucket[], k: number): RateBucket[] {
  if (k <= 1) return buckets;
  const out: RateBucket[] = [];
  for (let i = 0; i < buckets.length; i += k) {
    let count = 0;
    for (let j = i; j < Math.min(i + k, buckets.length); j++)
      count += buckets[j].count;
    out.push({ t: buckets[i].t, count });
  }
  return out;
}

/**
 * Compact alert-rate sparkline: anomalous events per 5 s. Muted bars, the first-anomaly bucket in
 * the root red, buckets after the shown moment dimmed. Hidden when there is nothing to show.
 */
export default function AlertRateChart({
  events,
  startTime,
  shownAtS,
}: {
  events: Event[];
  startTime: string;
  /** Seconds after the incident start of the moment the graph shows; null = live (nothing dimmed). */
  shownAtS: number | null;
}) {
  const raw = alertRate(events, startTime, BUCKET_S);
  if (raw.length === 0) return null;
  const k = Math.ceil(raw.length / MAX_BARS);
  const buckets = merge(raw, k);
  const bucketS = BUCKET_S * k;

  const total = buckets.reduce((s, b) => s + b.count, 0);
  const peak = buckets.reduce(
    (best, b) => (b.count > best.count ? b : best),
    buckets[0],
  );
  const firstIdx = buckets.findIndex((b) => b.count > 0);
  const duration = buckets[buckets.length - 1].t + bucketS - buckets[0].t;
  const peakT = Math.max(0, peak.t);
  const barW = Math.max(
    1,
    Math.min(10, (W - (buckets.length - 1)) / buckets.length),
  );
  const step = barW + 1;
  const x0 = Math.max(0, W - buckets.length * step + 1);
  const label = `${total} alerts over ${duration}s, peaking at ${peak.count} around T+${peakT}s`;

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <div className="hidden sm:flex flex-col text-right text-[11px] leading-tight text-muted tabular-nums">
        <span>{`Alerts / ${bucketS} s`}</span>
        <span>{`peak ${peak.count} at T+${peakT}s`}</span>
      </div>
      <svg
        role="img"
        aria-label={label}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="max-w-full overflow-visible"
      >
        <title>{`anomalous alerts in this incident, per ${bucketS}-second window`}</title>
        <line
          x1={0}
          x2={W}
          y1={H - 0.5}
          y2={H - 0.5}
          stroke="var(--line)"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const h =
            b.count === 0
              ? 0
              : Math.max(3, Math.round(((H - 4) * b.count) / peak.count));
          const first = i === firstIdx;
          const dim = shownAtS !== null && b.t > shownAtS;
          return (
            <rect
              key={b.t}
              data-bar
              data-first={first ? "true" : undefined}
              data-dim={dim ? "true" : "false"}
              x={x0 + i * step}
              y={H - 1 - h}
              width={barW}
              height={h}
              rx={Math.max(0, Math.min(2, barW / 2))}
              fill={first ? "var(--root)" : "var(--muted)"}
              opacity={dim ? 0.35 : 1}
            />
          );
        })}
      </svg>
    </div>
  );
}
