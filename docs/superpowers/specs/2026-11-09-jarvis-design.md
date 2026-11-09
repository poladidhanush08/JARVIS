# J.A.R.V.I.S. — Design Spec

*Justified Analysis, Reasoning & Visualization of Incident Systems.*
Source PRD (living doc): https://claude.ai/artifact/NNYxoiTQPXGczg72yxxwiP — this file is the
repo copy the implementation plan argues from. Date: 2026-11-09.

## 1. Intent

Ingest alerts/logs/metrics from many services, group the ones caused by the same failure into
one incident, name the most likely root cause **with visible evidence**, show impact, a timeline
and fix suggestions. The demo must prove: **≥15 noisy alerts become 1 explained incident in < 60 s**.

## 2. Goals / non-goals / anti-goals

Goals: 3 source types (REST/webhook, uploaded log files JSON/CSV/plain text, live simulator);
one normalized Event schema; automatic grouping; ranked root causes with confidence + evidence;
impact (services, endpoints, users, failed transactions); timeline; recommendations; Markdown report.

Non-goals: production scale, auth/RBAC, real Datadog/PagerDuty integrations, auto-remediation,
custom ML models.

Anti-goals: a root cause without visible evidence; a dashboard that re-lists alerts without
grouping; a demo that needs internet, API keys or luck (must run offline, deterministic).

Success metrics: scenario A collapses ≥15 alerts into 1 incident; correct root cause ranked #1
in 3/3 scenarios; first alert → root cause shown < 60 s; 0 noise events in the demo incident;
100% of root-cause claims carry evidence.

## 3. Demo scenarios ("PayFlow")

Topology (`services.yaml`): web-frontend → api-gateway → {auth-service, payment-service,
order-service}; auth-service → user-db; payment-service → user-db, bank-gateway (external);
order-service → payment-service; notification-service → order-service (consumes order events).
Edges mean "depends on / calls".

| Scenario | Injected root cause | Symptoms |
|---|---|---|
| A (hero) | user-db connection pool exhausted | login failures, slow /checkout, failed payments |
| B | bad deploy of auth-service v2.3.1 (config error) | login 401/500 spike right after a deploy event |
| C | bank-gateway degraded | payment failures only; logins healthy |

Scenario A cascade (~90 s): T+0 user-db pool 95% → exhausted (warn); T+5 auth p95 80 ms → 2.4 s,
DB timeouts; T+12 login failures 35%, gateway 5xx on /login; T+18 payment DB timeouts, 28% txn
failures; T+25 gateway slow /checkout and /pay, frontend error spike; T+30+ order/notification
secondary symptoms. Noise that must be excluded: CPU blip on notification-service, cert-expiry
warning on a staging host, one slow bank-gateway call. Scenario C must not blame user-db.

## 4. Functional requirements (P0 must, P1 should, P2 stretch)

- F1 sources: `POST /api/events` single/batch (P0); log upload .log/.json/.csv (P0); live
  simulator with play/pause/speed 1x–10x/reset (P0); metric events (P1).
- F2 correlation: normalize + fingerprint (P0); weighted score = 0.35·time + 0.35·dependency +
  0.2·signature + 0.1·trace, join if > 0.6 (P0, weights tunable); exclude noise and record *why*
  each event joined (P0); live updates + merge incidents (P1).
- F3 root cause: rank services by came-first, graph position, recent change (deploy ≤ 10 min
  before onset), own-vs-propagated fault (P0); confidence % + evidence list (P0); LLM plain-English
  summary grounded in evidence, template fallback (P1).
- F4 impact: blast radius, endpoints, users, failed transactions (P0); SEV1–SEV4 from user-facing
  impact (P1); revenue at risk (P2).
- F5 timeline: chronological, root event first (P0); propagation replay (P1).
- F6 recommendations: YAML playbook keyed on cause type (P0); similar past incidents (P2).
- F7 dashboard: incident list (P0); incident detail (P0); event explorer (P1); report export (P1).

## 5. Data model

Event: id, timestamp (ISO-8601), source (api|log_file|simulator), service, type
(log|alert|metric|deploy), level (debug|info|warn|error|critical), message, fingerprint,
metric {name, value}?, trace_id?, tags {}.
Incident: id, title, status (open|investigating|resolved), severity, start_time, last_event_time,
event_ids, affected_services, root_cause_candidates [{service, cause_type, confidence, evidence}],
impact {users_affected, failed_transactions, endpoints}, recommendations, correlation_reasons.
Service graph: nodes with tier (frontend|gateway|service|datastore|external), directed edges.

## 6. Architecture

Sources → ingest + normalize → correlation engine → root cause ranker → impact + playbook →
incident store → React dashboard over WebSocket. Both engines read the service graph. The
optional LLM only writes the summary; it never decides grouping or ranking.

## 7. Dashboard UX and design rules

Screens (left sidebar: Incidents, Sources, Events):
1. Incidents home — "N raw alerts" vs "N incidents" headline numbers, incident list (severity,
   what+why title, alert count, status, time since start), service status dots.
2. Incident page — header (title, severity badge, live status line "Investigating · confidence
   rising · updated 3 s ago"); left 2/3 affected-path graph (root red, impacted amber, healthy
   faded grey, static layout); right column cards: Root cause (verdict, confidence words + %, top
   evidence, "Show evidence"), Impact (3 numbers: users blocked, payments failed, minutes since
   start), Next step (first 2 fixes + link to all steps with verify checks); bottom Key moments
   strip (4–6 moments) with replay button.
3. Sources — log drag-and-drop with parse preview, API endpoint + copyable curl, simulator controls.
4. Events — filterable raw event table; row opens side sheet with incident + correlation signals.

"The collapse": when an incident forms, incoming alert cards slide into one incident card once
(~2 s), then stillness. Explain-on-hover: every number/node/edge shows its source.

Design rules: one question per screen; answer first, evidence on demand; color only for status
(red root/SEV1, amber impacted, grey healthy, one blue accent); motion only on change (150–300 ms,
respects reduce-motion); ≤ 3 headline numbers per screen; light default + dark via system;
Inter/system font, 3 sizes (24/15/13 px); 8 px grid; Lucide icons with labels; severity by text +
icon, WCAG AA. Leave out: gauges, 3D, HUD effects, alert walls, > 2 nav levels, legends where
direct labels fit. Done when: root cause nameable in 5 s; verdict/impact/first action fit
1440×900 without scrolling; every number shows its source on hover.

## 8. Non-functional

Offline-first; event on dashboard < 1 s; re-correlation < 200 ms at 5,000 events; no score without
its factors; deterministic scenarios; new log formats = parser plugins, new playbooks = YAML.
