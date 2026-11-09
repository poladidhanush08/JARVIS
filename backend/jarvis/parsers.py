import csv
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from jarvis.models import Event

_TEXT_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+"
    r"\[?(?P<level>debug|info|warn|warning|error|critical)\]?\s+"
    r"(?P<service>[\w.-]+):?\s+(?P<msg>.+)$",
    re.IGNORECASE,
)

_OPTIONAL_KEYS = ("type", "metric", "trace_id", "tags")


@dataclass
class ParseResult:
    events: list[Event] = field(default_factory=list)
    skipped: int = 0
    format: Literal["jsonl", "json", "csv", "text"] = "text"


def _first_line(content: str) -> str:
    for line in content.splitlines():
        if line.strip():
            return line.strip()
    return ""


def _detect(content: str, filename: str) -> Literal["jsonl", "json", "csv", "text"]:
    first = _first_line(content)
    looks_json = first.startswith(("{", "["))
    if filename.lower().endswith(".csv") or (
        not looks_json and "timestamp" in first.lower() and "," in first
    ):
        return "csv"
    if content.lstrip().startswith("["):
        return "json"
    if first.startswith("{"):
        return "jsonl"
    return "text"


def _pick(record: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if record.get(k) not in (None, ""):
            return record[k]
    return None


def _event_from_record(record: Any) -> Event:
    """Build an Event from a dict of loosely named fields; raises on any problem."""
    if not isinstance(record, dict):
        raise ValueError("record is not an object")
    record = {str(k).strip().lower(): v for k, v in record.items()}
    level = _pick(record, "level")
    if isinstance(level, str):
        level = level.strip().lower()
        if level == "warning":
            level = "warn"
    fields: dict[str, Any] = {
        "timestamp": _pick(record, "timestamp", "ts", "time"),
        "service": _pick(record, "service"),
        "level": level,
        "message": _pick(record, "message", "msg"),
        "source": "log_file",
    }
    for key in _OPTIONAL_KEYS:
        value = record.get(key)
        if value not in (None, ""):
            fields[key] = value
    return Event(**fields)


def _try(record: Any, result: ParseResult) -> None:
    try:
        result.events.append(_event_from_record(record))
    except (ValidationError, ValueError, TypeError):
        result.skipped += 1


def _parse_jsonl(content: str, result: ParseResult) -> None:
    for line in content.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except (ValueError, RecursionError):
            result.skipped += 1
            continue
        _try(record, result)


def _parse_json(content: str, result: ParseResult) -> None:
    try:
        records = json.loads(content)
    except (ValueError, RecursionError):
        result.skipped += 1
        return
    if not isinstance(records, list):
        result.skipped += 1
        return
    for record in records:
        _try(record, result)


def _parse_csv(content: str, result: ParseResult) -> None:
    try:
        for row in csv.DictReader(io.StringIO(content.lstrip("\n\r"))):
            row = {k: v for k, v in row.items() if k is not None}
            for key in ("metric", "tags"):
                cell = row.get(key)
                if cell:
                    try:
                        row[key] = json.loads(cell)
                    except (ValueError, RecursionError):
                        row[key] = None
                        row["__bad__"] = True
            if row.pop("__bad__", False):
                result.skipped += 1
                continue
            _try(row, result)
    except csv.Error:
        result.skipped += 1


def _parse_text(content: str, result: ParseResult) -> None:
    for line in content.splitlines():
        if not line.strip():
            continue
        m = _TEXT_RE.match(line.strip())
        if not m:
            result.skipped += 1
            continue
        _try(
            {
                "timestamp": m["ts"],
                "level": m["level"],
                "service": m["service"],
                "message": m["msg"],
            },
            result,
        )


def parse_log_file(content: str, filename: str) -> ParseResult:
    content = content.removeprefix("\ufeff")
    fmt = _detect(content, filename)
    result = ParseResult(format=fmt)
    {"jsonl": _parse_jsonl, "json": _parse_json, "csv": _parse_csv, "text": _parse_text}[fmt](
        content, result
    )
    return result
