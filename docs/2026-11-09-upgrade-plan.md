# J.A.R.V.I.S. upgrade plan: from working demo to winning prototype

Live: https://jarvis-one-beta-97.vercel.app (frontend, Vercel) + https://jarvis-hv19.onrender.com (API, Render free).
Written 2026-11-09 after testing the live site on desktop (1440×900) and phone (375 px).

## Where we stand

All 7 judged features work on the live site: data sources, correlation, root cause, impact,
timeline, recommendations, dashboard. 16 sample log files pass, including shuffled order and
garbage input. The engine handles 5,000 events in about 0.4 s.

**Fixed today** (branch `fix/live-site-bugs`, not deployed yet):

| Bug on the live site | Fix |
|---|---|
| Key moments overlapped into unreadable text on phones | Fixed-width moments that scroll sideways |
| Dependency graph cut off on phones | Graph zooms out to fit and refits on resize |
| Unknown address showed a blank page | "Page not found" page with a link home |
| When Render's free server was asleep the app looked broken for up to a minute, and Sources gave up | "Waking up the analysis engine…" banner, automatic retries, page recovers on its own |

**Risks found that are not bugs in the code but will hurt a demo:**

1. **Everyone shares one engine.** I saw another visitor's run while testing. If two judges open
   the link at once, one pressing Play or Reset wipes the other's screen.
2. **Cold start.** The free Render plan sleeps after 15 idle minutes, so the first visitor waits up
   to a minute. Now handled gracefully, but still a wait.
3. **Confidence is almost always 80%.** It doesn't move, so it says little.
4. **On phones the graph is complete but tiny.** It is readable only with pinch-zoom.

## Plan

Effort: S = under 1 hour, M = 1–3 hours, L = half a day or more.

### Phase 1: demo-proof (do before judging)

| # | Change | Why it matters | Effort |
|---|---|---|---|
| 1.1 | **Keep-alive ping**: a free UptimeRobot monitor hits `/api/health` every 10 min | Removes the cold start; zero code risk | S |
| 1.2 | **Private workspace per visitor**: a session id in the browser; the backend keeps one engine per session (max 50, idle ones dropped after 30 min) | Judges can't collide; anyone can press Reset safely | M |
| 1.3 | **"Run the demo" button** on the empty home page: plays scenario A at 2x with short captions ("30 alerts arriving…", "grouped into 1 incident", "root cause: user-db, 80%") | A judge can understand the product with zero instructions | M |
| 1.4 | **Error boundary + `/api/health`**: a friendly "something went wrong, reload" screen instead of a blank page | No dead screens in front of judges | S |
| 1.5 | **Phone view of the affected path**: below 768 px, show the graph as a vertical list (root → impacted services, with status words) instead of a tiny canvas | Readable on a phone without zooming | M |

### Phase 2: features that win the criteria

| # | Change | Criterion it strengthens | Effort |
|---|---|---|---|
| 2.1 | **AI incident summary**: Claude writes a 3-sentence plain-English summary from the evidence list only, cached per incident; the current template is the fallback if no key or offline | Root cause + report: "understandable incident report" | M |
| 2.2 | **Scenario D, two simultaneous incidents**: unrelated failures at the same time produce 2 separate incidents | Correlation: proves grouping is real, not "everything in the time window" | S |
| 2.3 | **Meaningful confidence**: scale by the lead over the runner-up (clear winner → 90%+, close call → 50–60%) and say why | Root cause credibility | S |
| 2.4 | **Incident lifecycle**: Acknowledge and Resolve buttons, time to resolve, resolved state in green | Dashboard realism; uses the unused "recovered" colour | M |
| 2.5 | **Alert-rate sparkline** on the timeline: alerts per 5 s, with the incident start marked | Timeline: shows the storm visually | S |
| 2.6 | **Baseline anomaly detection for metrics**: flag a metric when it jumps far above its own recent average, not only by log level | Correlation realism; answers "how do you detect, not just group?" | M |
| 2.7 | **Discovered dependencies**: learn caller → callee edges from shared trace ids and draw them dashed on the graph | Root cause on services missing from the map | L |

### Phase 3: production-grade (after the hackathon, or if judges ask "is it real?")

| # | Change | Effort |
|---|---|---|
| 3.1 | Persistence (SQLite, then Postgres) so a restart keeps incidents; 7-day event retention | L |
| 3.2 | Ingest security: API keys for `POST /api/events` and uploads, 5 MB upload cap, rate limits, WebSocket origin check | M |
| 3.3 | Integrations: Prometheus Alertmanager webhook, generic JSON webhook mapping, Slack message when an incident opens | M |
| 3.4 | CI on GitHub Actions: pytest, vitest, lint and build on every pull request; Vercel preview per PR | S |
| 3.5 | Monitoring: structured JSON logs, Sentry for frontend and backend errors | S |
| 3.6 | Scale: bounded event memory (ring buffer), root-cause ranking without scanning all events | M |
| 3.7 | Paid Render instance ($7/month) instead of the keep-alive ping | S (config) |

### UI polish, in parallel with the phases above

- Loading skeletons instead of empty cards while data loads.
- "Copy link" button on the incident page, for sharing with a teammate.
- Home: show the last resolved incident under the list, so a quiet dashboard doesn't look empty.
- Accessibility pass: focus order, keyboard access to graph nodes, contrast check of muted text.

## Recommended order

If judging is within a day: **1.1 → 1.2 → 1.3 → 1.4 → 2.2 → 2.3 → 2.1 → 1.5**. That is about one
working day, and covers both demo risks plus the three most visible upgrades. Everything in
Phase 3 can be described in the pitch as "next steps" rather than built.

Each item ships separately: build on a branch, run all tests, check it in the browser, then merge
to `main` (which redeploys Vercel and Render automatically).

## Open questions

1. **When is judging?** This decides how much of Phase 2 fits.
2. **AI summary (2.1):** use the Claude API? It needs an API key in Render's settings and costs a
   few cents per demo.
3. **Keep-alive (1.1):** use a free UptimeRobot ping, or pay $7/month for an always-on Render instance?
