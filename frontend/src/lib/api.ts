import type {
  Event,
  EventIn,
  EventRow,
  GraphData,
  Incident,
  Scenario,
  SimulatorStatus,
  Stats,
  UploadResult,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const getStats = () => request<Stats>("/api/stats");
export const getIncidents = (includeCandidates = false) =>
  request<Incident[]>(`/api/incidents?include_candidates=${includeCandidates}`);
export const getIncident = (id: string) =>
  request<{ incident: Incident; events: Event[] }>(`/api/incidents/${encodeURIComponent(id)}`);

export function getEvents(params: { service?: string; level?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.service) q.set("service", params.service);
  if (params.level) q.set("level", params.level);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request<EventRow[]>(`/api/events${qs ? `?${qs}` : ""}`);
}

export const getGraph = () => request<GraphData>("/api/graph");
export const getScenarios = () => request<Scenario[]>("/api/scenarios");

export function uploadLog(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/api/upload", { method: "POST", body: form });
}

export const postEvents = (body: EventIn | EventIn[]) => post<{ accepted: number }>("/api/events", body);

export const reportUrl = (id: string) => `/api/incidents/${encodeURIComponent(id)}/report`;

export const simulator = {
  start: (scenarioId: string, speed = 1) =>
    post<SimulatorStatus>("/api/simulator/start", { scenario_id: scenarioId, speed }),
  pause: () => post<SimulatorStatus>("/api/simulator/pause"),
  resume: () => post<SimulatorStatus>("/api/simulator/resume"),
  reset: () => post<SimulatorStatus>("/api/simulator/reset"),
  speed: (n: number) => post<SimulatorStatus>("/api/simulator/speed", { speed: n }),
  status: () => request<SimulatorStatus>("/api/simulator"),
};
