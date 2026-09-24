// Wire-level test harness for the rider's A02/A03 screens. Unlike installFixtures (which
// intercepts inside api() and never sees headers), this lets the REAL @ubi/mobile-core
// api() build every request — method, path, query, JSON body and the Idempotency-Key
// header — and stubs only global fetch, the network itself. A route answer of "offline"
// throws exactly what React Native's fetch throws with no network. Flags come over the
// same wire (GET /v1/config/flags), exactly as FlagsProvider reads them in the app.
import { installFixtures } from "@ubi/mobile-core";

export type WireCall = {
  method: string;
  /** Path without the query string. */
  path: string;
  /** Decoded query parameters. */
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
};
export type WireReply = { status: number; json?: unknown } | "offline";
export type WireRoute = (call: WireCall) => WireReply | undefined;

export function installWire(
  route: WireRoute,
  flags: Record<string, boolean> = {},
): { calls: WireCall[]; writes: () => WireCall[] } {
  // Make sure no fixture handler short-circuits the production boundary.
  installFixtures(async () => undefined);
  const calls: WireCall[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const full = String(url).replace(/^https?:\/\/[^/]+/, "");
    const [path, qs = ""] = full.split("?");
    const query: Record<string, string> = {};
    for (const pair of qs.split("&").filter(Boolean)) {
      const [k, v = ""] = pair.split("=");
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    const call: WireCall = {
      method: String(init.method ?? "GET"),
      path,
      query,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply: WireReply =
      call.method === "GET" && path === "/v1/config/flags"
        ? { status: 200, json: flags }
        : (route(call) ?? {
            status: 404,
            json: { code: "not_found", message: "no route for " + path },
          });
    if (reply === "offline") throw new TypeError("Network request failed");
    const text = reply.json === undefined ? "" : JSON.stringify(reply.json);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: "",
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return {
    calls,
    writes: () =>
      calls.filter((c) => c.method !== "GET" && c.path !== "/v1/config/flags"),
  };
}

export const NGN = (amountMinor: number) => ({ amountMinor, currency: "NGN" });
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
export const refusal = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): WireReply => ({ status, json: { code, message, details } });
