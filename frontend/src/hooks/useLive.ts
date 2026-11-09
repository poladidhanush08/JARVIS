import { useEffect, useMemo, useState } from "react";
import type { Event, Incident, Stats, WsMessage } from "../lib/types";
import { wsUrl } from "../lib/endpoint";
import { sessionId } from "../lib/session";

const MAX_EVENTS = 50;
const RECONNECT_MS = 1000;

interface Received {
  event: Event;
  /** Client arrival time (ms). Simulator timestamps drift from the wall clock. */
  at: number;
}

export interface Live {
  stats: Stats;
  incidents: Incident[];
  recentEvents: Event[];
  /** Client arrival time (ms) of each event in `recentEvents`, by event id. */
  receivedAt: ReadonlyMap<string, number>;
  /** Incident ids in the first snapshot frame; null until it arrives. */
  snapshotIds: string[] | null;
  connected: boolean;
}

export function useLive(): Live {
  const [stats, setStats] = useState<Stats>({ raw_alerts: 0, incidents: 0, isolated: 0 });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [received, setReceived] = useState<Received[]>([]);
  const [snapshotIds, setSnapshotIds] = useState<string[] | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`${wsUrl()}?session=${encodeURIComponent(sessionId())}`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(m.data) as WsMessage;
        } catch {
          return; // ignore malformed frames
        }
        if (msg.type === "events") {
          const at = Date.now();
          const fresh = [...msg.events].reverse().map((event) => ({ event, at }));
          setReceived((prev) => [...fresh, ...prev].slice(0, MAX_EVENTS));
        } else {
          if (msg.type === "snapshot") {
            const ids = msg.incidents.map((i) => i.id);
            setSnapshotIds((prev) => prev ?? ids);
          } else if (msg.stats.raw_alerts === 0) {
            setReceived([]); // engine reset
          }
          setStats(msg.stats);
          setIncidents(msg.incidents);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const recentEvents = useMemo(() => received.map((r) => r.event), [received]);
  const receivedAt = useMemo(() => new Map(received.map((r) => [r.event.id, r.at])), [received]);

  return { stats, incidents, recentEvents, receivedAt, snapshotIds, connected };
}
