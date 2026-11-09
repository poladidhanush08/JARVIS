import { Play } from "lucide-react";
import { tPlus } from "../lib/format";
import type { KeyMoment } from "../lib/types";

/** Dot colour: the first moment is the root's first anomaly; later ones are impacted services. */
function dotClass(i: number, reached: boolean) {
  if (!reached) return "bg-healthy/50";
  return i === 0 ? "bg-root" : "bg-impacted";
}

export default function KeyMoments({
  moments,
  startTime,
  replayIndex,
  onReplay,
}: {
  moments: KeyMoment[];
  startTime: string;
  replayIndex: number | null;
  onReplay: () => void;
}) {
  const running = replayIndex !== null;

  return (
    <section aria-label="Key moments" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-label font-semibold text-muted">Key moments</h2>
        <button
          type="button"
          onClick={onReplay}
          disabled={running || moments.length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-3 py-1 text-label text-ink hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink"
        >
          <Play size={14} aria-hidden="true" />
          {running ? "Replaying…" : "Replay"}
        </button>
      </div>
      {moments.length === 0 ? (
        <p className="text-label text-muted">No anomalies recorded yet.</p>
      ) : (
        <ol className="relative flex gap-4 overflow-x-auto pb-1">
          {moments.map((m, i) => {
            const reached = !running || i <= replayIndex;
            const current = running && i === replayIndex;
            return (
              <li
                key={m.event_id}
                aria-current={current ? "step" : undefined}
                className="flex min-w-24 flex-1 flex-col gap-1"
              >
                <span className="text-label tabular-nums text-muted">{tPlus(m.timestamp, startTime)}</span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-200 ${dotClass(i, reached)} ${current ? "ring-2 ring-line ring-offset-1 ring-offset-surface" : ""}`}
                  />
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                </span>
                <span className={`text-label transition-colors duration-200 ${reached ? "text-ink" : "text-muted"}`}>
                  {i === 0 ? `${m.service}: ${m.label}` : m.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
