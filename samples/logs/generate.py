"""Generate the J.A.R.V.I.S. sample log files in this folder.

Run from the repo root:  python samples/logs/generate.py
Every file is deterministic, so re-running produces identical output.
"""

import csv
import io
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DAY = datetime(2026, 11, 9, tzinfo=timezone.utc)


def at(hh: int, mm: int, ss: float) -> datetime:
    return DAY + timedelta(hours=hh, minutes=mm, seconds=ss)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def text_ts(t: datetime) -> str:
    return t.strftime("%Y-%m-%d %H:%M:%S")


def ev(t: datetime, service: str, level: str, message: str, **extra) -> dict:
    record = {"timestamp": iso(t), "service": service, "level": level, "message": message}
    record.update(extra)
    return record


def write(name: str, content: str | bytes) -> None:
    path = HERE / name
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8", newline="")
    print(f"wrote {name}")


def jsonl(records: list) -> str:
    return "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n"


# ---------------------------------------------------------------- 01 text story
def payment_incident_text() -> str:
    """The official scenario as plain application logs (no metrics/tags in text)."""
    rows = [
        (0, "INFO", "auth-service", "login ok user=48213 in 82ms"),
        (0, "WARN", "user-db", "connection pool at 95% (190/200)"),
        (2, "ERROR", "user-db", "connection pool exhausted, waiting for connection"),
        (4, "DEBUG", "payment-service", "heartbeat ok"),
        (5, "ERROR", "auth-service", "DB timeout after 2000ms on user-db"),
        (7, "ERROR", "auth-service", "DB timeout after 2000ms on user-db"),
        (11, "ERROR", "auth-service", "DB timeout after 2000ms on user-db"),
        (12, "ERROR", "user-db", "connection pool exhausted, waiting for connection"),
        (12, "ERROR", "api-gateway", "5xx rate 35% on /login from auth-service"),
        (15, "WARN", "notification-service", "CPU 91% for 30s"),
        (18, "ERROR", "payment-service", "DB timeout after 2000ms on user-db"),
        (22, "WARN", "staging-host-3", "TLS certificate expires in 6 days"),
        (22, "ERROR", "user-db", "connection pool exhausted, waiting for connection"),
        (24, "ERROR", "payment-service", "DB timeout after 2000ms on user-db"),
        (25, "WARN", "api-gateway", "slow responses p95 3100ms on /checkout"),
        (26, "WARN", "api-gateway", "slow responses p95 2900ms on /pay"),
        (27, "ERROR", "web-frontend", "client error spike calling api-gateway"),
        (30, "ERROR", "payment-service", "DB timeout after 2000ms on user-db"),
        (32, "WARN", "order-service", "retries calling payment-service (attempt 3)"),
        (35, "WARN", "bank-gateway", "slow response 1800ms"),
        (40, "WARN", "notification-service", "order event backlog growing; order-service lagging"),
        (42, "ERROR", "web-frontend", "client error spike calling api-gateway"),
        (44, "WARN", "order-service", "retries calling payment-service (attempt 5)"),
        (50, "INFO", "auth-service", "login ok user=99120 in 2410ms"),
    ]
    return "".join(f"{text_ts(at(10, 0, s))} {lvl} {svc}: {msg}\n" for s, lvl, svc, msg in rows)


# ------------------------------------------------------- 02 jsonl bad deploy
def bad_deploy_jsonl() -> str:
    t = lambda s: at(11, 0, s)  # noqa: E731
    login = {"endpoint": "/login"}
    records = [
        ev(t(0), "auth-service", "info", "auth-service v2.3.1", type="deploy", tags={"version": "2.3.1"}),
        ev(t(10), "user-db", "info", "nightly vacuum complete"),
        ev(t(20), "auth-service", "error", "config error: invalid JWT signing key", tags=login, trace_id="req-1001"),
        ev(t(22), "auth-service", "error", "login failures 38%", type="metric",
           metric={"name": "failed_logins", "value": 380}, tags=login),
        ev(t(25), "auth-service", "error", "config error: invalid JWT signing key", tags=login, trace_id="req-1002"),
        ev(t(25), "api-gateway", "error", "5xx rate 41% on /login", type="alert", tags=login, trace_id="req-1002"),
        ev(t(28), "bank-gateway", "warn", "slow response 1700ms"),
        ev(t(30), "auth-service", "error", "config error: invalid JWT signing key", tags=login),
        ev(t(30), "web-frontend", "error", "login page errors calling api-gateway", type="alert"),
        ev(t(32), "auth-service", "error", "login failures 41%", type="metric",
           metric={"name": "failed_logins", "value": 410}, tags=login),
        ev(t(35), "api-gateway", "error", "5xx rate 44% on /login", type="alert", tags=login),
        ev(t(40), "web-frontend", "error", "login page errors calling api-gateway", type="alert"),
        ev(t(42), "auth-service", "error", "login failures 43%", type="metric",
           metric={"name": "failed_logins", "value": 430}, tags=login),
    ]
    return jsonl(records)


# --------------------------------------------------- 03 json array external
def bank_gateway_json() -> str:
    t = lambda s: at(12, 0, s)  # noqa: E731
    pay = {"endpoint": "/pay"}
    records = [
        ev(t(0), "bank-gateway", "error", "health check failing: HTTP 503", type="alert"),
        ev(t(4), "payment-service", "error", "timeout calling bank-gateway after 5000ms", tags=pay),
        ev(t(6), "auth-service", "info", "login success rate normal"),
        ev(t(8), "payment-service", "error", "transaction failures 24%", type="metric",
           metric={"name": "failed_payments", "value": 85}, tags=pay),
        ev(t(10), "payment-service", "error", "timeout calling bank-gateway after 5000ms", tags=pay),
        ev(t(12), "api-gateway", "error", "5xx rate 22% on /pay", type="alert", tags=pay),
        ev(t(15), "bank-gateway", "error", "health check failing: HTTP 503", type="alert"),
        ev(t(15), "user-db", "warn", "slow query 900ms"),
        ev(t(16), "payment-service", "error", "timeout calling bank-gateway after 5000ms", tags=pay),
        ev(t(18), "payment-service", "error", "transaction failures 27%", type="metric",
           metric={"name": "failed_payments", "value": 95}, tags=pay),
        ev(t(22), "api-gateway", "error", "5xx rate 25% on /pay", type="alert", tags=pay),
        ev(t(28), "payment-service", "error", "transaction failures 26%", type="metric",
           metric={"name": "failed_payments", "value": 75}, tags=pay),
        ev(t(30), "bank-gateway", "error", "health check failing: HTTP 503", type="alert"),
    ]
    return json.dumps(records, indent=2) + "\n"


# ------------------------------------------------ 04 csv service crash
CSV_COLS = ["timestamp", "service", "level", "type", "message", "metric", "tags", "trace_id"]


def csv_text(rows: list[dict], cols: list[str] = CSV_COLS, header: list[str] | None = None,
             newline: str = "\n") -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator=newline)
    w.writerow(header or cols)
    for r in rows:
        w.writerow([r.get(c, "") for c in cols])
    return buf.getvalue()


def payment_crash_csv() -> str:
    t = lambda s: iso(at(13, 0, s))  # noqa: E731
    pay = json.dumps({"endpoint": "/pay"})
    rows = [
        {"timestamp": t(0), "service": "payment-service", "level": "error", "type": "log",
         "message": "payment-service out of memory, worker killed", "tags": pay},
        {"timestamp": t(3), "service": "payment-service", "level": "critical", "type": "alert",
         "message": "payment-service pods crash-looping (5 restarts)", "tags": pay},
        {"timestamp": t(6), "service": "order-service", "level": "warn", "type": "log",
         "message": "retries calling payment-service (attempt 2)"},
        {"timestamp": t(8), "service": "api-gateway", "level": "error", "type": "alert",
         "message": "5xx rate 18% on /pay", "tags": pay},
        {"timestamp": t(9), "service": "user-db", "level": "info", "type": "log",
         "message": "vacuum complete"},
        {"timestamp": t(10), "service": "payment-service", "level": "error", "type": "metric",
         "message": "transaction failures 22%", "metric": json.dumps({"name": "failed_payments", "value": 64}),
         "tags": pay},
        {"timestamp": t(14), "service": "web-frontend", "level": "error", "type": "alert",
         "message": "checkout errors calling api-gateway"},
        # boundary rows: both are skipped and counted
        {"timestamp": t(15), "service": "payment-service", "level": "error", "type": "metric",
         "message": "bad metric cell", "metric": "{not json"},
        {"timestamp": t(16), "service": "payment-service", "level": "fatal", "type": "log",
         "message": "unknown level 'fatal'"},
        {"timestamp": t(18), "service": "payment-service", "level": "error", "type": "log",
         "message": "payment-service out of memory, worker killed", "tags": pay},
        {"timestamp": t(20), "service": "order-service", "level": "warn", "type": "log",
         "message": "retries calling payment-service (attempt 4)"},
    ]
    return csv_text(rows)


# ----------------------------------------------- 05 two separate incidents
def two_incidents_jsonl() -> str:
    a = lambda s: at(14, 0, s)  # noqa: E731
    b = lambda s: at(14, 20, s)  # noqa: E731
    login, pay = {"endpoint": "/login"}, {"endpoint": "/pay"}
    records = [
        ev(a(0), "user-db", "warn", "connection pool at 96% (192/200)"),
        ev(a(2), "user-db", "error", "connection pool exhausted, waiting for connection"),
        ev(a(5), "auth-service", "error", "DB timeout after 2000ms on user-db", tags=login),
        ev(a(8), "auth-service", "error", "login failures 30%", type="metric",
           metric={"name": "failed_logins", "value": 300}, tags=login),
        ev(a(12), "api-gateway", "error", "5xx rate 30% on /login", type="alert", tags=login),
        ev(a(15), "user-db", "error", "connection pool exhausted, waiting for connection"),
        ev(a(18), "auth-service", "error", "DB timeout after 2000ms on user-db", tags=login),
        # 20 minutes later, an unrelated outage in a different part of the system
        ev(b(0), "bank-gateway", "error", "health check failing: HTTP 503", type="alert"),
        ev(b(4), "payment-service", "error", "timeout calling bank-gateway after 5000ms", tags=pay),
        ev(b(8), "payment-service", "error", "transaction failures 20%", type="metric",
           metric={"name": "failed_payments", "value": 70}, tags=pay),
        ev(b(12), "api-gateway", "error", "5xx rate 19% on /pay", type="alert", tags=pay),
        ev(b(15), "bank-gateway", "error", "health check failing: HTTP 503", type="alert"),
    ]
    return jsonl(records)


# ------------------------------------------------------- 06 noise only
def noise_only_text() -> str:
    rows = [
        (at(15, 0, 0), "INFO", "auth-service", "login ok user=1 in 80ms"),
        (at(15, 0, 1), "DEBUG", "payment-service", "cache hit ratio 0.97"),
        (at(15, 0, 5), "INFO", "order-service", "order 8812 created"),
        (at(15, 0, 9), "WARN", "staging-host-3", "TLS certificate expires in 6 days"),
        (at(15, 0, 30), "INFO", "user-db", "checkpoint complete"),
        (at(15, 8, 0), "WARN", "notification-service", "CPU 88% for 20s"),
        (at(15, 8, 3), "INFO", "web-frontend", "deployed static assets v412"),
        (at(15, 16, 0), "WARN", "bank-gateway", "slow response 1500ms"),
        (at(15, 24, 0), "ERROR", "legacy-batch", "nightly report job failed: disk quota"),
        (at(15, 24, 5), "INFO", "auth-service", "login ok user=2 in 79ms"),
    ]
    return "".join(f"{text_ts(t)} {lvl} {svc}: {msg}\n" for t, lvl, svc, msg in rows)


# ------------------------------------------------- 07 malformed and mixed
def malformed_text() -> str:
    lines = [
        "2026-11-09 16:00:00 ERROR user-db: connection pool exhausted, waiting for connection",
        "",
        "   ",
        "this line is not a log line at all",
        "2026-11-09 16:00:02 [ERROR] user-db connection pool exhausted, waiting for connection",
        "2026-11-09T16:00:04Z warning auth-service: DB timeout after 2000ms on user-db",
        "2026-11-09 16:00:05.250 error auth-service: DB timeout after 2000ms on user-db",
        "2026-13-45 99:99:99 ERROR user-db: impossible date",
        "16:00:06 ERROR user-db: time without a date",
        "2026-11-09 16:00:07 FATAL user-db: unknown level",
        "2026-11-09 16:00:08 ERROR",
        "Traceback (most recent call last):",
        '  File "app.py", line 42, in handle',
        "{\"timestamp\": \"2026-11-09T16:00:09Z\", \"service\": \"x\", \"level\": \"error\", \"message\": \"json inside a text file\"}",
        "2026-11-09 16:00:10 CRITICAL api-gateway: 5xx rate 50% on /login from auth-service",
        "\t2026-11-09 16:00:11 ERROR auth-service: leading tab is trimmed",
    ]
    return "\n".join(lines) + "\n"


# --------------------------------------------- 08 field-level boundaries
def edge_fields_jsonl() -> str:
    good = [
        {"timestamp": "2026-11-09T17:00:00Z", "service": "user-db", "level": "WARNING", "message": "WARNING is read as warn"},
        {"ts": "2026-11-09T17:00:01Z", "service": "user-db", "level": "Info", "msg": "ts and msg aliases, mixed-case level"},
        {"time": "2026-11-09 17:00:02", "service": "auth-service", "level": "debug", "message": "time alias, naive timestamp read as UTC"},
        {"Timestamp": "2026-11-09T22:30:03+05:30", "Service": "payment-service", "Level": "ERROR", "Message": "uppercase keys, +05:30 offset (17:00:03 UTC)"},
        {"timestamp": "2026-11-09T17:00:04.123456Z", "service": "auth-service", "level": "info", "message": "fractional seconds"},
        {"timestamp": "2026-11-09T17:00:05Z", "service": "legacy-mainframe", "level": "error", "message": "service not in services.yaml"},
        {"timestamp": "2026-11-09T17:00:06Z", "service": "api-gateway", "level": "info", "type": "alert", "message": "alert type counts as anomalous even at info"},
        {"timestamp": "2026-11-09T17:00:07Z", "service": "auth-service", "level": "warn", "type": "metric", "message": "p95 latency 2400ms",
         "metric": {"name": "p95_latency_ms", "value": 2400}, "tags": {"endpoint": "/login", "region": "ap-south-1"}, "trace_id": "req-91c2"},
        {"timestamp": "2026-11-09T17:00:08Z", "service": "auth-service", "level": "info", "type": "deploy", "message": "auth-service v2.4.0"},
        {"timestamp": "2026-11-09T17:00:09Z", "service": "web-frontend", "level": "info", "message": "unicode ünïcödé ✓ 日本語 🚀"},
        {"timestamp": "2026-11-09T17:00:10Z", "service": "web-frontend", "level": "info", "message": "long message " + "x" * 2000},
        {"timestamp": "2026-11-09T17:00:11Z", "service": "order-service", "level": "info", "message": "extra unknown fields are ignored", "host": "ip-10-0-0-7", "pid": 4412},
        {"timestamp": "2026-11-09T17:00:12Z", "service": "order-service", "level": "info", "message": "metric value as a numeric string",
         "type": "metric", "metric": {"name": "queue_depth", "value": "42"}},
    ]
    bad = [
        {"timestamp": "2026-11-09T17:01:00Z", "service": "x", "level": "fatal", "message": "unknown level"},
        {"timestamp": "2026-11-09T17:01:01Z", "service": "x", "level": "error", "type": "trace", "message": "unknown type"},
        {"timestamp": "2026-11-09T17:01:02Z", "service": "x", "level": "error"},
        {"service": "x", "level": "error", "message": "missing timestamp"},
        {"timestamp": "yesterday", "service": "x", "level": "error", "message": "unparseable timestamp"},
        {"timestamp": "2026-13-45T25:61:00Z", "service": "x", "level": "error", "message": "impossible date"},
        {"timestamp": "2026-11-09T17:01:06Z", "level": "error", "message": "missing service"},
        {"timestamp": "2026-11-09T17:01:07Z", "service": "", "level": "error", "message": "empty service"},
        {"timestamp": "2026-11-09T17:01:08Z", "service": "x", "level": "error", "message": "metric without value", "metric": {"name": "cpu"}},
        {"timestamp": "2026-11-09T17:01:09Z", "service": "x", "level": "error", "message": "metric is a string", "metric": "91%"},
        {"timestamp": "2026-11-09T17:01:10Z", "service": "x", "level": "error", "message": "nested tag values", "tags": {"k8s": {"pod": "a"}}},
        [1, 2, 3],
        None,
        "just a string",
        42,
    ]
    lines = [json.dumps(r, ensure_ascii=False) for r in good + bad]
    lines.append('{"timestamp": "2026-11-09T17:01:20Z", "service": "x", "level": "error", "message": "unclosed')
    lines.append("")
    lines.append("not json at all")
    return "\n".join(lines) + "\n"


# --------------------------------------------- 09 out-of-order delivery
def out_of_order_jsonl() -> str:
    t = lambda s: at(18, 0, s)  # noqa: E731
    login, pay = {"endpoint": "/login"}, {"endpoint": "/pay"}
    records = [
        ev(t(0), "user-db", "warn", "connection pool at 95% (190/200)"),
        ev(t(2), "user-db", "error", "connection pool exhausted, waiting for connection"),
        ev(t(5), "auth-service", "error", "DB timeout after 2000ms on user-db", tags=login),
        ev(t(9), "auth-service", "error", "login failures 33%", type="metric",
           metric={"name": "failed_logins", "value": 330}, tags=login),
        ev(t(12), "api-gateway", "error", "5xx rate 33% on /login", type="alert", tags=login),
        ev(t(18), "payment-service", "error", "DB timeout after 2000ms on user-db", tags=pay),
        ev(t(20), "payment-service", "error", "transaction failures 25%", type="metric",
           metric={"name": "failed_payments", "value": 90}, tags=pay),
        ev(t(25), "api-gateway", "warn", "slow responses p95 3000ms on /pay", type="alert", tags=pay),
        ev(t(27), "web-frontend", "error", "client error spike calling api-gateway", type="alert"),
        ev(t(32), "order-service", "warn", "retries calling payment-service (attempt 3)"),
    ]
    random.Random(7).shuffle(records)
    return jsonl(records)


# ------------------------------------------ 10 Excel-style CSV with BOM
def excel_csv() -> bytes:
    t = lambda s: iso(at(19, 0, s))  # noqa: E731
    cols = ["timestamp", "service", "level", "message"]
    header = ["Timestamp", "Service", "Level", "Message"]
    rows = [
        {"timestamp": t(0), "service": "user-db", "level": "WARNING", "message": "connection pool at 97% (194/200)"},
        {"timestamp": t(2), "service": "user-db", "level": "ERROR", "message": "connection pool exhausted, waiting for connection"},
        {"timestamp": t(5), "service": "auth-service", "level": "ERROR", "message": "DB timeout after 2000ms on user-db, retrying"},
        {"timestamp": t(9), "service": "payment-service", "level": "ERROR", "message": "DB timeout after 2000ms on user-db"},
        {"timestamp": t(12), "service": "api-gateway", "level": "ERROR", "message": "upstream auth-service returned 503, 5xx rate 20%"},
    ]
    return ("﻿" + csv_text(rows, cols, header, newline="\r\n")).encode("utf-8")


# ------------------------------------------------------- stress and junk
def deep_nesting_json() -> str:
    return "[" * 100_000 + "\n"


def load_5000_jsonl() -> str:
    """25 independent bursts of 200 events, 310 s apart: 25 incidents."""
    rng = random.Random(42)
    records = []
    templates = [
        ("user-db", "error", "connection pool exhausted, waiting for connection", {}),
        ("auth-service", "error", "DB timeout after 2000ms on user-db", {"endpoint": "/login"}),
        ("payment-service", "error", "DB timeout after 2000ms on user-db", {"endpoint": "/pay"}),
        ("api-gateway", "error", "5xx rate 30% on /login", {"endpoint": "/login"}),
        ("auth-service", "info", "login ok in 90ms", {}),
    ]
    for burst in range(25):
        start = at(20, 0, 0) + timedelta(seconds=310 * burst)
        for i in range(200):
            svc, lvl, msg, tags = templates[0] if i == 0 else rng.choice(templates)
            rec = ev(start + timedelta(milliseconds=250 * i), svc, lvl, msg)
            if tags:
                rec["tags"] = tags
            records.append(rec)
    return jsonl(records)


def binary_garbage() -> bytes:
    return random.Random(13).randbytes(4096)


def json_in_txt() -> str:
    t = lambda s: at(21, 0, s)  # noqa: E731
    return jsonl([
        ev(t(0), "user-db", "error", "connection pool exhausted, waiting for connection"),
        ev(t(3), "auth-service", "error", "DB timeout after 2000ms on user-db"),
        ev(t(6), "payment-service", "error", "DB timeout after 2000ms on user-db"),
    ])


def main() -> None:
    write("01-payment-incident.log", payment_incident_text())
    write("02-bad-deploy.jsonl", bad_deploy_jsonl())
    write("03-bank-gateway-outage.json", bank_gateway_json())
    write("04-payment-crash.csv", payment_crash_csv())
    write("05-two-incidents.jsonl", two_incidents_jsonl())
    write("06-noise-only.log", noise_only_text())
    write("07-malformed-mixed.log", malformed_text())
    write("08-edge-fields.jsonl", edge_fields_jsonl())
    write("09-out-of-order.jsonl", out_of_order_jsonl())
    write("10-excel-bom-crlf.csv", excel_csv())
    write("11-empty.log", "")
    write("12-csv-header-only.csv", "timestamp,service,level,message\n")
    write("13-deep-nesting.json", deep_nesting_json())
    write("14-load-5000.jsonl", load_5000_jsonl())
    write("15-binary-garbage.log", binary_garbage())
    write("16-json-in-a-txt.txt", json_in_txt())


if __name__ == "__main__":
    main()
