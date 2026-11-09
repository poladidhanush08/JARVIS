import type { Impact } from "../lib/types";
import Card from "./Card";

function Row({ value, label, source }: { value: number; label: string; source: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span title={source} className="min-w-12 text-body font-semibold tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-label text-muted">{label}</span>
    </li>
  );
}

export default function ImpactCard({ impact }: { impact: Impact }) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-muted">Impact</h2>
      <ul className="flex flex-col gap-1">
        <Row value={impact.users_affected} label="users blocked at login" source="sum of failed_logins metrics" />
        <Row value={impact.failed_transactions} label="payments failed" source="sum of failed_payments metrics" />
        <Row
          value={impact.minutes_since_start}
          label="minutes since start"
          source="minutes since the first event in this incident"
        />
      </ul>
    </Card>
  );
}
