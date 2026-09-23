// Wire-level test harness for screens that POST trip/booking state. Unlike
// installFixtures (which intercepts inside api() and never sees headers), this lets the
// REAL @ubi/mobile-core api() build the request — method, path, JSON body and the
// Idempotency-Key header — and stubs only global fetch, the network itself. A route
// answer of "offline" throws exactly what React Native's fetch throws with no network.
import { installFixtures } from "@ubi/mobile-core";

export type WireCall = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};
export type WireReply = { status: number; json?: unknown } | "offline";

export function installWire(route: (call: WireCall) => WireReply | undefined): {
  calls: WireCall[];
  writes: () => WireCall[];
} {
  // Make sure no fixture handler short-circuits the production boundary.
  installFixtures(async () => undefined);
  const calls: WireCall[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: WireCall = {
      method: String(init.method ?? "GET"),
      path: String(url).replace(/^https?:\/\/[^/]+/, ""),
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = route(call) ?? {
      status: 404,
      json: { code: "not_found", message: "no route for " + call.path },
    };
    if (reply === "offline") throw new TypeError("Network request failed");
    const text = reply.json === undefined ? "" : JSON.stringify(reply.json);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: "",
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return { calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

export const NGN = (amountMinor: number) => ({ amountMinor, currency: "NGN" });
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
