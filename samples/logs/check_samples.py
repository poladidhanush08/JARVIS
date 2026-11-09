"""Upload every sample log to a running J.A.R.V.I.S. backend and print the results.

Start the backend first (port 8000), then run from the repo root:
    backend/.venv/Scripts/python samples/logs/check_samples.py
Each file is uploaded into a freshly reset engine, so results don't mix.
"""

import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

# 127.0.0.1, not localhost: on Windows "localhost" tries IPv6 first and adds ~2 s per request.
API = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
HERE = Path(__file__).resolve().parent


def call(method: str, path: str, body: bytes | None = None, ctype: str | None = None):
    req = urllib.request.Request(API + path, data=body, method=method)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def upload(path: Path):
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    return call("POST", "/api/upload", body, f"multipart/form-data; boundary={boundary}")


def main() -> None:
    for path in sorted(HERE.glob("[0-9][0-9]-*")):
        call("POST", "/api/simulator/reset")
        started = time.perf_counter()
        status, res = upload(path)
        ms = (time.perf_counter() - started) * 1000
        print(f"\n== {path.name}  (HTTP {status}, {ms:.0f} ms)")
        if status != 200:
            print(f"   error: {res}")
            continue
        print(f"   format={res['format']} accepted={res['accepted']} skipped={res['skipped']}")
        _, stats = call("GET", "/api/stats")
        print(f"   raw_alerts={stats['raw_alerts']} incidents={stats['incidents']} isolated={stats['isolated']}")
        _, incidents = call("GET", "/api/incidents")
        for inc in incidents[:3]:
            top = inc["root_cause_candidates"][0] if inc["root_cause_candidates"] else {}
            print(f"   {inc['id']} {inc['severity']} | {inc['title']}")
            print(f"      root={top.get('service')} ({top.get('cause_type')}, {top.get('confidence')}%) "
                  f"alerts={len(inc['event_ids'])} services={len(inc['affected_services'])}")
        if len(incidents) > 3:
            print(f"   ... and {len(incidents) - 3} more incidents")
    call("POST", "/api/simulator/reset")


if __name__ == "__main__":
    main()
