import type { Severity } from "../lib/types";

const STYLES: Record<string, string> = {
  SEV1: "bg-root/12 text-root border-root/35",
  SEV2: "bg-impacted/12 text-impacted border-impacted/35",
};
const FALLBACK = "bg-surface-2 text-muted border-line";

/** Lucide-style 14 px glyphs: octagon (SEV1), triangle (SEV2), circle (SEV3/4). Text always shown. */
function Glyph({ severity }: { severity: Severity }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (severity === "SEV1") {
    return (
      <svg {...common}>
        <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    );
  }
  if (severity === "SEV2") {
    return (
      <svg {...common}>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export default function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-label font-semibold tabular-nums ${STYLES[severity] ?? FALLBACK}`}
    >
      <Glyph severity={severity} />
      {severity}
    </span>
  );
}
