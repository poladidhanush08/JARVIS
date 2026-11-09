import type { Impact } from "../lib/types";
import Card from "./Card";

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : "—");

function Figure({ value, label, source }: { value: number | undefined; label: string; source: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span title={source} className="text-headline font-semibold leading-none tabular-nums">
        {num(value)}
      </span>
      <span className="text-label text-muted">{label}</span>
    </div>
  );
}

const pill = "rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[12px]";
const joined = (items: string[] | undefined) => (items && items.length > 0 ? items.join(", ") : "—");

/** Services then endpoints on one wrapping row, clamped to two lines (full list on hover). */
function Pills({ services, endpoints }: { services: string[] | undefined; endpoints: string[] | undefined }) {
  const empty = !services?.length && !endpoints?.length;
  return (
    <div
      title={`Services: ${joined(services)}\nEndpoints: ${joined(endpoints)}`}
      className="flex max-h-[44px] flex-wrap items-center gap-1 overflow-hidden text-label"
    >
      {empty && <span className="text-muted">Services and endpoints: —</span>}
      {services?.map((s) => (
        <span key={`s-${s}`} className={`${pill} text-ink`}>
          {s}
        </span>
      ))}
      {endpoints?.map((e) => (
        <span key={`e-${e}`} className={`${pill} text-muted`}>
          {e}
        </span>
      ))}
    </div>
  );
}

export default function ImpactCard({ impact }: { impact: Impact }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Impact</h2>
      <div className="grid grid-cols-3 gap-3">
        <Figure value={impact.users_affected} label="users affected" source="sum of failed_logins metrics" />
        <Figure value={impact.failed_transactions} label="failed transactions" source="sum of failed_payments metrics" />
        <Figure
          value={impact.minutes_since_start}
          label="minutes since start"
          source="minutes since the first event in this incident"
        />
      </div>
      <Pills services={impact.services} endpoints={impact.endpoints} />
    </Card>
  );
}
