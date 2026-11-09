from jarvis.parsers import parse_log_file


def test_text_lines():
    r = parse_log_file("2026-11-09 10:00:05 ERROR auth-service: DB timeout after 2000ms on user-db\n", "app.log")
    assert r.format == "text" and len(r.events) == 1
    e = r.events[0]
    assert (e.service, e.level, e.source) == ("auth-service", "error", "log_file")


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


def test_json_array_counts_bad_elements():
    content = '[{"time":"2026-11-09T10:00:00Z","service":"a","level":"info","message":"ok"}, {"service":"a"}, 5]'
    r = parse_log_file(content, "x.json")
    assert r.format == "json" and len(r.events) == 1 and r.skipped == 2


def test_jsonl_optional_fields_and_bad_line():
    content = (
        '\n{"timestamp":"2026-11-09T10:00:00Z","service":"s","level":"info","message":"m",'
        '"type":"metric","metric":{"name":"cpu","value":91.5},"trace_id":"t1","tags":{"k":"v"}}\n'
        "{broken\n"
    )
    r = parse_log_file(content, "x.log")
    assert r.format == "jsonl" and r.skipped == 1
    e = r.events[0]
    assert e.type == "metric" and e.metric.value == 91.5 and e.trace_id == "t1" and e.tags == {"k": "v"}


def test_csv_skips_invalid_rows_and_text_naive_is_utc():
    r = parse_log_file("timestamp,service,level,message\nnope,a,info,m\n,\n", "a.csv")
    assert r.events == [] and r.skipped == 1
    t = parse_log_file("2026-11-09 10:00:05 info svc msg", "a.log")
    assert t.events[0].timestamp.utcoffset().total_seconds() == 0
