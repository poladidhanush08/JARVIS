import { confidenceLabel, tPlus } from "./format";
import type { Incident } from "./types";

const dash = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : "—");
const list = (items: string[] | undefined) => (items && items.length > 0 ? items.join(", ") : "—");

/** Markdown incident report built from the incident as the UI shows it. */
export function buildReport(incident: Incident): string {
  const top = incident.root_cause_candidates[0];
  const title = incident.title || `Incident ${incident.id}`;
  const out: string[] = [`# ${title}`, ""];

  out.push(
    `- **Incident:** ${incident.id}`,
    `- **Severity:** ${incident.severity}`,
    `- **Status:** ${incident.status}`,
    `- **Started:** ${incident.start_time || "—"}`,
    `- **Last event:** ${incident.last_event_time || "—"}`,
    `- **Alerts correlated:** ${incident.event_ids.length}`,
    "",
    "## Summary",
    "",
  );
  if (top) {
    const cause = incident.cause_phrase ? `${top.service} ${incident.cause_phrase}` : top.service;
    out.push(
      `${incident.event_ids.length} alerts across ${incident.affected_services.length} services were correlated into one incident. ` +
        `Most likely root cause: **${cause}** (${confidenceLabel(top.confidence)} confidence, ${top.confidence}%).`,
    );
  } else {
    out.push(`${incident.event_ids.length} alerts correlated; root cause still being analysed.`);
  }

  const impact = incident.impact;
  out.push(
    "",
    "## Impact",
    "",
    `- Users affected: ${dash(impact?.users_affected)}`,
    `- Failed transactions: ${dash(impact?.failed_transactions)}`,
    `- Minutes since start: ${dash(impact?.minutes_since_start)}`,
    `- Services: ${list(impact?.services?.length ? impact.services : incident.affected_services)}`,
    `- Endpoints: ${list(impact?.endpoints)}`,
    "",
    "## Timeline",
    "",
  );
  if (incident.key_moments.length === 0) out.push("—");
  for (const m of incident.key_moments) {
    out.push(`- ${tPlus(m.timestamp, incident.start_time)} (${m.timestamp}) — **${m.service}**: ${m.label}`);
  }

  out.push("", "## Root cause", "");
  if (top) {
    out.push(`**${top.service}** — ${top.cause_type || "—"}, confidence ${top.confidence}%`, "", "Evidence:", "");
    if (top.evidence.length === 0) out.push("- —");
    for (const e of top.evidence) out.push(`- ${e}`);
    if (incident.runner_up_note) out.push("", `_${incident.runner_up_note}_`);
  } else {
    out.push("—");
  }

  out.push("", "## Recommendations", "");
  if (incident.recommendations.length === 0) out.push("—");
  for (const r of incident.recommendations) {
    out.push(`${r.step}. **${r.action}** — ${r.effect}`);
    if (r.command) out.push("", "   ```", `   ${r.command}`, "   ```", "");
    out.push(`   Verify: ${r.verify}`);
  }
  out.push("");
  return out.join("\n");
}

/** Safe file name for the report download. */
export function reportFileName(incident: Pick<Incident, "id">): string {
  return `jarvis-${incident.id.replace(/[^A-Za-z0-9_-]+/g, "_")}-report.md`;
}
