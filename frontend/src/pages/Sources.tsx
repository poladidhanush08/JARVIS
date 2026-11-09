import { Pause, Play, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/Card";
import CopyButton from "../components/CopyButton";
import { getEvents, getScenarios, HttpError, simulator, uploadLog } from "../lib/api";
import { publicApiOrigin } from "../lib/endpoint";
import type { Event, Scenario, SimulatorStatus, UploadResult } from "../lib/types";

const SPEEDS = [1, 2, 5, 10];
const COUNT_LIMIT = 100_000;
const EVENTS_ENDPOINT = `${publicApiOrigin()}/api/events`;
const CURL =
  `curl -X POST ${EVENTS_ENDPOINT} -H "Content-Type: application/json" ` +
  `-d '{"service":"user-db","level":"error","message":"connection pool exhausted"}'`;

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-body hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const primary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-body font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

function CardHeader({ title, detail, count }: { title: string; detail: string; count: number | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-label text-muted">{detail}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end" title="events from this source currently held by the engine">
        <span className="text-title font-semibold leading-none tabular-nums">{count === null ? "—" : count.toLocaleString()}</span>
        <span className="text-label text-muted">events received</span>
      </div>
    </div>
  );
}

function SimulatorCard({ received, onActivity }: { received: number | null; onActivity: () => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const lastEmitted = useRef<number | null>(null);
  const apply = useCallback((s: SimulatorStatus, seedScenario = false) => {
    setStatus(s);
    if (s.emitted !== lastEmitted.current) {
      lastEmitted.current = s.emitted;
      onActivity();
    }
    if (s.state !== "idle") {
      setSpeed(s.speed);
      if (seedScenario && s.scenario) setScenarioId(s.scenario);
    }
  }, [onActivity]);

  useEffect(() => {
    let alive = true;
    getScenarios()
      .then((s) => {
        if (!alive) return;
        setScenarios(s);
        setScenarioId((cur) => cur || s[0]?.id || "");
      })
      .catch(() => {
        if (alive) setError("Could not load scenarios.");
      });
    simulator
      .status()
      .then((s) => {
        if (alive) apply(s, true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [apply]);

  const state = status?.state ?? "idle";
  const active = state === "running" || state === "paused";
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const t = setInterval(() => {
      simulator
        .status()
        .then((s) => {
          if (alive) apply(s);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active, apply]);

  const run = async (fn: () => Promise<SimulatorStatus>): Promise<boolean> => {
    try {
      apply(await fn());
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      return false;
    }
  };
  // Go to Incidents so the collapse plays where it can be seen.
  const play = async () => {
    if (await run(() => simulator.start(scenarioId, speed))) navigate("/");
  };
  const chooseSpeed = (n: number) => {
    setSpeed(n);
    if (active) void run(() => simulator.speed(n));
  };

  const statusLine =
    status && status.total > 0
      ? `${state.charAt(0).toUpperCase()}${state.slice(1)} · ${status.emitted} of ${status.total} events`
      : status
        ? `${state.charAt(0).toUpperCase()}${state.slice(1)}`
        : "Idle";

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title="Simulator" detail="Replays a scripted incident as live events" count={received} />
      <div role="radiogroup" aria-label="Scenario" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {scenarios.map((sc, i) => {
          const checked = sc.id === scenarioId;
          return (
            <button
              key={sc.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={active && !checked}
              onClick={() => setScenarioId(sc.id)}
              className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
                checked ? "border-accent bg-accent/8" : "border-line bg-surface-2 hover:border-muted/50"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-md border text-label font-semibold ${checked ? "border-accent text-accent" : "border-line text-muted"}`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-body font-semibold">{sc.name}</span>
              </span>
              <span className="text-label text-muted">{sc.description}</span>
            </button>
          );
        })}
      </div>
      <div role="group" aria-label="Speed" className="flex items-center gap-2">
        <span className="text-label text-muted">Speed</span>
        {SPEEDS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={speed === n}
            onClick={() => chooseSpeed(n)}
            className={`rounded-md border px-2 py-0.5 text-label focus-visible:outline-2 focus-visible:outline-accent ${
              speed === n ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:border-accent"
            }`}
          >
            {n}x
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!active && (
          <button
            type="button"
            className={primary}
            disabled={!scenarioId}
            onClick={play}
          >
            <Play size={14} aria-hidden="true" />
            Play
          </button>
        )}
        {state === "running" && (
          <button type="button" className={btn} onClick={() => run(simulator.pause)}>
            <Pause size={14} aria-hidden="true" />
            Pause
          </button>
        )}
        {state === "paused" && (
          <button type="button" className={primary} onClick={() => run(simulator.resume)}>
            <Play size={14} aria-hidden="true" />
            Resume
          </button>
        )}
        {(active || state === "finished") && (
          <button type="button" className={btn} onClick={() => run(simulator.reset)}>
            <RotateCcw size={14} aria-hidden="true" />
            Reset
          </button>
        )}
      </div>
      <p className="text-label text-muted" aria-live="polite">
        {statusLine}
      </p>
      {error && <p className="text-label text-muted">{error}</p>}
    </Card>
  );
}

function UploadCard({ received, onActivity }: { received: number | null; onActivity: () => void }) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setResult(await uploadLog(file));
      setError("");
      onActivity();
    } catch (e) {
      setResult(null);
      setError(e instanceof HttpError ? e.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [onActivity]);

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title="Log upload" detail="Import a log file; each line becomes an event" count={received} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors ${
          over ? "border-accent bg-accent/10" : "border-line"
        }`}
      >
        <p className="text-body text-muted">Drop a log file here</p>
        <button type="button" className={btn} disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} aria-hidden="true" />
          Choose file
        </button>
        <input
          ref={input}
          type="file"
          aria-label="Log file"
          accept=".log,.txt,.json,.jsonl,.csv"
          className="hidden"
          onChange={(e) => {
            void send(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="text-label text-muted">.log, .txt, .json, .jsonl or .csv</p>
      </div>
      {error && (
        <p className="text-body text-muted" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="text-body" role="status">
            Imported {result.accepted} events · skipped {result.skipped} lines · format {result.format}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-label">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-1 pr-3 font-semibold">Time</th>
                  <th className="py-1 pr-3 font-semibold">Service</th>
                  <th className="py-1 pr-3 font-semibold">Level</th>
                  <th className="py-1 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.slice(0, 5).map((ev) => (
                  <tr key={ev.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-1 pr-3">{ev.service}</td>
                    <td className="py-1 pr-3">{ev.level}</td>
                    <td className="py-1">{ev.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function ApiCard({ received }: { received: number | null }) {
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title="REST API" detail="Push events from any system" count={received} />
      <p className="text-label text-muted">
        Send events with <code className="font-mono">POST {EVENTS_ENDPOINT}</code>
      </p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed">
          <code>{CURL}</code>
        </pre>
        <CopyButton text={CURL} what="curl example" />
      </div>
    </Card>
  );
}

type Counts = Record<Event["source"], number>;

/** Events per source, counted from the engine's event list (refreshed on activity). */
function useSourceCounts() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const alive = useRef(true);
  const refresh = useCallback(() => {
    getEvents({ limit: COUNT_LIMIT })
      .then((rows) => {
        if (!alive.current) return;
        const c: Counts = { simulator: 0, log_file: 0, api: 0 };
        for (const r of rows) c[r.event.source] = (c[r.event.source] ?? 0) + 1;
        setCounts(c);
      })
      .catch(() => {
        /* counts unavailable: cards show a dash */
      });
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  return { counts, refresh };
}

export default function SourcesPage() {
  const { counts, refresh } = useSourceCounts();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline font-semibold tracking-tight">Sources</h1>
        <p className="text-label text-muted">Three ways in. Everything lands in the same correlation engine.</p>
      </div>
      <SimulatorCard received={counts?.simulator ?? null} onActivity={refresh} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UploadCard received={counts?.log_file ?? null} onActivity={refresh} />
        <ApiCard received={counts?.api ?? null} />
      </div>
    </div>
  );
}
