import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import type { Severity } from "../lib/types";

const STYLES: Record<string, string> = {
  SEV1: "bg-root/15 text-root border-root/40",
  SEV2: "bg-impacted/15 text-impacted border-impacted/40",
};
const FALLBACK = "bg-healthy/15 text-muted border-line";

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = severity === "SEV1" ? AlertOctagon : severity === "SEV2" ? AlertTriangle : Info;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-label font-semibold ${STYLES[severity] ?? FALLBACK}`}
    >
      <Icon size={14} aria-hidden="true" />
      {severity}
    </span>
  );
}
