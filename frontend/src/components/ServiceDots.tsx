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
    <ul aria-label="Services" className="flex flex-wrap gap-x-4 gap-y-2">
      {services.map((s) => {
        const status = serviceStatus(s, incidents);
        const label = `${s}: ${LABEL[status]}`;
        return (
          <li key={s} title={label} aria-label={label} className="flex items-center gap-2 text-label text-muted">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full transition-colors duration-200 ${DOT[status]}`} />
            <span aria-hidden="true">{s}</span>
          </li>
        );
      })}
    </ul>
  );
}
