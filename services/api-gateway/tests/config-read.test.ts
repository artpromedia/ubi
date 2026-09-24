/**
 * The read-only config family (src/routes/config-read.ts).
 *
 * The apps read their city's deny-by-default flags and active config through
 * the gateway. Only those two GETs cross to config-service; its flag flip,
 * change requests, approvals, city status and history — and every other
 * method on the two read paths — answer the gateway's own 404 and never reach
 * it. What does cross carries the gateway's verified identity, never the
 * client's, because config-service evaluates flags for x-user-id and
 * authorizes its admin routes on x-user-role.
 *
 * tests/route-contract.test.ts pins the same paths against config-service's
 * generated route manifest.
 */
import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyIdentityContext } from "../src/identity/context";
import { setIdentityStateStore } from "../src/lib/redis";

import {
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
      enabled: true,
      reason: "probe",
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

describe("nothing else under config reaches config-service", () => {
  // An admin token, so no scope rule stands between the probe and the router:
  // each 404 below is the ROUTER refusing, not a missing scope.
  it.each([
    ["PUT", "/v1/config/flags"],
    ["POST", "/v1/config/flags"],
    ["DELETE", "/v1/config/flags"],
    ["PUT", "/v1/config/flags/marketplace_rides"],
    ["PUT", "/v1/flags/marketplace_rides"],
    ["GET", "/v1/flags?cityId=LOS"],
    ["GET", "/v1/config/cities"],
    ["POST", "/v1/config/cities/status"],
    ["PUT", "/v1/config/cities/LOS"],
    ["GET", "/v1/config/cities/LOS/history"],
    ["GET", "/v1/config/cities/LOS%2Fhistory"],
    ["POST", "/v1/config/change-requests"],
    ["POST", "/v1/config/change-requests/cr_1/approve"],
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
