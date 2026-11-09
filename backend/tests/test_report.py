from jarvis.report import render_markdown


def test_report_has_all_sections(sample_incident, sample_events):
    md = render_markdown(sample_incident, sample_events)
    for h in ["## Summary", "## Impact", "## Timeline", "## Root cause", "## Recommended actions", "## Follow-ups"]:
        assert h in md
    assert md.startswith("# Logins and payments failing because user-db ran out of connections")
    assert "**Severity:** SEV1 · **Status:** investigating · **Started:** 2026-11-09 10:00:00 UTC" in md
    assert "`kubectl set env deploy/user-db POOL_MAX=400`" in md
    assert "Verify: pool usage below 80%" in md
    assert "auth-service ranked lower" in md


def test_step_without_command_omits_backticks_line(sample_incident, sample_events):
    md = render_markdown(sample_incident, sample_events)
    step4 = md.split("4. ")[1].split("## Follow-ups")[0]
    assert "`" not in step4 and "Verify: load test passes" in step4
