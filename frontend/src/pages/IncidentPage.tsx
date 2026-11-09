import { ArrowLeft, FileDown, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AffectedGraph from "../components/AffectedGraph";
import AffectedPathList from "../components/AffectedPathList";
import Card from "../components/Card";
import ImpactCard from "../components/ImpactCard";
import KeyMoments from "../components/KeyMoments";
import NextStepCard from "../components/NextStepCard";
import RootCauseCard from "../components/RootCauseCard";
import SeverityBadge from "../components/SeverityBadge";
import { useLive } from "../hooks/useLive";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { getGraph, getIncident, HttpError } from "../lib/api";
import { relativeTime, tPlus } from "../lib/format";
import { graphLayout } from "../lib/graphLayout";
import { confidenceTrend, needsRefetch } from "../lib/incidentView";
import { buildReport, reportFileName } from "../lib/report";
import type { Event, GraphData, Incident } from "../lib/types";

const REPLAY_STEP_MS = 700;
const CLOCK_MS = 5000;

type Trend = "rising" | "steady";
type Load =
  | { state: "loading" }
  | { state: "notfound" }
  | { state: "error"; message: string }
  | { state: "ready"; incident: Incident; events: Event[]; trend: Trend };

function StatusLine({ incident, trend }: { incident: Incident; trend: Trend }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="text-label text-muted">
      <span className="capitalize">{incident.status}</span> · confidence {trend} · updated{" "}
      {relativeTime(incident.updated_at ?? incident.last_event_time, now)}
    </p>
  );
}

/** Builds the Markdown report in the browser and saves it (works offline). */
function downloadReport(incident: Incident) {
  const blob = new Blob([buildReport(incident)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(incident);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex w-fit items-center gap-1 text-label text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      Incidents
    </Link>
  );
}

/** Steps an index 0..steps-1 every 700 ms after `start()`, then returns to null (live view). */
function useReplay(steps: number) {
  const [index, setIndex] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  const start = useCallback(() => {
    if (steps === 0) return;
    clearInterval(timer.current);
    setIndex(0);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i >= steps) {
        clearInterval(timer.current);
        setIndex(null);
      } else {
        setIndex(i);
      }
    }, REPLAY_STEP_MS);
  }, [steps]);

  return { index, start };
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-headline font-semibold tracking-tight">{title}</h1>
      <p className="text-body text-muted">{detail}</p>
      <BackLink />
    </div>
  );
}

/**
 * Route shell: owns what is shared across incidents (live feed, service graph) and keys the
 * per-incident view by id, so navigating resets its state, replay and timers.
 */
export default function IncidentPage() {
  const { id = "" } = useParams();
  const live = useLive();
  const [graph, setGraph] = useState<GraphData | null>(null);

  useEffect(() => {
    let alive = true;
    getGraph()
      .then((g) => {
        if (alive) setGraph(g);
      })
      .catch(() => {
        /* graph unavailable: the cards still answer the question */
      });
    return () => {
      alive = false;
    };
  }, []);

  return <IncidentView key={id} id={id} graph={graph} liveIncidents={live.incidents} />;
}

function IncidentView({
  id,
  graph,
  liveIncidents,
}: {
  id: string;
  graph: GraphData | null;
  liveIncidents: Incident[];
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const lastConfidence = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const latest = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchIncident = useCallback(async () => {
    const token = ++latest.current;
    // results from an unmounted view or a superseded fetch are dropped
    const current = () => alive.current && token === latest.current;
    inFlight.current = true;
    try {
      const { incident, events } = await getIncident(id);
      if (!current()) return;
      const top = incident.root_cause_candidates[0]?.confidence;
      const trend = confidenceTrend(lastConfidence.current, top);
      lastConfidence.current = top;
      setLoad({ state: "ready", incident, events, trend });
    } catch (err) {
      if (!current()) return;
      if (err instanceof HttpError && err.status === 404) {
        setLoad({ state: "notfound" });
      } else {
        // keep showing the last good copy if a refetch fails
        const message = err instanceof Error ? err.message : String(err);
        setLoad((prev) => (prev.state === "ready" ? prev : { state: "error", message }));
      }
    } finally {
      if (token === latest.current) inFlight.current = false;
    }
  }, [id]);

  useEffect(() => {
    void fetchIncident();
  }, [fetchIncident]);

  const loaded = load.state === "ready" ? load.incident : null;
  const wasLive = useRef(false); // seen in the previous live list, so vanishing means merged away or reset
  useEffect(() => {
    if (inFlight.current) return; // re-checked when the fetch lands and `loaded` changes
    if (needsRefetch(loaded, liveIncidents, wasLive.current)) void fetchIncident();
    wasLive.current = liveIncidents.some((i) => i.id === id);
  }, [id, loaded, liveIncidents, fetchIncident]);

  const replay = useReplay(Math.min(loaded?.key_moments.length ?? 0, 6));
  const [selected, setSelected] = useState<number | null>(null);
  const phone = useMediaQuery("(max-width: 767px)");
  const layout = useMemo(() => (graph && loaded ? graphLayout(graph, loaded) : null), [graph, loaded]);

  if (load.state === "loading") return <p className="text-body text-muted">Loading incident…</p>;
  if (load.state === "notfound") {
    return <Unavailable title="Incident not found" detail="It may have been reset, or the link is out of date." />;
  }
  if (load.state === "error") return <Unavailable title="Could not load this incident" detail={load.message} />;

  const { incident, events, trend } = load;
  const top = incident.root_cause_candidates[0];
  const graphIndex = replay.index ?? selected;

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 lg:h-[calc(100vh-48px)] lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <BackLink />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SeverityBadge severity={incident.severity} />
            <h1 className="min-w-0 break-words text-headline font-semibold leading-tight tracking-tight">
              {incident.title || `Incident ${incident.id}`}
            </h1>
          </div>
          <StatusLine incident={incident} trend={trend} />
        </div>
        <button
          type="button"
          onClick={() => downloadReport(incident)}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-label font-semibold text-ink transition-colors duration-150 ease-out hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          <FileDown size={16} aria-hidden="true" />
          Export report
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <Card className="relative flex min-h-[300px] flex-1 flex-col p-0">
            <div className="flex items-center justify-between gap-4 px-5 pt-4">
              <h2 className="text-label font-semibold uppercase tracking-wide text-muted">
                Dependency graph
                {selected !== null && replay.index === null && (
                  <span className="ml-2 normal-case tracking-normal text-ink">
                    at {incident.key_moments[selected] ? tPlus(incident.key_moments[selected].timestamp, incident.start_time) : ""}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  replay.start();
                }}
                disabled={replay.index !== null || incident.key_moments.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1 text-label font-semibold text-ink transition-colors duration-150 ease-out hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink"
              >
                <Play size={14} aria-hidden="true" />
                {replay.index !== null ? "Replaying…" : "Replay"}
              </button>
            </div>
            {layout && phone ? (
              <AffectedPathList layout={layout} incident={incident} events={events} replayIndex={graphIndex} />
            ) : (
              <div className="min-h-0 flex-1" role="group" aria-label="Affected services graph">
                {layout ? (
                  <AffectedGraph
                    layout={layout}
                    incident={incident}
                    events={events}
                    replayIndex={graphIndex}
                    replaying={replay.index !== null}
                  />
                ) : (
                  <p className="p-5 text-label text-muted">Service graph unavailable.</p>
                )}
              </div>
            )}
          </Card>
          <Card className="shrink-0 px-4 py-3">
            <KeyMoments
              moments={incident.key_moments}
              startTime={incident.start_time}
              rootService={top?.service}
              activeIndex={graphIndex}
              selected={replay.index === null ? selected : null}
              onSelect={setSelected}
            />
          </Card>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto">
          {top ? (
            <RootCauseCard
              key={top.service}
              candidate={top}
              phrase={incident.cause_phrase}
              runnerUp={incident.runner_up_note}
            />
          ) : (
            <Card className="flex flex-col gap-2">
              <h2 className="text-label font-semibold uppercase tracking-wide text-muted">Root cause</h2>
              <p className="text-body text-muted">Still analysing — waiting for more signals.</p>
            </Card>
          )}
          <ImpactCard impact={incident.impact} />
          <NextStepCard recommendations={incident.recommendations} />
        </div>
      </div>
    </div>
  );
}
