import { useEffect, useState } from "react";
import type { Event, Incident, Stats, WsMessage } from "../lib/types";

const MAX_EVENTS = 50;
const RECONNECT_MS = 1000;

export function useLive(): { stats: Stats; incidents: Incident[]; recentEvents: Event[]; connected: boolean } {
  const [stats, setStats] = useState<Stats>({ raw_alerts: 0, incidents: 0, isolated: 0 });
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [recentEvents, setRecentEvents] = useState<Event[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(m.data) as WsMessage;
        } catch {
          return; // ignore malformed frames
        }
        if (msg.type === "events") {
          setRecentEvents((prev) => [...[...msg.events].reverse(), ...prev].slice(0, MAX_EVENTS));
        } else {
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

  return { stats, incidents, recentEvents, connected };
}
