# Phase 2a build plan: meaningful confidence, every alert collapses, alert-rate chart

Branch `feat/phase2a`. Same rules as Phase 1:
- Keep every existing test passing; update only expectations these changes deliberately alter.
- Add tests for each behaviour below.
- Backend: `.venv/Scripts/python -m pytest -q` (from backend/). Frontend: `npx vitest run`, `npm run lint`,
  `npm run build` (from frontend/). All must pass with pristine output.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Task E: confidence that means something (backend + root-cause card)

**Problem:** `RootCauseCandidate.confidence` is the raw evidence score
(`min(99, round(100 * (0.35 first + 0.30 graph + 0.20 change + 0.15 own)))`). Every clear winner shows a flat 80% or
99% no matter how close the runner-up is. Today's numbers:
- A: user-db 80, auth-service 49, payment-service 48
- B: auth-service 99, api-gateway 57
- C: bank-gateway 80, payment-service 52
- D: 99 / 58 and 80 / 52

**Change (in `backend/jarvis/rca.py` and `models.py`):**
- Add `score: int` to `RootCauseCandidate`. It holds exactly today's raw value (same formula, 0–99) and is the
  "evidence score".
- `confidence` becomes how decisively the candidate wins: a softmax over all candidates' raw scores (0–1 floats,
  before rounding) with temperature factor `K = 10`.
  - `p_i = exp(K*s_i) / Σ_j exp(K*s_j)`, then `confidence = min(99, round(100 * p_i))`.
  - With a single candidate (nothing to compare against), `confidence = score`.
- Sort candidates by `(-score, service)`. This is the same order as softmax, kept explicit.
- Keep the module constants named: `CONFIDENCE_TEMPERATURE = 10`.
- Expected results (assert them in `test_scenarios.py`):
  - A: user-db 85–92 (High)
  - B: auth-service ≥ 95
  - C: bank-gateway 88–96
  - D: logins ≥ 95, payments 88–96
  - A constructed close call (top 0.60 vs runner-up 0.55, two candidates) gives Medium (50–74).
  - Compute the real values and pin exact numbers in tests once known.
- `runner_up_note` is unchanged.

**Frontend (`types.ts`, `RootCauseCard.tsx`):**
- Mirror `score` in the TS types.
- In the expanded "Show evidence" section, add one line below the factor bars:
  `"Evidence score {score}/100 · next best: {runner-up service} {score}/100"`. Omit the "next best" part when
  there's no runner-up. The candidates list is already on the incident.
- The ring and label keep using `confidence`.
- Update `RootCauseCard` tests.

## Task F: every alert visibly joins its incident (home page)

**Problem:**
- `CollapseStream` only flies cards when a *new* incident id appears. After that, alerts join the existing incident
  silently, so the "many alerts → one incident" moment shows only 2–3 cards.
- The engine promotes an incident at 3 alerts; don't change that.

**Change (in `frontend/src/components/CollapseStream.tsx` and `frontend/src/lib/collapse.ts`):**
- A pending card flies into an incident row as soon as its event id appears in **any listed incident's
  `event_ids`**, whether the incident is new or existing.
- **Minimum dwell (`MIN_DWELL_MS = 600`):** a card must have been visible this long before it may fly, so it is
  seen even when the `events` and `update` frames arrive back to back. Queue absorbed cards until their dwell has
  passed.
- **Visible cap (`MAX_VISIBLE_CARDS = 8`):** at most this many pending cards on screen. When more arrive, the
  oldest absorbed ones fly first. Unabsorbed overflow cards wait off-screen with a muted line "+N more arriving".
- **Flight timing:**
  - Per card: 300 ms, ease-out.
  - Stagger: at most 120 ms per card within one batch.
  - Total per batch: at most 2 s. Reuse the existing measured-slide approach; no new animation library.
- **Kept behaviour:**
  - The receiving row gets the existing flash, at most once per 600 ms per row.
  - Excluded cards (still ungrouped after the 10 s window) still turn grey, are labelled "excluded", and move aside.
- **Reduced motion:** no flight; absorbed cards are simply removed.
- **Snapshot rule:** incidents present in the first WS snapshot never trigger flights for events that arrived
  before the snapshot. Keep the `snapshotIds` seeding.
- **Tests (pure helper and component; fake timers, mocked getBoundingClientRect):**
  - A card absorbed into an *existing* incident flies.
  - Dwell is respected: no flight before 600 ms.
  - The cap holds, including the "+N more arriving" line.
  - Reduced motion removes cards with no flight.
  - Unmount leaves no timers.
  - All existing CollapseStream tests still pass, or are updated only where the old "new incident only" rule is the
    thing being changed.

## Task G: alert-rate chart (incident page)

**Change:**
- A compact sparkline **inside the Key moments card header, right-aligned**: about 180×32 px, so the page still fits
  1440×900 with no scrolling.
- **Data:** anomalous events (warn/error/critical or type alert) of this incident, bucketed per 5 s from the
  incident's first event to its last event, inclusive. Put the bucketing in a pure function in
  `frontend/src/lib/alertRate.ts`: `alertRate(events, startIso, bucketS = 5) -> { t: number; count: number }[]`.
- **Visual:**
  - Thin bars in the neutral muted colour.
  - The bucket containing the first anomaly gets the red root colour, and nothing else is coloured.
  - A visible label to the left: `"Alerts / 5 s"`, plus `"peak {n} at T+{s}s"`.
  - A `title` on the chart explaining it: "anomalous alerts in this incident, per 5-second window".
  - It follows the replay / selected moment: buckets after the shown moment are drawn at 35% opacity.
- **Accessibility:** `role="img"` with an `aria-label` summarising
  `"{total} alerts over {duration}s, peaking at {n} around T+{s}s"`.
- **Before drawing:** load and follow the `dataviz` skill for the chart's styling rules.
- **Tests:**
  - `alertRate` bucketing: boundaries, empty input, non-anomalous events ignored, out-of-order input.
  - The sparkline renders the right number of bars, the peak label, and dims buckets after the selected moment.
