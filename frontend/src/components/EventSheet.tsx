import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { isAnomalous } from "../lib/collapse";
import type { EventRow } from "../lib/types";

const REASON_LABELS: Record<string, string> = {
  time: "close in time",
  dependency: "dependency path",
  signature: "same error signature",
  trace: "shared trace",
};

export default function EventSheet({ row, onClose, assigning = false }: { row: EventRow; onClose: () => void; assigning?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { event, incident_id, reasons } = row;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fields: [string, string][] = [
    ["id", event.id],
    ["timestamp", event.timestamp],
    ["source", event.source],
    ["service", event.service],
    ["type", event.type],
    ["level", event.level],
    ["message", event.message],
    ["fingerprint", event.fingerprint],
    ["trace_id", event.trace_id ?? "—"],
    ["metric", event.metric ? `${event.metric.name} = ${event.metric.value}` : "—"],
    ["tags", Object.keys(event.tags).length ? JSON.stringify(event.tags) : "—"],
  ];

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Event details"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-6 sm:max-w-md"
        style={{ animation: "sheet-in 200ms ease-out" }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-title font-semibold">
            <span className="font-mono">{event.service}</span>
            <span className="text-label font-normal text-muted">{event.level}</span>
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-label hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={14} aria-hidden="true" />
            Close
          </button>
        </div>
        <section
          aria-label="Correlation"
          className={`flex flex-col gap-2 rounded-xl border p-4 ${incident_id ? "border-line bg-surface-2" : "border-dashed border-line bg-canvas"}`}
        >
          <h3 className="text-label font-semibold uppercase tracking-wide text-muted">
            {incident_id ? "Joined incident" : assigning ? "Incident" : "Excluded"}
          </h3>
          {incident_id ? (
            <Link to={`/incidents/${incident_id}`} className="w-fit font-mono text-body text-accent hover:underline">
              {incident_id}
            </Link>
          ) : (
            <>
              <p className="text-body text-muted">{assigning ? "Assigning to an incident…" : "Not part of any incident"}</p>
              {!assigning && (
                <p className="text-label text-muted">
                  {isAnomalous(event)
                    ? "This alert shared no time window, dependency path, error signature or trace with an incident's alerts, so it was kept out."
                    : `A ${event.level} ${event.type} is not an alert, so it is not correlated.`}
                </p>
              )}
            </>
          )}
          {incident_id && reasons.length === 0 && <p className="text-label text-muted">Started this incident</p>}
          {incident_id && reasons.length > 0 && <p className="text-label text-muted">Grouped because it matched on:</p>}
          {incident_id && reasons.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Why it was grouped">
              {reasons.map((r) => (
                <li
                  key={r}
                  title={r}
                  className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-label"
                >
                  <span className="font-semibold">{r}</span>
                  <span className="text-muted">{REASON_LABELS[r] ?? r}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <dl className="flex flex-col gap-2">
          {fields.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-label text-muted">{k}</dt>
              <dd className="break-words font-mono text-label">{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
