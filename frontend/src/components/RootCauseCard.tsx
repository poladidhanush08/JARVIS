import { ChevronDown, ChevronUp } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { canAnimate, useCountUp } from "../hooks/useCountUp";
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
const FORMULA = "0.35 × came first + 0.30 × graph position + 0.20 × recent change + 0.15 × own fault";
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

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

/** Ring fills 0 -> score once; the number counts up alongside it. */
function ConfidenceRing({ confidence }: { confidence: number }) {
  const pct = Math.max(0, Math.min(100, confidence));
  const shown = useCountUp(pct, 1);
  // the word follows the displayed number, so it never claims "High" at 6%
  const word = confidenceLabel(shown);
  const [animated] = useState(canAnimate);
  const offset = RING_C * (1 - pct / 100);
  const ring = {
    cx: 28,
    cy: 28,
    r: RING_R,
    fill: "none",
    stroke: "var(--root)",
    strokeWidth: 6,
    strokeLinecap: "round" as const,
    strokeDasharray: RING_C,
  };
  return (
    <div className="flex items-center gap-3">
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        role="meter"
        aria-label="Root-cause confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="shrink-0 -rotate-90"
      >
        <circle cx="28" cy="28" r={RING_R} fill="none" stroke="var(--line)" strokeWidth="6" />
        {animated ? (
          <motion.circle
            {...ring}
            initial={{ strokeDashoffset: RING_C }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        ) : (
          <circle {...ring} strokeDashoffset={offset} />
        )}
      </svg>
      <div className="flex flex-col">
        <span title={FORMULA} className="text-title font-semibold tabular-nums">
          {word}, {shown}%
        </span>
        <span className="text-label text-muted">confidence</span>
      </div>
    </div>
  );
}

export default function RootCauseCard({
  candidate,
  phrase,
  runnerUp,
  runnerUpCandidate,
}: {
  candidate: RootCauseCandidate;
  phrase: string;
  runnerUp: string;
  runnerUpCandidate?: { service: string; score?: number };
}) {
  const [open, setOpen] = useState(false);
  const evidence = open ? candidate.evidence : candidate.evidence.slice(0, 3);
  const factors = [
    ...FACTOR_ORDER.filter((k) => k in candidate.factors),
    ...Object.keys(candidate.factors).filter((k) => !FACTOR_ORDER.includes(k)),
  ];
  const Chevron = open ? ChevronUp : ChevronDown;
  const [animated] = useState(canAnimate);
  const hasMore = candidate.evidence.length > 3 || factors.length > 0;

  return (
    <Card className="border-light flex flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Root cause</h2>
        {hasMore && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="root-cause-detail"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md text-label text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Chevron size={14} aria-hidden="true" />
            {open ? "Hide evidence" : "Show evidence"}
          </button>
        )}
      </div>
      <p className="flex items-baseline gap-2 text-title font-semibold leading-snug">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 translate-y-[-2px] rounded-full bg-root" />
        <span>{phrase ? `${candidate.service} — ${phrase}` : candidate.service}</span>
      </p>
      <ConfidenceRing confidence={candidate.confidence} />
      {evidence.length > 0 && (
        <ul aria-label="Evidence" className="flex flex-col gap-1 text-label">
          {evidence.map((line, i) => {
            const body = (
              <>
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
                <span title={line} className={open ? "" : "line-clamp-1"}>
                  {line}
                </span>
              </>
            );
            // top 3 fade in one by one on first show; lines revealed later just appear
            return animated && i < 3 ? (
              <motion.li
                key={line}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut", delay: 0.4 + i * 0.25 }}
                className="flex gap-2"
              >
                {body}
              </motion.li>
            ) : (
              <li key={line} className="flex gap-2">
                {body}
              </li>
            );
          })}
        </ul>
      )}
      {runnerUp && (
        <p title={runnerUp} className={`text-label text-muted ${open ? "" : "line-clamp-1"}`}>
          {runnerUp}
        </p>
      )}
      {open && factors.length > 0 && (
        <ul id="root-cause-detail" aria-label="Confidence factors" className="flex flex-col gap-1" title={FORMULA}>
          {factors.map((k) => (
            <FactorBar key={k} name={k} value={candidate.factors[k]} />
          ))}
        </ul>
      )}
      {open && typeof candidate.score === "number" && (
        <p className="text-label text-muted tabular-nums">
          {`Evidence score ${candidate.score}/100`}
          {runnerUpCandidate && typeof runnerUpCandidate.score === "number" && ` · next best: ${runnerUpCandidate.service} ${runnerUpCandidate.score}/100`}
        </p>
      )}
    </Card>
  );
}
