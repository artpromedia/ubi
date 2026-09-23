/**
 * Supplier travel payments on the canonical ledger (P7 / recheck T02):
 * `/v1/finance/travel/{authorize,capture,release,refund}` and the status read,
 * exercised through the router (src/finance/travel-routes.ts) against a REAL
 * Postgres — the double-entry trigger, the unique idempotency keys, the row
 * locks and the CHECK constraints on the item amounts only exist there.
 *
 * tests/finance/travel-app.test.ts proves the same router is mounted in the
 * real app at the path travel-service's payment port calls by default.
 *
 * This file sets and clears INTERNAL_SERVICE_KEY on purpose — the fail-closed
 * test IS about the unset variable — so the turbo env-declaration lint does
 * not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import * as jose from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeededCity,
} from "../ledger/helpers";
import { createTravelPaymentRoutes } from "../../src/finance/travel-routes";
import { balanceOf, spendableOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { authorizeMarketplaceFunding } from "../../src/ledger/mp-funding";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";

const db = testDb();
const deps = makeDeps(db);
const app = createTravelPaymentRoutes(deps);

const INTERNAL_KEY = "travel-payments-test-internal-key";
const IDENTITY_SECRET = "travel-payments-test-identity-secret-000001";
let savedKey: string | undefined;
let savedIdentitySecret: string | undefined;

const createdOrderIds: string[] = [];

beforeAll(() => {
  savedKey = process.env.INTERNAL_SERVICE_KEY;
  savedIdentitySecret = process.env.UBI_IDENTITY_SECRET;
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
  process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
});

afterAll(async () => {
  if (savedKey === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = savedKey;
  }
  if (savedIdentitySecret === undefined) {
    delete process.env.UBI_IDENTITY_SECRET;
  } else {
    process.env.UBI_IDENTITY_SECRET = savedIdentitySecret;
  }
  const items = await db.travelPaymentItem.findMany({
    where: { orderId: { in: createdOrderIds } },
    select: { id: true },
  });
  await db.travelPaymentOp.deleteMany({
    where: { itemId: { in: items.map((item) => item.id) } },
  });
  await db.travelPaymentItem.deleteMany({
    where: { id: { in: items.map((item) => item.id) } },
  });
  await closeTestDb();
});

interface Traveller {
  readonly city: SeededCity;
  readonly userId: string;
  readonly wallet: WalletRecord;
}

async function fundedTraveller(
  amountMinor: number,
  flags: Readonly<Record<string, boolean>> = { flights_booking: true },
): Promise<Traveller> {
  const city = await seedCity(db, { flags });
  const user = await seedUser(db, "Traveller");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const created = await ensureWallet(tx, "user", user.id, config.city);
    return created;
  });
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { city, userId: user.id, wallet };
}

function newOrderId(): string {
  const orderId = uid("tord");
  createdOrderIds.push(orderId);
  return orderId;
}

type Op = "authorize" | "capture" | "release" | "refund";

interface Body {
  readonly orderId: string;
  readonly userId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason?: string;
}

function bodyFor(
  traveller: Traveller,
  orderId: string,
  amountMinor: number,
  reason = "travel flight item",
): Body {
  return {
    orderId,
    userId: traveller.userId,
    amountMinor,
    currency: traveller.city.currency,
    reason,
  };
}

function serviceHeaders(
  traveller: Traveller,
  key: string = uid("idem"),
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-Service-Key": INTERNAL_KEY,
    "Idempotency-Key": key,
    "X-City-ID": traveller.city.cityId,
    "X-User-ID": traveller.userId,
    "X-User-Role": "rider",
    ...extra,
  };
}

async function call(
  op: Op,
  body: Body,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request(`/${op}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

interface OpResponse {
  readonly ref: string;
  readonly op: Op;
  readonly itemId: string;
  readonly orderId: string;
  readonly entryId: string | null;
  readonly amount: { amountMinor: number; currency: string };
  readonly state: string;
  readonly replayed: boolean;
  readonly item: {
    readonly state: string;
    readonly authorized: { amountMinor: number };
    readonly captured: { amountMinor: number };
    readonly refunded: { amountMinor: number };
    readonly refundable: { amountMinor: number };
    readonly encumbered: { amountMinor: number };
    readonly captureEntryId: string | null;
  };
}

interface ErrorResponse {
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

async function ok(response: Response, status = 201): Promise<OpResponse> {
  const body = (await response.json()) as OpResponse;
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function refused(
  response: Response,
  status: number,
  code: string,
): Promise<ErrorResponse> {
  const body = (await response.json()) as ErrorResponse;
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(body.code).toBe(code);
  return body;
}

/** Every journal line posted for this order: capture lines and refund lines. */
async function linesForOrder(orderId: string) {
  const entries = await db.journalEntry.findMany({
    where: {
      reference: {
        in: [`travel_order:${orderId}`, `travel_order:${orderId}:refund`],
      },
    },
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
  return entries;
}

function sumLines(
  lines: ReadonlyArray<{ account: string; amountMinor: bigint }>,
  account?: string,
): number {
  return lines
    .filter((line) => account === undefined || line.account === account)
    .reduce((total, line) => total + Number(line.amountMinor), 0);
}

describe("authorize → capture → refund (the happy path, on the journal)", () => {
  it("encumbers without moving money, captures once into travel_clearing, and refunds with linked counter-entries", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const { wallet, city } = traveller;

    // authorize: a reservation, not a journal movement.
    const auth = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 600_000),
        serviceHeaders(traveller),
      ),
    );
    expect(auth.op).toBe("authorize");
    expect(auth.state).toBe("authorized");
    expect(auth.entryId).toBeNull();
    expect(auth.replayed).toBe(false);
    expect(auth.item.encumbered.amountMinor).toBe(600_000);
    expect((await balanceOf(db, wallet.id, city.currency)).amountMinor).toBe(
      1_000_000,
    );
    expect((await spendableOf(db, wallet.id, city.currency)).amountMinor).toBe(
      400_000,
    );
    expect(await linesForOrder(orderId)).toHaveLength(0);

    // capture: ONE balanced entry, wallet → travel_clearing.
    const cap = await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 600_000, "travel flight capture"),
        serviceHeaders(traveller),
      ),
    );
    expect(cap.state).toBe("captured");
    expect(cap.entryId).not.toBeNull();
    expect(cap.item.captureEntryId).toBe(cap.entryId);
    expect(cap.item.encumbered.amountMinor).toBe(0);
    expect((await balanceOf(db, wallet.id, city.currency)).amountMinor).toBe(
      400_000,
    );
    expect((await spendableOf(db, wallet.id, city.currency)).amountMinor).toBe(
      400_000,
    );

    const afterCapture = await linesForOrder(orderId);
    expect(afterCapture).toHaveLength(1);
    const captureEntry = afterCapture[0];
    expect(captureEntry?.id).toBe(cap.entryId);
    expect(captureEntry?.kind).toBe("travel_capture");
    const captureLines = captureEntry?.lines ?? [];
    expect(sumLines(captureLines)).toBe(0);
    expect(
      captureLines.map((line) => [
        line.account,
        line.walletId,
        Number(line.amountMinor),
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["wallet", wallet.id, -600_000],
        ["travel_clearing", null, 600_000],
      ]),
    );
    // Never the marketplace commission account or a commission hold.
    expect(captureLines.some((line) => line.account === "ubi_commission")).toBe(
      false,
    );
    expect(
      await db.mpCommissionHold.count({ where: { walletId: wallet.id } }),
    ).toBe(0);

    // partial refund: linked to the capture entry.
    const firstRefund = await ok(
      await call(
        "refund",
        bodyFor(traveller, orderId, 250_000, "travel refund rf_1"),
        serviceHeaders(traveller),
      ),
    );
    expect(firstRefund.state).toBe("partially_refunded");
    expect(firstRefund.item.refundable.amountMinor).toBe(350_000);

    // the remainder: refunded in full.
    const secondRefund = await ok(
      await call(
        "refund",
        bodyFor(traveller, orderId, 350_000, "travel refund rf_2"),
        serviceHeaders(traveller),
      ),
    );
    expect(secondRefund.state).toBe("refunded");
    expect(secondRefund.item.refunded.amountMinor).toBe(600_000);

    const entries = await linesForOrder(orderId);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "travel_capture",
      "travel_refund",
      "travel_refund",
    ]);
    for (const refundEntry of entries.slice(1)) {
      expect(sumLines(refundEntry.lines)).toBe(0);
      for (const line of refundEntry.lines) {
        expect(line.counterpartRef).toBe(`travel_capture:${cap.entryId}`);
      }
    }
    const allLines = entries.flatMap((entry) => entry.lines);
    // travel_clearing nets to zero for a fully refunded item; the wallet is whole.
    expect(sumLines(allLines, "travel_clearing")).toBe(0);
    expect(sumLines(allLines, "wallet")).toBe(0);
    expect((await balanceOf(db, wallet.id, city.currency)).amountMinor).toBe(
      1_000_000,
    );

    // Every transition wrote its audit row and outbox event.
    const audits = await db.auditLog.findMany({
      where: { subjectType: "travel_payment", subjectId: auth.itemId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => row.action)).toEqual([
      "finance.travel.authorized",
      "finance.travel.captured",
      "finance.travel.refunded",
      "finance.travel.refunded",
    ]);
    expect(audits.every((row) => row.actorId === "travel-service")).toBe(true);
    const events = await db.outboxEvent.findMany({
      where: { aggregateType: "travel_payment", aggregateId: auth.itemId },
      orderBy: { toVersion: "asc" },
    });
    expect(
      events.map((row) => [row.name, row.fromVersion, row.toVersion]),
    ).toEqual([
      ["transfer.held", null, 1],
      ["transfer.posted", 1, 2],
      ["refund.posted", 2, 3],
      ["refund.posted", 3, 4],
    ]);
  });
});

describe("authorize → release", () => {
  it("frees the authorization without a journal entry, and nothing can capture it afterwards", async () => {
    const traveller = await fundedTraveller(500_000);
    const orderId = newOrderId();
    const { wallet, city } = traveller;

    const auth = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    expect((await spendableOf(db, wallet.id, city.currency)).amountMinor).toBe(
      200_000,
    );

    const release = await ok(
      await call(
        "release",
        bodyFor(traveller, orderId, 300_000, "travel flight release"),
        serviceHeaders(traveller),
      ),
    );
    expect(release.state).toBe("released");
    expect(release.entryId).toBeNull();
    expect(release.amount.amountMinor).toBe(300_000);
    expect((await spendableOf(db, wallet.id, city.currency)).amountMinor).toBe(
      500_000,
    );
    expect((await balanceOf(db, wallet.id, city.currency)).amountMinor).toBe(
      500_000,
    );
    expect(await linesForOrder(orderId)).toHaveLength(0);

    const events = await db.outboxEvent.findMany({
      where: { aggregateType: "travel_payment", aggregateId: auth.itemId },
      orderBy: { toVersion: "asc" },
    });
    expect(events.map((row) => row.name)).toEqual([
      "transfer.held",
      "payment.auth_released",
    ]);

    // capture after release: illegal, and nothing moved.
    const late = await refused(
      await call(
        "capture",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );
    expect(late.details?.from).toBe("released");
    expect(await linesForOrder(orderId)).toHaveLength(0);

    // a second release under a different key is not a transition either.
    await refused(
      await call(
        "release",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );
  });
});

describe("idempotency", () => {
  it("replays the original result for the same key and body, and never posts twice", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const authKey = uid("auth");
    const capKey = uid("cap");

    const first = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 400_000),
        serviceHeaders(traveller, authKey),
      ),
    );
    const again = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 400_000),
        serviceHeaders(traveller, authKey),
      ),
      200,
    );
    expect(again.replayed).toBe(true);
    expect(again.ref).toBe(first.ref);
    expect(again.itemId).toBe(first.itemId);

    const cap = await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 400_000, "travel flight capture"),
        serviceHeaders(traveller, capKey),
      ),
    );
    // The free-text reason is descriptive: a retry that words it differently
    // (travel-service's reconcile vs webhook paths) is still the same capture.
    const capReplay = await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 400_000, "travel webhook capture"),
        serviceHeaders(traveller, capKey),
      ),
      200,
    );
    expect(capReplay.replayed).toBe(true);
    expect(capReplay.ref).toBe(cap.ref);
    expect(capReplay.entryId).toBe(cap.entryId);

    expect(await linesForOrder(orderId)).toHaveLength(1);
    expect(
      await db.travelPaymentOp.count({ where: { itemId: first.itemId } }),
    ).toBe(2);
    expect(
      (await balanceOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(600_000);
  });

  it("refuses a replay of a key with different money terms (409)", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const authKey = uid("auth");

    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 400_000),
        serviceHeaders(traveller, authKey),
      ),
    );
    await refused(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 450_000),
        serviceHeaders(traveller, authKey),
      ),
      409,
      "idempotency_key_reuse",
    );

    const refundKey = uid("refund");
    await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 400_000),
        serviceHeaders(traveller),
      ),
    );
    await ok(
      await call(
        "refund",
        bodyFor(traveller, orderId, 100_000),
        serviceHeaders(traveller, refundKey),
      ),
    );
    await refused(
      await call(
        "refund",
        bodyFor(traveller, orderId, 150_000),
        serviceHeaders(traveller, refundKey),
      ),
      409,
      "idempotency_key_reuse",
    );
    const entries = await linesForOrder(orderId);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "travel_capture",
      "travel_refund",
    ]);
  });

  it("requires an Idempotency-Key on every POST", async () => {
    const traveller = await fundedTraveller(100_000);
    const headers = serviceHeaders(traveller);
    const { "Idempotency-Key": _dropped, ...withoutKey } = headers;
    void _dropped;
    for (const op of ["authorize", "capture", "release", "refund"] as const) {
      await refused(
        await call(op, bodyFor(traveller, newOrderId(), 10_000), withoutKey),
        422,
        "validation_failed",
      );
    }
  });
});

describe("the item state machine", () => {
  it("rejects a double capture, a release after capture, a refund before capture and a second authorization", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();

    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 500_000),
        serviceHeaders(traveller),
      ),
    );
    // One authorization per order item, ever.
    const second = await refused(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 500_000),
        serviceHeaders(traveller),
      ),
      409,
      "conflict",
    );
    expect((second.details?.item as { state: string }).state).toBe(
      "authorized",
    );
    // Nothing to refund yet.
    await refused(
      await call(
        "refund",
        bodyFor(traveller, orderId, 100_000),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );
    // A capture above the authorization is refused before anything moves.
    await refused(
      await call(
        "capture",
        bodyFor(traveller, orderId, 500_001),
        serviceHeaders(traveller),
      ),
      409,
      "conflict",
    );

    await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 500_000),
        serviceHeaders(traveller),
      ),
    );
    const double = await refused(
      await call(
        "capture",
        bodyFor(traveller, orderId, 500_000),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );
    // The refusal carries the item as it stands, so a caller can reconcile.
    expect(double.details?.from).toBe("captured");
    expect(
      (double.details?.item as { captured: { amountMinor: number } }).captured
        .amountMinor,
    ).toBe(500_000);
    await refused(
      await call(
        "release",
        bodyFor(traveller, orderId, 500_000),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );

    expect(await linesForOrder(orderId)).toHaveLength(1);
    expect(
      (await balanceOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(500_000);
  });

  it("refuses an op that names a different traveller than the authorization", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const other = await seedUser(db, "Stranger");
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 200_000),
        serviceHeaders(traveller),
      ),
    );
    await refused(
      await call(
        "capture",
        { ...bodyFor(traveller, orderId, 200_000), userId: other.id },
        serviceHeaders(traveller),
      ),
      409,
      "conflict",
    );
  });
});

describe("partial refund bounds", () => {
  it("never refunds more than was captured, across several partial refunds", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();

    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 700_000),
        serviceHeaders(traveller),
      ),
    );
    // A capture may come in under the authorization; the rest is freed.
    const cap = await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 600_000),
        serviceHeaders(traveller),
      ),
    );
    expect(cap.item.captured.amountMinor).toBe(600_000);
    expect(
      (await spendableOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(400_000);

    const over = await refused(
      await call(
        "refund",
        bodyFor(traveller, orderId, 600_001),
        serviceHeaders(traveller),
      ),
      409,
      "conflict",
    );
    expect(over.details?.refundableMinor).toBe(600_000);

    await ok(
      await call(
        "refund",
        bodyFor(traveller, orderId, 450_000),
        serviceHeaders(traveller),
      ),
    );
    const overRemaining = await refused(
      await call(
        "refund",
        bodyFor(traveller, orderId, 150_001),
        serviceHeaders(traveller),
      ),
      409,
      "conflict",
    );
    expect(overRemaining.details?.refundableMinor).toBe(150_000);

    const last = await ok(
      await call(
        "refund",
        bodyFor(traveller, orderId, 150_000),
        serviceHeaders(traveller),
      ),
    );
    expect(last.state).toBe("refunded");
    await refused(
      await call(
        "refund",
        bodyFor(traveller, orderId, 1),
        serviceHeaders(traveller),
      ),
      409,
      "illegal_transition",
    );

    const refunds = (await linesForOrder(orderId)).filter(
      (entry) => entry.kind === "travel_refund",
    );
    expect(
      sumLines(
        refunds.flatMap((entry) => entry.lines),
        "wallet",
      ),
    ).toBe(600_000);
  });

  it("is backed by the database: a refunded total above the capture violates a CHECK constraint", async () => {
    const traveller = await fundedTraveller(100_000);
    const orderId = newOrderId();
    const auth = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 50_000),
        serviceHeaders(traveller),
      ),
    );
    await expect(
      db.travelPaymentItem.update({
        where: { id: auth.itemId },
        data: { capturedMinor: 50_000n, refundedMinor: 50_001n },
      }),
    ).rejects.toThrow();
    await expect(
      db.travelPaymentItem.update({
        where: { id: auth.itemId },
        data: { capturedMinor: 50_001n },
      }),
    ).rejects.toThrow();
  });
});

describe("concurrency", () => {
  it("lets exactly one of several racing captures (different keys) through", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, async () =>
        call(
          "capture",
          bodyFor(traveller, orderId, 300_000),
          serviceHeaders(traveller),
        ),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(5);

    const entries = await linesForOrder(orderId);
    expect(entries).toHaveLength(1);
    expect(
      (await balanceOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(700_000);
  });

  it("converges racing retries of the SAME key on one capture", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const capKey = uid("cap");
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );

    const responses = await Promise.all(
      Array.from({ length: 5 }, async () =>
        call(
          "capture",
          bodyFor(traveller, orderId, 300_000),
          serviceHeaders(traveller, capKey),
        ),
      ),
    );
    const bodies = (await Promise.all(
      responses.map(async (response) => response.json()),
    )) as OpResponse[];
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(4);
    expect(new Set(bodies.map((body) => body.ref)).size).toBe(1);
    expect(await linesForOrder(orderId)).toHaveLength(1);
  });
});

/**
 * A client over the SAME database whose first top-level
 * `travelPaymentItem.findUnique` waits on `gate` before it reads. It forces
 * one interleaving deterministically: the original request commits exactly
 * between a same-key retry's first replay lookup and its unlocked pre-checks.
 * Every read and write still goes to the real database (transactions run on
 * the real client); only the timing is pinned.
 */
function gatedDb(gate: () => Promise<void>): typeof db {
  let armed = true;
  const items = new Proxy(db.travelPaymentItem, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "findUnique" && typeof value === "function") {
        return async (args: unknown) => {
          if (armed) {
            armed = false;
            await gate();
          }
          return (value as (input: unknown) => Promise<unknown>).call(
            target,
            args,
          );
        };
      }
      return typeof value === "function"
        ? (value as (...input: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "travelPaymentItem") {
        return items;
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...input: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

describe("a same-key retry that races its original past the unlocked pre-checks", () => {
  /**
   * Runs `op` twice under ONE Idempotency-Key: the retry on a gated router,
   * the original inside the gate, so the original has committed by the time
   * the retry reads the item. The retry must answer the original result (200,
   * replayed) — never refuse its own op as illegal or as a conflict.
   */
  async function raceSameKey(
    op: Op,
    traveller: Traveller,
    body: Body,
  ): Promise<{ original: OpResponse; retry: OpResponse }> {
    const key = uid(`race-${op}`);
    let original: OpResponse | undefined;
    const gated = createTravelPaymentRoutes(
      makeDeps(
        gatedDb(async () => {
          original = await ok(
            await call(op, body, serviceHeaders(traveller, key)),
          );
        }),
      ),
    );
    const retry = await ok(
      await gated.request(`/${op}`, {
        method: "POST",
        headers: serviceHeaders(traveller, key),
        body: JSON.stringify(body),
      }),
      200,
    );
    expect(original).toBeDefined();
    expect(retry.replayed).toBe(true);
    expect(retry.ref).toBe(original?.ref);
    return { original: original as OpResponse, retry };
  }

  it("authorize: the retry replays instead of reporting the order as already authorized", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const { retry } = await raceSameKey(
      "authorize",
      traveller,
      bodyFor(traveller, orderId, 300_000),
    );
    expect(retry.state).toBe("authorized");
    expect(await db.travelPaymentItem.count({ where: { orderId } })).toBe(1);
  });

  it("capture: the retry replays the one capture instead of calling it a double capture", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    const { original, retry } = await raceSameKey(
      "capture",
      traveller,
      bodyFor(traveller, orderId, 300_000),
    );
    expect(retry.entryId).toBe(original.entryId);
    expect(await linesForOrder(orderId)).toHaveLength(1);
    expect(
      (await balanceOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(700_000);
  });

  it("release: the retry replays the release instead of refusing released → released", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    const { retry } = await raceSameKey(
      "release",
      traveller,
      bodyFor(traveller, orderId, 300_000),
    );
    expect(retry.state).toBe("released");
  });

  it("refund: the retry replays a full refund instead of refusing a refunded item", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    const { retry } = await raceSameKey(
      "refund",
      traveller,
      bodyFor(traveller, orderId, 300_000),
    );
    expect(retry.state).toBe("refunded");
    const refunds = (await linesForOrder(orderId)).filter(
      (entry) => entry.kind === "travel_refund",
    );
    expect(refunds).toHaveLength(1);
    expect(
      (await balanceOf(db, traveller.wallet.id, traveller.city.currency))
        .amountMinor,
    ).toBe(1_000_000);
  });

  it("still refuses a DIFFERENT key that loses the same race", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 300_000),
        serviceHeaders(traveller),
      ),
    );
    const gated = createTravelPaymentRoutes(
      makeDeps(
        gatedDb(async () => {
          await ok(
            await call(
              "capture",
              bodyFor(traveller, orderId, 300_000),
              serviceHeaders(traveller),
            ),
          );
        }),
      ),
    );
    await refused(
      await gated.request("/capture", {
        method: "POST",
        headers: serviceHeaders(traveller),
        body: JSON.stringify(bodyFor(traveller, orderId, 300_000)),
      }),
      409,
      "illegal_transition",
    );
    expect(await linesForOrder(orderId)).toHaveLength(1);
  });
});

describe("funding and encumbrance", () => {
  it("refuses an authorization the wallet cannot cover", async () => {
    const traveller = await fundedTraveller(100_000);
    const body = await refused(
      await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 100_001),
        serviceHeaders(traveller),
      ),
      422,
      "insufficient_funds",
    );
    expect(body.details?.requiredMinor).toBe(100_001);
  });

  it("encumbers the wallet for every other debit path until capture or release", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 800_000),
        serviceHeaders(traveller),
      ),
    );

    // A second travel item cannot pledge the same money...
    await refused(
      await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 300_000),
        serviceHeaders(traveller),
      ),
      422,
      "insufficient_spendable",
    );
    // ...and neither can a marketplace ride's funding reservation.
    await expect(
      authorizeMarketplaceFunding(deps, {
        requesterId: traveller.userId,
        requestId: uid("req"),
        awardId: uid("award"),
        paymentMethodId: "wallet",
        amountMinor: 300_000,
        currency: traveller.city.currency,
        cityId: traveller.city.cityId,
      }),
    ).rejects.toMatchObject({ code: "insufficient_funds" });

    await ok(
      await call(
        "release",
        bodyFor(traveller, orderId, 800_000),
        serviceHeaders(traveller),
      ),
    );
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 300_000),
        serviceHeaders(traveller),
      ),
    );
  });

  it("refuses a currency the city's wallet is not denominated in", async () => {
    const traveller = await fundedTraveller(100_000);
    await refused(
      await call(
        "authorize",
        { ...bodyFor(traveller, newOrderId(), 10_000), currency: "USD" },
        serviceHeaders(traveller),
      ),
      422,
      "validation_failed",
    );
  });
});

describe("deny-by-default", () => {
  it("refuses a NEW authorization where no travel booking vertical is on", async () => {
    const traveller = await fundedTraveller(100_000, {
      flights_booking: false,
      stays_booking: false,
    });
    await refused(
      await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 10_000),
        serviceHeaders(traveller),
      ),
      404,
      "feature_disabled",
    );
  });

  it("never strands money: an existing authorization still releases after the switch is turned off", async () => {
    const traveller = await fundedTraveller(100_000, { stays_booking: true });
    const orderId = newOrderId();
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 40_000),
        serviceHeaders(traveller),
      ),
    );
    await db.flagRule.update({
      where: {
        flagKey_cityId: {
          flagKey: "stays_booking",
          cityId: traveller.city.cityId,
        },
      },
      data: { enabled: false },
    });
    await ok(
      await call(
        "release",
        bodyFor(traveller, orderId, 40_000),
        serviceHeaders(traveller),
      ),
    );
  });

  it("needs the city on every call", async () => {
    const traveller = await fundedTraveller(100_000);
    const { "X-City-ID": _dropped, ...withoutCity } = serviceHeaders(traveller);
    void _dropped;
    await refused(
      await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 10_000),
        withoutCity,
      ),
      404,
      "city_unsupported",
    );
  });
});

describe("the service-to-service guard", () => {
  it("refuses a request without the key, and one with the wrong key", async () => {
    const traveller = await fundedTraveller(100_000);
    const { "X-Service-Key": _dropped, ...withoutKey } =
      serviceHeaders(traveller);
    void _dropped;
    const noKey = await call(
      "authorize",
      bodyFor(traveller, newOrderId(), 10_000),
      withoutKey,
    );
    expect(noKey.status).toBe(403);

    const wrongKey = await call(
      "authorize",
      bodyFor(traveller, newOrderId(), 10_000),
      serviceHeaders(traveller, uid("idem"), {
        "X-Service-Key": "not-the-key",
      }),
    );
    expect(wrongKey.status).toBe(403);

    const status = await app.request(`/orders/${newOrderId()}`, {
      headers: { "X-City-ID": traveller.city.cityId },
    });
    expect(status.status).toBe(403);
    expect(
      await db.travelPaymentItem.count({
        where: { userId: traveller.userId },
      }),
    ).toBe(0);
  });

  it("fails CLOSED when INTERNAL_SERVICE_KEY is unset — even for a caller that sends no key", async () => {
    const traveller = await fundedTraveller(100_000);
    delete process.env.INTERNAL_SERVICE_KEY;
    try {
      const { "X-Service-Key": _dropped, ...withoutKey } =
        serviceHeaders(traveller);
      void _dropped;
      const response = await call(
        "authorize",
        bodyFor(traveller, newOrderId(), 10_000),
        withoutKey,
      );
      expect(response.status).toBe(403);
    } finally {
      process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    }
  });

  it("refuses a forwarded signed identity that does not verify, and records one that does", async () => {
    const traveller = await fundedTraveller(100_000);
    const bad = await call(
      "authorize",
      bodyFor(traveller, newOrderId(), 10_000),
      serviceHeaders(traveller, uid("idem"), {
        "x-ubi-identity": "not.a.valid-jws",
      }),
    );
    expect(bad.status).toBe(401);

    const signed = await new jose.SignJWT({
      role: "rider",
      scp: [],
      mod: [],
      city: null,
      tenant: null,
      sid: null,
      dev: null,
      rid: "travel-test",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(traveller.userId)
      .setIssuer("ubi-gateway")
      .setAudience("ubi-internal")
      .setIssuedAt()
      .setExpirationTime("120s")
      .sign(new TextEncoder().encode(IDENTITY_SECRET));
    const orderId = newOrderId();
    const good = await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 10_000),
        serviceHeaders(traveller, uid("idem"), {
          "x-ubi-identity": signed,
          "X-User-ID": "someone-else",
        }),
      ),
    );
    const audit = await db.auditLog.findFirst({
      where: { subjectType: "travel_payment", subjectId: good.itemId },
    });
    expect(
      (audit?.after as { onBehalfOf: { id: string; verified: boolean } })
        .onBehalfOf,
    ).toEqual({ id: traveller.userId, role: "rider", verified: true });
  });
});

describe("status lookup (reconciling after an ambiguous timeout)", () => {
  it("shows the item and every op with the key it arrived under", async () => {
    const traveller = await fundedTraveller(1_000_000);
    const orderId = newOrderId();
    const authKey = uid("auth");
    const capKey = uid("cap");
    await ok(
      await call(
        "authorize",
        bodyFor(traveller, orderId, 200_000),
        serviceHeaders(traveller, authKey),
      ),
    );
    // The caller "loses" this response (a timeout): it does not know whether
    // the capture happened.
    await call(
      "capture",
      bodyFor(traveller, orderId, 200_000),
      serviceHeaders(traveller, capKey),
    );

    const response = await app.request(`/orders/${orderId}`, {
      headers: serviceHeaders(traveller),
    });
    expect(response.status).toBe(200);
    const status = (await response.json()) as {
      item: { state: string; captured: { amountMinor: number } };
      ops: Array<{ op: string; clientKey: string; entryId: string | null }>;
    };
    expect(status.item.state).toBe("captured");
    expect(status.item.captured.amountMinor).toBe(200_000);
    expect(status.ops.map((op) => [op.op, op.clientKey])).toEqual([
      ["authorize", authKey],
      ["capture", capKey],
    ]);
    expect(status.ops[1]?.entryId).not.toBeNull();

    // Replaying the same key is the other safe answer: the original result.
    const replay = await ok(
      await call(
        "capture",
        bodyFor(traveller, orderId, 200_000),
        serviceHeaders(traveller, capKey),
      ),
      200,
    );
    expect(replay.replayed).toBe(true);
    expect(await linesForOrder(orderId)).toHaveLength(1);
  });

  it("answers 404 for an order with no authorization", async () => {
    const traveller = await fundedTraveller(0);
    const response = await app.request(`/orders/${uid("nope")}`, {
      headers: serviceHeaders(traveller),
    });
    await refused(response, 404, "not_found");
  });
});
