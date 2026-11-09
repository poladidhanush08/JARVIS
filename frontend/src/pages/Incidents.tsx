import { Link } from "react-router-dom";
import Card from "../components/Card";
import CollapseStream from "../components/CollapseStream";
import ServiceDots from "../components/ServiceDots";
import SeverityBadge from "../components/SeverityBadge";
import { useLive } from "../hooks/useLive";
import { relativeTime } from "../lib/format";
import type { Incident } from "../lib/types";

function IncidentRow({ incident }: { incident: Incident }) {
  return (
    <li>
      <Link
        to={`/incidents/${encodeURIComponent(incident.id)}`}
        data-incident-row={incident.id}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 transition-colors duration-200 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <SeverityBadge severity={incident.severity} />
        <span className="min-w-0 flex-1 basis-48 break-words text-body font-semibold">{incident.title}</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted">
          <span title="events grouped into this incident">
            {incident.event_ids.length} {incident.event_ids.length === 1 ? "alert" : "alerts"}
          </span>
          <span className="capitalize">{incident.status}</span>
          <span>{relativeTime(incident.start_time)}</span>
        </span>
      </Link>
    </li>
  );
}

function Headline({ value, label, source }: { value: number; label: string; source: string }) {
  return (
    <div className="flex flex-col">
      <span title={source} className="text-headline font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-label text-muted">{label}</span>
    </div>
  );
}

export default function IncidentsPage() {
  const { stats, incidents, recentEvents, receivedAt, snapshotIds } = useLive();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <h1 className="sr-only">Incidents</h1>
      <ServiceDots incidents={incidents} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          <Headline value={stats.raw_alerts} label="raw alerts" source="warn/error/critical events and alerts received" />
          <Headline value={stats.incidents} label="incidents" source="groups of 3 or more correlated alerts" />
        </div>
        <p className="text-label text-muted" title="anomalous alerts that matched no incident">
          {stats.isolated} isolated {stats.isolated === 1 ? "alert" : "alerts"} not grouped
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        {incidents.length === 0 ? (
          <Card className="py-8 text-center text-body text-muted">
            All quiet. Start a scenario from{" "}
            <Link to="/sources" className="text-accent underline-offset-2 hover:underline">
              Sources
            </Link>{" "}
            to see J.A.R.V.I.S. work.
          </Card>
        ) : (
          <ul aria-label="Incidents" className="flex flex-col gap-2">
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
