import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import EventSheet from "../components/EventSheet";
import { getEvents } from "../lib/api";
import type { EventRow } from "../lib/types";
import { useLive } from "../hooks/useLive";

const LIMIT = 500;
const REFETCH_MS = 2000;

const fieldCls =
  "rounded-md border border-line bg-surface px-2 py-1 text-body text-ink focus-visible:outline-2 focus-visible:outline-accent";

export default function EventsPage() {
  const { recentEvents } = useLive();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [error, setError] = useState(false);
  const [service, setService] = useState("");
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastFetch = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const load = useCallback(() => {
    lastFetch.current = Date.now();
    getEvents({ limit: LIMIT })
      .then((r) => {
        if (alive.current) {
          setRows(r);
          setError(false);
        }
      })
      .catch(() => {
        if (alive.current) setError(true);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
      clearTimeout(pending.current);
    };
  }, [load]);

  // Refetch on live updates, at most once per REFETCH_MS.
  useEffect(() => {
    if (recentEvents.length === 0) return;
    const wait = REFETCH_MS - (Date.now() - lastFetch.current);
    if (wait <= 0) load();
    else {
      clearTimeout(pending.current);
      pending.current = setTimeout(load, wait);
    }
  }, [recentEvents, load]);

  const merged = useMemo(() => {
    const seen = new Set(rows.map((r) => r.event.id));
    const live: EventRow[] = recentEvents
      .filter((e) => !seen.has(e.id))
      .map((event) => ({ event, incident_id: null, reasons: [] }));
    return [...live, ...rows].slice(0, LIMIT);
  }, [rows, recentEvents]);

  const services = useMemo(() => [...new Set(merged.map((r) => r.event.service))].sort(), [merged]);
  const levels = useMemo(() => [...new Set(merged.map((r) => r.event.level))].sort(), [merged]);

  const q = query.trim().toLowerCase();
  const shown = merged.filter(
    (r) =>
      (!service || r.event.service === service) &&
      (!level || r.event.level === level) &&
      (!q || r.event.message.toLowerCase().includes(q)),
  );
  const selected = merged.find((r) => r.event.id === selectedId) ?? null;
  const closeSheet = useCallback(() => setSelectedId(null), []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-headline font-semibold">Events</h1>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-muted">
          Service
          <select value={service} onChange={(e) => setService(e.target.value)} className={fieldCls}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label text-muted">
          Level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={fieldCls}>
            <option value="">All levels</option>
            {levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-label text-muted">
          Search message
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages"
            className={`${fieldCls} w-full`}
          />
        </label>
      </div>
      {error && <p className="text-body text-muted">Could not load events. Showing what is available.</p>}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left text-label">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-semibold">Time</th>
              <th className="px-3 py-2 font-semibold">Service</th>
              <th className="px-3 py-2 font-semibold">Level</th>
              <th className="px-3 py-2 font-semibold">Message</th>
              <th className="px-3 py-2 font-semibold">Incident</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.event.id} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {new Date(r.event.timestamp).toLocaleTimeString()}
                </td>
                <td className="px-3 py-2">{r.event.service}</td>
                <td className="px-3 py-2">
                  <span className="rounded-md border border-line px-1.5 py-0.5">{r.event.level}</span>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.event.id)}
                    className="text-left hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {r.event.message}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.incident_id ? (
                    <Link to={`/incidents/${r.incident_id}`} className="text-accent hover:underline">
                      {r.incident_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted">
                  No events match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && <EventSheet row={selected} onClose={closeSheet} />}
    </div>
  );
}
