import { ArrowRight, Play } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import CollapseStream from "../components/CollapseStream";
import DemoGuide from "../components/DemoGuide";
import ServiceDots from "../components/ServiceDots";
import SeverityBadge from "../components/SeverityBadge";
import { canAnimate, useCountUp } from "../hooks/useCountUp";
import { useLive } from "../hooks/useLive";
import { simulator } from "../lib/api";
import { confidenceLabel, relativeTime } from "../lib/format";
import type { Incident } from "../lib/types";

function IncidentRow({ incident }: { incident: Incident }) {
  const top = incident.root_cause_candidates[0];
  const [animated] = useState(canAnimate);
  const n = incident.event_ids.length;
  return (
    <motion.li
      layout={animated ? "position" : false}
      initial={animated ? { opacity: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Link
        to={`/incidents/${encodeURIComponent(incident.id)}`}
        data-incident-row={incident.id}
        className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-5 py-4 transition-colors duration-200 ease-out hover:border-accent/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SeverityBadge severity={incident.severity} />
          <span className="min-w-0 flex-1 basis-48 break-words text-body font-semibold">{incident.title}</span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted tabular-nums">
            <span title="events grouped into this incident">
              {n} {n === 1 ? "alert" : "alerts"}
            </span>
            <span className="capitalize">{incident.status}</span>
            <span>{relativeTime(incident.start_time)}</span>
          </span>
        </span>
        <span className="flex items-center gap-2 text-label text-muted">
          <span>Root cause</span>
          {top ? (
            <>
              <span className="inline-flex items-center gap-1.5 font-mono text-ink">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-root" />
                {top.service}
              </span>
              <span className="tabular-nums">
                {confidenceLabel(top.confidence)}, {top.confidence}%
              </span>
            </>
          ) : (
            <span>—</span>
          )}
        </span>
      </Link>
    </motion.li>
  );
}

function Headline({
  value,
  label,
  source,
  pop = false,
}: {
  value: number;
  label: string;
  source: string;
  /** Pop the number in on change instead of counting up. */
  pop?: boolean;
}) {
  const counted = useCountUp(value);
  const [animated] = useState(canAnimate);
  return (
    <div className="flex flex-col gap-1">
      {pop && animated ? (
        <motion.span
          key={value}
          title={source}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
          className="origin-left text-hero font-semibold leading-none tracking-tight tabular-nums"
        >
          {value}
        </motion.span>
      ) : (
        <span title={source} className="text-hero font-semibold leading-none tracking-tight tabular-nums">
          {pop ? value : counted}
        </span>
      )}
      <span className="text-label text-muted">{label}</span>
    </div>
  );
}

const DEMO_SCENARIO = "a_db_pool";
const DEMO_SPEED = 2;

/** Empty state: offers the guided demo unless a simulator run is already in progress. */
function EmptyState({
  ready,
  rawAlerts,
  onStarted,
}: {
  /** The first live snapshot has arrived, so "no incidents" is real. */
  ready: boolean;
  rawAlerts: number;
  onStarted: () => void;
}) {
  // null until the simulator status is known, so the button never flashes during a run
  const [busy, setBusy] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check on mount, and again whenever the engine is empty (a run reset elsewhere brings the button back).
  const recheck = busy === null || (busy && rawAlerts === 0);
  useEffect(() => {
    if (!recheck) return;
    let alive = true;
    simulator
      .status()
      .then((s) => alive && setBusy(s.state === "running" || s.state === "paused"))
      .catch(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [recheck, rawAlerts]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await simulator.start(DEMO_SCENARIO, DEMO_SPEED);
      setBusy(true);
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-body text-muted">No incidents yet.</p>
      {!ready && <p className="text-label text-muted">Connecting…</p>}
      {ready && busy === false && (
        <>
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-body font-semibold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play size={14} aria-hidden="true" />
            Run the demo
          </button>
          <p className="max-w-md text-label text-muted">
            Plays scenario A: a payment platform where logins, slow APIs and failed payments share one cause.
          </p>
          {error && (
            <p role="alert" className="text-label text-muted">
              {error}
            </p>
          )}
        </>
      )}
      <p className="text-label text-muted">
        Or open{" "}
        <Link to="/sources" className="text-accent underline-offset-2 hover:underline">
          Sources
        </Link>{" "}
        to upload logs or send events by API.
      </p>
    </Card>
  );
}

export default function IncidentsPage() {
  const { stats, incidents, recentEvents, receivedAt, snapshotIds } = useLive();
  const [demoStarted, setDemoStarted] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-headline font-semibold tracking-tight">Incidents</h1>
      <ServiceDots incidents={incidents} />
      {demoStarted && (
        <DemoGuide
          stats={stats}
          incidents={incidents}
          recentEvents={recentEvents}
          onClose={() => setDemoStarted(false)}
        />
      )}

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Headline value={stats.raw_alerts} label="raw alerts" source="warn/error/critical events and alerts received" />
          <ArrowRight size={28} aria-hidden="true" className="mb-6 text-muted" />
          <Headline value={stats.incidents} label="incidents" source="groups of 3 or more correlated alerts" pop />
        </div>
        <p className="text-label text-muted" title="anomalous alerts that matched no incident">
          {stats.isolated} unrelated {stats.isolated === 1 ? "alert" : "alerts"} excluded
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {incidents.length === 0 ? (
          <EmptyState
            ready={snapshotIds !== null}
            rawAlerts={stats.raw_alerts}
            onStarted={() => setDemoStarted(true)}
          />
        ) : (
          <ul aria-label="Incidents" className="flex flex-col gap-3">
            {incidents.map((i) => (
              <IncidentRow key={i.id} incident={i} />
            ))}
          </ul>
        )}
        <aside aria-label="Incoming alerts" className="min-w-0">
          <CollapseStream
            recentEvents={recentEvents}
            incidents={incidents}
            snapshotIds={snapshotIds}
            receivedAt={receivedAt}
          />
        </aside>
      </div>
    </div>
  );
}
