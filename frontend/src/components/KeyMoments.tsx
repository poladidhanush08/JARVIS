import { tPlus } from "../lib/format";
import type { Event, KeyMoment } from "../lib/types";
import AlertRateChart from "./AlertRateChart";

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
  events = [],
}: {
  moments: KeyMoment[];
  startTime: string;
  /** Top root-cause candidate's service; its moment gets the red dot. */
  rootService?: string;
  /** Moment the graph currently shows (replay step or selection); null = live. */
  activeIndex: number | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** This incident's events; feeds the alert-rate sparkline in the header. */
  events?: Event[];
}) {
  const shown = moments.slice(0, 6);
  const active = activeIndex !== null ? shown[activeIndex] : undefined;
  const shownAtS = active
    ? (Date.parse(active.timestamp) - Date.parse(startTime)) / 1000
    : null;
  return (
    <section aria-label="Key moments" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:h-4 sm:flex-nowrap">
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">
          Key moments
        </h2>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <AlertRateChart
            events={events}
            startTime={startTime}
            shownAtS={shownAtS}
          />
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
      </div>
      {shown.length === 0 ? (
        <p className="text-label text-muted">No anomalies recorded yet.</p>
      ) : (
        // Columns never shrink below 7rem: on narrow screens the strip scrolls sideways instead
        // of squeezing the labels on top of each other. The connector line is drawn per item so
        // it keeps running under every moment while scrolling.
        <ol className="grid auto-cols-[minmax(7rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
          {shown.map((m, i) => {
            const reached = activeIndex === null || i <= activeIndex;
            const current = activeIndex !== null && i === activeIndex;
            return (
              <li
                key={m.event_id}
                aria-current={current ? "step" : undefined}
                className="relative min-w-0"
              >
                {i < shown.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 -right-2 top-[32px] h-px bg-line"
                  />
                )}
                <button
                  type="button"
                  aria-pressed={selected === i}
                  onClick={() => onSelect(selected === i ? null : i)}
                  title={`Show the graph at ${tPlus(m.timestamp, startTime)}`}
                  className={`relative flex w-full flex-col items-start gap-1 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent ${selected === i ? "bg-surface-2" : ""}`}
                >
                  <span
                    title="seconds after the incident's first anomaly"
                    className="text-label tabular-nums text-muted"
                  >
                    {tPlus(m.timestamp, startTime)}
                  </span>
                  <span
                    aria-hidden="true"
                    data-dot
                    className={`relative h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-200 ${dotClass(m.service === rootService, reached)} ${current ? "ring-2 ring-ink/40 ring-offset-2 ring-offset-surface" : ""}`}
                  />
                  <span
                    className={`line-clamp-2 text-label transition-colors duration-200 ${reached ? "text-ink" : "text-muted"}`}
                  >
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
