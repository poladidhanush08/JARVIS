import { tPlus } from "../lib/format";
import type { KeyMoment } from "../lib/types";

/** Dot colour: red for the top root-cause candidate's moment; others are impacted services. */
function dotClass(isRoot: boolean, reached: boolean) {
  if (!reached) return "bg-healthy/50";
  return isRoot ? "bg-root" : "bg-impacted";
}

/**
 * Horizontal timeline of 4-6 key moments. Clicking one shows the graph as it was at that
 * moment (click again to return to live); during replay the current step is marked.
 */
export default function KeyMoments({
  moments,
  startTime,
  rootService,
  activeIndex,
  selected,
  onSelect,
}: {
  moments: KeyMoment[];
  startTime: string;
  /** Top root-cause candidate's service; its moment gets the red dot. */
  rootService?: string;
  /** Moment the graph currently shows (replay step or selection); null = live. */
  activeIndex: number | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const shown = moments.slice(0, 6);
  return (
    <section aria-label="Key moments" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Key moments</h2>
        {selected !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-md text-label text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Back to live
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-label text-muted">No anomalies recorded yet.</p>
      ) : (
        <ol className="relative grid auto-cols-fr grid-flow-col gap-2 overflow-x-auto">
          <span aria-hidden="true" className="pointer-events-none absolute left-2 right-2 top-[32px] h-px bg-line" />
          {shown.map((m, i) => {
            const reached = activeIndex === null || i <= activeIndex;
            const current = activeIndex !== null && i === activeIndex;
            return (
              <li key={m.event_id} aria-current={current ? "step" : undefined} className="min-w-28">
                <button
                  type="button"
                  aria-pressed={selected === i}
                  onClick={() => onSelect(selected === i ? null : i)}
                  title={`Show the graph at ${tPlus(m.timestamp, startTime)}`}
                  className={`flex w-full flex-col items-start gap-1 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent ${selected === i ? "bg-surface-2" : ""}`}
                >
                  <span title="seconds after the incident's first anomaly" className="text-label tabular-nums text-muted">
                    {tPlus(m.timestamp, startTime)}
                  </span>
                  <span
                    aria-hidden="true"
                    data-dot
                    className={`relative h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-200 ${dotClass(m.service === rootService, reached)} ${current ? "ring-2 ring-ink/40 ring-offset-2 ring-offset-surface" : ""}`}
                  />
                  <span className={`line-clamp-2 text-label transition-colors duration-200 ${reached ? "text-ink" : "text-muted"}`}>
                    {i === 0 ? `${m.service}: ${m.label}` : m.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
