/**
 * Exact config routes (`src/routes/config-read.ts` + `src/routes/config-admin.ts`,
 * DEC-1 = A / CC-B01).
 *
 * 1. The apps read their city's deny-by-default flags and active config through
 *    `GET /v1/config/flags` and `GET /v1/config/cities/{cityId}` (`profile:read`,
 *    kept in `LIMITED_MODE_SCOPES`).
 * 2. The admin policy console's eight exact method + path routes require
 *    `config:admin` — held ONLY by `CONFIG_ADMIN_ROLES`, NEVER surviving
 *    `limited` mode, forwarding `Idempotency-Key` and the signed
 *    `x-ubi-identity` JWS, and surviving a Redis outage so the
 *    `marketplace_rides` kill switch keeps working when Redis is down while
 *    authentication and `limited` mode still fail closed.
 * 3. Every unrouted method or path under `/v1/config` or `/v1/flags` answers
 *    the gateway's own 404 and never reaches `config-service`.
 */
import "./env";

import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyIdentityContext } from "../src/identity/context";
import {
  CONFIG_ADMIN_ROLES,
  LIMITED_MODE_SCOPES,
  ROLE_SCOPES,
  effectiveScopes,
} from "../src/identity/scopes";
import { setIdentityStateStore } from "../src/lib/redis";
import { resetRateLimiter } from "../src/middleware/rate-limit";

import {
  brokenRiskStore,
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let config: Upstream;
const app = createApp("test");
let ipCounter = 0;

beforeAll(async () => {
  config = await startUpstream();
  process.env.CONFIG_SERVICE_URL = config.url;
});

afterAll(async () => {
  await config.close();
});

beforeEach(() => {
  config.received.length = 0;
  setIdentityStateStore(openRiskStore);
});

async function send(
  method: string,
  path: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  ipCounter += 1;
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": `10.88.0.${ipCounter % 250}`,
      ...extraHeaders,
    },
  };
  if (method !== "GET" && method !== "HEAD") {
    (init as { body?: string }).body = JSON.stringify({
      cityId: "LOS",
      enabled: false,
      reason: "incident kill switch probe",
    });
  }
  return app.fetch(new Request(`http://gateway.test${path}`, init));
}

describe("the config read hop", () => {
  it("serves GET /v1/config/flags from config-service's GET /v1/flags, query kept, as the verified caller", async () => {
    const token = await clientToken({
      sub: "usr_flag_reader",
      role: "rider",
      cityId: "LOS",
    });
    const response = await send("GET", "/v1/config/flags?cityId=LOS", token, {
      // Forged identity: stripped before anything reads it, so config-service
      // can neither evaluate as somebody else nor see an admin role.
      "x-user-id": "usr_victim",
      "x-user-role": "config_admin",
      "x-ubi-identity": "forged.context.value",
    });

    expect(response.status).toBe(200);
    expect(config.received).toHaveLength(1);
    const forwarded = config.received[0];
    expect(forwarded?.method).toBe("GET");
    expect(forwarded?.url).toBe("/v1/flags?cityId=LOS");
    expect(forwarded?.headers["x-user-id"]).toBe("usr_flag_reader");
    expect(forwarded?.headers["x-user-role"]).toBe("rider");
    const verified = await verifyIdentityContext(
      forwarded?.headers["x-ubi-identity"] ?? "",
    );
    expect(verified).toMatchObject({
      userId: "usr_flag_reader",
      role: "rider",
    });
    // No internal key crosses: config-service's on-behalf-of door stays shut.
    expect(forwarded?.headers["x-service-key"]).toBeUndefined();
  });

  it("serves GET /v1/config/cities/{cityId} at the same path", async () => {
    const token = await clientToken({ sub: "usr_driver_1", role: "driver" });
    const response = await send("GET", "/v1/config/cities/LOS", token);

    expect(response.status).toBe(200);
    expect(config.received.map((r) => [r.method, r.url])).toEqual([
      ["GET", "/v1/config/cities/LOS"],
    ]);
  });

  it("lets a limited-mode session read its city's flags (an unverified device still renders honestly)", async () => {
    const token = await clientToken({
      sub: "usr_new_device",
      role: "rider",
      mode: "limited",
    });
    const response = await send("GET", "/v1/config/flags?cityId=LOS", token);

    expect(response.status).toBe(200);
    expect(config.received).toHaveLength(1);
    const verified = await verifyIdentityContext(
      config.received[0]?.headers["x-ubi-identity"] ?? "",
    );
    expect(verified.modes).toEqual(["limited"]);
  });
});

describe("the exact config:admin routes (DEC-1 = A, CC-B01)", () => {
  it("grants config:admin ONLY to CONFIG_ADMIN_ROLES and NEVER in LIMITED_MODE_SCOPES", () => {
    expect(LIMITED_MODE_SCOPES).not.toContain("config:admin");
    const holders = Object.entries(ROLE_SCOPES)
      .filter(([, scopes]) => scopes.includes("config:admin"))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual([...CONFIG_ADMIN_ROLES].sort());

    for (const role of CONFIG_ADMIN_ROLES) {
      expect(
        effectiveScopes({ role, modes: ["limited"] }),
        `${role} in limited mode`,
      ).not.toContain("config:admin");
    }
  });

  it.each([
    ["PUT", "/v1/flags/marketplace_rides"],
    ["GET", "/v1/config/cities"],
    ["GET", "/v1/config/cities/LOS/history"],
    ["POST", "/v1/config/cities/status"],
    ["GET", "/v1/config/change-requests?cityId=LOS&status=pending"],
    ["POST", "/v1/config/change-requests"],
    ["POST", "/v1/config/change-requests/cr_1/approve"],
    ["POST", "/v1/config/change-requests/cr_1/reject"],
  ] as const)(
    "forwards %s %s with Idempotency-Key and signed config:admin context for CONFIG_ADMIN_ROLES, and refuses non-admins and limited mode",
    async (method, path) => {
      // 1. Non-config-admin roles (including ops, travel_ops, rider, service) are refused 403 forbidden.
      for (const deniedRole of [
        "rider",
        "driver",
        "ops",
        "travel_ops",
        "service",
      ]) {
        const deniedToken = await clientToken({
          sub: `usr_${deniedRole}`,
          role: deniedRole,
          cityId: "LOS",
        });
        const denied = await send(method, path, deniedToken, {
          "idempotency-key": "idem-denied-0001",
        });
        expect(denied.status, `${deniedRole} ${method} ${path}`).toBe(403);
        expect(config.received).toHaveLength(0);
      }

      // 2. A CONFIG_ADMIN_ROLES holder in limited mode is refused 403 limited_mode.
      const limitedAdminToken = await clientToken({
        sub: "usr_cfg_limited",
        role: "config_admin",
        mode: "limited",
      });
      const limitedRes = await send(method, path, limitedAdminToken, {
        "idempotency-key": "idem-limited-0001",
      });
      expect(limitedRes.status).toBe(403);
      const limitedBody = (await limitedRes.json()) as {
        error?: { code?: string };
      };
      expect(limitedBody.error?.code).toBe("limited_mode");
      expect(config.received).toHaveLength(0);

      // 3. Full-mode config_admin reaches config-service with Idempotency-Key & signed context.
      const adminToken = await clientToken({
        sub: "usr_cfg_admin",
        role: "config_admin",
      });
      const idemKey = `idem-cfg-${method.toLowerCase()}-0001`;
      const ok = await send(method, path, adminToken, {
        "idempotency-key": idemKey,
        "x-user-id": "usr_forged",
        "x-user-role": "super_admin",
      });
      expect(ok.status).toBe(200);
      expect(config.received).toHaveLength(1);
      const arrived = config.received[0];
      expect(arrived?.method).toBe(method);
      expect(arrived?.url).toBe(path);
      expect(arrived?.headers["idempotency-key"]).toBe(idemKey);
      expect(arrived?.headers["x-service-key"]).toBeUndefined();
      const verified = await verifyIdentityContext(
        arrived?.headers["x-ubi-identity"] ?? "",
      );
      expect(verified.userId).toBe("usr_cfg_admin");
      expect(verified.role).toBe("config_admin");
      expect(verified.scopes).toContain("config:admin");
      config.received.length = 0;
    },
  );

  it("keeps the marketplace_rides kill switch working over TCP during a total Redis outage while auth and limited mode fail closed", async () => {
    // Allocate and immediately close a TCP port so REDIS_URL points at a dead Redis.
    const deadPort = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const assigned = (probe.address() as AddressInfo).port;
        probe.close((err) => (err ? reject(err) : resolve(assigned)));
      });
    });

    const prevRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = `redis://127.0.0.1:${deadPort}/0`;
    await resetRateLimiter();
    setIdentityStateStore(brokenRiskStore);

    const tcpServer = serve({
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    await new Promise<void>((resolve) => {
      tcpServer.once("listening", () => resolve());
    });
    const tcpPort = (tcpServer.address() as AddressInfo).port;

    const tcpSend = (headers: Record<string, string>, body: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: tcpPort,
            method: "PUT",
            path: "/v1/flags/marketplace_rides",
            headers: {
              "content-type": "application/json",
              "content-length": String(Buffer.byteLength(body)),
              ...headers,
            },
            agent: false,
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
              text += chunk;
            });
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: text }),
            );
          },
        );
        req.once("error", reject);
        req.end(body);
      });

    try {
      const payload = JSON.stringify({
        cityId: "LOS",
        enabled: false,
        reason: "Emergency kill switch during Redis outage",
      });

      // 1. Auth NEVER fails open during Redis outage: missing/bad token -> 401.
      const unauth = await tcpSend(
        { "idempotency-key": "idem-outage-unauth-01" },
        payload,
      );
      expect(unauth.status).toBe(401);
      expect(config.received).toHaveLength(0);

      // 2. Limited mode NEVER fails open during Redis outage -> 403.
      const limitedToken = await clientToken({
        sub: "usr_ops_limited",
        role: "ops_admin",
        mode: "limited",
      });
      const limited = await tcpSend(
        {
          authorization: `Bearer ${limitedToken}`,
          "idempotency-key": "idem-outage-limited-01",
        },
        payload,
      );
      expect(limited.status).toBe(403);
      expect(config.received).toHaveLength(0);

      // 3. Full-mode ops_admin succeeds (rate limiter fails open, brokenRiskStore
      //    enters wallet_safe mode which preserves config:admin).
      const opsAdminToken = await clientToken({
        sub: "usr_ops_oncall",
        role: "ops_admin",
      });
      const allowed = await tcpSend(
        {
          authorization: `Bearer ${opsAdminToken}`,
          "idempotency-key": "idem-outage-kill-0001",
        },
        payload,
      );
      expect(allowed.status).toBe(200);
      expect(config.received).toHaveLength(1);
      const arrived = config.received[0];
      expect(arrived?.headers["idempotency-key"]).toBe("idem-outage-kill-0001");
      const verified = await verifyIdentityContext(
        arrived?.headers["x-ubi-identity"] ?? "",
      );
      expect(verified.userId).toBe("usr_ops_oncall");
      expect(verified.modes).toEqual(["wallet_safe"]);
      expect(verified.scopes).toContain("config:admin");
    } finally {
      await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
      if (prevRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = prevRedisUrl;
      }
      await resetRateLimiter();
      setIdentityStateStore(openRiskStore);
    }
  });
});

describe("unrouted config and flag paths stay withheld (404)", () => {
  // An admin token, so no scope rule stands between the probe and the router:
  // each 404 below is the ROUTER refusing, not a missing scope.
  it.each([
    ["PUT", "/v1/config/flags"],
    ["POST", "/v1/config/flags"],
    ["DELETE", "/v1/config/flags"],
    ["PUT", "/v1/config/flags/marketplace_rides"],
    ["DELETE", "/v1/flags/marketplace_rides"],
    ["POST", "/v1/flags/marketplace_rides"],
    ["GET", "/v1/flags?cityId=LOS"],
    ["PUT", "/v1/config/cities/LOS"],
    ["GET", "/v1/config/cities/LOS%2Fhistory"],
    ["DELETE", "/v1/config/change-requests/cr_1"],
    ["GET", "/v1/config/openapi.json"],
  ])("%s %s answers the gateway's own 404", async (method, path) => {
    const token = await clientToken({
      sub: "usr_admin_probe",
      role: "admin",
      cityId: "LOS",
    });
    const response = await send(method, path, token, {
      "idempotency-key": "idem-config-probe-0001",
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(config.received).toEqual([]);
  });
});
