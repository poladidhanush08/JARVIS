# J.A.R.V.I.S. MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, offline prototype that ingests events from an API, uploaded logs and a live simulator, collapses related alerts into explained incidents, and shows them on a clean React dashboard.

**Architecture:** A Python FastAPI backend holds an in-memory `Engine` (correlation → root-cause ranking → impact/playbook enrichment) over a static service graph. It pushes updates to a React (Vite) frontend over a WebSocket. Three scripted scenarios make the demo deterministic.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, NetworkX, PyYAML, pytest, httpx; Node 20.15, Vite 6, React 18, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), react-router-dom 6, `@xyflow/react` 12, lucide-react, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-09-jarvis-design.md`

## Global Constraints

- Python 3.12; all backend code lives under `backend/jarvis/`, with tests under `backend/tests/`. Run tests with `backend/.venv/Scripts/python -m pytest` (Windows venv layout).
- Node is v20.15. Use **Vite 6** (Vite 7 needs Node ≥ 20.19). No Docker on this machine, so everything runs natively.
- Offline-first: no network calls at runtime, no web fonts. Use the font stack `Inter, ui-sans-serif, system-ui, sans-serif`.
- Deterministic: the same scenario must always give the same incident grouping, ranking and title.
- Storage is in-memory (the spec allows "SQLite or in-memory"; YAGNI).
- Correlation weights: 0.35 time, 0.35 dependency, 0.2 signature, 0.1 trace. Join threshold: score ≥ 0.6. Time window: 300 s.
- Root-cause weights: 0.35 came-first, 0.30 graph position, 0.20 recent change (deploy ≤ 600 s before onset), 0.15 own fault.
- UI rules from spec §7: color only for status (red root/SEV1, amber impacted, grey healthy, one blue accent), motion only on change (150–300 ms, honors `prefers-reduced-motion`), ≤ 3 headline numbers per screen, light default with dark via `prefers-color-scheme`, type sizes 24/15/13 px, 8 px grid, icons always paired with labels.
- The LLM summary (F3.3), revenue at risk (F4.3) and similar incidents (F6.2) are **out of scope for this plan**. Explanations use templates.
- Commit after every task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Malformed or mixed log uploads**: bad lines are skipped and counted, never cause a 500. The test lives in Task 3.
2. **Out-of-order events** (old logs uploaded after live data): time proximity uses the absolute time difference. The test lives in Task 4.
3. **Naive timestamps without a timezone** are treated as UTC everywhere, so comparisons never raise. The test lives in Task 1.
4. **Services missing from `services.yaml`** are still ingested, get dependency score 0, can be ranked with graph score 0, and never crash. Tests live in Tasks 2 and 5.
5. **The simulator started or reset twice mid-run** cancels the previous run with no duplicate events. The test lives in Task 8.

---

## File Structure

```
backend/
  pyproject.toml            deps + pytest config
  jarvis/
    models.py               Pydantic models (Event, Incident, …) + to_utc()
    fingerprint.py          fingerprint(message)
    graph.py                ServiceGraph (load yaml, hops, dependents)
    parsers.py              parse_log_file() → ParseResult
    correlation.py          Correlator (scoring, joining, merging, promotion)
    rca.py                  rank_root_causes()
    impact.py               compute_impact(), severity(), key_moments()
    playbook.py             Playbook (cause type, recommendations, title phrase)
    engine.py               Engine (ingest + enrichment + queries)
    report.py               render_markdown()
    simulator.py            load_scenario(), scenario_events(), Simulator
    api.py                  FastAPI app, REST + WebSocket
  data/services.yaml, data/playbooks.yaml, data/scenarios/{a_db_pool,b_bad_deploy,c_bank_gateway}.yaml
  tests/…                   one test file per module + test_scenarios.py
frontend/
  vite.config.ts            Tailwind plugin, /api + /ws proxy to :8000, vitest config
  src/lib/{types,api,format,graphLayout}.ts
  src/hooks/useLive.ts      WebSocket → live state
  src/components/…          Sidebar, SeverityBadge, Card, AffectedGraph, RootCauseCard, ImpactCard, NextStepCard, KeyMoments, CollapseStream, EventSheet
  src/pages/{Incidents,IncidentPage,Sources,Events}.tsx
README.md                   how to run the demo
```

---

### Task 1: Backend scaffold, models, fingerprint

**Files:**
- Create: `backend/pyproject.toml`, `backend/jarvis/__init__.py`, `backend/jarvis/models.py`, `backend/jarvis/fingerprint.py`
- Test: `backend/tests/test_models.py`, `backend/tests/test_fingerprint.py`

**Interfaces:**
- Produces:
  - `to_utc(dt: datetime) -> datetime`: naive values are taken as UTC; aware values are converted to UTC.
  - `Event(BaseModel)`: `id: str` (default uuid4 hex), `timestamp: datetime` (validator applies `to_utc`), `source: Literal["api","log_file","simulator"]="api"`, `service: str`, `type: Literal["log","alert","metric","deploy"]="log"`, `level: Literal["debug","info","warn","error","critical"]="info"`, `message: str`, `fingerprint: str=""` (filled by validator via `fingerprint()` when empty), `metric: Metric | None`, `trace_id: str | None`, `tags: dict[str,str]={}`. Property `is_anomalous: bool` is true when level ∈ {warn, error, critical} or type == "alert".
  - `Metric(BaseModel)`: `name: str`, `value: float`.
  - `RootCauseCandidate`: `service: str`, `cause_type: str`, `confidence: int` (0–99), `factors: dict[str,float]` (keys `first`, `graph`, `change`, `own`), `evidence: list[str]`.
  - `Recommendation`: `step: int`, `action: str`, `effect: str`, `command: str | None`, `verify: str`.
  - `Impact`: `users_affected: int=0`, `failed_transactions: int=0`, `endpoints: list[str]=[]`, `services: list[str]=[]`, `minutes_since_start: int=0`.
  - `KeyMoment`: `timestamp: datetime`, `service: str`, `label: str`, `event_id: str`.
  - `Incident`: `id: str` (format `INC-001`), `title: str=""`, `status: Literal["open","investigating","resolved"]="investigating"`, `severity: Literal["SEV1","SEV2","SEV3","SEV4"]="SEV4"`, `start_time`, `last_event_time: datetime`, `event_ids: list[str]`, `affected_services: list[str]`, `promoted: bool=False`, `root_cause_candidates: list[RootCauseCandidate]=[]`, `impact: Impact`, `recommendations: list[Recommendation]=[]`, `key_moments: list[KeyMoment]=[]`, `correlation_reasons: dict[str, list[str]]={}`, `runner_up_note: str=""`, `cause_phrase: str=""` (e.g. "ran out of connections", set in Task 7).
  - `fingerprint(message: str) -> str`

- [ ] **Step 1: Create `backend/pyproject.toml`** with project `jarvis`, `requires-python = ">=3.12"`, dependencies `fastapi>=0.115`, `uvicorn[standard]>=0.32`, `pydantic>=2.9`, `networkx>=3.4`, `pyyaml>=6.0`, `python-multipart>=0.0.12`, and dev extras `pytest>=8`, `httpx>=0.27`, `pytest-asyncio>=0.24`. Set `[tool.pytest.ini_options] testpaths=["tests"]`, `asyncio_mode="auto"`, `pythonpath=["."]`. Create the venv and install: `cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"`.

- [ ] **Step 2: Write the failing tests**

```python
# tests/test_fingerprint.py
from jarvis.fingerprint import fingerprint
def test_numbers_become_placeholder():
    assert fingerprint("DB timeout after 2000ms on user-db") == "db timeout after <n>ms on user-db"
def test_ids_and_hex_stripped():
    assert fingerprint("request 9f8e7d6c5b4a failed for user 42") == "request <id> failed for user <n>"
    assert fingerprint("trace 123e4567-e89b-12d3-a456-426614174000 lost") == "trace <id> lost"
def test_same_shape_same_fingerprint():
    assert fingerprint("pool at 95% (190/200)") == fingerprint("pool at 97% (194/200)")

# tests/test_models.py
from datetime import datetime, timezone
from jarvis.models import Event
def test_naive_timestamp_is_utc():
    e = Event(timestamp=datetime(2026, 11, 9, 10, 0, 0), service="a", message="x")
    assert e.timestamp.tzinfo == timezone.utc
def test_fingerprint_autofilled_and_anomaly_flag():
    e = Event(timestamp="2026-11-09T10:00:00Z", service="auth-service", level="error", message="DB timeout after 2000ms on user-db")
    assert e.fingerprint == "db timeout after <n>ms on user-db" and e.is_anomalous
    assert not Event(timestamp="2026-11-09T10:00:00Z", service="a", level="info", message="ok").is_anomalous
    assert Event(timestamp="2026-11-09T10:00:00Z", service="a", type="alert", level="info", message="x").is_anomalous
```

- [ ] **Step 3: Run** `.venv/Scripts/python -m pytest -q`. Expected: FAIL (ImportError).
- [ ] **Step 4: Implement** `models.py` and `fingerprint.py` as specified. Fingerprint order: lowercase → UUIDs → `<id>`, hex runs of ≥ 8 chars containing a digit → `<id>`, remaining digit runs (with optional decimal) → `<n>`, collapse whitespace.
- [ ] **Step 5: Run tests.** Expected: all PASS.
- [ ] **Step 6: Commit** `feat(backend): scaffold, event models, fingerprinting`.

---

### Task 2: Service graph

**Files:**
- Create: `backend/data/services.yaml`, `backend/jarvis/graph.py`
- Test: `backend/tests/test_graph.py`

**Interfaces:**
- Consumes: none.
- Produces: `ServiceGraph.load(path: Path) -> ServiceGraph`; `ServiceGraph.default() -> ServiceGraph` (loads `backend/data/services.yaml` relative to the package); `.tier(service) -> str | None`; `.hops(a: str, b: str) -> int | None` (undirected shortest path; None if either is unknown or they are disconnected; 0 when a == b); `.depends_on(a: str, b: str) -> bool` (a transitively depends on b along directed edges); `.nodes() -> list[dict]` (`{"id","tier"}`); `.edges() -> list[dict]` (`{"source","target"}`, source depends on target).

`services.yaml` shape: `services: {name: {tier: ..., depends_on: [...]}}`. The content is exactly the spec §3 topology: web-frontend(frontend)→api-gateway; api-gateway(gateway)→auth-service, payment-service, order-service; auth-service(service)→user-db; payment-service(service)→user-db, bank-gateway; order-service(service)→payment-service; notification-service(service)→order-service; user-db(datastore); bank-gateway(external).

- [ ] **Step 1: Write the failing tests**

```python
from jarvis.graph import ServiceGraph
g = ServiceGraph.default()
def test_hops():
    assert g.hops("auth-service", "user-db") == 1
    assert g.hops("notification-service", "api-gateway") == 2
    assert g.hops("user-db", "user-db") == 0
def test_unknown_service_is_none_not_error():
    assert g.hops("staging-host-3", "user-db") is None
    assert g.tier("staging-host-3") is None
    assert g.depends_on("staging-host-3", "user-db") is False
def test_transitive_dependency():
    assert g.depends_on("web-frontend", "user-db")
    assert not g.depends_on("user-db", "auth-service")
def test_export_shapes():
    assert {"id": "user-db", "tier": "datastore"} in g.nodes()
    assert {"source": "payment-service", "target": "bank-gateway"} in g.edges()
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** with a `networkx.DiGraph`. Compute hops on `G.to_undirected()`; implement `depends_on` with `nx.has_path(G, a, b)` and a guard for unknown nodes.
- [ ] **Step 4: Run** the tests and confirm they PASS.
- [ ] **Step 5: Commit** `feat(backend): service dependency graph`.

---

### Task 3: Log file parsers

**Files:**
- Create: `backend/jarvis/parsers.py`
- Test: `backend/tests/test_parsers.py`

**Interfaces:**
- Consumes: `Event` (Task 1).
- Produces: `ParseResult` dataclass `(events: list[Event], skipped: int, format: Literal["jsonl","json","csv","text"])`; `parse_log_file(content: str, filename: str) -> ParseResult`. All events get `source="log_file"`.

Format detection: a `.csv` extension or a first line containing `timestamp` and `,` → csv. Content starting with `[` → JSON array. Otherwise, if the first non-blank line starts with `{` → JSON lines. Else → text. Accepted keys: `timestamp|ts|time`, `service`, `level` (`warning`→`warn`, case-insensitive), `message|msg`, plus optional `type`, `metric`, `trace_id`, `tags`. Text regex (case-insensitive):
`^(?P<ts>\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+\[?(?P<level>debug|info|warn|warning|error|critical)\]?\s+(?P<service>[\w.-]+):?\s+(?P<msg>.+)$`
Any line or record that fails parsing or validation increments `skipped`.

- [ ] **Step 1: Write the failing tests**

```python
from jarvis.parsers import parse_log_file
def test_text_lines():
    r = parse_log_file("2026-11-09 10:00:05 ERROR auth-service: DB timeout after 2000ms on user-db\n", "app.log")
    assert r.format == "text" and len(r.events) == 1
    e = r.events[0]; assert (e.service, e.level, e.source) == ("auth-service", "error", "log_file")
def test_jsonl_and_warning_alias():
    r = parse_log_file('{"ts":"2026-11-09T10:00:00Z","service":"user-db","level":"WARNING","msg":"pool at 95%"}', "x.json")
    assert r.format == "jsonl" and r.events[0].level == "warn"
def test_csv():
    r = parse_log_file("timestamp,service,level,message\n2026-11-09T10:00:00Z,payment-service,error,txn failed\n", "a.csv")
    assert r.format == "csv" and r.events[0].service == "payment-service"
def test_malformed_lines_are_skipped_and_counted():
    content = "2026-11-09 10:00:05 ERROR auth-service: boom\nnot a log line\n\n2026-13-99 99:99:99 ERROR x: bad date\n"
    r = parse_log_file(content, "mixed.log")
    assert len(r.events) == 1 and r.skipped == 2
def test_garbage_json_does_not_raise():
    r = parse_log_file("[{bad json", "x.json")
    assert r.events == [] and r.skipped >= 1
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** `parse_log_file`. Blank lines are neither events nor skipped.
- [ ] **Step 4: Run** the tests and confirm they PASS.
- [ ] **Step 5: Commit** `feat(backend): log file parsers for text, jsonl, json, csv`.

---

### Task 4: Correlation engine

**Files:**
- Create: `backend/jarvis/correlation.py`
- Test: `backend/tests/test_correlation.py`

**Interfaces:**
- Consumes: `Event`, `Incident`, `ServiceGraph`.
- Produces: `Correlator(graph: ServiceGraph)` with:
  - `add(event: Event) -> str | None`: returns the incident id the event was attached to, or None for non-anomalous events, which are not correlated.
  - `incidents: dict[str, Incident]`
  - `score(event: Event, incident: Incident) -> tuple[float, list[str]]`: the score and the matched signal names.
  - `reset() -> None`
  - Constants `WEIGHTS = {"time":0.35,"dependency":0.35,"signature":0.2,"trace":0.1}`, `THRESHOLD = 0.6`, `WINDOW_S = 300`, `PROMOTE_MIN_EVENTS = 3`.

Scoring (decided here):
- time = `max(0, 1 - abs(event.ts - incident.last_event_time).total_seconds() / WINDOW_S)`
- dependency = 1.0 if the service is already in the incident; otherwise use the minimum `hops` to any incident service: 1 hop → 0.6, 2 hops → 0.3, otherwise (or None) → 0.
- signature = the max of: 1.0 if the fingerprint matches any incident event's; 0.8 if the event message names an incident service, or any incident event message names `event.service`; 0.6 if `tags.endpoint` matches an incident event's endpoint.
- trace = 1.0 if `trace_id` is set and seen in the incident.
- Signal names recorded when the component is > 0: `"time"`, `"dependency"`, `"signature"`, `"trace"`. Stored as `incident.correlation_reasons[event.id]`.
- Join the highest-scoring incident with score ≥ THRESHOLD. If none qualifies, create a new incident with ids `INC-001`, `INC-002`, … in creation order.
- Merge: after joining, if the event also scored ≥ THRESHOLD against other incidents, and both those and the target are `promoted`, merge them into the oldest incident (union of events, services and reasons, min start, max last). Delete the absorbed incident.
- `promoted` becomes True once an incident has ≥ PROMOTE_MIN_EVENTS events, or any event with level critical.
- The incident keeps the internal state it needs (event objects per incident); keep that state inside Correlator, not in the `Incident` model.

- [ ] **Step 1: Write the failing tests.** Use a helper `ev(t, service, msg, level="error", **kw)` that builds an Event at `2026-11-09T10:00:00Z + t seconds`.

```python
def test_dependency_plus_signature_joins():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "connection pool exhausted", "warn"))
    assert c.add(ev(5, "auth-service", "DB timeout after 2000ms on user-db")) == i1
def test_neighbor_without_signature_does_not_join():   # bank-gateway noise case
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "payment-service", "DB timeout after 2000ms on user-db"))
    assert c.add(ev(10, "bank-gateway", "slow response 1800ms", "warn")) != i1
def test_shared_endpoint_joins_gateway():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "auth-service", "DB timeout on user-db", tags={"endpoint": "/login"}))
    assert c.add(ev(7, "api-gateway", "5xx rate 35% on /login", "error", type="alert", tags={"endpoint": "/login"})) == i1
def test_unknown_service_starts_own_incident():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    assert c.add(ev(3, "staging-host-3", "TLS certificate expires in 6 days", "warn", type="alert")) != i1
def test_info_events_are_not_correlated():
    c = Correlator(ServiceGraph.default())
    assert c.add(ev(0, "user-db", "nightly vacuum complete", "info")) is None
def test_out_of_order_event_uses_absolute_time():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(100, "user-db", "pool exhausted"))
    assert c.add(ev(95, "user-db", "pool exhausted")) == i1
def test_reasons_recorded_and_promotion():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    e2 = ev(1, "user-db", "pool exhausted"); c.add(e2); c.add(ev(2, "user-db", "pool exhausted"))
    inc = c.incidents[i1]
    assert inc.promoted and "dependency" in inc.correlation_reasons[e2.id]
def test_outside_window_starts_new():
    c = Correlator(ServiceGraph.default())
    i1 = c.add(ev(0, "user-db", "pool exhausted"))
    assert c.add(ev(400, "auth-service", "unrelated thing")) != i1
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement `Correlator`** as decided above.
- [ ] **Step 4: Run** the tests and confirm they PASS.
- [ ] **Step 5: Commit** `feat(backend): weighted event correlation with merge and promotion`.

---

### Task 5: Root cause ranker

**Files:**
- Create: `backend/jarvis/rca.py`
- Test: `backend/tests/test_rca.py`

**Interfaces:**
- Consumes: `Event`, `RootCauseCandidate`, `ServiceGraph`.
- Produces: `rank_root_causes(incident_events: list[Event], all_events: list[Event], graph: ServiceGraph) -> list[RootCauseCandidate]`, sorted by confidence descending with ties broken by service name. `cause_type` is left as `""`; Task 6 fills it. `runner_up_note(cands: list[RootCauseCandidate], incident_events: list[Event]) -> str`.

Factors for each service `s` with anomalous events in the incident:
- `first` = `1 - (first_anomaly(s) - t0) / max(t_last - t0, 1 s)`, where t0/t_last are the incident's first and last anomalous timestamps.
- `graph` = |{x ∈ affected \ {s} : graph.depends_on(x, s)}| / max(|affected| − 1, 1).
- `change` = 1.0 if `all_events` contains a `type=="deploy"` event for `s` within 600 s before first_anomaly(s); else 0.
- `own` = the share of `s`'s anomalous events whose message names no *other* known graph service.
- `confidence = min(99, round(100 * (0.35*first + 0.30*graph + 0.20*change + 0.15*own)))`.
- Evidence strings, in this order, included only when the factor > 0:
  - `"First anomaly in the incident at T+{secs}s"` when `first == 1`, else `"First anomaly at T+{secs}s"`
  - `"{k} of {n} other affected services depend on it"`
  - `"Deployed {message} {secs}s before onset"`
  - `"Its own errors: \"{most common own message}\""`
- `runner_up_note` = `"{service} ranked lower: its errors point at {named service}"` when the runner-up's most common message names another service; else `"{service} ranked lower: its first anomaly came {d}s later"`. Returns `""` when there are fewer than 2 candidates.

- [ ] **Step 1: Write the failing tests**

```python
def test_db_is_root_when_first_and_depended_on():
    evs = [ev(0,"user-db","connection pool exhausted","warn"), ev(5,"auth-service","DB timeout after 2000ms on user-db"),
           ev(18,"payment-service","DB timeout after 2000ms on user-db"), ev(25,"api-gateway","5xx on /login",type="alert")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[0].service == "user-db" and c[0].confidence >= 75
    assert any("depend on it" in s for s in c[0].evidence)
def test_recent_deploy_boosts_change_factor():
    dep = ev(-30, "auth-service", "auth-service v2.3.1", "info", type="deploy")
    evs = [ev(0,"auth-service","config error: invalid JWT signing key"), ev(5,"api-gateway","5xx on /login",type="alert")]
    c = rank_root_causes(evs, [dep, *evs], ServiceGraph.default())
    assert c[0].service == "auth-service" and c[0].factors["change"] == 1.0
def test_unknown_service_ranked_without_crash():
    evs = [ev(0,"staging-host-3","disk full"), ev(1,"staging-host-3","disk full")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert c[0].service == "staging-host-3" and c[0].factors["graph"] == 0
def test_runner_up_note_names_pointed_service():
    evs = [ev(0,"user-db","pool exhausted","warn"), ev(5,"auth-service","DB timeout after 2000ms on user-db")]
    c = rank_root_causes(evs, evs, ServiceGraph.default())
    assert runner_up_note(c, evs) == "auth-service ranked lower: its errors point at user-db"
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** as decided above.
- [ ] **Step 4: Run** the tests and confirm they PASS.
- [ ] **Step 5: Commit** `feat(backend): evidence-based root cause ranking`.

---

### Task 6: Impact, severity, key moments, playbook, title, report

**Files:**
- Create: `backend/jarvis/impact.py`, `backend/jarvis/playbook.py`, `backend/data/playbooks.yaml`, `backend/jarvis/report.py`
- Test: `backend/tests/test_impact.py`, `backend/tests/test_playbook.py`, `backend/tests/test_report.py`

**Interfaces:**
- Consumes: models, `ServiceGraph`, `RootCauseCandidate`.
- Produces:
  - `compute_impact(incident_events: list[Event], now: datetime) -> Impact`: `users_affected` = sum of metric values named `failed_logins`; `failed_transactions` = sum of those named `failed_payments`; `endpoints` = sorted unique `tags.endpoint`; `services` = sorted affected services; `minutes_since_start` = whole minutes from the first event to `now`.
  - `severity(impact: Impact, graph: ServiceGraph) -> str`: "user-facing" means any affected service has tier frontend or gateway. SEV1 if user-facing and (`failed_transactions ≥ 1` or `users_affected ≥ 500`); SEV2 if user-facing; SEV3 if ≥ 3 services; else SEV4.
  - `key_moments(incident_events: list[Event]) -> list[KeyMoment]`: the first anomalous event per service in time order, capped at 6. The label is `"first anomaly"` for the earliest; others use `"{service} affected"`.
  - `Playbook.load(path)` / `Playbook.default()`; `.cause_type(root: RootCauseCandidate, root_events: list[Event], graph) -> str`. Order: `change == 1` → `bad_deploy`; tier external → `external_dependency`; any `match` substring (case-insensitive) in the root's messages → that type; else `generic`.
  - `.recommend(cause_type: str, service: str) -> list[Recommendation]`, with `{service}` substituted.
  - `.phrase(cause_type) -> str`.
  - `make_title(impact: Impact, root_service: str, phrase: str) -> str`: the symptom is `"Logins and payments failing"` if both counts > 0; `"Payments failing"` or `"Logins failing"` if only one is; else `"{n} services degraded"`. Result: `f"{symptom} because {root_service} {phrase}"`.
  - `render_markdown(incident: Incident, events: list[Event]) -> str`.

`playbooks.yaml` content (four types, each with `match`, `phrase`, `steps[{action, effect, command, verify}]`):
- `db_pool_exhaustion`: match `["pool exhausted","connection pool"]`, phrase `ran out of connections`. Steps:
  1. "Raise the {service} connection pool limit" / "queued requests drain" / `kubectl set env deploy/{service} POOL_MAX=400` / "pool usage below 80%"
  2. "Kill long-running queries" / "frees stuck connections" / `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '30 seconds';` / "active connections drop"
  3. "Restart the services holding stale connections" / "clears broken pools" / `kubectl rollout restart deploy/auth-service deploy/payment-service` / "DB timeout errors stop"
  4. "Add connection timeouts and a circuit breaker" / "prevents recurrence" / no command / "load test passes"
- `bad_deploy`: phrase `had a bad deploy`. Steps: roll back (`kubectl rollout undo deploy/{service}` / "error rate back to baseline"), diff the release config, add config validation to CI.
- `external_dependency`: phrase `is degraded`. Steps: queue payments for retry / enable fallback, check the provider status page, tighten timeouts and alerting on {service}.
- `generic`: phrase `is failing`. Steps: inspect recent {service} logs, restart {service}, escalate to the owner.

Report sections, exactly: `# {title}`, a line `**Severity:** … · **Status:** … · **Started:** … UTC`, then `## Summary`, `## Impact`, `## Timeline` (a key-moments table: time · service · moment), `## Root cause` (top candidate, confidence, evidence bullets, runner-up note), `## Recommended actions` (numbered, with command in backticks and "Verify:" line), `## Follow-ups`.

- [ ] **Step 1: Write the failing tests**

```python
def test_impact_sums_metrics_and_endpoints():
    evs = [ev(0,"auth-service","login failures",type="metric",metric={"name":"failed_logins","value":420},tags={"endpoint":"/login"}),
           ev(10,"payment-service","txn failures",type="metric",metric={"name":"failed_payments","value":104},tags={"endpoint":"/pay"})]
    imp = compute_impact(evs, now=T0 + timedelta(minutes=4, seconds=10))
    assert (imp.users_affected, imp.failed_transactions, imp.endpoints, imp.minutes_since_start) == (420, 104, ["/login","/pay"], 4)
def test_severity_rules():
    g = ServiceGraph.default()
    assert severity(Impact(failed_transactions=1, services=["api-gateway"]), g) == "SEV1"
    assert severity(Impact(services=["api-gateway"]), g) == "SEV2"
    assert severity(Impact(services=["a","b","c"]), g) == "SEV3"
    assert severity(Impact(services=["user-db"]), g) == "SEV4"
def test_title():
    assert make_title(Impact(users_affected=5, failed_transactions=2), "user-db", "ran out of connections") == \
        "Logins and payments failing because user-db ran out of connections"
def test_cause_type_and_recommendations():
    pb = Playbook.default(); g = ServiceGraph.default()
    root = RootCauseCandidate(service="user-db", cause_type="", confidence=80, factors={"first":1,"graph":1,"change":0,"own":1}, evidence=[])
    assert pb.cause_type(root, [ev(0,"user-db","connection pool exhausted")], g) == "db_pool_exhaustion"
    recs = pb.recommend("db_pool_exhaustion", "user-db")
    assert recs[0].step == 1 and "user-db" in recs[0].action and recs[0].verify
def test_report_has_all_sections(sample_incident, sample_events):   # fixtures in tests/conftest.py
    md = render_markdown(sample_incident, sample_events)
    for h in ["## Summary","## Impact","## Timeline","## Root cause","## Recommended actions","## Follow-ups"]:
        assert h in md
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** the four modules as decided above. Add `tests/conftest.py` with the `ev` helper, `T0`, and the `sample_incident`/`sample_events` fixtures, then move the `ev` helpers from Tasks 4–5 into it.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): impact, severity, playbook recommendations, report`.

---

### Task 7: Engine

**Files:**
- Create: `backend/jarvis/engine.py`
- Test: `backend/tests/test_engine.py`

**Interfaces:**
- Consumes: `Correlator`, `rank_root_causes`, `runner_up_note`, impact/playbook functions, `ServiceGraph`, `Playbook`.
- Produces: `Engine(graph: ServiceGraph | None = None, playbook: Playbook | None = None, clock: Callable[[], datetime] = utcnow)` with:
  - `ingest(events: list[Event]) -> list[str]`: changed incident ids. Events are stored in arrival order, then each is passed to the correlator; touched incidents are re-enriched.
  - `events(service: str | None = None, level: str | None = None, since: datetime | None = None) -> list[Event]`: sorted by timestamp.
  - `event_incident(event_id) -> str | None`
  - `incidents(include_candidates: bool = False) -> list[Incident]`: promoted only by default, newest first.
  - `incident(incident_id) -> Incident | None`
  - `incident_events(incident_id) -> list[Event]`
  - `stats() -> dict` with keys `raw_alerts` (count of anomalous events), `incidents` (promoted), `isolated` (non-promoted)
  - `reset() -> None`

Enrichment per touched incident: candidates = `rank_root_causes`; set `candidates[0].cause_type` via `Playbook.cause_type` (and for the others too); impact; severity; key moments; recommendations for the top candidate; title via `make_title` with the top candidate's phrase (also stored in `cause_phrase`); `runner_up_note`; `status = "investigating"`.

- [ ] **Step 1: Write the failing tests**

```python
def test_ingest_enriches_incident():
    e = Engine(clock=lambda: T0 + timedelta(minutes=2))
    e.ingest([ev(0,"user-db","connection pool exhausted","warn"), ev(2,"user-db","connection pool exhausted"),
              ev(5,"auth-service","DB timeout after 2000ms on user-db",tags={"endpoint":"/login"})])
    [inc] = e.incidents()
    assert inc.root_cause_candidates[0].service == "user-db"
    assert inc.title.endswith("because user-db ran out of connections") and inc.recommendations
    assert e.stats() == {"raw_alerts": 3, "incidents": 1, "isolated": 0}
def test_candidates_hidden_by_default():
    e = Engine(); e.ingest([ev(0,"staging-host-3","TLS certificate expires in 6 days","warn",type="alert")])
    assert e.incidents() == [] and len(e.incidents(include_candidates=True)) == 1 and e.stats()["isolated"] == 1
def test_reset_clears_everything():
    e = Engine(); e.ingest([ev(0,"user-db","pool exhausted")]); e.reset()
    assert e.events() == [] and e.stats()["raw_alerts"] == 0
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement `Engine`.**
- [ ] **Step 4: Add `test_perf_single_ingest_under_200ms`.** Pre-load 5,000 synthetic events (scenario-A-like messages, timestamps spread over 2 hours so most incidents are closed by the window), then assert that one more `ingest([event])` takes < 200 ms (`time.perf_counter`). Run all engine tests. Expected: PASS. If it is too slow, only score incidents whose `last_event_time` is within `WINDOW_S` of the event.
- [ ] **Step 5: Commit** `feat(backend): engine orchestrating correlation and enrichment`.

---

### Task 8: Scenarios and simulator

**Files:**
- Create: `backend/data/scenarios/a_db_pool.yaml`, `b_bad_deploy.yaml`, `c_bank_gateway.yaml`, `backend/jarvis/simulator.py`
- Test: `backend/tests/test_scenarios.py`, `backend/tests/test_simulator.py`

**Interfaces:**
- Consumes: `Event`, `Engine`.
- Produces:
  - `Scenario` model: `id: str`, `name: str`, `description: str`, `duration: int`, `steps: list[Step]`. `Step` has `at: float`, `service`, `type`, `level`, `message`, `metric?`, `tags?`, `repeat: int = 1`, `every: float = 0`.
  - `list_scenarios() -> list[Scenario]` (from `data/scenarios/*.yaml`, sorted by id)
  - `load_scenario(scenario_id: str) -> Scenario`
  - `scenario_events(s: Scenario, start: datetime) -> list[Event]`: expands repeats; sorts by time; `source="simulator"`; timestamp = start + at.
  - `Simulator(engine: Engine, on_events: Callable[[list[Event]], Awaitable[None]])` with async methods `start(scenario_id: str, speed: float = 1.0)`, `pause()`, `resume()`, `reset()`, `set_speed(speed: float)` (clamped to 1–10), and `status() -> dict` (`{"scenario","state","speed","emitted","total"}`, where state ∈ idle|running|paused|finished). Wall-clock wait between events is `Δat / speed`. `start` cancels any running task and resets the engine first.

Scenario A steps (ids/messages exact; `endpoint` in tags):

| at | service | type | level | message | extra |
|---|---|---|---|---|---|
| 0 | user-db | log | warn | connection pool at 95% (190/200) | |
| 2 | user-db | log | error | connection pool exhausted, waiting for connection | repeat 3 every 10 |
| 5 | auth-service | log | error | DB timeout after 2000ms on user-db | repeat 4 every 6, /login |
| 6 | auth-service | metric | warn | p95 latency 2400ms | p95_latency_ms 2400 |
| 12 | api-gateway | alert | error | 5xx rate 35% on /login | repeat 2 every 10, /login |
| 12 | auth-service | metric | error | login failures 35% | failed_logins 420, repeat 3 every 10, /login |
| 15 | notification-service | metric | warn | CPU 91% for 30s | cpu_pct 91 (**noise**) |
| 18 | payment-service | log | error | DB timeout after 2000ms on user-db | repeat 3 every 6, /pay |
| 20 | payment-service | metric | error | transaction failures 28% | failed_payments 104, repeat 3 every 10, /pay |
| 22 | staging-host-3 | alert | warn | TLS certificate expires in 6 days | (**noise**) |
| 25 | api-gateway | alert | warn | slow responses p95 3100ms on /checkout | /checkout |
| 26 | api-gateway | alert | warn | slow responses p95 2900ms on /pay | /pay |
| 27 | web-frontend | alert | error | client error spike calling api-gateway | repeat 2 every 15 |
| 32 | order-service | log | warn | retries calling payment-service (attempt 3) | repeat 2 every 12 |
| 35 | bank-gateway | log | warn | slow response 1800ms | (**noise**) |
| 40 | notification-service | log | warn | order event backlog growing; order-service lagging | |

Scenario B: at 0 an auth-service `deploy`/info event "auth-service v2.3.1"; at 10 a user-db info event "nightly vacuum complete"; at 20 an auth-service error "config error: invalid JWT signing key" (repeat 4 every 5, /login); at 22 an auth-service metric `failed_logins` 380 (repeat 3 every 10, /login); at 25 an api-gateway alert error "5xx rate 41% on /login" (repeat 2 every 10, /login); at 28 a bank-gateway warn "slow response 1700ms" (noise); at 30 a web-frontend alert error "login page errors calling api-gateway" (repeat 2 every 10).

Scenario C: at 0 a bank-gateway alert error "health check failing: HTTP 503" (repeat 3 every 15); at 4 a payment-service error "timeout calling bank-gateway after 5000ms" (repeat 4 every 6, /pay); at 6 an auth-service info "login success rate normal"; at 8 a payment-service metric `failed_payments` 85 (repeat 3 every 10, /pay); at 12 an api-gateway alert error "5xx rate 22% on /pay" (repeat 2 every 10, /pay); at 15 a user-db warn "slow query 900ms" (noise).

- [ ] **Step 1: Write the failing acceptance tests** (each one ingests `scenario_events(load_scenario(id), T0)` into a fresh `Engine`):

```python
@pytest.mark.parametrize("sid,root,cause", [("a_db_pool","user-db","db_pool_exhaustion"),
                                            ("b_bad_deploy","auth-service","bad_deploy"),
                                            ("c_bank_gateway","bank-gateway","external_dependency")])
def test_scenario_root_cause(sid, root, cause):
    e = run(sid); [inc] = e.incidents()
    assert inc.root_cause_candidates[0].service == root and inc.root_cause_candidates[0].cause_type == cause
def test_scenario_a_collapses_and_excludes_noise():
    e = run("a_db_pool"); [inc] = e.incidents()
    msgs = {ev.message for ev in e.incident_events(inc.id)}
    assert len(inc.event_ids) >= 15
    assert not msgs & {"CPU 91% for 30s", "TLS certificate expires in 6 days", "slow response 1800ms"}
    assert inc.title == "Logins and payments failing because user-db ran out of connections" and inc.severity == "SEV1"
def test_scenario_c_does_not_blame_db():
    e = run("c_bank_gateway"); [inc] = e.incidents()
    assert "user-db" not in inc.affected_services
```

Simulator tests (async; use `speed=10` and a scenario fixture with steps at 0, 0.1 and 0.2 written to a tmp dir, or monkeypatch the step times):

```python
async def test_start_twice_cancels_previous_without_duplicates(): ...   # start, start again immediately, await finish: emitted == total and engine has exactly `total` events
async def test_pause_stops_emission(): ...                                # pause after first event; count unchanged after 0.3 s; resume finishes
def test_speed_clamped(): ...                                             # set_speed(50) → status()["speed"] == 10
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Write the three YAML files** exactly as tabled above, then implement `simulator.py`.
- [ ] **Step 4: Run** the full suite. Expected: PASS. If a scenario assertion fails, tune only the scenario messages, never the global weights, and note any change in the commit message.
- [ ] **Step 5: Commit** `feat(backend): demo scenarios and live simulator`.

---

### Task 9: REST API and WebSocket

**Files:**
- Create: `backend/jarvis/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `Engine`, `Simulator`, `parse_log_file`, `render_markdown`, `ServiceGraph`, `list_scenarios`.
- Produces: `app: FastAPI` (run with `uvicorn jarvis.api:app --port 8000`). Endpoints:
  - `POST /api/events`: body is an Event-like object or a list of them (`timestamp` optional → now; `source` forced to `api`). Returns `{"accepted": n}`.
  - `POST /api/upload`: multipart `file`. Returns `{"accepted", "skipped", "format", "preview": first 5 events}`.
  - `GET /api/stats` → `Engine.stats()`
  - `GET /api/incidents?include_candidates=false` → `list[Incident]`
  - `GET /api/incidents/{id}` → `{"incident": Incident, "events": list[Event]}`. Unknown id → 404.
  - `GET /api/incidents/{id}/report` → `text/markdown` with `Content-Disposition: attachment; filename="{id}.md"`
  - `GET /api/events?service&level&limit=500` → `list[{"event": Event, "incident_id": str|None, "reasons": list[str]}]`
  - `GET /api/graph` → `{"nodes", "edges"}`
  - `GET /api/scenarios` → `[{"id","name","description"}]`
  - `POST /api/simulator/start` `{"scenario_id","speed"}`, `/pause`, `/resume`, `/reset`, `/speed` `{"speed"}`; `GET /api/simulator` returns status. Unknown scenario → 404.
  - `WS /ws`: on connect, sends `{"type":"snapshot","stats":…,"incidents":[…]}`. After every ingest (from any source) it sends `{"type":"events","events":[…]}` followed by `{"type":"update","stats":…,"incidents":[…]}`.
  - CORS allows `http://localhost:5173`.

- [ ] **Step 1: Write the failing tests** with `fastapi.testclient.TestClient`:

```python
def test_post_events_then_incident_visible(client):
    body = [{"timestamp": f"2026-11-09T10:00:0{i}Z", "service": "user-db", "level": "error", "message": "connection pool exhausted"} for i in range(3)]
    assert client.post("/api/events", json=body).json() == {"accepted": 3}
    [inc] = client.get("/api/incidents").json()
    detail = client.get(f"/api/incidents/{inc['id']}").json()
    assert len(detail["events"]) == 3
def test_upload_reports_skipped(client):
    r = client.post("/api/upload", files={"file": ("x.log", b"2026-11-09 10:00:05 ERROR auth-service: boom\ngarbage\n")}).json()
    assert (r["accepted"], r["skipped"], r["format"]) == (1, 1, "text")
def test_unknown_incident_404(client): assert client.get("/api/incidents/INC-999").status_code == 404
def test_report_download(client_with_incident): ...   # 200, text/markdown, attachment header, contains "## Root cause"
def test_websocket_snapshot_then_update(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        client.post("/api/events", json={"service": "user-db", "level": "error", "message": "pool exhausted"})
        assert ws.receive_json()["type"] == "events"
        assert ws.receive_json()["type"] == "update"
```

The `client` fixture builds a fresh app via a factory `create_app() -> FastAPI` so tests don't share engine state; `app = create_app()` at module level.

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement `create_app`**, with a `Hub` that holds the WebSocket connections and a `broadcast(events)` used by both the REST handlers and the simulator.
- [ ] **Step 4: Run** the full suite and confirm it PASSES. Smoke test: start `uvicorn jarvis.api:app --port 8000` in the background, `curl -X POST localhost:8000/api/simulator/start -H "Content-Type: application/json" -d '{"scenario_id":"a_db_pool","speed":10}'`, wait about 6 s, and confirm `curl localhost:8000/api/incidents` returns one incident with the expected title. Stop the server.
- [ ] **Step 5: Commit** `feat(backend): REST API, uploads, simulator controls, websocket`.

---

### Task 10: Frontend scaffold, design tokens, data layer

**Files:**
- Create: `frontend/` via `npm create vite@6 frontend -- --template react-ts`; then `frontend/vite.config.ts`, `src/index.css`, `src/main.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Card.tsx`, `src/components/SeverityBadge.tsx`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/format.ts`, `src/lib/graphLayout.ts`, `src/hooks/useLive.ts`
- Test: `src/lib/format.test.ts`, `src/lib/graphLayout.test.ts`, `src/components/SeverityBadge.test.tsx`

**Interfaces:**
- Consumes: the Task 9 HTTP and WS contract.
- Produces:
  - `types.ts`: TS mirrors of `Event`, `Incident`, `RootCauseCandidate`, `Impact`, `Recommendation`, `KeyMoment`, `Stats`, `GraphData`, `EventRow` (same field names as the Pydantic models).
  - `api.ts`: `getStats()`, `getIncidents()`, `getIncident(id)`, `getEvents(params)`, `getGraph()`, `getScenarios()`, `uploadLog(file)`, `postEvents(body)`, `simulator.{start(id, speed), pause(), resume(), reset(), speed(n), status()}`, and `reportUrl(id)`.
  - `useLive(): { stats: Stats; incidents: Incident[]; recentEvents: Event[]; connected: boolean }`. It reconnects with a 1 s backoff and keeps the last 50 events.
  - `format.ts`: `confidenceLabel(c: number): "High"|"Medium"|"Low"` (≥75 High, ≥50 Medium), `relativeTime(iso: string, now?: Date): string` ("3 s ago", "4 min ago"), `tPlus(iso: string, startIso: string): string` ("T+18s").
  - `graphLayout(graph: GraphData, incident?: Incident): { nodes: {id, x, y, status: "root"|"impacted"|"healthy", label}[]; edges: {id, source, target, active: boolean}[] }`. Rows by tier: frontend y=0, gateway 100, service 200, datastore/external 300. Within a row, sort by name and space 160 px apart, centered on x=0. root = top candidate; impacted = other affected services; edge `active` when both ends are root or impacted.
  - `SeverityBadge({severity})`: renders the text `SEV1` with an icon (`AlertOctagon` for SEV1, `AlertTriangle` for SEV2, `Info` otherwise) and red/amber/grey styles.

Setup decisions: `npm i react-router-dom@6 @xyflow/react@12 lucide-react` and `npm i -D tailwindcss@4 @tailwindcss/vite@4 vitest@2 jsdom @testing-library/react @testing-library/jest-dom`. Proxy `/api` → `http://localhost:8000` and `/ws` → `ws://localhost:8000` (with `ws: true`). In `index.css`, use `@import "tailwindcss";` plus `@theme` tokens: `--color-ink`, `--color-muted`, `--color-line`, `--color-surface`, `--color-canvas`, `--color-accent` (blue), `--color-root` (red), `--color-impacted` (amber), `--color-healthy` (grey). Dark values go under `@media (prefers-color-scheme: dark)`, set on `:root` CSS variables. Body text 15 px, labels 13 px, headline 24 px. The layout is a 200 px left sidebar (Incidents / Sources / Events, each a Lucide icon plus label, active item tinted) and a main area with 24 px padding. Routes: `/` Incidents, `/incidents/:id`, `/sources`, `/events`.

- [ ] **Step 1: Scaffold and install** as decided. Remove the template demo content.
- [ ] **Step 2: Write the failing tests**

```ts
test("confidence labels", () => { expect(confidenceLabel(87)).toBe("High"); expect(confidenceLabel(60)).toBe("Medium"); expect(confidenceLabel(20)).toBe("Low"); });
test("tPlus", () => expect(tPlus("2026-11-09T10:00:18Z", "2026-11-09T10:00:00Z")).toBe("T+18s"));
test("layout marks root, impacted, healthy and active edges", () => {
  const g = { nodes: [{id:"api-gateway",tier:"gateway"},{id:"auth-service",tier:"service"},{id:"user-db",tier:"datastore"},{id:"order-service",tier:"service"}],
              edges: [{source:"api-gateway",target:"auth-service"},{source:"auth-service",target:"user-db"},{source:"api-gateway",target:"order-service"}] };
  const inc = { affected_services: ["api-gateway","auth-service","user-db"], root_cause_candidates: [{ service: "user-db" }] } as any;
  const l = graphLayout(g, inc);
  expect(l.nodes.find(n => n.id === "user-db")!.status).toBe("root");
  expect(l.nodes.find(n => n.id === "order-service")!.status).toBe("healthy");
  expect(l.edges.find(e => e.target === "order-service")!.active).toBe(false);
});
test("severity badge shows text, not color alone", () => { render(<SeverityBadge severity="SEV1" />); expect(screen.getByText("SEV1")).toBeInTheDocument(); });
```

- [ ] **Step 3: Run** `npx vitest run` and confirm it FAILS.
- [ ] **Step 4: Implement** the files listed.
- [ ] **Step 5: Run** `npx vitest run` and `npm run build`. Expected: tests PASS and the build succeeds.
- [ ] **Step 6: Commit** `feat(frontend): scaffold, design tokens, data layer`.

---

### Task 11: Incidents home and "the collapse"

**Files:**
- Create: `src/pages/Incidents.tsx`, `src/components/CollapseStream.tsx`, `src/components/ServiceDots.tsx`
- Test: `src/pages/Incidents.test.tsx`

**Interfaces:**
- Consumes: `useLive`, `SeverityBadge`, `Card`, `relativeTime`, `getGraph`.
- Produces: the home page.

Layout, top to bottom:
1. A row of service status dots (grey, amber if affected, red if root of any open incident), each with its name on hover.
2. Two headline numbers side by side: `{stats.raw_alerts}` "raw alerts" and `{stats.incidents}` "incidents", with a small muted line `{stats.isolated} isolated alerts not grouped`. No third big number.
3. The incident list: rows show severity badge, title, `{event_ids.length} alerts`, status, and `relativeTime(start_time)`. Clicking a row goes to `/incidents/:id`.
4. Empty state when there are no incidents: "All quiet. Start a scenario from Sources to see J.A.R.V.I.S. work." with a link to `/sources`.

`CollapseStream`: while `recentEvents` contains anomalous events from the last 10 s that are not yet in an incident card, show them as small cards in a right-hand column. When an incident first appears in `incidents` (a new id), animate those cards translating and fading into that incident's row once (≤ 2 s total, CSS transitions, 200 ms per card stagger cap). Then the column empties. With `prefers-reduced-motion`, skip the animation and simply remove the cards.

- [ ] **Step 1: Write the failing test.** Mock `useLive` (`vi.mock("../hooks/useLive")`) to return stats `{raw_alerts: 27, incidents: 1, isolated: 3}` and one incident. Assert that the text "27", "raw alerts", the incident title and "SEV1" are present. Add a second test where incidents is `[]` and assert "All quiet" is shown.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** the page and components.
- [ ] **Step 4: Run** the tests and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): incidents home with alert collapse`.

---

### Task 12: Incident page

**Files:**
- Create: `src/pages/IncidentPage.tsx`, `src/components/AffectedGraph.tsx`, `src/components/RootCauseCard.tsx`, `src/components/ImpactCard.tsx`, `src/components/NextStepCard.tsx`, `src/components/KeyMoments.tsx`
- Test: `src/components/RootCauseCard.test.tsx`, `src/components/NextStepCard.test.tsx`

**Interfaces:**
- Consumes: `getIncident`, `getGraph`, `reportUrl`, `graphLayout`, `confidenceLabel`, `tPlus`, `relativeTime`, `useLive` (refetch the incident when an `update` lists this id).
- Produces: the incident page laid out exactly like the spec §7 wireframe:
  - **Header:** title (24 px), `SeverityBadge`, and the live status line `"{status} · confidence {rising|steady} · updated {relativeTime}"`. Confidence is "rising" if the top confidence went up since the last fetch, else "steady". A "Download report" button (Lucide `FileDown` + label) links to `reportUrl`.
  - **Grid:** `grid-cols-3`, graph `col-span-2`, cards in the right column. At 1440×900 the header, root cause, impact and next step must be visible without scrolling.
  - **`AffectedGraph`:** `@xyflow/react` with nodes and edges from `graphLayout`. Nodes are not draggable; fit view; no minimap or controls. Root nodes are red-tinted with a 2 px red border, impacted amber, healthy grey at 50% opacity. Active edges use the axis color; inactive edges are faint. Each node tooltip (title attribute) reads `"{n} events, first at T+{s}s"`; each active edge has a label-on-hover `"{k} events from {source} naming {target}"` (count of the source's incident events whose message names the target; `"dependency"` when k is 0). There is no legend; a one-line muted caption below the graph explains the colors.
  - **`RootCauseCard`:** label "Root cause", verdict `"{service} — {cause phrase from title}"`, `"{confidenceLabel} confidence, {confidence}%"`, and the first 2 evidence lines. A "Show evidence" toggle expands all evidence, the factor breakdown (first/graph/change/own as % bars in neutral grey) and the runner-up note.
  - **`ImpactCard`:** three rows: users blocked at login, payments failed, minutes since start (number at 15/600 weight, muted label). Each number has a `title` naming its source ("sum of failed_logins metrics").
  - **`NextStepCard`:** the first 2 recommendations (numbered action), then an "All {n} steps + verify checks" toggle that reveals every step with effect, a copyable command (`Copy` icon button using `navigator.clipboard`) and a "Verify:" line.
  - **`KeyMoments`:** a horizontal strip with one dot per moment (the first one red), `tPlus` above the label, and a "Replay" button (`Play` icon). Replay steps an index from 0 to n−1 every 700 ms; the graph shows only services whose first anomaly is at or before the current moment as non-healthy. It runs only on click.

- [ ] **Step 1: Write the failing tests**

```tsx
test("root cause card shows verdict and confidence words", () => {
  // props: candidate = incident.root_cause_candidates[0], phrase = incident.cause_phrase, runnerUp = incident.runner_up_note
  render(<RootCauseCard candidate={{service:"user-db",cause_type:"db_pool_exhaustion",confidence:80,factors:{first:1,graph:1,change:0,own:1},evidence:["First anomaly in the incident at T+0s","5 of 5 other affected services depend on it","x"]}} phrase="ran out of connections" runnerUp="auth-service ranked lower: its errors point at user-db" />);
  expect(screen.getByText(/High confidence, 80%/)).toBeInTheDocument();
  expect(screen.queryByText("x")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Show evidence"));
  expect(screen.getByText("x")).toBeInTheDocument();
  expect(screen.getByText(/ranked lower/)).toBeInTheDocument();
});
test("next step card shows two steps then expands", () => { /* 4 recs → 2 visible; click "All 4 steps + verify checks" → 4 visible and "Verify:" text present */ });
```

- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** the page and components.
- [ ] **Step 4: Run** the tests and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): incident page with graph, root cause, impact, next steps, key moments`.

---

### Task 13: Sources and Events pages

**Files:**
- Create: `src/pages/Sources.tsx`, `src/pages/Events.tsx`, `src/components/EventSheet.tsx`
- Test: `src/pages/Sources.test.tsx`, `src/pages/Events.test.tsx`

**Interfaces:**
- Consumes: `getScenarios`, `simulator.*`, `uploadLog`, `getEvents`, `useLive`.
- Produces:
  - **Sources**, three cards stacked:
    1. **Simulator:** a scenario select (name + description), Play/Pause/Resume/Reset buttons (icon + label), a speed segmented control 1x/2x/5x/10x, and a status line "Running · 14 of 31 events" polled from `simulator.status()` every 1 s while running.
    2. **Upload logs:** a drag-and-drop zone plus a file picker accepting `.log,.txt,.json,.jsonl,.csv`. After upload, show "Imported {accepted} events · skipped {skipped} lines · format {format}" and a 5-row preview table.
    3. **API:** the endpoint `POST http://localhost:8000/api/events` and a curl example in a code block with a Copy button.
  - **Events:** filters (service select, level select, text search over message), and a table (time, service, level, message, incident) of up to 500 rows, newest first, live-appending from `useLive().recentEvents`. Clicking a row opens `EventSheet`, a right-side panel showing the full event JSON fields, its incident (linked) and the reasons as readable chips ("time", "dependency", "signature", "trace"), or "Not part of any incident".

- [ ] **Step 1: Write the failing tests.** Sources: with `api` mocked, uploading a file shows "Imported 1 events · skipped 1 lines · format text". Events: with `getEvents` mocked to return one row with reasons `["time","signature"]`, clicking the row shows the chips "time" and "signature".
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement** the pages.
- [ ] **Step 4: Run** the tests and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): sources and event explorer`.

---

### Task 14: End-to-end demo verification and README

**Files:**
- Create: `README.md`, `.claude/launch.json` (configurations `backend`: `backend/.venv/Scripts/python -m uvicorn jarvis.api:app --port 8000`, cwd `backend`; `frontend`: `npm run dev`, cwd `frontend`, port 5173)
- Modify: whatever the walkthrough shows is broken.

- [ ] **Step 1:** Start both servers. Open `http://localhost:5173` in the browser pane.
- [ ] **Step 2: Scenario A walkthrough.** On Sources, run scenario A at 10x. On the home page, confirm the collapse plays once, the counts show ≥ 15 raw alerts and 1 incident, and the title matches. Open the incident: user-db is red, auth/payment/gateway/frontend are amber, order/notification match the incident's affected list, bank-gateway is grey. Root cause shows High confidence, Impact shows 3 numbers, and Next step shows 2 steps. Replay animates. The report downloads with all sections. Take screenshots at 1440×900 and check that the verdict, impact and first action are visible without scrolling.
- [ ] **Step 3:** Reset and run B, then C. Confirm the roots are auth-service (bad deploy) and bank-gateway (external, with user-db not affected).
- [ ] **Step 4:** Upload a small mixed log file and confirm the skipped count shows. POST one event via the curl example and confirm it appears live in Events.
- [ ] **Step 5:** Check dark mode via `resize_window colorScheme: dark` and a 375 px width, so the sidebar collapses to icons with labels on hover and there is no horizontal page scroll.
- [ ] **Step 6: Write `README.md`** covering what it is, how to run it (two commands), the demo script (scenario A in 90 s), how correlation and RCA work (weights), and the scenario list.
- [ ] **Step 7:** Run the full backend and frontend test suites one last time. Expected: all PASS.
- [ ] **Step 8: Commit** `docs: README and demo verification fixes`.
