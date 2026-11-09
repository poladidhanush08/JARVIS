import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { collapseStagger, pendingEvents } from "../lib/collapse";
import type { Event, Incident } from "../lib/types";

const DURATION_MS = 300;
const TICK_MS = 1000;

interface Flight {
  incidentId: string;
  cards: Event[];
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Anomalous events waiting to be grouped. When a new incident appears, the cards that
 * were waiting fly into that incident's row (`[data-incident-row=id]`) once, then clear.
 */
export default function CollapseStream({ recentEvents, incidents }: { recentEvents: Event[]; incidents: Incident[] }) {
  const [now, setNow] = useState(() => new Date());
  const [flight, setFlight] = useState<Flight | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const lastShown = useRef<Event[]>([]);
  const cardEls = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const pending = useMemo(() => pendingEvents(recentEvents, incidents, now), [recentEvents, incidents, now]);

  // Detect a newly appeared incident id; incidents present on first render never animate.
  useEffect(() => {
    const ids = incidents.map((i) => i.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const fresh = ids.find((id) => !known.has(id));
    ids.forEach((id) => known.add(id));
    if (!fresh) return;
    const stillPending = new Set(pending.map((e) => e.id));
    const absorbed = lastShown.current.filter((e) => !stillPending.has(e.id));
    lastShown.current = [];
    if (absorbed.length > 0 && !prefersReducedMotion()) setFlight({ incidentId: fresh, cards: absorbed });
  }, [incidents, pending]);

  useEffect(() => {
    if (!flight) lastShown.current = pending;
  }, [pending, flight]);

  // Run the flight: measure each card, then transition it into the target row.
  useLayoutEffect(() => {
    if (!flight) return;
    const target = document.querySelector<HTMLElement>(`[data-incident-row="${CSS.escape(flight.incidentId)}"]`);
    const to = target?.getBoundingClientRect();
    const stagger = collapseStagger(flight.cards.length, DURATION_MS);
    const frame = requestAnimationFrame(() => {
      flight.cards.forEach((e, i) => {
        const el = cardEls.current.get(e.id);
        if (!el) return;
        const from = el.getBoundingClientRect();
        const dx = to ? to.left + 24 - from.left : 0;
        const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;
        const delay = i * stagger;
        el.style.transition = `transform ${DURATION_MS}ms ease-in ${delay}ms, opacity ${DURATION_MS}ms ease-in ${delay}ms`;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
        el.style.opacity = "0";
      });
    });
    const total = DURATION_MS + stagger * Math.max(0, flight.cards.length - 1);
    const timer = setTimeout(() => setFlight(null), total);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [flight]);

  const cards = flight ? flight.cards : pending;
  if (cards.length === 0) return null;

  return (
    <section aria-label="Ungrouped alerts" className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-muted">{flight ? "Grouping" : "Waiting to be grouped"}</h2>
      <ul className="flex flex-col gap-2">
        {cards.map((e) => (
          <li
            key={e.id}
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
