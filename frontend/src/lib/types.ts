export type Level = "debug" | "info" | "warn" | "error" | "critical";
export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";

export interface Metric {
  name: string;
  value: number;
}

export interface Event {
  id: string;
  timestamp: string;
  source: "api" | "log_file" | "simulator";
  service: string;
  type: "log" | "alert" | "metric" | "deploy";
  level: Level;
  message: string;
  fingerprint: string;
  metric: Metric | null;
  trace_id: string | null;
  tags: Record<string, string>;
}

export interface RootCauseCandidate {
  service: string;
  cause_type: string;
  confidence: number;
  factors: Record<string, number>;
  evidence: string[];
}

export interface Recommendation {
  step: number;
  action: string;
  effect: string;
  command: string | null;
  verify: string;
}

export interface Impact {
  users_affected: number;
  failed_transactions: number;
  endpoints: string[];
  services: string[];
  minutes_since_start: number;
}

export interface KeyMoment {
  timestamp: string;
  service: string;
  label: string;
  event_id: string;
}

export interface Incident {
  id: string;
  title: string;
  status: "open" | "investigating" | "resolved";
  severity: Severity;
  start_time: string;
  last_event_time: string;
  event_ids: string[];
  affected_services: string[];
  promoted: boolean;
  root_cause_candidates: RootCauseCandidate[];
  impact: Impact;
  recommendations: Recommendation[];
  key_moments: KeyMoment[];
  correlation_reasons: Record<string, string[]>;
  runner_up_note: string;
  cause_phrase: string;
  /** Wall clock (UTC) of the engine's last enrichment. */
  updated_at: string | null;
}

export interface Stats {
  raw_alerts: number;
  incidents: number;
  isolated: number;
}

export interface GraphNode {
  id: string;
  tier: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EventRow {
  event: Event;
  incident_id: string | null;
  reasons: string[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
}

export interface SimulatorStatus {
  scenario: string | null;
  state: string;
  speed: number;
  emitted: number;
  total: number;
}

export interface UploadResult {
  accepted: number;
  skipped: number;
  format: string;
  preview: Event[];
}

/** Event as accepted by POST /api/events (timestamp optional). */
export interface EventIn {
  id?: string;
  timestamp?: string;
  service: string;
  type?: Event["type"];
  level?: Level;
  message: string;
  metric?: Metric;
  trace_id?: string;
  tags?: Record<string, string>;
}

export type WsMessage =
  | { type: "snapshot" | "update"; stats: Stats; incidents: Incident[] }
  | { type: "events"; events: Event[] };
