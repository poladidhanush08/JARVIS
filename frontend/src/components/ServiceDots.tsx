import { useEffect, useState } from "react";
import { getGraph } from "../lib/api";
import { serviceStatus, type ServiceStatus } from "../lib/collapse";
import type { Incident } from "../lib/types";

const DOT: Record<ServiceStatus, string> = {
  root: "bg-root",
  impacted: "bg-impacted",
  healthy: "bg-healthy",
};
const LABEL: Record<ServiceStatus, string> = {
  root: "root cause",
  impacted: "impacted",
  healthy: "healthy",
};

/** Visible status word beside non-healthy names, so colour is never the only signal. */
const WORD: Record<ServiceStatus, string> = {
  root: "root",
  impacted: "impacted",
  healthy: "",
};
const PILL: Record<ServiceStatus, string> = {
  root: "border-root/40 bg-root/10 text-ink",
  impacted: "border-impacted/35 bg-impacted/8 text-ink",
  healthy: "border-line bg-surface text-muted",
};
const WORD_STYLE: Record<ServiceStatus, string> = { root: "text-root", impacted: "text-impacted", healthy: "" };

export default function ServiceDots({ incidents }: { incidents: Incident[] }) {
  const [services, setServices] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    getGraph()
      .then((g) => {
        if (alive) setServices(g.nodes.map((n) => n.id));
      })
      .catch(() => {
        /* graph unavailable: show no dots */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (services.length === 0) return null;

  return (
    <ul aria-label="Services" className="flex flex-wrap gap-2">
      {services.map((s) => {
        const status = serviceStatus(s, incidents);
        const label = `${s}: ${LABEL[status]}`;
        return (
          <li
            key={s}
            title={label}
            aria-label={label}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label transition-colors duration-200 ease-out ${PILL[status]}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${DOT[status]}`} />
            <span aria-hidden="true" className="font-mono text-[12px]">
              {s}
            </span>
            {status !== "healthy" && (
              <span aria-hidden="true" className={WORD_STYLE[status]}>
                {WORD[status]}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
