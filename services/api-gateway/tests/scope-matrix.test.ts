import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import {
  brokenRiskStore,
  clientToken,
  openRiskStore,
  safeModeStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let upstream: Upstream;
const app = createApp("test");

const USER_ID = "usr_matrix";

beforeAll(async () => {
  upstream = await startUpstream();
  process.env.USER_SERVICE_URL = upstream.url;
  process.env.RIDE_SERVICE_URL = upstream.url;
  process.env.PAYMENT_SERVICE_URL = upstream.url;
  process.env.NOTIFICATION_SERVICE_URL = upstream.url;
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(() => {
  upstream.received.length = 0;
});

type Mode = "full" | "limited" | "safe" | "limited_and_safe";

/** Distinct client IPs keep the rate limiter out of the way of the matrix. */
let ipCounter = 0;

async function call(
  mode: Mode,
  method: string,
  path: string,
  role = "rider",
): Promise<{ status: number; code: string | undefined }> {
  const inSafeMode = mode === "safe" || mode === "limited_and_safe";
  setIdentityStateStore(
    inSafeMode
      ? safeModeStore(USER_ID, new Date(Date.now() + 60 * 60 * 1000))
      : openRiskStore,
  );

  const token = await clientToken({
    sub: USER_ID,
    role,
    ...(mode === "limited" || mode === "limited_and_safe"
      ? { mode: "limited" as const }
      : {}),
  });

  ipCounter += 1;
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${ipCounter % 250}`,
    },
  };
  if (method !== "GET" && method !== "HEAD") {
    (init as { body?: string }).body = "{}";
  }

  const response = await app.fetch(
    new Request(`http://gateway.test${path}`, init),
  );
  const body = (await response.json()) as { error?: { code?: string } };
  return { status: response.status, code: body.error?.code };
}

interface MatrixCase {
  readonly method: string;
  readonly path: string;
  readonly full: "allow" | "deny";
  readonly limited: "allow" | "deny";
  readonly safe: "allow" | "deny";
}

/**
 * The scope matrix, as the slice states it:
 *   limited mode  — book with cash and view history; no money, no security.
 *   safe mode     — no P2P, no NIP, no PIN / phone / contact change.
 */
const MATRIX: readonly MatrixCase[] = [
  {
    method: "GET",
    path: "/v1/users/me",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/users/me",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/rides/history",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/rides",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/transactions",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/wallets/balance",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/wallets/transfers",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/wallets/nip",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/wallets/topup",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/users/me/pin",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/users/me/phone",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/users/me/contacts",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/devices/enroll",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/auth/step-up/selfie",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  // Undeclared route: limited mode is an allowlist, safe mode is a denylist.
  {
    method: "GET",
    path: "/v1/notifications",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
];

describe("limited mode and wallet safe mode scope matrix", () => {
  for (const testCase of MATRIX) {
    const label = `${testCase.method} ${testCase.path}`;

    it(`${label} — full mode: ${testCase.full}`, async () => {
      const result = await call("full", testCase.method, testCase.path);
      if (testCase.full === "allow") expect(result.status).toBe(200);
      else expect(result.status).toBe(403);
    });

    it(`${label} — limited mode: ${testCase.limited}`, async () => {
      const result = await call("limited", testCase.method, testCase.path);
      if (testCase.limited === "allow") {
        expect(result.status).toBe(200);
      } else {
        expect(result.status).toBe(403);
        expect(result.code).toBe("limited_mode");
      }
    });

    it(`${label} — wallet safe mode: ${testCase.safe}`, async () => {
      const result = await call("safe", testCase.method, testCase.path);
      if (testCase.safe === "allow") {
        expect(result.status).toBe(200);
      } else {
        expect(result.status).toBe(403);
        expect(result.code).toBe("safe_mode_active");
      }
    });
  }

  it("never reaches the upstream service when a request is denied", async () => {
    upstream.received.length = 0;
    const result = await call("limited", "POST", "/v1/wallets/transfers");
    expect(result.status).toBe(403);
    expect(upstream.received).toHaveLength(0);
  });

  it("reports safe mode ahead of limited mode when both are active", async () => {
    const result = await call(
      "limited_and_safe",
      "POST",
      "/v1/wallets/transfers",
    );
    expect(result.status).toBe(403);
    expect(result.code).toBe("safe_mode_active");
  });

  it("still lets a doubly-restricted session book with cash and finish the step-up", async () => {
    expect((await call("limited_and_safe", "POST", "/v1/rides")).status).toBe(
      200,
    );
    expect(
      (await call("limited_and_safe", "POST", "/v1/auth/step-up/selfie"))
        .status,
    ).toBe(200);
  });

  it("refuses a scope the role never had, without blaming a mode", async () => {
    const result = await call("full", "POST", "/v1/drivers/me/status", "rider");
    expect(result.status).toBe(403);
    expect(result.code).toBe("forbidden");
  });

  it("lets a driver do what only a driver may", async () => {
    expect(
      (await call("full", "POST", "/v1/drivers/me/status", "driver")).status,
    ).toBe(200);
    expect(
      (await call("limited", "POST", "/v1/drivers/me/status", "driver")).code,
    ).toBe("limited_mode");
  });

  it("cannot be widened by a token claiming scopes its role does not have", async () => {
    setIdentityStateStore(openRiskStore);
    const token = await clientToken({
      sub: USER_ID,
      role: "rider",
      scopes: ["admin:all", "driver:online", "wallet:transfer:p2p"],
    });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/drivers/me/status", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("fails closed into safe mode when the risk store cannot be read", async () => {
    setIdentityStateStore(brokenRiskStore);
    const token = await clientToken({ sub: USER_ID, role: "rider" });

    const denied = await app.fetch(
      new Request("http://gateway.test/v1/wallets/transfers", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(denied.status).toBe(403);
    expect(
      ((await denied.json()) as { error: { code: string } }).error.code,
    ).toBe("safe_mode_active");

    // Degraded, not down: reading and booking still work.
    const allowed = await app.fetch(
      new Request("http://gateway.test/v1/rides/history", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("lets safe mode lapse on its own once the window has passed", async () => {
    setIdentityStateStore(safeModeStore(USER_ID, new Date(Date.now() - 1_000)));
    const token = await clientToken({ sub: USER_ID, role: "rider" });
    const response = await app.fetch(
      new Request("http://gateway.test/v1/wallets/transfers", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
  });
});
