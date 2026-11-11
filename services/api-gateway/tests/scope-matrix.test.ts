import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp, parseCorsOrigins } from "../src/app";
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
  process.env.FLEET_SERVICE_URL = upstream.url;
  process.env.GROWTH_SERVICE_URL = upstream.url;
  process.env.CONFIG_SERVICE_URL = upstream.url;
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
    cityId: "LOS",
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
    path: "/v1/push/devices",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "DELETE",
    path: "/v1/push/devices",
    full: "allow",
    limited: "allow",
    safe: "allow",
  },
  {
    method: "DELETE",
    path: "/v1/push/devices/fcm_tok_1",
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
  // Fleet staff routes (fleet-service): reads and writes survive safe mode
  // (no P2P, NIP or security change is involved); none survives limited mode.
  {
    method: "GET",
    path: "/v1/fleets/flt_1/calendar",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/fleets/flt_1/maintenance",
    full: "allow",
    limited: "deny",
    safe: "allow",
  },
  {
    method: "POST",
    path: "/v1/fleets",
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

  describe("fleet scopes", () => {
    it("lets rider and driver accounts act as fleet staff, but not a merchant", async () => {
      for (const role of ["rider", "driver"]) {
        expect(
          (await call("full", "GET", "/v1/fleets", role)).status,
          role,
        ).toBe(200);
        expect(
          (await call("full", "POST", "/v1/fleets/flt_1/off-road", role))
            .status,
          role,
        ).toBe(200);
      }
      for (const [method, path] of [
        ["GET", "/v1/fleets/flt_1/calendar"],
        ["POST", "/v1/fleets/flt_1/assignments/propose"],
      ] as const) {
        const merchant = await call("full", method, path, "merchant");
        expect(merchant.status, `${method} ${path}`).toBe(403);
        expect(merchant.code).toBe("forbidden");
      }
    });

    it("keeps the driver's fleet routes to drivers", async () => {
      for (const [method, path] of [
        ["GET", "/v1/drivers/me/fleet-offers"],
        ["POST", "/v1/fleet-offers/fap_1/sign"],
        ["POST", "/v1/fleet-offers/fap_1/decline"],
        ["GET", "/v1/drivers/me/fleet"],
        ["POST", "/v1/drivers/me/fleet/terminate"],
        ["GET", "/v1/drivers/me/schedule"],
        ["POST", "/v1/drivers/me/availability:preview"],
        ["PUT", "/v1/drivers/me/availability"],
        ["GET", "/v1/drivers/me/conflicts/fcf_1"],
      ] as const) {
        expect(
          (await call("full", method, path, "driver")).status,
          `driver ${method} ${path}`,
        ).toBe(200);
        const rider = await call("full", method, path, "rider");
        expect(rider.status, `rider ${method} ${path}`).toBe(403);
        expect(rider.code).toBe("forbidden");
      }
    });

    it("refuses a limited-mode PIN signature as a mode restriction, never reaching fleet-service", async () => {
      upstream.received.length = 0;
      const result = await call(
        "limited",
        "POST",
        "/v1/fleet-offers/fap_1/sign",
        "driver",
      );
      expect(result.status).toBe(403);
      expect(result.code).toBe("limited_mode");
      expect(upstream.received).toHaveLength(0);
    });

    it("leaves the driver's other /drivers/me routes on their owners", async () => {
      expect(
        (await call("full", "GET", "/v1/drivers/me/status", "driver")).status,
      ).toBe(200);
      expect(upstream.received.at(-1)?.url).toContain("/v1/drivers/me/status");
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
    const token = await clientToken({
      sub: USER_ID,
      role: "rider",
      cityId: "LOS",
    });
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

  it("answers 409 city_selection_required on city-scoped routes when a user token carries no cityId, while letting city picker, profile, and admin through", async () => {
    setIdentityStateStore(openRiskStore);
    const citylessDriver = await clientToken({
      sub: "usr_cityless_driver",
      role: "driver",
    });

    for (const [method, path] of [
      ["POST", "/v1/drivers/me/status"],
      ["POST", "/v1/drivers/me/locations"],
      ["GET", "/v1/mp/feed"],
      ["POST", "/v1/rides"],
      ["GET", "/v1/fleets"],
    ] as const) {
      ipCounter += 1;
      const res = await app.fetch(
        new Request(`http://gateway.test${path}`, {
          method,
          headers: {
            authorization: `Bearer ${citylessDriver}`,
            "content-type": "application/json",
            "x-forwarded-for": `10.99.0.${ipCounter % 250}`,
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
      );
      expect(res.status, `${method} ${path}`).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, `${method} ${path}`).toBe(
        "city_selection_required",
      );
    }

    // Non-city-scoped routes (city picker, logout, profile, active ride read, flags) still pass
    for (const [method, path] of [
      ["POST", "/v1/auth/city"],
      ["POST", "/v1/auth/logout"],
      ["GET", "/v1/users/me"],
      ["GET", "/v1/rides/active"],
      ["GET", "/v1/config/flags"],
    ] as const) {
      ipCounter += 1;
      const res = await app.fetch(
        new Request(`http://gateway.test${path}`, {
          method,
          headers: {
            authorization: `Bearer ${citylessDriver}`,
            "content-type": "application/json",
            "x-forwarded-for": `10.99.1.${ipCounter % 250}`,
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
      );
      expect(res.status, `${method} ${path}`).toBe(200);
    }

    // Admin cross-city tokens without cityId are not blocked
    const adminToken = await clientToken({ sub: "usr_admin", role: "admin" });
    ipCounter += 1;
    const adminRes = await app.fetch(
      new Request("http://gateway.test/v1/fleets", {
        method: "GET",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "x-forwarded-for": `10.99.2.${ipCounter % 250}`,
        },
      }),
    );
    expect(adminRes.status).toBe(200);
  });

  it("grants super_admin and specialist ops roles their console scopes in full mode while blocking limited mode", async () => {
    expect(
      (await call("full", "GET", "/v1/admin/mp/requests", "super_admin"))
        .status,
    ).toBe(200);
    expect(
      (await call("full", "GET", "/v1/ops/travel/exceptions", "super_admin"))
        .status,
    ).toBe(200);
    expect(
      (await call("limited", "GET", "/v1/admin/mp/requests", "super_admin"))
        .code,
    ).toBe("limited_mode");
    expect(
      (await call("limited", "POST", "/v1/auth/logout", "super_admin")).status,
    ).toBe(200);

    // ops_admin reaches mp admin and travel ops, but never internal holds (admin:all)
    expect(
      (await call("full", "GET", "/v1/admin/mp/requests", "ops_admin")).status,
    ).toBe(200);
    expect(
      (await call("full", "GET", "/v1/ops/travel/exceptions", "ops_admin"))
        .status,
    ).toBe(200);
    expect(
      (await call("full", "POST", "/v1/wallet/mp/holds", "ops_admin")).code,
    ).toBe("forbidden");

    // travel_ops reaches travel ops, but not marketplace admin
    expect(
      (await call("full", "GET", "/v1/ops/travel/exceptions", "travel_ops"))
        .status,
    ).toBe(200);
    expect(
      (await call("full", "GET", "/v1/admin/mp/requests", "travel_ops")).code,
    ).toBe("forbidden");

    // config:admin routes (CC-B01): config_admin, ops_admin, admin, super_admin in full/safe mode only; never ops, never limited mode
    for (const role of ["config_admin", "ops_admin", "admin", "super_admin"]) {
      expect(
        (await call("full", "PUT", "/v1/flags/marketplace_rides", role)).status,
      ).toBe(200);
      expect(
        (await call("safe", "PUT", "/v1/flags/marketplace_rides", role)).status,
      ).toBe(200);
      expect(
        (await call("limited", "PUT", "/v1/flags/marketplace_rides", role))
          .code,
      ).toBe("limited_mode");
    }
    expect(
      (await call("full", "PUT", "/v1/flags/marketplace_rides", "ops")).code,
    ).toBe("forbidden");

    // finance:ops routes (CC-B03, DEC-6 = C): finance_ops, ops_admin, admin, super_admin in full mode; denied in limited mode and denied to ops / config_admin / rider / driver
    for (const role of ["finance_ops", "ops_admin", "admin", "super_admin"]) {
      for (const [method, path] of [
        ["GET", "/v1/ops/wallet-credits"],
        ["POST", "/v1/ops/wallet-credits"],
        ["GET", "/v1/ops/wallet-credits/ocrd_1"],
        ["POST", "/v1/ops/wallet-credits/ocrd_1/approve"],
        ["POST", "/v1/ops/wallet-credits/ocrd_1/reject"],
        ["POST", "/v1/ops/wallet-credits/ocrd_1/reverse"],
      ] as const) {
        expect((await call("full", method, path, role)).status).toBe(200);
        expect((await call("limited", method, path, role)).code).toBe(
          "limited_mode",
        );
      }
    }
    for (const role of ["ops", "config_admin", "rider", "driver", "merchant"]) {
      expect(
        (await call("full", "POST", "/v1/ops/wallet-credits", role)).code,
      ).toBe("forbidden");
      expect(
        (
          await call(
            "full",
            "POST",
            "/v1/ops/wallet-credits/ocrd_1/approve",
            role,
          )
        ).code,
      ).toBe("forbidden");
    }

    // POST /v1/wallet/topups enforces wallet:topup (allowed for rider/driver in full, denied in limited, denied for merchant)
    expect(
      (await call("full", "POST", "/v1/wallet/topups", "rider")).status,
    ).toBe(200);
    expect(
      (await call("full", "POST", "/v1/wallet/topups", "driver")).status,
    ).toBe(200);
    expect(
      (await call("limited", "POST", "/v1/wallet/topups", "rider")).code,
    ).toBe("limited_mode");
    expect(
      (await call("full", "POST", "/v1/wallet/topups", "merchant")).code,
    ).toBe("forbidden");

    // mp:admin:write routes (CC-A04 / P2-01, P2-02): ops, ops_admin, admin, super_admin in full mode;
    // refused at the gateway before reaching any service for rider, driver, support_agent (mp:admin:read only),
    // finance_ops, config_admin, and limited-mode operators.
    for (const path of [
      "/v1/admin/mp/business-bookings/awd_1/retry",
      "/v1/admin/mp/delivery-cancellations/awd_1/retry",
      "/v1/admin/mp/offroad-flags/flg_1/decide",
    ]) {
      for (const role of ["ops", "ops_admin", "admin", "super_admin"]) {
        expect((await call("full", "POST", path, role)).status).toBe(200);
        upstream.received.length = 0;
        const lim = await call("limited", "POST", path, role);
        expect(lim.code).toBe("limited_mode");
        expect(upstream.received).toHaveLength(0);
      }
      for (const role of [
        "rider",
        "driver",
        "support_agent",
        "support_lead",
        "reviewer",
        "finance_ops",
        "config_admin",
        "travel_ops",
      ]) {
        upstream.received.length = 0;
        const denied = await call("full", "POST", path, role);
        expect(denied.code).toBe("forbidden");
        expect(upstream.received).toHaveLength(0);
      }
    }
    // Specialist read roles still reach GET /v1/admin/mp/* in full mode:
    for (const role of [
      "support_agent",
      "reviewer",
      "finance_ops",
      "config_admin",
    ]) {
      expect(
        (await call("full", "GET", "/v1/admin/mp/offroad-flags", role)).status,
      ).toBe(200);
    }

    // growth:admin routes (CC-A12 / P2-10): growth_admin, growth_editor, ai_ops, ops_admin, admin, super_admin in full mode;
    // refused in limited mode and refused for rider, driver, merchant, ops, finance_ops, config_admin.
    for (const role of [
      "growth_admin",
      "growth_editor",
      "ai_ops",
      "ops_admin",
      "admin",
      "super_admin",
    ]) {
      for (const [method, path] of [
        ["GET", "/v1/growth/campaigns"],
        ["POST", "/v1/growth/campaigns/cmp_1/actions"],
        ["GET", "/v1/growth/referrals/review-queue"],
        ["GET", "/v1/growth/recon/2026-10-01"],
      ] as const) {
        expect((await call("full", method, path, role)).status).toBe(200);
        upstream.received.length = 0;
        const lim = await call("limited", method, path, role);
        expect(lim.code).toBe("limited_mode");
        expect(upstream.received).toHaveLength(0);
      }
    }
    for (const role of [
      "rider",
      "driver",
      "merchant",
      "ops",
      "finance_ops",
      "config_admin",
      "travel_ops",
    ]) {
      upstream.received.length = 0;
      const denied = await call("full", "GET", "/v1/growth/campaigns", role);
      expect(denied.code).toBe("forbidden");
      expect(upstream.received).toHaveLength(0);
    }

    // Rider/driver growth surfaces (benefits, referrals, attribution, driver incentives/statements)
    // ride on profile:read and survive limited mode when cityId is present.
    for (const [method, path] of [
      ["GET", "/v1/benefits"],
      ["GET", "/v1/referrals"],
      ["POST", "/v1/referrals/share"],
      ["POST", "/v1/attribution/claim"],
      ["GET", "/v1/driver/incentives"],
      ["GET", "/v1/driver/statements/2026-W39"],
    ] as const) {
      expect((await call("full", method, path, "rider")).status).toBe(200);
      expect((await call("limited", method, path, "rider")).status).toBe(200);
      expect((await call("full", method, path, "driver")).status).toBe(200);
    }
  });

  it("maps FLEET_MANAGER / fleet_manager to fleet:read, fleet:manage, and step-up scopes (CC-A16 / P3-12)", async () => {
    for (const [method, path] of [
      ["GET", "/v1/fleets/mine"],
      ["POST", "/v1/fleets/flt_1/vehicles"],
      ["POST", "/v1/fleets/flt_1/assignments"],
      ["GET", "/v1/fleets/flt_1/week-money"],
    ] as const) {
      expect((await call("full", method, path, "FLEET_MANAGER")).status).toBe(
        200,
      );
    }
    // Limited mode allows profile:read and auth:step_up, while gating fleet:read and fleet:manage until step-up
    expect(
      (await call("limited", "GET", "/v1/users/me", "FLEET_MANAGER")).status,
    ).toBe(200);
    const limRead = await call(
      "limited",
      "GET",
      "/v1/fleets/mine",
      "FLEET_MANAGER",
    );
    expect(limRead.status).toBe(403);
    expect(limRead.code).toBe("limited_mode");
    const limWrite = await call(
      "limited",
      "POST",
      "/v1/fleets/flt_1/vehicles",
      "FLEET_MANAGER",
    );
    expect(limWrite.status).toBe(403);
    expect(limWrite.code).toBe("limited_mode");
  });

  it("gates /v1/ops/notifications/dlq behind notifications:ops (CC-A15 / P2-04)", async () => {
    for (const role of [
      "ops",
      "ops_admin",
      "support_lead",
      "support_agent",
      "admin",
      "super_admin",
    ]) {
      for (const [method, path] of [
        ["GET", "/v1/ops/notifications/dlq"],
        ["GET", "/v1/ops/notifications/dlq/dlq_mp_1"],
        ["POST", "/v1/ops/notifications/dlq/dlq_mp_1/replay"],
        ["POST", "/v1/ops/notifications/dlq/dlq_mp_1/discard"],
      ] as const) {
        expect((await call("full", method, path, role)).status).toBe(200);
        upstream.received.length = 0;
        const lim = await call("limited", method, path, role);
        expect(lim.code).toBe("limited_mode");
        expect(upstream.received).toHaveLength(0);
      }
    }

    for (const role of [
      "rider",
      "driver",
      "merchant",
      "fleet_manager",
      "config_admin",
      "travel_ops",
      "growth_admin",
      "service",
    ]) {
      upstream.received.length = 0;
      const denied = await call(
        "full",
        "GET",
        "/v1/ops/notifications/dlq",
        role,
      );
      expect(denied.code).toBe("forbidden");
      expect(upstream.received).toHaveLength(0);
    }
  });

  describe("CORS_ORIGINS configuration (CC-A16 / P1-03)", () => {
    it("allows fleet.ubi.africa by default and localhost:3004 in development", async () => {
      const prodOrigins = parseCorsOrigins(undefined, "production");
      expect(prodOrigins).toContain("https://fleet.ubi.africa");
      expect(prodOrigins).not.toContain("http://localhost:3004");

      const devOrigins = parseCorsOrigins(undefined, "development");
      expect(devOrigins).toContain("https://fleet.ubi.africa");
      expect(devOrigins).toContain("http://localhost:3004");

      const customOrigins = parseCorsOrigins(
        "https://ubi.africa, https://fleet.ubi.africa , https://admin.ubi.africa",
        "production",
      );
      expect(customOrigins).toEqual([
        "https://ubi.africa",
        "https://fleet.ubi.africa",
        "https://admin.ubi.africa",
      ]);

      const fleetRes = await app.fetch(
        new Request("http://localhost/health", {
          method: "OPTIONS",
          headers: {
            Origin: "https://fleet.ubi.africa",
            "Access-Control-Request-Method": "POST",
          },
        }),
      );
      expect(fleetRes.headers.get("access-control-allow-origin")).toBe(
        "https://fleet.ubi.africa",
      );

      const unknownRes = await app.fetch(
        new Request("http://localhost/health", {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
          },
        }),
      );
      expect(unknownRes.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("rejects wildcard or non-exact origins in CORS_ORIGINS", () => {
      expect(() => parseCorsOrigins("*", "production")).toThrow(/wildcards/i);
      expect(() =>
        parseCorsOrigins("https://*.ubi.africa", "production"),
      ).toThrow(/wildcards/i);
      expect(() =>
        parseCorsOrigins("https://fleet.ubi.africa/path", "production"),
      ).toThrow(/exact/i);
    });
  });
});
