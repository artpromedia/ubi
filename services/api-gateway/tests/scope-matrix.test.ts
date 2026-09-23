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
  process.env.ASK_SERVICE_URL = upstream.url;
  process.env.TRAVEL_SERVICE_URL = upstream.url;
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
  // Marketplace: every /v1/mp route is deliberately off the limited-mode
  // allowlist — bids and awards move wallet-held money. Safe mode only denies
  // P2P/NIP and security changes, so full-mode marketplace use survives it.
  {
    method: "GET",
    path: "/v1/mp/quote",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/mp/requests",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/mp/requests/req_123/select",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/mp/requests/req_123/award",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  // The wallet marketplace overview is a read served by payment-service and
  // stays inside the wallet:read family (reads survive limited mode).
  {
    method: "GET",
    path: "/v1/wallet/mp/overview",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  // Ask UBI: the chat and its reads survive limited mode; the confirm that
  // mints a grant, the reconcile that re-drives an execution and the AI
  // marketplace stages do not. Safe mode leaves them all (booking survives it).
  {
    method: "POST",
    path: "/v1/ask/threads",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/threads/thr_1/messages",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/ask/reviews/rvw_1",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/ask/executions/exec_1",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/reviews/rvw_1/confirm",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/executions/exec_1/reconcile",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/mp/quotes",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/mp/reviews",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/ask/mp/requests/req_1/cancel",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  // Mandates: reading them is a profile read; creating or changing standing
  // authority to spend is neither for an unverified device nor during a
  // SIM-swap hold.
  {
    method: "GET",
    path: "/v1/mandates",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/mandates",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "PATCH",
    path: "/v1/mandates/mnd_1",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  // Travel (travel-service): searching and reading your own trips survive
  // limited mode, like ride:read; carts, checkout, cancel and switch move
  // wallet money and do not. Airport transfers ride on mp:request, off the
  // limited-mode allowlist like every /v1/mp route. Safe mode leaves booking
  // alone, as it does for rides.
  {
    method: "GET",
    path: "/v1/travel/trips/trp_1",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/flights/searches",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/stays/searches",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/carts",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "PUT",
    path: "/v1/travel/carts/cart_1/passengers",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/carts/cart_1/checkout",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/orders/ord_1/cancel",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/travel/orders/ord_1/switch",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/reservations",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/reservations",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/reservations/trf_1/cancel",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  // Business travel: organizations (user-service) and their money
  // (payment-service /v1/business). Reads and administration survive safe
  // mode; funding an organization does not; none of it survives limited mode.
  {
    method: "GET",
    path: "/v1/organizations",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/organizations",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/organizations/invitations/inv_1/accept",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "PUT",
    path: "/v1/organizations/org_1/policy",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/business/organizations/org_1/budgets",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "GET",
    path: "/v1/business/bookings/mine",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/business/organizations/org_1/topups",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/business/organizations/org_1/budgets/allocations",
    full: "allow",
    limited: "deny",
    safe: "deny",
  },
  {
    method: "POST",
    path: "/v1/business/organizations/org_1/budgets/returns",
    full: "allow",
    limited: "deny",
    safe: "deny",
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

  describe("marketplace scopes", () => {
    it("lets a driver read the feed and bid, but not a rider", async () => {
      expect((await call("full", "GET", "/v1/mp/feed", "driver")).status).toBe(
        200,
      );
      expect((await call("full", "POST", "/v1/mp/bids", "driver")).status).toBe(
        200,
      );
      const riderFeed = await call("full", "GET", "/v1/mp/feed", "rider");
      expect(riderFeed.status).toBe(403);
      expect(riderFeed.code).toBe("forbidden");
      const riderBid = await call("full", "POST", "/v1/mp/bids", "rider");
      expect(riderBid.status).toBe(403);
      expect(riderBid.code).toBe("forbidden");
    });

    it("refuses a limited-mode driver's bid as a mode restriction", async () => {
      const result = await call("limited", "POST", "/v1/mp/bids", "driver");
      expect(result.status).toBe(403);
      expect(result.code).toBe("limited_mode");
    });

    it("lets a driver manage rate profiles, but not in limited mode", async () => {
      expect(
        (await call("full", "PUT", "/v1/mp/rate-profiles", "driver")).status,
      ).toBe(200);
      expect(
        (await call("limited", "PUT", "/v1/mp/rate-profiles", "driver")).code,
      ).toBe("limited_mode");
    });

    it("keeps Book for Later requester routes to riders", async () => {
      for (const path of [
        "/v1/mp/scheduled-requests",
        "/v1/mp/advance-requests",
        "/v1/mp/recurring-templates",
      ]) {
        expect((await call("full", "POST", path, "rider")).status).toBe(200);
      }
      // Drivers hold mp:request too (DRIVER_SCOPES extends RIDER_SCOPES), so
      // the requester routes stay open to them; a merchant has neither scope.
      const merchant = await call(
        "full",
        "POST",
        "/v1/mp/scheduled-requests",
        "merchant",
      );
      expect(merchant.status).toBe(403);
      expect(
        (await call("full", "GET", "/v1/mp/advance-bookings", "driver")).status,
      ).toBe(200);
      expect(
        (await call("full", "GET", "/v1/mp/advance-bookings", "rider")).status,
      ).toBe(200);
    });

    it("keeps the driver marketplace surfaces to drivers", async () => {
      expect(
        (await call("full", "GET", "/v1/mp/driver/preferences", "driver"))
          .status,
      ).toBe(200);
      expect(
        (await call("full", "PATCH", "/v1/mp/driver/preferences", "driver"))
          .status,
      ).toBe(200);
      expect(
        (await call("full", "GET", "/v1/mp/driver/jobs", "driver")).status,
      ).toBe(200);
      const riderPrefs = await call(
        "full",
        "GET",
        "/v1/mp/driver/preferences",
        "rider",
      );
      expect(riderPrefs.status).toBe(403);
      expect(riderPrefs.code).toBe("forbidden");
      const riderParked = await call(
        "full",
        "POST",
        "/v1/mp/driver/parked",
        "rider",
      );
      expect(riderParked.status).toBe(403);
      expect(
        (await call("limited", "PATCH", "/v1/mp/driver/preferences", "driver"))
          .code,
      ).toBe("limited_mode");
    });

    it("lets a driver open the driver-view under the request family", async () => {
      expect(
        (
          await call(
            "full",
            "GET",
            "/v1/mp/requests/req_123/driver-view",
            "driver",
          )
        ).status,
      ).toBe(200);
    });

    it("reserves the admin monitor for admin tokens", async () => {
      expect(
        (await call("full", "GET", "/v1/admin/mp/requests", "admin")).status,
      ).toBe(200);
      const rider = await call("full", "GET", "/v1/admin/mp/requests", "rider");
      expect(rider.status).toBe(403);
      expect(rider.code).toBe("forbidden");
      const driver = await call(
        "full",
        "GET",
        "/v1/admin/mp/requests",
        "driver",
      );
      expect(driver.status).toBe(403);
      expect(driver.code).toBe("forbidden");
    });

    it("keeps the commission-hold ledger endpoints away from user tokens", async () => {
      for (const role of ["rider", "driver"]) {
        const result = await call(
          "full",
          "POST",
          "/v1/wallet/mp/holds/reserve",
          role,
        );
        expect(result.status).toBe(403);
        expect(result.code).toBe("forbidden");
      }
      expect(
        (await call("full", "POST", "/v1/wallet/mp/holds/reserve", "admin"))
          .status,
      ).toBe(200);
    });

    it("keeps rider funding authorization away from user tokens too", async () => {
      for (const role of ["rider", "driver"]) {
        const result = await call(
          "full",
          "POST",
          "/v1/wallet/mp/funding/authorize",
          role,
        );
        expect(result.status).toBe(403);
        expect(result.code).toBe("forbidden");
      }
      expect(
        (await call("full", "POST", "/v1/wallet/mp/funding/authorize", "admin"))
          .status,
      ).toBe(200);
    });

    it("never reaches the marketplace upstream when a limited-mode bid is denied", async () => {
      upstream.received.length = 0;
      const result = await call("limited", "POST", "/v1/mp/bids", "driver");
      expect(result.status).toBe(403);
      expect(upstream.received).toHaveLength(0);
    });
  });

  describe("travel scopes", () => {
    it("lets riders and drivers search and book travel, but not a merchant", async () => {
      for (const role of ["rider", "driver"]) {
        expect(
          (await call("full", "POST", "/v1/travel/carts", role)).status,
          role,
        ).toBe(200);
        expect(
          (await call("full", "GET", "/v1/travel/orders/ord_1", role)).status,
          role,
        ).toBe(200);
      }
      for (const path of ["/v1/travel/carts", "/v1/travel/flights/searches"]) {
        const merchant = await call("full", "POST", path, "merchant");
        expect(merchant.status, path).toBe(403);
        expect(merchant.code).toBe("forbidden");
      }
    });

    it("refuses a limited-mode checkout as a mode restriction, never reaching travel-service", async () => {
      upstream.received.length = 0;
      const result = await call(
        "limited",
        "POST",
        "/v1/travel/carts/cart_1/checkout",
      );
      expect(result.status).toBe(403);
      expect(result.code).toBe("limited_mode");
      expect(upstream.received).toHaveLength(0);
    });

    it("reserves the travel-ops console for admin tokens", async () => {
      for (const [method, path] of [
        ["GET", "/v1/ops/travel/exceptions"],
        ["POST", "/v1/ops/travel/exceptions/ord_1/actions"],
        ["GET", "/v1/ops/travel/providers/health"],
        ["POST", "/v1/ops/travel/flight-status"],
      ] as const) {
        expect(
          (await call("full", method, path, "admin")).status,
          `${method} ${path}`,
        ).toBe(200);
        for (const role of ["rider", "driver", "merchant"]) {
          const refused = await call("full", method, path, role);
          expect(refused.status, `${role} ${method} ${path}`).toBe(403);
          expect(refused.code).toBe("forbidden");
        }
      }
    });
  });

  describe("business scopes", () => {
    it("keeps organizations and their money to rider and driver accounts", async () => {
      for (const role of ["rider", "driver"]) {
        expect(
          (await call("full", "GET", "/v1/organizations", role)).status,
          role,
        ).toBe(200);
        expect(
          (
            await call(
              "full",
              "POST",
              "/v1/business/organizations/org_1/topups",
              role,
            )
          ).status,
          role,
        ).toBe(200);
      }
      for (const [method, path] of [
        ["GET", "/v1/organizations"],
        ["POST", "/v1/organizations/org_1/invitations"],
        ["GET", "/v1/business/organizations/org_1/funding"],
        ["POST", "/v1/business/organizations/org_1/topups"],
      ] as const) {
        const merchant = await call("full", method, path, "merchant");
        expect(merchant.status, `${method} ${path}`).toBe(403);
        expect(merchant.code).toBe("forbidden");
      }
    });

    it("never reaches payment-service when a safe-mode organization top-up is denied", async () => {
      upstream.received.length = 0;
      const result = await call(
        "safe",
        "POST",
        "/v1/business/organizations/org_1/topups",
      );
      expect(result.status).toBe(403);
      expect(result.code).toBe("safe_mode_active");
      expect(upstream.received).toHaveLength(0);
    });
  });

  describe("ask scopes", () => {
    it("keeps the assistant to riders and drivers", async () => {
      expect(
        (await call("full", "POST", "/v1/ask/threads", "driver")).status,
      ).toBe(200);
      const merchant = await call(
        "full",
        "POST",
        "/v1/ask/threads",
        "merchant",
      );
      expect(merchant.status).toBe(403);
      expect(merchant.code).toBe("forbidden");
    });

    it("never reaches ask-service when a limited-mode confirm is denied", async () => {
      upstream.received.length = 0;
      const result = await call(
        "limited",
        "POST",
        "/v1/ask/reviews/rvw_1/confirm",
      );
      expect(result.status).toBe(403);
      expect(result.code).toBe("limited_mode");
      expect(upstream.received).toHaveLength(0);
    });
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
