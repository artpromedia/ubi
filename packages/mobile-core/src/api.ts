// The ONLY production boundary. Fixtures (src/dev/fixtures in each app) register handlers through installFixtures(); never import them from screens.
import { getAccessToken } from './session';

export type Money = { amountMinor: number; currency: string };
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
type Handler = (input: { method: string; path: string; body?: unknown }) => Promise<{ status: number; json: unknown } | undefined>;
let fixtureHandler: Handler | undefined;
export function installFixtures(h: Handler) { if (__DEV__) fixtureHandler = h; }

let base = 'https://api.ubi.africa';
export function configureApi(opts: { baseUrl: string }) { base = opts.baseUrl; }

function newIdempotencyKey(): string {
  return 'idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: { idempotent?: boolean; idempotencyKey?: string } = {}): Promise<T> {
  if (fixtureHandler) {
    const r = await fixtureHandler({ method, path, body });
    if (r) { if (r.status >= 400) { const e = r.json as { code?: string; message?: string }; throw new ApiError(r.status, e?.code ?? 'error', e?.message ?? 'fixture error', r.json); } return r.json as T; }
  }
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (opts.idempotent || method === 'POST') headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) { const e = (json ?? {}) as { code?: string; message?: string; details?: unknown }; throw new ApiError(res.status, e.code ?? 'http_' + res.status, e.message ?? res.statusText, e.details ?? json); }
  return json as T;
}

// Server-sent events for Ask threads. RN fetch lacks streaming on some versions — use react-native-sse (or XHR progressive) in RN-01; this shape is what screens consume.
export type SseEvent = { type: string; [k: string]: unknown };
export function openEventStream(path: string, body: unknown, onEvent: (e: SseEvent) => void, onDone: (err?: Error) => void): () => void {
  let closed = false;
  (async () => {
    try {
      if (fixtureHandler) { const r = await fixtureHandler({ method: 'SSE', path, body }); const events = (r?.json as SseEvent[]) ?? []; for (const e of events) { if (closed) return; onEvent(e); await new Promise(res => setTimeout(res, 120)); } onDone(); return; }
      const token = await getAccessToken();
      const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: token ? 'Bearer ' + token : '' }, body: JSON.stringify(body) });
      const text = await res.text(); // TODO(RN-01): replace with incremental reader
      for (const chunk of text.split('\n\n')) { const line = chunk.split('\n').find(l => l.startsWith('data:')); if (line && !closed) onEvent(JSON.parse(line.slice(5))); }
      onDone();
    } catch (e) { onDone(e as Error); }
  })();
  return () => { closed = true; };
}
