import type { Event, Incident } from "./types";

export const PENDING_WINDOW_MS = 10_000;

const ANOMALOUS_LEVELS = new Set<Event["level"]>(["warn", "error", "critical"]);

export function isAnomalous(e: Event): boolean {
  return e.type === "alert" || ANOMALOUS_LEVELS.has(e.level);
}

/**
 * Anomalous events from the last `windowMs` that no listed incident has absorbed yet.
 * Age is measured from `receivedAt` (client arrival, ms) when known, since simulator
 * timestamps are compressed and drift from the wall clock; else from the event timestamp.
 */
export function pendingEvents(
  events: Event[],
  incidents: Incident[],
  now: Date = new Date(),
  receivedAt: ReadonlyMap<string, number> = new Map(),
  windowMs: number = PENDING_WINDOW_MS,
): Event[] {
  const grouped = new Set(incidents.flatMap((i) => i.event_ids));
  const cutoff = now.getTime() - windowMs;
  const at = (e: Event) => receivedAt.get(e.id) ?? new Date(e.timestamp).getTime();
  return events.filter((e) => isAnomalous(e) && !grouped.has(e.id) && at(e) >= cutoff);
}

export type ServiceStatus = "root" | "impacted" | "healthy";

/** Red if the top root-cause candidate of any incident, amber if affected by any, else grey. */
export function serviceStatus(service: string, incidents: Incident[]): ServiceStatus {
  if (incidents.some((i) => i.root_cause_candidates[0]?.service === service)) return "root";
  if (incidents.some((i) => i.affected_services.includes(service))) return "impacted";
  return "healthy";
}

/** Per-card stagger for the collapse: capped at 200 ms, and stagger * (n - 1) + duration stays within 2 s. */
export function collapseStagger(count: number, durationMs: number, totalMs = 2000, capMs = 200): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(capMs, Math.floor((totalMs - durationMs) / (count - 1))));
}

/**
 * Anomalous events that waited past the window without joining any incident: shown greyed as
 * "excluded" (newest first, at most `max`). They drop out if a later incident absorbs them.
 */
export function excludedEvents(
  events: Event[],
  incidents: Incident[],
  now: Date = new Date(),
  receivedAt: ReadonlyMap<string, number> = new Map(),
  windowMs: number = PENDING_WINDOW_MS,
  max = 5,
): Event[] {
  const grouped = new Set(incidents.flatMap((i) => i.event_ids));
  const cutoff = now.getTime() - windowMs;
  const at = (e: Event) => receivedAt.get(e.id) ?? new Date(e.timestamp).getTime();
  return events.filter((e) => isAnomalous(e) && !grouped.has(e.id) && at(e) < cutoff).slice(0, max);
}

/* ---------- Collapse choreography: every incoming alert visibly joins its incident ---------- */

/** A card stays on screen at least this long before it may fly, so back-to-back frames still show it. */
export const MIN_DWELL_MS = 600;
/** At most this many pending cards on screen (flying ones included); the rest wait off-screen. */
export const MAX_VISIBLE_CARDS = 8;
/** One card's flight into its incident row. */
export const FLIGHT_MS = 300;
/** Largest delay between consecutive cards of one batch. */
export const FLIGHT_STAGGER_MS = 120;
/** A whole batch lands within this. */
export const FLIGHT_BATCH_MS = 2000;
/** A receiving row flashes at most once per this. */
export const FLASH_THROTTLE_MS = 600;
/** Remaining cards slide up into freed space over this; no batch starts meanwhile. */
export const SETTLE_MS = 200;

export interface ShownCard {
  event: Event;
  /** When the card first appeared on screen (ms). */
  shownAt: number;
}

export interface FlyingCard {
  event: Event;
  incidentId: string;
}

export interface Flight {
  cards: FlyingCard[];
  startedAt: number;
  endsAt: number;
  stagger: number;
}

export interface CollapseState {
  /** Time the pending window is measured at: frozen while a batch flies so nothing shifts under it. */
  clock: number;
  /** Event ids present before the first snapshot: they never fly. null until the snapshot arrives. */
  history: ReadonlySet<string> | null;
  /** Cards on screen in display order (oldest first, flying ones included). */
  shown: ShownCard[];
  /** Event ids already flown or removed by absorption; never shown again. */
  flown: ReadonlySet<string>;
  flight: Flight | null;
  settleUntil: number;
  /** Pending cards waiting off-screen because of the cap. */
  overflow: number;
  /** When the state next needs a step (ms), or null when nothing is waiting. */
  nextWakeAt: number | null;
}

export interface CollapseInput {
  /** Newest first, as useLive delivers them. */
  events: Event[];
  incidents: Incident[];
  receivedAt: ReadonlyMap<string, number>;
  snapshotIds: string[] | null;
  reducedMotion: boolean;
}

export const INITIAL_COLLAPSE: CollapseState = {
  clock: 0,
  history: null,
  shown: [],
  flown: new Set(),
  flight: null,
  settleUntil: 0,
  overflow: 0,
  nextWakeAt: null,
};

/** Per-card stagger and total length of one batch of `count` cards. */
export function flightTiming(count: number): { stagger: number; total: number } {
  const stagger = collapseStagger(count, FLIGHT_MS, FLIGHT_BATCH_MS, FLIGHT_STAGGER_MS);
  return { stagger, total: FLIGHT_MS + stagger * Math.max(0, count - 1) };
}

/** The rows among `ids` that may flash now: none flashed within the last `throttleMs`. */
export function rowsToFlash(
  ids: Iterable<string>,
  lastFlash: ReadonlyMap<string, number>,
  now: number,
  throttleMs: number = FLASH_THROTTLE_MS,
): string[] {
  return [...new Set(ids)].filter((id) => {
    const last = lastFlash.get(id);
    return last === undefined || now - last >= throttleMs;
  });
}

/** The first listed incident that absorbed each event id. */
export function absorbedBy(incidents: Incident[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const inc of incidents) for (const id of inc.event_ids) if (!map.has(id)) map.set(id, inc.id);
  return map;
}

/**
 * Advance the collapse choreography to `now`. Pure: the component calls it on every input
 * change and at `nextWakeAt`, and only renders and animates what it returns.
 * - Live events (seen after the first snapshot) get a card; once any listed incident absorbs one
 *   and it has been visible for MIN_DWELL_MS, it flies (one batch at a time, oldest first).
 * - Events seen before the snapshot never fly: absorbed, they simply drop out.
 * - At most MAX_VISIBLE_CARDS are on screen; absorbed cards take free slots first.
 * - With reduced motion, ready cards are removed instead of flown.
 */
export function stepCollapse(prev: CollapseState, input: CollapseInput, now: number): CollapseState {
  const { events, incidents, receivedAt, snapshotIds, reducedMotion } = input;
  const present = new Set(events.map((e) => e.id));
  const history = prev.history ?? (snapshotIds === null ? null : present);
  const absorbed = absorbedBy(incidents);
  const flown = new Set([...prev.flown].filter((id) => present.has(id)));
  const settle = reducedMotion ? 0 : SETTLE_MS;
  const at = (e: Event) => receivedAt.get(e.id) ?? new Date(e.timestamp).getTime();

  let shown = prev.shown.filter((c) => present.has(c.event.id));
  let removed = shown.length < prev.shown.length;
  let flight = prev.flight;
  if (flight && !flight.cards.every((c) => present.has(c.event.id))) flight = null; // engine reset
  if (flight && now >= flight.endsAt) {
    const landed = new Set(flight.cards.map((c) => c.event.id));
    landed.forEach((id) => flown.add(id));
    shown = shown.filter((c) => !landed.has(c.event.id));
    flight = null;
    removed = true;
  }

  const clock = flight ? flight.startedAt : now;
  const cutoff = clock - PENDING_WINDOW_MS;
  const flyingIds = new Set(flight?.cards.map((c) => c.event.id) ?? []);
  const shownIds = new Set(shown.map((c) => c.event.id));
  const live = (id: string) => history !== null && !history.has(id);

  // Cards that belong in the column, oldest first.
  const candidates: Event[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!isAnomalous(e) || flown.has(e.id) || flyingIds.has(e.id)) continue;
    if (absorbed.has(e.id)) {
      if (!live(e.id)) continue;
      if (!shownIds.has(e.id) && at(e) < cutoff) continue;
    } else if (at(e) < cutoff) continue;
    candidates.push(e);
  }
  candidates.sort((a, b) => at(a) - at(b));
  const candidateIds = new Set(candidates.map((e) => e.id));

  const before = shown.length;
  shown = shown.filter((c) => flyingIds.has(c.event.id) || candidateIds.has(c.event.id));
  if (shown.length < before) removed = true;
  const settleUntil = removed && shown.length > 0 ? Math.max(prev.settleUntil, now + settle) : prev.settleUntil;

  // Start the next batch: absorbed cards whose dwell has passed, in display order.
  if (!flight && history !== null && now >= settleUntil) {
    const ready = shown.filter((c) => absorbed.has(c.event.id) && now - c.shownAt >= MIN_DWELL_MS);
    if (ready.length > 0) {
      if (reducedMotion) {
        ready.forEach((c) => flown.add(c.event.id));
        shown = shown.filter((c) => !flown.has(c.event.id));
      } else {
        const { stagger, total } = flightTiming(ready.length);
        flight = {
          cards: ready.map((c) => ({ event: c.event, incidentId: absorbed.get(c.event.id)! })),
          startedAt: now,
          endsAt: now + total,
          stagger,
        };
      }
    }
  }

  // Fill free slots: absorbed cards first, then the oldest waiting ones; new cards append below.
  const onScreen = new Set(shown.map((c) => c.event.id));
  const waiting = candidates.filter((e) => !onScreen.has(e.id) && !flown.has(e.id));
  const slots = Math.max(0, MAX_VISIBLE_CARDS - shown.length);
  const picked = new Set(
    [...waiting.filter((e) => absorbed.has(e.id)), ...waiting.filter((e) => !absorbed.has(e.id))]
      .slice(0, slots)
      .map((e) => e.id),
  );
  shown = [...shown, ...waiting.filter((e) => picked.has(e.id)).map((event) => ({ event, shownAt: now }))];
  const overflow = waiting.length - picked.size;

  // Next moment anything changes: a batch lands, a dwell ends, or a waiting card expires.
  const wakes: number[] = [];
  if (flight) wakes.push(flight.endsAt);
  else {
    for (const c of shown) {
      if (absorbed.has(c.event.id)) wakes.push(Math.max(c.shownAt + MIN_DWELL_MS, settleUntil));
      else wakes.push(at(c.event) + PENDING_WINDOW_MS + 1);
    }
    for (const e of waiting) if (!picked.has(e.id)) wakes.push(at(e) + PENDING_WINDOW_MS + 1);
  }
  const nextWakeAt = wakes.length > 0 ? Math.max(now + 1, Math.min(...wakes)) : null;

  return { clock, history, shown, flown, flight, settleUntil, overflow, nextWakeAt };
}
