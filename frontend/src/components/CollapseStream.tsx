import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { collapseStagger, pendingEvents } from "../lib/collapse";
import type { Event, Incident } from "../lib/types";

export const COLLAPSE_DURATION_MS = 300;
const TICK_MS = 1000;
const NO_ARRIVALS: ReadonlyMap<string, number> = new Map();

interface FlyingCard {
  event: Event;
  incidentId: string;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const findRow = (incidentId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-incident-row]")).find(
    (el) => el.dataset.incidentRow === incidentId,
  );

/**
 * Anomalous events waiting to be grouped. When a new incident appears, the waiting cards
 * whose events it absorbed fly into its row (`[data-incident-row=id]`) once, then clear.
 * Incidents in the first WebSocket snapshot (`snapshotIds`) are already known and never fly;
 * nothing animates before that snapshot arrives.
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
  const [now, setNow] = useState(() => new Date());
  const [flight, setFlight] = useState<FlyingCard[] | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const lastShown = useRef<Event[]>([]);
  const cardEls = useRef(new Map<string, HTMLElement>());

  const pending = useMemo(
    () => pendingEvents(recentEvents, incidents, now, receivedAt),
    [recentEvents, incidents, now, receivedAt],
  );
  const hasPending = pending.length > 0;

  // Tick only while cards are waiting, so expired cards (older than 10 s) drop out.
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, [hasPending]);

  // Detect newly appeared incident ids; the first snapshot seeds `seen` once.
  useEffect(() => {
    if (seen.current === null) {
      if (snapshotIds === null) return;
      seen.current = new Set(snapshotIds);
    }
    const known = seen.current;
    const fresh = incidents.filter((i) => !known.has(i.id));
    fresh.forEach((i) => known.add(i.id));
    if (fresh.length === 0) return;
    const shown = lastShown.current;
    const flying = fresh.flatMap((inc) => {
      const absorbed = new Set(inc.event_ids);
      return shown.filter((e) => absorbed.has(e.id)).map((event) => ({ event, incidentId: inc.id }));
    });
    if (flying.length > 0 && !prefersReducedMotion()) setFlight(flying);
  }, [incidents, snapshotIds]);

  useEffect(() => {
    if (!flight) lastShown.current = pending;
  }, [pending, flight]);

  // Run the flight: measure each card, then transition it into its target row.
  useLayoutEffect(() => {
    if (!flight) return;
    const stagger = collapseStagger(flight.length, COLLAPSE_DURATION_MS);
    const frame = requestAnimationFrame(() => {
      flight.forEach(({ event, incidentId }, i) => {
        const el = cardEls.current.get(event.id);
        if (!el) return;
        const to = findRow(incidentId)?.getBoundingClientRect();
        const from = el.getBoundingClientRect();
        const dx = to ? to.left + 24 - from.left : 0;
        const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;
        const delay = i * stagger;
        el.style.transition = `transform ${COLLAPSE_DURATION_MS}ms ease-in ${delay}ms, opacity ${COLLAPSE_DURATION_MS}ms ease-in ${delay}ms`;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
        el.style.opacity = "0";
      });
    });
    const total = COLLAPSE_DURATION_MS + stagger * Math.max(0, flight.length - 1);
    const timer = setTimeout(() => setFlight(null), total);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [flight]);

  const flyingIds = new Set(flight?.map((c) => c.event.id) ?? []);
  const cards = [...(flight?.map((c) => c.event) ?? []), ...pending.filter((e) => !flyingIds.has(e.id))];
  if (cards.length === 0) return null;

  return (
    <section aria-label="Ungrouped alerts" className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-muted">{flight ? "Grouping" : "Waiting to be grouped"}</h2>
      <ul className="flex flex-col gap-2">
        {cards.map((e) => (
          <li
            key={e.id}
            data-testid="pending-card"
            ref={(el) => {
              if (el) cardEls.current.set(e.id, el);
              else cardEls.current.delete(e.id);
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-label"
          >
            <div className="font-semibold">{e.service}</div>
            <div className="truncate text-muted">{e.message}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
