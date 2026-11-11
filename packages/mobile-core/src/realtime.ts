// Resumable event stream: lastSeq → bounded replay (≤ 50) → REST snapshot fallback (launch CLAUDE.md #2).
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  type Envelope,
  type NormalizedRealtimeFrame,
  normalizeRealtimeMessage,
} from "./realtime-protocol";
import { getAccessToken } from "./session";

export {
  type Envelope,
  type NormalizedRealtimeFrame,
  normalizeRealtimeMessage,
};

export type Options<S = unknown> = {
  channel: string;
  snapshotPath?: string;
  reduce?: (state: S | undefined, e: Envelope) => S;
  onEvent?: (e: Envelope) => void;
  onSnapshot?: () => Promise<{ seq?: number; state?: S } | void> | void;
  enabled?: boolean;
  wsUrl?: string;
};

export function useResumableStream<S = unknown>(opts: Options<S>) {
  const [state, setState] = useState<S | undefined>();
  const [status, setStatus] = useState<
    "connecting" | "live" | "reconnecting" | "offline"
  >("connecting");
  const [asOf, setAsOf] = useState<Date | undefined>();
  const lastSeq = useRef(0);
  const backoff = useRef(1000);
  const callbacksRef = useRef({
    reduce: opts.reduce,
    onEvent: opts.onEvent,
    onSnapshot: opts.onSnapshot,
  });
  callbacksRef.current = {
    reduce: opts.reduce,
    onEvent: opts.onEvent,
    onSnapshot: opts.onSnapshot,
  };

  useEffect(() => {
    if (opts.enabled === false) return;
    if (typeof WebSocket === "undefined") return;
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "test" &&
      !opts.wsUrl &&
      !(globalThis as Record<string, unknown>).__UBI_ENABLE_TEST_WS__
    ) {
      return;
    }

    let ws: WebSocket | undefined;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const snapshot = async () => {
      if (callbacksRef.current.onSnapshot) {
        const res = await callbacksRef.current.onSnapshot();
        if (res && typeof res === "object") {
          if (typeof res.seq === "number") {
            lastSeq.current = res.seq;
          }
          if ("state" in res && res.state !== undefined) {
            setState(res.state);
          }
        }
        setAsOf(new Date());
        return;
      }
      if (!opts.snapshotPath) return;
      const snap = await api<Record<string, unknown>>("GET", opts.snapshotPath);
      if (typeof snap.seq === "number") {
        lastSeq.current = snap.seq;
      }
      setState("state" in snap ? (snap.state as S) : (snap as unknown as S));
      setAsOf(new Date());
    };

    const connect = async () => {
      if (closed) return;
      try {
        await snapshot();
      } catch {
        setStatus("offline");
      }
      if (closed) return;
      let token: string | null | undefined;
      try {
        token = await getAccessToken();
      } catch {
        token = null;
      }
      if (closed) return;
      try {
        ws = new WebSocket(
          (opts.wsUrl ?? "wss://rt.ubi.africa/v1/stream") +
            "?channel=" +
            encodeURIComponent(opts.channel) +
            "&lastSeq=" +
            lastSeq.current +
            "&token=" +
            encodeURIComponent(token ?? ""),
        );
      } catch {
        setStatus("offline");
        return;
      }
      ws.onopen = () => {
        setStatus("live");
        backoff.current = 1000;
      };
      ws.onmessage = (m) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(m.data));
        } catch {
          return;
        }
        const normalized = normalizeRealtimeMessage(parsed);
        if (normalized.kind === "heartbeat") {
          try {
            ws?.send(
              JSON.stringify({
                type: "heartbeat_ack",
                payload: { timestamp: Date.now() },
              }),
            );
          } catch {
            // ignore send failure
          }
          return;
        }
        if (normalized.kind === "replay_overflow") {
          void snapshot();
          return;
        }
        if (normalized.kind !== "event") {
          return;
        }
        const env = normalized.envelope;
        if (env.seq > 0) {
          if (env.seq <= lastSeq.current) return;
          if (lastSeq.current > 0 && env.seq - lastSeq.current > 50) {
            void snapshot();
            return;
          }
          lastSeq.current = env.seq;
        }
        setAsOf(new Date());
        if (callbacksRef.current.reduce) {
          setState((s) => callbacksRef.current.reduce!(s, env));
        }
        callbacksRef.current.onEvent?.(env);
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        timer = setTimeout(connect, backoff.current + Math.random() * 500);
        backoff.current = Math.min(backoff.current * 2, 30_000);
      };
      ws.onerror = () => ws?.close();
    };
    void connect();
    return () => {
      closed = true;
      ws?.close();
      if (timer) clearTimeout(timer);
    };
  }, [opts.channel, opts.snapshotPath, opts.enabled, opts.wsUrl]);

  return { state, status, asOf };
}
