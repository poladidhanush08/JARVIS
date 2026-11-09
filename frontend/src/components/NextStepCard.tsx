import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { Recommendation } from "../lib/types";
import Card from "./Card";
import CopyButton from "./CopyButton";

function Step({ rec, detailed }: { rec: Recommendation; detailed: boolean }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-label font-semibold tabular-nums text-muted"
      >
        {rec.step}
      </span>
      <span className="sr-only">{rec.step}.</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span title={rec.action} className={`text-body leading-snug ${detailed ? "" : "line-clamp-2"}`}>
          {rec.action}
        </span>
        {detailed && <span className="text-label text-muted">{rec.effect}</span>}
        {rec.command && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[12px]" title={rec.command}>
              {rec.command}
            </code>
            <CopyButton text={rec.command} />
          </div>
        )}
        {detailed && (
          <span className="text-label text-muted">
            <span className="font-semibold">Verify:</span> {rec.verify}
          </span>
        )}
      </div>
    </li>
  );
}

export default function NextStepCard({ recommendations }: { recommendations: Recommendation[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? recommendations : recommendations.slice(0, 2);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Next steps</h2>
        {recommendations.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="next-steps"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md text-label text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Chevron size={14} aria-hidden="true" />
            {open ? "Show fewer" : `Show all ${recommendations.length} steps + verify checks`}
          </button>
        )}
      </div>
      {recommendations.length === 0 ? (
        <p className="text-body text-muted">No playbook steps for this cause yet.</p>
      ) : (
        <ol id="next-steps" className="flex flex-col gap-2.5">
          {shown.map((r) => (
            <Step key={r.step} rec={r} detailed={open} />
          ))}
        </ol>
      )}
    </Card>
  );
}
