import "./env";

/**
 * Real limited-mode tokens through the real scope matrix.
 *
 * tests/scope-matrix.test.ts drives the matrix with hand-built tokens that
 * carry `mode: "limited"` and NO scopes claim, so the gateway's own
 * LIMITED_MODE_SCOPES is the only narrowing. A token user-service actually
 * issues to an unverified device also carries a `scopes` claim — and the
 * gateway intersects with it. Round 6 found the two lists had drifted: the
 * gateway kept the assistant's chat (ask:converse) and travel reads
 * (travel:read) in limited mode, but user-service's claim left them out, so a
 * real limited session lost both.
 *
 * Every token here is minted by user-service's own `issueAccessToken`
 * (services/user-service/src/identity/tokens.ts) with the gateway's client
 * secret, then sent through createApp — auth, identity, scope, proxy — to a
 * recording upstream.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../../user-service/src/identity/tokens";
import { verifyIdentityContext } from "../src/identity/context";
import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import { openRiskStore, startUpstream, type Upstream } from "./helpers";

let upstream: Upstream;
const app = createApp("test");
let ipCounter = 0;

beforeAll(async () => {
  upstream = await startUpstream();
  for (const name of [
    "USER_SERVICE_URL",
    "RIDE_SERVICE_URL",
    "PAYMENT_SERVICE_URL",
    "ASK_SERVICE_URL",
    "TRAVEL_SERVICE_URL",
  ]) {
    process.env[name] = upstream.url;
  }
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(() => {
  upstream.received.length = 0;
  setIdentityStateStore(openRiskStore);
});

async function limitedToken(role: "RIDER" | "DRIVER"): Promise<string> {
  const issued = await issueAccessToken({
    userId: `usr_limited_${role.toLowerCase()}`,
    email: "limited@example.test",
    role,
    mode: "limited",
    deviceId: "dev_unverified",
    sessionId: "ses_limited",
    cityId: "LOS",
  });
  expect(issued.mode).toBe("limited");
  return issued.accessToken;
}

async function send(
  token: string,
  method: string,
  path: string,
): Promise<{ status: number; code: string | undefined }> {
  ipCounter += 1;
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": `10.44.0.${ipCounter % 250}`,
    },
  };
  if (method !== "GET") {
    (init as { body?: string }).body = "{}";
  }
  const response = await app.fetch(
    new Request(`http://gateway.test${path}`, init),
  );
  const body = (await response.json()) as { error?: { code?: string } };
  return { status: response.status, code: body.error?.code };
}

/** What a limited session minted by user-service may and may not reach. */
const LIMITED_CASES: readonly {
  readonly method: string;
  readonly path: string;
  readonly outcome: "allow" | "deny";
  readonly why: string;
}[] = [
  // Restored by this round: the assistant's chat and travel reads.
  {
    method: "POST",
    path: "/v1/ask/threads",
    outcome: "allow",
    why: "ask:converse",
  },
  {
    method: "POST",
    path: "/v1/ask/threads/thr_1/messages",
    outcome: "allow",
    why: "ask:converse",
  },
  {
    method: "GET",
    path: "/v1/ask/executions/exe_1",
    outcome: "allow",
    why: "ask:converse",
  },
  {
    method: "POST",
    path: "/v1/travel/flights/searches",
    outcome: "allow",
    why: "travel:read",
  },
  {
    method: "POST",
    path: "/v1/travel/stays/searches",
    outcome: "allow",
    why: "travel:read",
  },
  {
    method: "GET",
    path: "/v1/travel/orders/ord_1",
    outcome: "allow",
    why: "travel:read",
  },
  {
    method: "GET",
    path: "/v1/reservations",
    outcome: "allow",
    why: "travel:read",
  },
  // Kept all along.
  { method: "POST", path: "/v1/rides", outcome: "allow", why: "cash booking" },
  {
    method: "GET",
    path: "/v1/users/me",
    outcome: "allow",
    why: "profile:read",
  },
  // Still refused: everything that moves money or acts for the user.
  {
    method: "POST",
    path: "/v1/ask/reviews/rvw_1/confirm",
    outcome: "deny",
    why: "ask:transact",
  },
  {
    method: "POST",
    path: "/v1/ask/mp/quotes",
    outcome: "deny",
    why: "mp:request",
  },
  {
    method: "POST",
    path: "/v1/travel/carts",
    outcome: "deny",
    why: "travel:book",
  },
  {
    method: "POST",
    path: "/v1/travel/carts/cart_1/checkout",
    outcome: "deny",
    why: "travel:book",
  },
  {
    method: "POST",
    path: "/v1/travel/orders/ord_1/cancel",
    outcome: "deny",
    why: "travel:book",
  },
  {
    method: "POST",
    path: "/v1/reservations",
    outcome: "deny",
    why: "mp:request",
  },
  {
    method: "POST",
    path: "/v1/wallet/transfers",
    outcome: "deny",
    why: "wallet:transfer:p2p",
  },
  {
    method: "GET",
    path: "/v1/organizations",
    outcome: "deny",
    why: "business:read (deny-by-default)",
  },
  {
    method: "POST",
    path: "/v1/business/organizations/org_1/topups",
    outcome: "deny",
    why: "business:fund",
  },
];

describe("user-service limited-mode tokens through the gateway scope matrix", () => {
  for (const role of ["RIDER", "DRIVER"] as const) {
    for (const testCase of LIMITED_CASES) {
      it(`${role.toLowerCase()} ${testCase.method} ${testCase.path} — ${testCase.outcome} (${testCase.why})`, async () => {
        const token = await limitedToken(role);
        const before = upstream.received.length;
        const result = await send(token, testCase.method, testCase.path);
        if (testCase.outcome === "allow") {
          expect(result.status).toBe(200);
          expect(upstream.received.length).toBe(before + 1);
        } else {
          expect(result.status).toBe(403);
          expect(result.code).toBe("limited_mode");
          expect(upstream.received.length).toBe(before);
        }
      });
    }
  }

  it("signs the restored scopes into the context the services verify, and no money scope", async () => {
    const token = await limitedToken("RIDER");
    const result = await send(token, "POST", "/v1/ask/threads");
    expect(result.status).toBe(200);
    const forwarded = upstream.received.at(-1)?.headers ?? {};
    const context = await verifyIdentityContext(
      forwarded["x-ubi-identity"] ?? "",
    );
    expect(context.modes).toEqual(["limited"]);
    expect(context.scopes).toContain("ask:converse");
    expect(context.scopes).toContain("travel:read");
    for (const moving of [
      "ask:transact",
      "travel:book",
      "mp:request",
      "wallet:transfer:p2p",
      "business:fund",
    ]) {
      expect(context.scopes, moving).not.toContain(moving);
    }
    expect(forwarded["x-ubi-scopes"]?.split(" ")).toEqual([...context.scopes]);
  });
});
