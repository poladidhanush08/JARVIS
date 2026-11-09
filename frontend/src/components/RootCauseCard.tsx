import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { confidenceLabel } from "../lib/format";
import type { RootCauseCandidate } from "../lib/types";
import Card from "./Card";

const FACTOR_ORDER = ["first", "graph", "change", "own"];
const FACTOR_HINT: Record<string, string> = {
  first: "first anomaly in time",
  graph: "affected services depend on it",
  change: "recent deploy or change",
  own: "errors that name no other service",
};

function FactorBar({ name, value }: { name: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)_40px] items-center gap-2 text-label text-muted" title={FACTOR_HINT[name]}>
      <span>{name}</span>
      <span
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <span className="block h-full rounded-full bg-healthy" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right tabular-nums">{pct}%</span>
    </li>
  );
}

export default function RootCauseCard({
  candidate,
  phrase,
  runnerUp,
}: {
  candidate: RootCauseCandidate;
  phrase: string;
  runnerUp: string;
}) {
  const [open, setOpen] = useState(false);
  const evidence = open ? candidate.evidence : candidate.evidence.slice(0, 2);
  const factors = [
    ...FACTOR_ORDER.filter((k) => k in candidate.factors),
    ...Object.keys(candidate.factors).filter((k) => !FACTOR_ORDER.includes(k)),
  ];
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-muted">Root cause</h2>
      <p className="flex items-baseline gap-2 text-body font-semibold">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-root" />
        <span>{phrase ? `${candidate.service} — ${phrase}` : candidate.service}</span>
      </p>
      <p
        className="text-label text-muted"
        title="0.35 × came first + 0.30 × graph position + 0.20 × recent change + 0.15 × own fault"
      >
        {confidenceLabel(candidate.confidence)} confidence, {candidate.confidence}%
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-label">
        {evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {open && (
        <div id="root-cause-detail" className="flex flex-col gap-2 pt-2">
          {factors.length > 0 && (
            <ul aria-label="Confidence factors" className="flex flex-col gap-1">
              {factors.map((k) => (
                <FactorBar key={k} name={k} value={candidate.factors[k]} />
              ))}
            </ul>
          )}
          {runnerUp && <p className="text-label text-muted">{runnerUp}</p>}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="root-cause-detail"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-fit items-center gap-1 rounded-md text-label text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Chevron size={14} aria-hidden="true" />
        {open ? "Hide evidence" : "Show evidence"}
      </button>
    </Card>
  );
}
