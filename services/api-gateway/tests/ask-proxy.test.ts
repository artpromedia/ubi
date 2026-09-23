/**
 * The `/v1/ask/*` proxy to ask-service (recheck P01: the assistant had no
 * route through the gateway, so no client could reach it).
 *
 * Same pattern as every other proxy: the client's identity headers are
 * stripped, the bearer token is verified, and the gateway's OWN signed
 * `x-ubi-identity` context plus its city claims (`x-auth-city-id`,
 * `x-ubi-city-id`) cross the wire. ask-service mounts its routes under `/v1`
 * itself, so the path crosses unchanged. The streamed message turn
 * (text/event-stream) passes through as it came. `/v1/mandates` reaches
 * user-service's `/mandates` for the automation editor.
 */
import "./env";

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { type AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyIdentityContext } from "../src/identity/context";
import { setIdentityStateStore } from "../src/lib/redis";
import { IDENTITY_HEADER } from "../src/middleware/identity";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let upstream: Upstream;
let sseServer: Server;
let sseUrl: string;
let sseRequests: { url: string; headers: Record<string, string> }[] = [];
const app = createApp("test");

const SSE_BODY =
  'event: token\ndata: {"type":"token","text":"Here are your offers"}\n\n' +
  'event: review_ready\ndata: {"type":"review_ready","reviewId":"rvw_1","reviewKind":"marketplace"}\n\n' +
  'event: done\ndata: {"type":"done"}\n\n';

beforeAll(async () => {
  upstream = await startUpstream();
  process.env.USER_SERVICE_URL = upstream.url;
  process.env.ASK_SERVICE_URL = upstream.url;

  // A second real upstream that answers like the streamed message turn.
  sseServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[name] = value;
    }
    sseRequests.push({ url: req.url ?? "/", headers });
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(SSE_BODY);
    });
  });
  await new Promise<void>((resolve) => {
    sseServer.listen(0, "127.0.0.1", resolve);
  });
  sseUrl = `http://127.0.0.1:${(sseServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await upstream.close();
  await new Promise<void>((resolve, reject) => {
    sseServer.closeAllConnections();
    sseServer.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  upstream.received.length = 0;
  sseRequests = [];
  process.env.ASK_SERVICE_URL = upstream.url;
  setIdentityStateStore(openRiskStore);
});

let ip = 0;
function nextIp(): string {
  ip += 1;
  return `10.9.0.${ip % 250}`;
}

describe("the /v1/ask proxy", () => {
  it("reaches ask-service at the same path with the gateway's signed identity and city", async () => {
    const token = await clientToken({
      sub: "usr_asker",
      role: "rider",
      cityId: "LOS",
    });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/ask/threads", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-forwarded-for": nextIp(),
          // Forged by the client: every one must be replaced or dropped.
          "x-user-id": "usr_victim",
          "x-auth-city-id": "ACC",
          "x-ubi-city-id": "ACC",
          [IDENTITY_HEADER]: "forged.context.token",
        },
        body: JSON.stringify({ source: "home" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    const forwarded = upstream.received[0];
    // ask-service mounts /v1/ask itself: the version prefix is kept.
    expect(forwarded?.url).toBe("/v1/ask/threads");
    expect(forwarded?.headers["x-user-id"]).toBe("usr_asker");
    expect(forwarded?.headers["x-auth-city-id"]).toBe("LOS");
    expect(forwarded?.headers["x-ubi-city-id"]).toBe("LOS");

    const context = await verifyIdentityContext(
      forwarded?.headers[IDENTITY_HEADER] as string,
    );
    expect(context.userId).toBe("usr_asker");
    expect(context.cityId).toBe("LOS");
    expect(context.scopes).toEqual(
      expect.arrayContaining(["ask:converse", "ask:transact", "mp:request"]),
    );
  });

  it("forwards the confirm's idempotency key and the limited-mode scopes", async () => {
    const token = await clientToken({ sub: "usr_asker", role: "rider" });
    await app.fetch(
      new Request("http://gateway.test/v1/ask/reviews/rvw_1/confirm", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_confirm_0001",
          "x-forwarded-for": nextIp(),
        },
        body: JSON.stringify({ termsVersion: "t" }),
      }),
    );
    expect(upstream.received[0]?.url).toBe("/v1/ask/reviews/rvw_1/confirm");
    expect(upstream.received[0]?.headers["idempotency-key"]).toBe(
      "idem_confirm_0001",
    );

    // A limited-mode session still chats, but its context carries no
    // marketplace or transact scope for ask-service to act on.
    const limited = await clientToken({
      sub: "usr_new_device",
      role: "rider",
      mode: "limited",
    });
    await app.fetch(
      new Request("http://gateway.test/v1/ask/threads/thr_1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${limited}`,
          "content-type": "application/json",
          "x-forwarded-for": nextIp(),
        },
        body: JSON.stringify({ text: "hi" }),
      }),
    );
    const context = await verifyIdentityContext(
      upstream.received[1]?.headers[IDENTITY_HEADER] as string,
    );
    expect(context.modes).toContain("limited");
    expect(context.scopes).toContain("ask:converse");
    expect(context.scopes).not.toContain("mp:request");
    expect(context.scopes).not.toContain("ask:transact");
  });

  it("refuses an unauthenticated caller before ask-service", async () => {
    const response = await app.fetch(
      new Request("http://gateway.test/v1/ask/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": nextIp(),
          "x-user-id": "usr_victim",
          "x-user-role": "rider",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(upstream.received).toHaveLength(0);
  });

  it("passes the streamed message turn through as text/event-stream", async () => {
    process.env.ASK_SERVICE_URL = sseUrl;
    const token = await clientToken({ sub: "usr_asker", role: "rider" });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/ask/threads/thr_1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-forwarded-for": nextIp(),
        },
        body: JSON.stringify({ text: "find me a driver" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe(SSE_BODY);
    expect(sseRequests[0]?.url).toBe("/v1/ask/threads/thr_1/messages");
    expect(sseRequests[0]?.headers.accept).toBe("text/event-stream");
  });

  it("reaches user-service's /mandates for the automation editor", async () => {
    const token = await clientToken({ sub: "usr_asker", role: "rider" });
    await app.fetch(
      new Request("http://gateway.test/v1/mandates", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-forwarded-for": nextIp(),
        },
      }),
    );
    expect(upstream.received[0]?.url).toBe("/mandates");
    expect(upstream.received[0]?.headers[IDENTITY_HEADER]).toBeTruthy();
  });
});
