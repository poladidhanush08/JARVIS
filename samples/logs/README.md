# Sample log files for testing J.A.R.V.I.S.

16 files covering every supported format (plain text, JSON Lines, JSON array, CSV), real incident
stories, and boundary cases. Upload them on the **Sources** page, or check all of them at once:

```bash
backend/.venv/Scripts/python samples/logs/check_samples.py
```

That script resets the engine before each file, uploads it to the backend on port 8000, and prints
what was parsed and which incidents formed. `python samples/logs/generate.py` rebuilds the files.

Results below were observed on 2026-11-09 against the running backend.

## Incident stories: does it find the right root cause?

| File | Format | What it simulates | Parsed | Result |
|---|---|---|---|---|
| `01-payment-incident.log` | text | The official scenario as plain app logs: user-db pool runs out, logins, `/checkout` and payments fail, with 3 noise lines and INFO/DEBUG chatter | 24 accepted | 1 incident, root **user-db**, pool exhaustion, 80%. 18 alerts across 7 services; CPU blip, TLS warning and slow bank call stay isolated |
| `02-bad-deploy.jsonl` | JSON Lines | A deploy event, then JWT config errors, login-failure metrics, gateway 5xx, trace ids | 13 accepted | 1 incident, root **auth-service**, bad deploy, 99%. "Logins failing because auth-service had a bad deploy" |
| `03-bank-gateway-outage.json` | JSON array | External bank gateway fails; only payments break | 13 accepted | 1 incident, root **bank-gateway**, external dependency, 80%. user-db's slow query is left out |
| `04-payment-crash.csv` | CSV with JSON cells | payment-service runs out of memory and crash-loops (a critical alert) | 9 accepted, 2 skipped | 1 incident, root **payment-service**, 80%, SEV1. The bad metric cell and the "fatal" level row are skipped |
| `05-two-incidents.jsonl` | JSON Lines | user-db outage, then 20 minutes later an unrelated bank-gateway outage | 12 accepted | **2 separate incidents**, each with its own correct root (user-db, bank-gateway) |
| `09-out-of-order.jsonl` | JSON Lines | Scenario A with the lines shuffled, as if logs arrived late | 10 accepted | **Fails today:** root shown as payment-service (62%), 2 user-db alerts left isolated. Sorting each upload by time fixes it (user-db, 80%, all 10 alerts) |
| `10-excel-bom-crlf.csv` | CSV | Excel export: byte-order mark, Windows line endings, capitalised header, `WARNING` level | 5 accepted | 1 incident, root **user-db**, 80% |
| `16-json-in-a-txt.txt` | JSON Lines in a `.txt` | Wrong file extension; format is detected from the content | 3 accepted | 1 incident, root **user-db** |

Text logs carry no metrics or endpoint tags, so files 01 and 10 show 0 users and 0 payments in
Impact and a "N services degraded" title. The JSON and CSV files carry metrics and show real numbers.

## Boundaries: does it stay calm with bad input?

| File | What it tests | Result |
|---|---|---|
| `06-noise-only.log` | Only INFO/DEBUG chatter and isolated warnings minutes apart | 0 incidents, 4 isolated alerts. No false alarm |
| `07-malformed-mixed.log` | Blank lines, prose, a stack trace, impossible dates, time without date, unknown level `FATAL`, JSON inside a text log, `[ERROR]` brackets, `warning` alias, fractional seconds, leading tab | 6 accepted, 8 skipped, blank lines ignored. The 6 good lines still form 1 user-db incident |
| `08-edge-fields.jsonl` | Field aliases (`ts`, `time`, `msg`), upper-case keys, `+05:30` offsets, naive timestamps, unknown service, unicode, a 2,000-character message, extra fields, numeric-string metric; then 17 bad records: unknown level/type, missing or empty fields, impossible dates, malformed metrics, nested tags, non-object JSON, truncated JSON | 13 accepted, 17 skipped, exactly as designed. Nothing crashes |
| `11-empty.log` | Empty file | 0 accepted, 0 skipped |
| `12-csv-header-only.csv` | CSV with only a header row | 0 accepted, 0 skipped |
| `13-deep-nesting.json` | 100,000 nested brackets (a parser-crash attempt) | 1 skipped, HTTP 200, no crash |
| `14-load-5000.jsonl` | 5,000 events in 25 bursts 310 s apart | All 5,000 accepted in about 0.4 s, giving **25 separate incidents**, each rooted at user-db |
| `15-binary-garbage.log` | 4 KB of random bytes | 0 accepted, 100 skipped, HTTP 200 |

## What the files prove

- **Multiple data sources:** text, JSON Lines, JSON array and CSV all parse, and the format is
  detected from content, not the file name.
- **Correlation:** related alerts merge into one incident, noise stays out, and unrelated outages
  stay separate (files 05 and 14).
- **Root cause:** correct in every story except the shuffled one (09), across 4 different cause
  types: pool exhaustion, bad deploy, external dependency, service crash.
- **Robustness:** bad lines are skipped and counted, never a 500 error. 5,000 events take under half a second.
