import { Pause, Play, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Card from "../components/Card";
import CopyButton from "../components/CopyButton";
import { getScenarios, HttpError, simulator, uploadLog } from "../lib/api";
import type { Scenario, SimulatorStatus, UploadResult } from "../lib/types";

const SPEEDS = [1, 2, 5, 10];
const CURL =
  `curl -X POST http://localhost:8000/api/events -H "Content-Type: application/json" ` +
  `-d '{"service":"user-db","level":"error","message":"connection pool exhausted"}'`;

const btn =
  "inline-flex items-center gap-1 rounded-md border border-line px-3 py-1 text-body hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const primary =
  "inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-body font-semibold text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

function SimulatorCard() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [error, setError] = useState("");

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
        if (alive) setStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const state = status?.state ?? "idle";
  const active = state === "running" || state === "paused";
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const t = setInterval(() => {
      simulator
        .status()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active]);

  const run = async (fn: () => Promise<SimulatorStatus>) => {
    try {
      setStatus(await fn());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    }
  };
  const chooseSpeed = (n: number) => {
    setSpeed(n);
    if (state === "running") void run(() => simulator.speed(n));
  };

  const current = scenarios.find((s) => s.id === scenarioId);
  const statusLine = status
    ? `${state.charAt(0).toUpperCase()}${state.slice(1)} · ${status.emitted} of ${status.total} events`
    : "Idle";

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-body font-semibold">Simulator</h2>
      <label className="flex flex-col gap-1 text-label text-muted">
        Scenario
        <select
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
          disabled={active}
          className="rounded-md border border-line bg-surface px-2 py-1 text-body text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {current && <p className="text-label text-muted">{current.description}</p>}
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
            onClick={() => run(() => simulator.start(scenarioId, speed))}
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
        {active && (
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

function UploadCard() {
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
    } catch (e) {
      setResult(null);
      setError(e instanceof HttpError ? e.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-body font-semibold">Upload logs</h2>
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
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors ${
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

function ApiCard() {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-body font-semibold">API</h2>
      <p className="text-label text-muted">
        Send events with <code className="font-mono">POST http://localhost:8000/api/events</code>
      </p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-canvas p-2 font-mono text-label">
          <code>{CURL}</code>
        </pre>
        <CopyButton text={CURL} what="curl example" />
      </div>
    </Card>
  );
}

export default function SourcesPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-headline font-semibold">Sources</h1>
      <SimulatorCard />
      <UploadCard />
      <ApiCard />
    </div>
  );
}
