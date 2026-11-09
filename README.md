# J.A.R.V.I.S.

An incident-correlation prototype. It takes a stream of logs and alerts, groups the related ones
into a single incident, names the most likely root cause with its evidence, estimates the impact
and suggests the next steps. Everything runs locally, in memory, with no network access at runtime.

- `backend/` — FastAPI (Python 3.12): ingestion, correlation, root-cause ranking, impact, playbooks,
  scenario simulator, WebSocket live feed.
- `frontend/` — React + Vite dashboard: Incidents, Sources, Events.

## Run it

One-time setup: `python -m venv backend/.venv`, `backend/.venv/Scripts/pip install -e "backend[dev]"`
(use `bin/` instead of `Scripts/` outside Windows) and `npm install` in `frontend/`.

Then, in two terminals:

```sh
cd backend  && .venv/Scripts/python -m uvicorn jarvis.api:app --port 8000
cd frontend && npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/ws` to port 8000.

Send your own events at any time:

```sh
curl -X POST http://localhost:8000/api/events -H "Content-Type: application/json" \
  -d '{"service":"user-db","level":"error","message":"connection pool exhausted"}'
```

Or drop a `.log`, `.txt`, `.json`, `.jsonl` or `.csv` file on the Sources page. Lines it cannot
parse are counted as skipped.

## Demo script: scenario A in 90 seconds

1. **Sources** (0–10 s): pick *A · user-db pool exhaustion*, choose 10x, press Play.
2. **Incidents** (10–30 s): watch the alert cards fly into one incident card, then stop. Point at
   the headline: about 30 raw alerts, 1 incident; the CPU blip, the cert-expiry warning and the slow
   bank-gateway call stay outside as isolated alerts.
3. **Incident page** (30–70 s): the title answers the question ("Logins and payments failing
   because user-db ran out of connections"). The graph shows user-db red, its dependants amber and
   bank-gateway grey. Root cause: High confidence with its evidence. Impact: users blocked, payments
   failed, minutes since start. Next step: the first two fixes, with verify checks behind the link.
4. **Close** (70–90 s): press Replay on Key moments to retell the cascade, then Download report for a
   Markdown post-mortem draft.

Use **Reset** on Sources to clear everything before the next run.

## How it works

**Anomalous events** are those at level warn, error or critical, or of type alert. Only these are
correlated and counted as raw alerts.

**Correlation.** Each anomalous event is scored against every open incident:

| Signal | Weight | Score |
|---|---|---|
| Time | 0.35 | `1 - gap / 300 s` since the incident's last event |
| Dependency | 0.35 | 1.0 same service, 0.6 one hop in the service graph, 0.3 two hops |
| Signature | 0.20 | 1.0 same fingerprint, 0.8 message names a service in the incident (or the reverse), 0.6 same endpoint |
| Trace | 0.10 | 1.0 shares a trace id |

An event joins the best-scoring incident if the score is at least **0.6**; otherwise it starts a new
candidate. A candidate becomes an incident once it has 3 events (or one critical event). When an
event matches two incidents, they are merged. The time window is **300 s**.

**Root cause (RCA).** Every affected service in an incident gets a confidence score:

`confidence = 0.35·first + 0.30·graph + 0.20·change + 0.15·own`

- *first*: how early its first anomaly was (1 = first in the incident).
- *graph*: share of the other affected services that depend on it.
- *change*: 1 if it was deployed within 600 s before its first anomaly.
- *own*: share of its errors that are its own, not complaints about another service.

The top candidate is the verdict (High ≥ 75 %, Medium ≥ 50 %, otherwise Low), and its factors are
the evidence shown under "Show evidence".

## Scenarios

Topology (`backend/data/services.yaml`): web-frontend → api-gateway → auth / payment / order
services; auth and payment → user-db; payment → bank-gateway (external); order → payment;
notification → order.

| Scenario | Root cause | What you see |
|---|---|---|
| A (hero) | user-db connection pool exhausted | login failures, slow checkout, failed payments; noise stays isolated |
| B | bad deploy of auth-service v2.3.1 | login 401/500 spike right after a deploy event |
| C | bank-gateway degraded (external) | payment failures only; logins healthy, user-db not blamed |

## Tests

```sh
cd backend  && .venv/Scripts/python -m pytest -q
cd frontend && npx vitest run && npm run lint && npm run build
```
