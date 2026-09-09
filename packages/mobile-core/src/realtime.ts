// Resumable event stream: lastSeq → bounded replay (≤ 50) → REST snapshot fallback (launch CLAUDE.md #2).
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getAccessToken } from './session';

export type Envelope<T = unknown> = { seq: number; type: string; occurredAt: string; payload: T };
type Options<S> = { channel: string; snapshotPath: string; reduce: (state: S | undefined, e: Envelope) => S; wsUrl?: string };

export function useResumableStream<S>(opts: Options<S>) {
  const [state, setState] = useState<S | undefined>();
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [asOf, setAsOf] = useState<Date | undefined>();
  const lastSeq = useRef(0);
  const backoff = useRef(1000);

  useEffect(() => {
    let ws: WebSocket | undefined; let closed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = async () => {
      const snap = await api<{ seq: number; state: S }>('GET', opts.snapshotPath);
      lastSeq.current = snap.seq; setState(snap.state); setAsOf(new Date());
    };
    const connect = async () => {
      if (closed) return;
      try { await snapshot(); } catch { setStatus('offline'); }
      const token = await getAccessToken();
      ws = new WebSocket((opts.wsUrl ?? 'wss://rt.ubi.africa/v1/stream') + '?channel=' + encodeURIComponent(opts.channel) + '&lastSeq=' + lastSeq.current + '&token=' + (token ?? ''));
      ws.onopen = () => { setStatus('live'); backoff.current = 1000; };
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data)) as Envelope | { type: 'replay_overflow' };
        if ((e as { type: string }).type === 'replay_overflow') { void snapshot(); return; }
        const env = e as Envelope;
        if (env.seq <= lastSeq.current) return;
        lastSeq.current = env.seq; setAsOf(new Date());
        setState(s => opts.reduce(s, env));
      };
      ws.onclose = () => { if (closed) return; setStatus('reconnecting'); timer = setTimeout(connect, backoff.current + Math.random() * 500); backoff.current = Math.min(backoff.current * 2, 30_000); };
      ws.onerror = () => ws?.close();
    };
    void connect();
    return () => { closed = true; ws?.close(); if (timer) clearTimeout(timer); };
  }, [opts.channel, opts.snapshotPath]);

  return { state, status, asOf };
}
