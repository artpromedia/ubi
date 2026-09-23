/**
 * Business travel money is MOUNTED in the real service (A06 part C):
 * requests go through `src/index.ts`'s app — global middleware, the
 * `/v1/business/*` and `/v1/finance/*` rate limiters, the router registry —
 * with the two credentials production uses: the gateway-signed identity
 * context for the organization's people, and the internal service key for
 * ride-service. The only thing outside the service is the top-up PSP, played
 * here by a local HTTP server speaking the rail's wire protocol.
 *
 * The app reads its Prisma singleton, Redis client and rail configuration at
 * import time, so it is imported only after the environment points at the
 * test database and the local PSP. The rate limiter keys by X-Forwarded-For;
 * every request uses its own address.
 *
 * This file sets service credentials and DATABASE_URL on purpose, so the
 * turbo env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

import * as jose from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BUSINESS_STATEMENT_CSV_COLUMNS,
  BusinessOpResultSchema,
  BusinessPolicyCheckResultSchema,
  BusinessReservationViewSchema,
  BusinessStatementSchema,
  OrgFundingViewSchema,
} from "../../../../packages/contracts/src/business-travel";
import { periodOf } from "../../src/business/ops";
import {
  closeTestDb,
  seedOrganization,
  testDb,
  uid,
  type OrgCast,
} from "./fixtures";
import { TEST_DATABASE_URL } from "../ledger/helpers";

import type { Hono } from "hono";

const INTERNAL_KEY = "business-app-test-internal-service-key";
const IDENTITY_SECRET = "business-app-test-signed-identity-secret-0001";
const ENV_KEYS = [
  "INTERNAL_SERVICE_KEY",
  "UBI_IDENTITY_SECRET",
  "DATABASE_URL",
  "TOPUP_BASE_URL",
  "TOPUP_API_KEY",
] as const;

const db = testDb();
let app: Hono;
let disconnect: () => Promise<void>;
let psp: Server;
const captures: Array<{ key: string; body: unknown }> = [];
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

async function dropCachedPrisma(): Promise<void> {
  const holder = globalThis as { prisma?: { $disconnect(): Promise<void> } };
  if (holder.prisma !== undefined) {
    await holder.prisma.$disconnect().catch(() => undefined);
    delete holder.prisma;
  }
}

beforeAll(async () => {
  // The PSP: POST /captures → { pspRef }, POST /refunds → {}.
  psp = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      const idem = String(req.headers["idempotency-key"] ?? "");
      if (req.url === "/captures") {
        captures.push({ key: idem, body: JSON.parse(raw) as unknown });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ pspRef: `psp_${idem.slice(-12)}` }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => psp.listen(0, "127.0.0.1", resolve));
  const address = psp.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  for (const name of ENV_KEYS) {
    saved[name] = process.env[name];
  }
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
  process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.TOPUP_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.TOPUP_API_KEY = "business-app-test-psp-key";
  await dropCachedPrisma();
  const service = (await import("../../src/index.js")) as unknown as {
    default: Hono;
  };
  const prismaModule = await import("../../src/lib/prisma.js");
  const redisModule = await import("../../src/lib/redis.js");
  app = service.default;
  disconnect = async () => {
    await prismaModule.disconnectPrisma();
    await redisModule.disconnectRedis();
  };
});

afterAll(async () => {
  for (const name of ENV_KEYS) {
    const value = saved[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await disconnect();
  await dropCachedPrisma();
  await closeTestDb();
  await new Promise<void>((resolve) => psp.close(() => resolve()));
});

function forwardedFor(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function signedIdentity(
  userId: string,
  secret = IDENTITY_SECRET,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role: "rider",
    scp: ["wallet:read"],
    mod: [],
    city: null,
    tenant: null,
    sid: null,
    dev: null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", typ: "UBI-IC" })
    .setSubject(userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(secret));
}

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly contentType: string | null;
}

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const response = await app.fetch(
    new Request(`http://payment-service.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    status: response.status,
    body: parsed,
    text,
    contentType: response.headers.get("content-type"),
  };
}

async function as(
  userId: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return { "x-ubi-identity": await signedIdentity(userId), ...extra };
}

function service(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-service-key": INTERNAL_KEY, ...extra };
}

describe("business travel through the real app", () => {
  let cast: OrgCast;
  let period: string;

  beforeAll(async () => {
    cast = await seedOrganization(db);
    period = periodOf(new Date(), cast.city.timezone);
  });

  it("refuses the organization's money to an unsigned or forged caller, and the internal API to a caller without the service key", async () => {
    const unsigned = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/funding`,
      {},
    );
    expect(unsigned.status).toBe(401);
    const mirrors = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/funding`,
      {
        "x-user-id": cast.owner.id,
        "x-user-role": "ADMIN",
      },
    );
    expect(mirrors.status).toBe(401);
    const forged = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/funding`,
      {
        "x-ubi-identity": await signedIdentity(
          cast.owner.id,
          "not-the-gateway-secret-but-long-enough-x",
        ),
      },
    );
    expect(forged.status).toBe(401);

    const noKey = await send(
      "POST",
      "/v1/finance/business/reserve",
      { "idempotency-key": uid("k") },
      {},
    );
    expect(noKey.status).toBe(403);
    const wrongKey = await send(
      "POST",
      "/v1/finance/business/reserve",
      {
        "x-service-key": "wrong",
        "idempotency-key": uid("k"),
      },
      {},
    );
    expect(wrongKey.status).toBe(403);
    // A user identity is not a service credential.
    const userOnInternal = await send(
      "POST",
      "/v1/finance/business/reserve",
      await as(cast.owner.id),
      {},
    );
    expect(userOnInternal.status).toBe(403);
  });

  it("runs top-up → allocate → policy check → reserve → commit → statement end to end", async () => {
    // Top-up through the rail, replayed and refused on reuse.
    const topupKey = uid("topup");
    const topup = await send(
      "POST",
      `/v1/business/organizations/${cast.orgId}/topups`,
      await as(cast.owner.id, { "idempotency-key": topupKey }),
      { methodId: "card", amountMinor: 6_000_000 },
    );
    expect(topup.status).toBe(201);
    expect(captures).toHaveLength(1);
    const replayTopup = await send(
      "POST",
      `/v1/business/organizations/${cast.orgId}/topups`,
      await as(cast.owner.id, { "idempotency-key": topupKey }),
      { methodId: "card", amountMinor: 6_000_000 },
    );
    expect(replayTopup.status).toBe(200);
    expect(replayTopup.body.replayed).toBe(true);
    expect(captures).toHaveLength(1);
    const reuseTopup = await send(
      "POST",
      `/v1/business/organizations/${cast.orgId}/topups`,
      await as(cast.owner.id, { "idempotency-key": topupKey }),
      { methodId: "card", amountMinor: 1 },
    );
    expect(reuseTopup.status).toBe(409);
    expect(reuseTopup.body.code).toBe("idempotency_key_reuse");
    const bookerTopup = await send(
      "POST",
      `/v1/business/organizations/${cast.orgId}/topups`,
      await as(cast.booker.id, { "idempotency-key": uid("topup") }),
      { methodId: "card", amountMinor: 1_000 },
    );
    expect(bookerTopup.status).toBe(403);

    const allocate = await send(
      "POST",
      `/v1/business/organizations/${cast.orgId}/budgets/allocations`,
      await as(cast.admin.id, { "idempotency-key": uid("alloc") }),
      { costCentreId: cast.costCentreId, period, amountMinor: 4_000_000 },
    );
    expect(allocate.status).toBe(201);

    const funding = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/funding`,
      await as(cast.owner.id),
    );
    expect(funding.status).toBe(200);
    const fundingView = OrgFundingViewSchema.parse(funding.body);
    expect(fundingView.unallocated.amountMinor).toBe(2_000_000);
    expect(fundingView.budgets[0]?.available.amountMinor).toBe(4_000_000);

    // ride-service: quote-time policy check, then the reservation at award.
    const terms = {
      bookingRef: uid("award"),
      organizationId: cast.orgId,
      bookerId: cast.booker.id,
      travellerId: cast.traveller.id,
      service: "ride",
      vehicleClass: "comfort",
      amountMinor: 1_500_000,
      currency: "NGN",
      expenseCategory: "client visit",
    };
    const cityHeader = { "x-city-id": cast.city.cityId };
    const check = await send(
      "POST",
      "/v1/finance/business/policy-check",
      service(cityHeader),
      terms,
    );
    expect(check.status).toBe(200);
    expect(BusinessPolicyCheckResultSchema.parse(check.body)).toMatchObject({
      allowed: true,
      reasons: [],
    });

    const reserveKey = `business:${terms.bookingRef}:reserve`;
    const reserve = await send(
      "POST",
      "/v1/finance/business/reserve",
      service({ ...cityHeader, "idempotency-key": reserveKey }),
      terms,
    );
    expect(reserve.status).toBe(201);
    const reserved = BusinessOpResultSchema.parse(reserve.body);
    expect(reserved.reservation.state).toBe("reserved");

    const replay = await send(
      "POST",
      "/v1/finance/business/reserve",
      service({ ...cityHeader, "idempotency-key": reserveKey }),
      terms,
    );
    expect(replay.status).toBe(200);
    expect(BusinessOpResultSchema.parse(replay.body).ref).toBe(reserved.ref);
    const conflicting = await send(
      "POST",
      "/v1/finance/business/reserve",
      service({ ...cityHeader, "idempotency-key": reserveKey }),
      { ...terms, amountMinor: 1_500_001 },
    );
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe("idempotency_key_reuse");
    const noKey = await send(
      "POST",
      "/v1/finance/business/reserve",
      service(cityHeader),
      terms,
    );
    expect(noKey.status).toBe(422);

    const overBudget = await send(
      "POST",
      "/v1/finance/business/reserve",
      service({ ...cityHeader, "idempotency-key": uid("reserve") }),
      { ...terms, bookingRef: uid("award"), amountMinor: 2_600_000 },
    );
    expect(overBudget.status).toBe(422);
    expect(overBudget.body.code).toBe("insufficient_spendable");
    expect((overBudget.body.details as { reason?: string }).reason).toBe(
      "budget_insufficient",
    );

    const commit = await send(
      "POST",
      "/v1/finance/business/commit",
      service({ "idempotency-key": `business:${terms.bookingRef}:commit` }),
      { bookingRef: terms.bookingRef, actualMinor: 1_290_000, currency: "NGN" },
    );
    expect(commit.status).toBe(201);
    const committed = BusinessOpResultSchema.parse(commit.body);
    expect(committed.reservation.committed?.amountMinor).toBe(1_290_000);
    expect(committed.reservation.taxes).toEqual([
      { code: "vat", rateBps: 750, amountMinor: 90_000 },
    ]);

    const status = await send(
      "GET",
      `/v1/finance/business/reservations/${encodeURIComponent(terms.bookingRef)}`,
      service(),
    );
    expect(status.status).toBe(200);
    expect(
      (status.body.ops as Array<{ op: string }>).map((op) => op.op),
    ).toEqual(["reserve", "commit"]);

    // Who sees the booking.
    const bookerView = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/bookings`,
      await as(cast.booker.id),
    );
    expect(bookerView.status).toBe(200);
    const bookerBookings = bookerView.body.bookings as unknown[];
    expect(
      bookerBookings.map(
        (b) => BusinessReservationViewSchema.parse(b).bookingRef,
      ),
    ).toEqual([terms.bookingRef]);
    const travellerOnOrg = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/bookings`,
      await as(cast.traveller.id),
    );
    expect(travellerOnOrg.status).toBe(403);
    const outsiderOnOrg = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/bookings`,
      await as(cast.outsider.id),
    );
    expect(outsiderOnOrg.status).toBe(404);
    const mine = await send(
      "GET",
      "/v1/business/bookings/mine",
      await as(cast.traveller.id),
    );
    expect(
      (mine.body.bookings as Array<{ bookingRef: string }>).map(
        (b) => b.bookingRef,
      ),
    ).toEqual([terms.bookingRef]);

    // The consolidated statement, JSON and CSV, reconciled with the journal.
    const json = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/statements/${period}`,
      await as(cast.admin.id),
    );
    expect(json.status).toBe(200);
    const statement = BusinessStatementSchema.parse(json.body);
    expect(statement.totals.gross.amountMinor).toBe(1_290_000);
    expect(statement.reconciliation.journalCommittedMinor).toBe(1_290_000);
    expect(statement.lines[0]).toMatchObject({
      bookingRef: terms.bookingRef,
      costCentreCode: "ENG",
    });

    const csv = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/statements/${period}?format=csv`,
      await as(cast.admin.id),
    );
    expect(csv.status).toBe(200);
    expect(csv.contentType).toContain("text/csv");
    const [header, row] = csv.text.trim().split("\r\n");
    expect(header).toBe(BUSINESS_STATEMENT_CSV_COLUMNS.join(","));
    expect(row).toContain(terms.bookingRef);
    expect(row).toContain(",1290000,90000,1200000,NGN,");
    const bookerStatement = await send(
      "GET",
      `/v1/business/organizations/${cast.orgId}/statements/${period}`,
      await as(cast.booker.id),
    );
    expect(bookerStatement.status).toBe(403);
  });

  it("lets the traveller's cancel through and refuses another booker's", async () => {
    const terms = {
      bookingRef: uid("award"),
      organizationId: cast.orgId,
      bookerId: cast.booker.id,
      travellerId: cast.traveller.id,
      service: "ride",
      vehicleClass: "go",
      amountMinor: 200_000,
      currency: "NGN",
    };
    const reserve = await send(
      "POST",
      "/v1/finance/business/reserve",
      service({
        "x-city-id": cast.city.cityId,
        "idempotency-key": uid("reserve"),
      }),
      terms,
    );
    expect(reserve.status).toBe(201);
    const refused = await send(
      "POST",
      "/v1/finance/business/release",
      service({ "idempotency-key": uid("release") }),
      {
        bookingRef: terms.bookingRef,
        cancelledBy: { party: "org_admin", userId: cast.booker.id },
        reason: "cancelled",
      },
    );
    expect(refused.status).toBe(403);
    const released = await send(
      "POST",
      "/v1/finance/business/release",
      service({ "idempotency-key": uid("release") }),
      {
        bookingRef: terms.bookingRef,
        cancelledBy: { party: "traveller", userId: cast.traveller.id },
        reason: "plans_changed",
      },
    );
    expect(released.status).toBe(201);
    expect(
      BusinessOpResultSchema.parse(released.body).reservation.releasedBy,
    ).toBe("traveller");
  });
});
