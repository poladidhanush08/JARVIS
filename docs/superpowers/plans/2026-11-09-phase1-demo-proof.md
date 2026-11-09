# Phase 1 (demo-proof) build plan

Source: `docs/2026-11-09-upgrade-plan.md`, Phase 1 (items 1.1–1.5). Branch `feat/phase1`.
Global rules: Python 3.12 backend in `backend/`, React/Vite/TS/Tailwind v4 frontend in `frontend/`.
Keep every existing test passing; add tests for every behaviour below. Run backend
`.venv/Scripts/python -m pytest -q` (from backend/), and frontend `npx vitest run`, `npm run lint`, `npm run build`.
Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Contract shared by tasks A and B: workspaces (sessions)

- **Session id format:** `^[A-Za-z0-9_-]{8,64}$`.
- **Sending the id:**
  - REST requests send it in the header `X-Jarvis-Session`.
  - REST also accepts the query parameter `?session=` (for plain links); the header wins if both are present.
  - The WebSocket sends it as `/ws?session=<id>`.
- **No id or an invalid id:** the request uses the workspace named `"default"`. Existing tests and API users (curl,
  `check_samples.py`) keep working unchanged.
- **What a workspace holds:** its own `Engine`, `Hub` and `Simulator`. The simulator broadcasts only to its own hub.
- **Limits:**
  - At most `MAX_WORKSPACES = 50`. Creating one more evicts the least-recently-used non-default workspace.
  - A workspace idle for `WORKSPACE_TTL_S = 1800` s is evicted, checked whenever any request arrives.
  - An evicted workspace has its simulator reset (task cancelled) and its sockets closed.
  - `"default"` is never evicted.
  - "Used" means any REST request or WebSocket message or connection for that id.
- **CORS:** `allow_headers=["*"]` already covers the custom header. Also add `expose_headers` is not needed.
- `GET /api/health` → `{"status": "ok"}`. It needs no session, does no work, and never creates a workspace.

## Task A: backend workspaces + health

**Files:**
- Create `backend/jarvis/workspaces.py`.
- Modify `backend/jarvis/api.py`.
- Add tests in `backend/tests/test_workspaces.py`, plus additions to `test_api.py`.

**`workspaces.py`:**
- `Workspace(id)` dataclass-like class holding `engine`, `hub`, `sim`, `last_used: float`.
- `WorkspaceStore(max_workspaces=50, ttl_s=1800, clock=time.monotonic)` with:
  - `async get(session_id: str | None) -> Workspace`: validates the id, falls back to `"default"`, evicts expired and over-limit workspaces, and touches `last_used`.
  - `__len__`.
- Move `Hub` from api.py into workspaces.py (or keep it in api.py and import it; no cycle). Its behaviour is unchanged.

**`api.py`:**
- `create_app()` owns one `WorkspaceStore`.
- Every endpoint resolves its workspace with a FastAPI dependency reading `X-Jarvis-Session` / `session`.
- `/api/graph` and `/api/scenarios` are session-independent.
- The WebSocket reads `ws.query_params.get("session")`.

**Tests:**
- Two sessions are isolated: starting scenario A in session 1 leaves session 2's stats at 0.
- Events posted with the header land only in that session.
- No header uses the default workspace.
- An invalid id falls back to default.
- TTL eviction uses a fake clock.
- The LRU limit uses `max_workspaces=2`, and default is never evicted.
- An eviction cancels the running simulator, so no further events are ingested.
- The WebSocket with `?session=` only receives its own session's updates.
- `/api/health` returns 200 `{"status":"ok"}` and creates no workspace.

## Task B: frontend session plumbing + error screen + health ping

**Files:**
- Create `frontend/src/lib/session.ts`.
- Modify `frontend/src/lib/api.ts`, `frontend/src/hooks/useLive.ts`, `frontend/src/lib/endpoint.ts` (if needed),
  `frontend/src/pages/Sources.tsx`, `frontend/src/hooks/useBackendReady.ts` and `frontend/src/App.tsx`.
- Create `frontend/src/components/ErrorBoundary.tsx`.

**`session.ts`:**
- `sessionId(): string` returns the id stored in `localStorage["jarvis.session"]`.
- If there is none, or it is invalid, it creates one: `crypto.randomUUID()` with dashes kept (matches the format), with a
  fallback to a random base36 string when `randomUUID` is missing.
- If localStorage throws (private mode), it keeps the id in memory for the page's lifetime.
- Export `SESSION_HEADER = "X-Jarvis-Session"`.

**Other changes:**
- `api.ts` `request()` adds the header to every call. `reportUrl()` appends `?session=<id>`.
- `useLive` connects to `wsUrl()` + `?session=<id>`.
- The Sources curl example adds `-H "X-Jarvis-Session: <id>"`, so pushed events appear on this visitor's dashboard.
  The text next to the example says so.
- `useBackendReady` pings `/api/health` instead of `/api/stats`.
- `ErrorBoundary` is a class component wrapping `<Routes>`. On a render error it shows "Something went wrong" plus a
  short text and a "Reload" button that calls `location.reload()`. It logs to `console.error`.

**Tests:**
- `session.ts`: persistence, invalid stored value replaced, localStorage throwing.
- `api.ts` sends the header (mock fetch).
- `ErrorBoundary` renders the fallback when a child throws.

## Task C: "Run the demo" with live captions

**Files:**
- Create `frontend/src/components/DemoGuide.tsx` and `frontend/src/lib/demo.ts` (pure caption logic).
- Modify `frontend/src/pages/Incidents.tsx`.

**Behaviour:**
- When the home page has no incidents and the simulator is idle or finished, the empty state shows a primary button
  "Run the demo", plus a muted line: "Plays scenario A: a payment platform where logins, slow APIs and failed
  payments share one cause."
- Clicking it calls `simulator.start("a_db_pool", 2)`, stays on the home page, and shows a caption bar above the
  counters.
- The caption comes from live data via `demoCaption(stats, incidents, demoStarted)`. It returns the first that applies:
  1. No anomalous alerts yet: "Starting scenario A…"
  2. Alerts but no incident yet: "{n} alerts arriving from {k} services…" (k = distinct services in `recentEvents`).
  3. An incident exists and fewer than 15 alerts: "Grouping related alerts into one incident…"
  4. Otherwise: "{raw} alerts → 1 incident. Root cause: {service} ({label}, {pct}%)", with a link
     "Open the incident" to `/incidents/{id}`.
- The bar has a dismiss "×" button with aria-label "Close demo captions". It disappears when dismissed or when the
  user navigates away.
- Respects reduced motion: no animation is required, and a 200 ms fade is fine.

**Tests:**
- `demoCaption` covers every branch.
- The Incidents page shows the button on an empty state and calls `simulator.start("a_db_pool", 2)`.

## Task D: phone view of the affected path

**Files:**
- Create `frontend/src/components/AffectedPathList.tsx` and `frontend/src/hooks/useMediaQuery.ts`.
- Modify `frontend/src/pages/IncidentPage.tsx`.

**Behaviour:**
- Below 768 px (`(max-width: 767px)`), the graph card shows a vertical list instead of the React Flow canvas.
- Root first, then impacted services in order of first anomaly, then a muted line: "{n} healthy services not
  involved".
- Each row shows the status dot, the service name in mono, the status word (root cause / impacted), the time of its
  first event as `T+Ns`, and the number of events from that service.
- The list follows the same replay / selected-moment state as the graph. Use the node statuses from `graphElements`,
  so services not yet reached show as "waiting".
- Desktop is unchanged.

**Tests:**
- `AffectedPathList` sets the order and words.
- Replay index hides services that are not yet reached.
- `useMediaQuery` reacts to change events (mock matchMedia).

## Task E: keep-alive

**File:** create `.github/workflows/keep-alive.yml`.

**Behaviour:**
- It runs on `schedule: cron "*/10 * * * *"` and `workflow_dispatch`.
- It runs `curl -fsS --max-time 90 "$URL/api/health"`, retrying up to 3 times.
- `URL` comes from `vars.JARVIS_API_URL`, with a default of `https://jarvis-hv19.onrender.com`.
- Free tier note: one always-awake service uses about 720 of Render's 750 free hours a month.
