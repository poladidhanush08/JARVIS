import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FLIGHT_MS,
  INITIAL_COLLAPSE,
  SETTLE_MS,
  flightTiming,
  rowsToFlash,
  stepCollapse,
  type CollapseInput,
} from "../lib/collapse";
import type { Event, Incident } from "../lib/types";

const FADE_MS = 150;
const NO_ARRIVALS: ReadonlyMap<string, number> = new Map();

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const findRow = (incidentId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-incident-row]")).find(
    (el) => el.dataset.incidentRow === incidentId,
  );

/** Ref callback that keeps `map` in step with the mounted elements, by id. */
const track = (map: Map<string, HTMLElement>, id: string) => (el: HTMLElement | null) => {
  if (el) map.set(id, el);
  else map.delete(id);
};

/**
 * Anomalous events waiting to be grouped. Every alert that arrives after the first WebSocket
 * snapshot gets a card; once any listed incident absorbs it (new or existing) and it has been
 * visible for the minimum dwell, it flies into that incident's row (`[data-incident-row=id]`).
 * The choreography (dwell, cap, batches, settling, snapshot rule, exclusion) is the pure
 * `stepCollapse`; this component only renders its state, runs one wake-up timer and plays
 * the measured slides.
 */
export default function CollapseStream({
  recentEvents,
  incidents,
  snapshotIds,
  receivedAt = NO_ARRIVALS,
}: {
  recentEvents: Event[];
  incidents: Incident[];
  snapshotIds: string[] | null;
  receivedAt?: ReadonlyMap<string, number>;
}) {
  const input = useMemo(
    () => ({ events: recentEvents, incidents, receivedAt, snapshotIds }),
    [recentEvents, incidents, receivedAt, snapshotIds],
  );
  const latest = useRef(input);
  const [state, setState] = useState(() =>
    stepCollapse(INITIAL_COLLAPSE, { ...input, reducedMotion: prefersReducedMotion() }, Date.now()),
  );
  const cardEls = useRef(new Map<string, HTMLElement>());
  const excludedEls = useRef(new Map<string, HTMLElement>());
  const lastFlash = useRef(new Map<string, number>());
  const lastTops = useRef(new Map<HTMLElement, number>());

  const step = useCallback(() => {
    const now = Date.now();
    const next: CollapseInput = { ...latest.current, reducedMotion: prefersReducedMotion() };
    setState((s) => stepCollapse(s, next, now));
  }, []);

  // Step before paint whenever the live data changes, so a frame never shows stale cards.
  useLayoutEffect(() => {
    latest.current = input;
    step();
  }, [input, step]);

  // The one timer: wake when a dwell or settle ends, a batch lands or a card expires; none while idle.
  useEffect(() => {
    if (state.nextWakeAt === null) return;
    const timer = setTimeout(step, Math.max(0, state.nextWakeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state, step]);

  // Play a batch: measure each card, then slide it into its target row and fade it out.
  const { flight } = state;
  useLayoutEffect(() => {
    if (!flight) return;
    const frame = requestAnimationFrame(() => {
      flight.cards.forEach(({ event, incidentId }, i) => {
        const el = cardEls.current.get(event.id);
        if (!el) return;
        const to = findRow(incidentId)?.getBoundingClientRect();
        const from = el.getBoundingClientRect();
        const dx = to ? to.left + 24 - from.left : 0;
        const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;
        const delay = i * flight.stagger;
        el.style.transition = `transform ${FLIGHT_MS}ms ease-out ${delay}ms, opacity ${FADE_MS}ms ease-out ${delay + FLIGHT_MS - FADE_MS}ms`;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
        el.style.opacity = "0";
      });
      // the receiving rows flash as the batch starts, at most once per throttle window each
      const now = Date.now();
      const { total } = flightTiming(flight.cards.length);
      rowsToFlash(
        flight.cards.map((c) => c.incidentId),
        lastFlash.current,
        now,
      ).forEach((id) => {
        lastFlash.current.set(id, now);
        const row = findRow(id);
        if (row && typeof row.animate === "function") {
          row.animate(
            [
              { borderColor: "var(--line)" },
              { borderColor: "var(--accent)", offset: 0.6 },
              { borderColor: "var(--line)" },
            ],
            { duration: total + 300, easing: "ease-out" },
          );
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [flight]);

  // When cards leave, the rest (pending and excluded) slide into the freed space instead of jumping.
  const order = [...state.shown.map((c) => c.event.id), "|", ...state.excluded.map((e) => e.id)].join("\n");
  useLayoutEffect(() => {
    const flying = new Set(flight?.cards.map((c) => c.event.id) ?? []);
    const reduce = prefersReducedMotion();
    const tops = new Map<HTMLElement, number>();
    const slide = (el: HTMLElement, skip: boolean) => {
      const top = el.offsetTop;
      tops.set(el, top);
      const before = lastTops.current.get(el);
      if (reduce || skip || before === undefined || before === top) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${before - top}px)`;
      void el.offsetHeight; // commit the start position before transitioning back
      el.style.transition = `transform ${SETTLE_MS}ms ease-out`;
      el.style.transform = "";
    };
    cardEls.current.forEach((el, id) => slide(el, flying.has(id)));
    excludedEls.current.forEach((el) => slide(el, false));
    lastTops.current = tops;
  }, [order, flight]);

  const cards = state.shown.map((c) => c.event);
  const { excluded, overflow } = state;
  if (cards.length === 0 && overflow === 0 && excluded.length === 0) return null;
  const fadeIn = prefersReducedMotion() ? "" : "card-in";

  return (
    <div className="flex flex-col gap-6">
      {(cards.length > 0 || overflow > 0) && (
        <section aria-label="Ungrouped alerts" className="flex flex-col gap-2">
          <h2 className="text-label font-semibold uppercase tracking-wide text-muted">
            {state.grouping ? "Grouping" : "Waiting to be grouped"}
          </h2>
          <ul className="flex flex-col gap-2">
            {cards.map((e) => (
              <li
                key={e.id}
                data-testid="pending-card"
                ref={track(cardEls.current, e.id)}
                className={`${fadeIn} rounded-lg border border-line bg-surface px-3 py-2 text-label will-change-transform`}
              >
                <div className="flex items-center gap-2 font-mono font-semibold">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${e.level === "warn" ? "bg-impacted" : "bg-root"}`}
                  />
                  {e.service}
                </div>
                <div className="truncate text-muted">{e.message}</div>
              </li>
            ))}
          </ul>
          {overflow > 0 && <p className="text-label text-muted tabular-nums">+{overflow} more arriving</p>}
        </section>
      )}
      {excluded.length > 0 && (
        <section aria-label="Excluded alerts" className="flex flex-col gap-2">
          <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Excluded</h2>
          <ul className="flex flex-col gap-2">
            {excluded.map((e) => (
              // the outer item slides when the list shifts; the inner card keeps its step-aside animation
              <li key={e.id} data-testid="excluded-card" ref={track(excludedEls.current, e.id)}>
                <div
                  title="matched no incident: not correlated with the other alerts"
                  className="step-aside rounded-lg border border-dashed border-line bg-surface px-3 py-2 text-label"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono font-semibold text-muted">{e.service}</span>
                    <span className="shrink-0 rounded border border-line px-1.5 text-[11px] uppercase tracking-wide text-muted">
                      excluded
                    </span>
                  </div>
                  <div className="truncate text-muted">{e.message}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
