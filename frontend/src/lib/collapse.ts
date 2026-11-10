import type { Event, Incident } from "./types";

/** An unabsorbed card is excluded once it has been on screen this long without joining an incident. */
export const PENDING_WINDOW_MS = 10_000;

const ANOMALOUS_LEVELS = new Set<Event["level"]>(["warn", "error", "critical"]);

export function isAnomalous(e: Event): boolean {
  return e.type === "alert" || ANOMALOUS_LEVELS.has(e.level);
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
/** Incident rows re-sort with a 250 ms layout slide; batches wait this long so they aim at the final rows. */
export const LAYOUT_SETTLE_MS = 300;
/** At most this many excluded cards are listed. */
export const MAX_EXCLUDED = 5;

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
  /** Event ids whose card stayed unabsorbed for the whole window. */
  expired: ReadonlySet<string>;
  /** Expired events not absorbed since, newest first: listed greyed as "excluded". */
  excluded: Event[];
  flight: Flight | null;
  settleUntil: number;
  /** A batch is flying or the column is still settling after one: the header reads "Grouping". */
  grouping: boolean;
  /** Listed incident ids in order, to notice the rows re-sorting. */
  incidentOrder: string;
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
  expired: new Set(),
  excluded: [],
  flight: null,
  settleUntil: 0,
  grouping: false,
  incidentOrder: "",
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
 * - At most MAX_VISIBLE_CARDS are on screen; absorbed cards take free slots first. Off-screen
 *   cards never expire: the exclusion window starts when a card is first shown.
 * - Batches wait for the column and the incident rows to settle, so they aim at final positions.
 * - With reduced motion, ready cards are removed instead of flown.
 */
export function stepCollapse(prev: CollapseState, input: CollapseInput, now: number): CollapseState {
  const { events, incidents, receivedAt, snapshotIds, reducedMotion } = input;
  const present = new Set(events.map((e) => e.id));
  const history = prev.history ?? (snapshotIds === null ? null : present);
  const absorbed = absorbedBy(incidents);
  const flown = new Set([...prev.flown].filter((id) => present.has(id)));
  const expired = new Set([...prev.expired].filter((id) => present.has(id)));
  const settle = reducedMotion ? 0 : SETTLE_MS;
  const at = (e: Event) => receivedAt.get(e.id) ?? new Date(e.timestamp).getTime();

  let shown = prev.shown.filter((c) => present.has(c.event.id));
  let removed = shown.length < prev.shown.length;
  let landed = false;
  let flight = prev.flight;
  // A batch lands when its time is up, or at once if some of its events dropped out (engine reset).
  if (flight && (now >= flight.endsAt || flight.cards.some((c) => !present.has(c.event.id)))) {
    const ids = new Set(flight.cards.map((c) => c.event.id));
    ids.forEach((id) => flown.add(id));
    shown = shown.filter((c) => !ids.has(c.event.id));
    flight = null;
    removed = true;
    landed = true;
  }

  const clock = flight ? flight.startedAt : now;
  const cutoff = clock - PENDING_WINDOW_MS;
  const flyingIds = new Set(flight?.cards.map((c) => c.event.id) ?? []);
  const live = (id: string) => history !== null && !history.has(id);

  // Cards shown for the whole window without joining an incident are excluded.
  for (const c of shown) {
    if (!flyingIds.has(c.event.id) && !absorbed.has(c.event.id) && c.shownAt < cutoff) expired.add(c.event.id);
  }

  // Cards that belong in the column (on screen or waiting off-screen), oldest first.
  const candidates: Event[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!isAnomalous(e) || flown.has(e.id) || flyingIds.has(e.id) || expired.has(e.id)) continue;
    if (absorbed.has(e.id) && !live(e.id)) continue;
    candidates.push(e);
  }
  candidates.sort((a, b) => at(a) - at(b));
  const candidateIds = new Set(candidates.map((e) => e.id));

  const before = shown.length;
  shown = shown.filter((c) => flyingIds.has(c.event.id) || candidateIds.has(c.event.id));
  if (shown.length < before) removed = true;
  let settleUntil = prev.settleUntil;
  if (removed && shown.length > 0) settleUntil = Math.max(settleUntil, now + settle);
  const incidentOrder = incidents.map((i) => i.id).join("\n");
  if (incidentOrder !== prev.incidentOrder && !reducedMotion) {
    settleUntil = Math.max(settleUntil, now + LAYOUT_SETTLE_MS);
  }

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

  const grouping = flight !== null || ((prev.grouping || landed) && now < settleUntil && shown.length > 0);
  const excluded = events.filter((e) => expired.has(e.id) && !absorbed.has(e.id)).slice(0, MAX_EXCLUDED);

  // Next moment anything changes: a batch lands, a dwell or settle ends, or a shown card expires.
  const wakes: number[] = [];
  if (flight) wakes.push(flight.endsAt);
  else {
    for (const c of shown) {
      if (absorbed.has(c.event.id)) wakes.push(Math.max(c.shownAt + MIN_DWELL_MS, settleUntil));
      else wakes.push(c.shownAt + PENDING_WINDOW_MS + 1);
    }
    if (grouping) wakes.push(settleUntil);
  }
  const nextWakeAt = wakes.length > 0 ? Math.max(now + 1, Math.min(...wakes)) : null;

  return {
    clock,
    history,
    shown,
    flown,
    expired,
    excluded,
    flight,
    settleUntil,
    grouping,
    incidentOrder,
    overflow,
    nextWakeAt,
  };
}
