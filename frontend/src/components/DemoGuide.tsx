import { ArrowRight, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { canAnimate } from "../hooks/useCountUp";
import { demoCaption } from "../lib/demo";
import type { Event, Incident, Stats } from "../lib/types";

/** Live caption bar narrating the guided demo from the incoming data. */
export default function DemoGuide({
  stats,
  incidents,
  recentEvents,
  onClose,
}: {
  stats: Stats;
  incidents: Incident[];
  recentEvents: Event[];
  onClose: () => void;
}) {
  const [animated] = useState(canAnimate);
  const caption = demoCaption(stats, incidents, recentEvents);
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={animated ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-5 py-3"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 flex-1 basis-60 text-body tabular-nums">{caption.text}</span>
      {caption.incidentId && (
        <Link
          to={`/incidents/${encodeURIComponent(caption.incidentId)}`}
          className="inline-flex items-center gap-1.5 text-body font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Open the incident
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
      <button
        type="button"
        aria-label="Close demo captions"
        onClick={onClose}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-label text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X size={14} aria-hidden="true" />
        Close
      </button>
    </motion.div>
  );
}
