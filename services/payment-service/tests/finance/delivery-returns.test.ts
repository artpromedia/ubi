/**
 * Delivery return-leg fees on the canonical ledger (P17):
 * `/v1/finance/delivery-returns/{reserve,capture,release}` and the status
 * read, exercised through the router (src/finance/delivery-return-routes.ts)
 * against a REAL Postgres — the double-entry trigger, the unique idempotency
 * keys, the row locks and the CHECK constraints only exist there.
 *
 * Every scenario runs against a real awarded delivery: the driver's 10%
 * commission hold is reserved and CAPTURED through the real mp-holds
 * operations, because the return fee is bound to that award's driver — and
 * because the one thing this module must never do is touch that commission.
 *
 * This file sets and clears INTERNAL_SERVICE_KEY on purpose — the fail-closed
 * test IS about the unset variable — so the turbo env-declaration lint does
 * not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { money } from "@ubi/contracts";
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
import { createDeliveryReturnRoutes } from "../../src/finance/delivery-return-routes";
import { returnReservationKey } from "../../src/finance/delivery-returns";
import { balanceOf, spendableOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { authorizeMarketplaceFunding } from "../../src/ledger/mp-funding";
import { captureHold, reserveHold } from "../../src/ledger/mp-holds";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";

const db = testDb();
const deps = makeDeps(db);
const app = createDeliveryReturnRoutes(deps);

const INTERNAL_KEY = "delivery-returns-test-internal-key";
let savedKey: string | undefined;

const createdReturnIds: string[] = [];
const createdWalletIds: string[] = [];

beforeAll(() => {
  savedKey = process.env.INTERNAL_SERVICE_KEY;
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
});

afterAll(async () => {
  if (savedKey === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = savedKey;
  }
  const charges = await db.deliveryReturnCharge.findMany({
    where: { returnId: { in: createdReturnIds } },
    select: { id: true, reservationId: true },
  });
  await db.deliveryReturnChargeOp.deleteMany({
    where: { chargeId: { in: charges.map((charge) => charge.id) } },
  });
  await db.deliveryReturnCharge.deleteMany({
    where: { id: { in: charges.map((charge) => charge.id) } },
  });
  await db.mpRiderReservation.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Party {
  readonly userId: string;
  readonly wallet: WalletRecord;
}

/** A delivery whose award is real: the driver's commission is captured. */
interface AwardedDelivery {
  readonly city: SeededCity;
  readonly sender: Party;
  readonly driver: Party;
  readonly deliveryId: string;
  readonly awardId: string;
  readonly holdId: string;
  readonly captureEntryId: string;
}

async function party(
  city: SeededCity,
  name: string,
  amountMinor: number,
): Promise<Party> {
  const user = await seedUser(db, name);
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { userId: user.id, wallet };
}

async function awardedDelivery(
  senderFundsMinor: number,
  flags: Readonly<Record<string, boolean>> = { marketplace_delivery: true },
): Promise<AwardedDelivery> {
  const city = await seedCity(db, { flags });
  const sender = await party(city, "Sender", senderFundsMinor);
  const driver = await party(city, "Driver", 2_000_00);
  const awardId = uid("awd");
  const reserved = await reserveHold(
    deps,
    {
      driverId: driver.userId,
      bidRef: uid("bid"),
      requestRef: uid("req"),
      amountMinor: 500_00,
      baseMinor: 5_000_00,
      currency: city.currency,
      policyVersion: 1,
      cityId: city.cityId,
    },
    uid("idem"),
  );
  const captured = await captureHold(
    deps,
    reserved.hold.reservationId,
    { awardId, expectedAmountMinor: money(500_00, city.currency) },
    uid("idem"),
  );
  return {
    city,
    sender,
    driver,
    deliveryId: uid("dlv"),
    awardId,
    holdId: reserved.hold.reservationId,
    captureEntryId: captured.journalEntryId,
  };
}

type Op = "reserve" | "capture" | "release";

interface Body {
  readonly returnId: string;
  readonly deliveryId: string;
  readonly awardId: string;
  readonly senderId: string;
  readonly driverId: string;
  readonly feeMinor: number;
  readonly currency: string;
  readonly reason?: string;
}

function newReturnId(): string {
  const returnId = uid("ret");
  createdReturnIds.push(returnId);
  return returnId;
}

function bodyFor(
  delivery: AwardedDelivery,
  returnId: string,
  feeMinor: number,
  overrides: Partial<Body> = {},
): Body {
  return {
    returnId,
    deliveryId: delivery.deliveryId,
    awardId: delivery.awardId,
    senderId: delivery.sender.userId,
    driverId: delivery.driver.userId,
    feeMinor,
    currency: delivery.city.currency,
    reason: "recipient unreachable, returning to sender",
    ...overrides,
  };
}

function headers(
  delivery: AwardedDelivery,
  key: string = uid("idem"),
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-Service-Key": INTERNAL_KEY,
    "Idempotency-Key": key,
    "X-City-ID": delivery.city.cityId,
    ...extra,
  };
}

async function call(
  op: Op,
  body: Body,
  requestHeaders: Record<string, string>,
): Promise<Response> {
  return app.request(`/${op}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

interface OpResponse {
  readonly ref: string;
  readonly op: Op;
  readonly chargeId: string;
  readonly returnId: string;
  readonly entryId: string | null;
  readonly amount: { amountMinor: number; currency: string };
  readonly state: string;
  readonly replayed: boolean;
  readonly charge: {
    readonly state: string;
    readonly walletId: string | null;
    readonly reservationId: string | null;
    readonly encumbered: { amountMinor: number };
    readonly captured: { amountMinor: number };
    readonly captureEntryId: string | null;
    readonly releaseReason: string | null;
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

async function spendable(p: Party, currency: string): Promise<number> {
  return (await spendableOf(db, p.wallet.id, currency)).amountMinor;
}

async function balance(p: Party, currency: string): Promise<number> {
  return (await balanceOf(db, p.wallet.id, currency)).amountMinor;
}

/** Every journal entry this module posted for a return. */
async function returnEntries(returnId: string) {
  return db.journalEntry.findMany({
    where: { reference: `delivery_return:${returnId}` },
    include: { lines: true },
  });
}

/** The award's commission as it stands: the hold row and its journal trail. */
async function commissionSnapshot(delivery: AwardedDelivery) {
  const hold = await db.mpCommissionHold.findUniqueOrThrow({
    where: { id: delivery.holdId },
  });
  const commissionEntries = await db.journalEntry.count({
    where: {
      kind: {
        in: [
          "mp_commission_capture",
          "mp_commission_reversal",
          "mp_commission_delta_capture",
          "mp_commission_delta_refund",
        ],
      },
      lines: { some: { walletId: delivery.driver.wallet.id } },
    },
  });
  const ubiCommissionMinor = await db.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      account: "ubi_commission",
      entry: { reference: `mp_award:${delivery.awardId}` },
    },
  });
  return {
    state: hold.state,
    amountMinor: hold.amountMinor,
    awardRef: hold.awardRef,
    journalEntryId: hold.journalEntryId,
    reversalEntryId: hold.reversalEntryId,
    updatedAt: hold.updatedAt.toISOString(),
    commissionEntries,
    ubiCommissionMinor: ubiCommissionMinor._sum.amountMinor,
  };
}

describe("reserve → capture (the charged return, on the journal)", () => {
  it("holds the fee at approval, takes it exactly once at completion, and pays the driver whole", async () => {
    const delivery = await awardedDelivery(10_000_00);
    const { city, sender, driver } = delivery;
    const returnId = newReturnId();
    const driverBefore = await balance(driver, city.currency);

    const reserve = await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_500_00),
        headers(delivery),
      ),
    );
    expect(reserve.state).toBe("reserved");
    expect(reserve.entryId).toBeNull();
    expect(reserve.charge.encumbered.amountMinor).toBe(1_500_00);
    // A reservation, not a movement: balance intact, spendable down.
    expect(await balance(sender, city.currency)).toBe(10_000_00);
    expect(await spendable(sender, city.currency)).toBe(8_500_00);
    expect(await returnEntries(returnId)).toHaveLength(0);

    // The encumbrance is a rider reservation in its own key namespace.
    const reservation = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: returnReservationKey(returnId) },
    });
    expect(reservation.id).toBe(reserve.charge.reservationId);
    expect(reservation.status).toBe("active");
    expect(reservation.walletId).toBe(sender.wallet.id);

    const captureKey = uid("idem");
    const capture = await ok(
      await call(
        "capture",
        bodyFor(delivery, returnId, 1_500_00),
        headers(delivery, captureKey),
      ),
    );
    expect(capture.state).toBe("captured");
    expect(capture.entryId).not.toBeNull();
    expect(capture.charge.captured.amountMinor).toBe(1_500_00);
    expect(capture.charge.encumbered.amountMinor).toBe(0);

    const entries = await returnEntries(returnId);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.kind).toBe("delivery_return_fee");
    expect(entry?.id).toBe(capture.entryId);
    // Sender wallet → driver wallet, the whole fee; balanced; no commission line.
    const lines = entry?.lines ?? [];
    expect(lines).toHaveLength(2);
    expect(
      lines.find((line) => line.walletId === sender.wallet.id)?.amountMinor,
    ).toBe(BigInt(-1_500_00));
    expect(
      lines.find((line) => line.walletId === driver.wallet.id)?.amountMinor,
    ).toBe(BigInt(1_500_00));
    expect(lines.some((line) => line.account === "ubi_commission")).toBe(false);

    expect(await balance(sender, city.currency)).toBe(8_500_00);
    expect(await spendable(sender, city.currency)).toBe(8_500_00);
    expect(await balance(driver, city.currency)).toBe(driverBefore + 1_500_00);
    expect(
      (
        await db.mpRiderReservation.findUniqueOrThrow({
          where: { id: reservation.id },
        })
      ).status,
    ).toBe("consumed");

    // Replay of the capture: the original answer, no second entry.
    const replay = await ok(
      await call(
        "capture",
        bodyFor(delivery, returnId, 1_500_00),
        headers(delivery, captureKey),
      ),
      200,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.ref).toBe(capture.ref);
    expect(replay.entryId).toBe(capture.entryId);

    // A capture under a NEW key is an illegal transition, never a second debit.
    await refused(
      await call(
        "capture",
        bodyFor(delivery, returnId, 1_500_00),
        headers(delivery),
      ),
      409,
      "illegal_transition",
    );
    // …and a captured fee cannot be released.
    await refused(
      await call(
        "release",
        bodyFor(delivery, returnId, 1_500_00),
        headers(delivery),
      ),
      409,
      "illegal_transition",
    );
    expect(await returnEntries(returnId)).toHaveLength(1);
    expect(await balance(sender, city.currency)).toBe(8_500_00);

    // Status: every op recorded, in order.
    const status = await app.request(`/returns/${returnId}`, {
      headers: { "X-Service-Key": INTERNAL_KEY },
    });
    expect(status.status).toBe(200);
    const view = (await status.json()) as {
      charge: { state: string };
      ops: Array<{ op: string }>;
    };
    expect(view.charge.state).toBe("captured");
    expect(view.ops.map((op) => op.op)).toEqual(["reserve", "capture"]);
  });

  it("never touches the award's 10% commission — reserve, capture and release leave it byte-for-byte", async () => {
    const delivery = await awardedDelivery(10_000_00);
    // The award's own rider funding reservation, as the saga creates it.
    await authorizeMarketplaceFunding(deps, {
      requesterId: delivery.sender.userId,
      requestId: uid("req"),
      awardId: delivery.awardId,
      paymentMethodId: "wallet",
      amountMinor: 5_000_00,
      currency: delivery.city.currency,
      cityId: delivery.city.cityId,
    });
    const awardFundingBefore = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: delivery.awardId },
    });
    const before = await commissionSnapshot(delivery);
    expect(before.state).toBe("captured");
    expect(before.commissionEntries).toBe(1);

    const captured = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, captured, 800_00),
        headers(delivery),
      ),
    );
    await ok(
      await call(
        "capture",
        bodyFor(delivery, captured, 800_00),
        headers(delivery),
      ),
    );
    const released = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, released, 300_00),
        headers(delivery),
      ),
    );
    await ok(
      await call(
        "release",
        bodyFor(delivery, released, 300_00),
        headers(delivery),
      ),
    );

    expect(await commissionSnapshot(delivery)).toEqual(before);
    const awardFundingAfter = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: delivery.awardId },
    });
    expect(awardFundingAfter.status).toBe("active");
    expect(awardFundingAfter.amountMinor).toBe(awardFundingBefore.amountMinor);
    expect(awardFundingAfter.updatedAt.toISOString()).toBe(
      awardFundingBefore.updatedAt.toISOString(),
    );
  });
});

describe("idempotency", () => {
  it("replays a reserve verbatim, refuses a changed replay, and allows one charge per return", async () => {
    const delivery = await awardedDelivery(10_000_00);
    const returnId = newReturnId();
    const key = uid("idem");

    const first = await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery, key),
      ),
    );
    const replay = await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery, key),
      ),
      200,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.ref).toBe(first.ref);
    expect(replay.chargeId).toBe(first.chargeId);

    // Same key, different money: a caller bug, never someone else's answer.
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_200_00),
        headers(delivery, key),
      ),
      409,
      "idempotency_key_reuse",
    );
    // A different key for the same return: one charge per return, ever.
    const second = await refused(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
      409,
      "conflict",
    );
    expect(second.details?.returnId).toBe(returnId);

    expect(
      await db.mpRiderReservation.count({
        where: { awardId: returnReservationKey(returnId) },
      }),
    ).toBe(1);
    expect(await spendable(delivery.sender, delivery.city.currency)).toBe(
      9_000_00,
    );
  });

  it("serialises racing reserves for one return: exactly one hold, whatever the keys", async () => {
    const delivery = await awardedDelivery(10_000_00);
    const returnId = newReturnId();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        call("reserve", bodyFor(delivery, returnId, 700_00), headers(delivery)),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(5);
    expect(
      await db.mpRiderReservation.count({
        where: { awardId: returnReservationKey(returnId) },
      }),
    ).toBe(1);
    expect(await spendable(delivery.sender, delivery.city.currency)).toBe(
      9_300_00,
    );
  });

  it("captures once under a capture race", async () => {
    const delivery = await awardedDelivery(10_000_00);
    const returnId = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 400_00),
        headers(delivery),
      ),
    );
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        call("capture", bodyFor(delivery, returnId, 400_00), headers(delivery)),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
    expect(await returnEntries(returnId)).toHaveLength(1);
    expect(await balance(delivery.sender, delivery.city.currency)).toBe(
      9_600_00,
    );
  });
});

describe("insufficient funds", () => {
  it("refuses a fee the sender cannot cover and writes nothing", async () => {
    const delivery = await awardedDelivery(500_00);
    const returnId = newReturnId();
    const body = await refused(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 900_00),
        headers(delivery),
      ),
      422,
      "insufficient_funds",
    );
    expect(body.details?.requiredMinor).toBe(900_00);
    expect(await db.deliveryReturnCharge.count({ where: { returnId } })).toBe(
      0,
    );
    expect(
      await db.mpRiderReservation.count({
        where: { awardId: returnReservationKey(returnId) },
      }),
    ).toBe(0);
    expect(await spendable(delivery.sender, delivery.city.currency)).toBe(
      500_00,
    );
  });

  it("counts other encumbrances: a fee the balance covers but spendable does not is refused", async () => {
    const delivery = await awardedDelivery(1_000_00);
    const first = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, first, 700_00),
        headers(delivery),
      ),
    );
    const second = newReturnId();
    const body = await refused(
      await call(
        "reserve",
        bodyFor(delivery, second, 500_00),
        headers(delivery),
      ),
      422,
      "insufficient_spendable",
    );
    expect(body.details?.shortfallMinor).toBe(200_00);
    expect(
      await db.deliveryReturnCharge.count({ where: { returnId: second } }),
    ).toBe(0);
  });
});

describe("release", () => {
  it("frees a reservation exactly once, converges on replays, and blocks a later capture", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const { city, sender } = delivery;
    const returnId = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
    );
    expect(await spendable(sender, city.currency)).toBe(4_000_00);

    const release = await ok(
      await call(
        "release",
        bodyFor(delivery, returnId, 1_000_00, {
          reason: "return charge cancelled by ops",
        }),
        headers(delivery),
      ),
    );
    expect(release.state).toBe("released");
    expect(release.charge.releaseReason).toBe("return charge cancelled by ops");
    expect(await spendable(sender, city.currency)).toBe(5_000_00);
    expect(await balance(sender, city.currency)).toBe(5_000_00);
    const reservation = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: returnReservationKey(returnId) },
    });
    expect(reservation.status).toBe("released");

    // A second release under a NEW key answers the original release.
    const again = await ok(
      await call(
        "release",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
      200,
    );
    expect(again.replayed).toBe(true);
    expect(again.ref).toBe(release.ref);

    // Released is terminal: no capture, no entry.
    await refused(
      await call(
        "capture",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
      409,
      "illegal_transition",
    );
    expect(await returnEntries(returnId)).toHaveLength(0);
  });

  it("tombstones a release that arrives before any reservation, so a late reserve cannot strand a hold", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const returnId = newReturnId();
    const tombstone = await ok(
      await call(
        "release",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
    );
    expect(tombstone.state).toBe("released");
    expect(tombstone.charge.reservationId).toBeNull();
    expect(tombstone.charge.walletId).toBeNull();

    await refused(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
      409,
      "conflict",
    );
    expect(await spendable(delivery.sender, delivery.city.currency)).toBe(
      5_000_00,
    );
    expect(
      await db.mpRiderReservation.count({
        where: { awardId: returnReservationKey(returnId) },
      }),
    ).toBe(0);
  });

  it("refuses a release whose terms do not match the charge", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const returnId = newReturnId();
    await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 1_000_00),
        headers(delivery),
      ),
    );
    await refused(
      await call(
        "release",
        bodyFor(delivery, returnId, 900_00),
        headers(delivery),
      ),
      409,
      "conflict",
    );
    expect(await spendable(delivery.sender, delivery.city.currency)).toBe(
      4_000_00,
    );
  });
});

describe("authority and policy", () => {
  it("is deny-by-default: no new reservation unless marketplace_delivery is on — but an existing charge still settles", async () => {
    const dark = await awardedDelivery(5_000_00, {
      marketplace_delivery: false,
    });
    const darkReturn = newReturnId();
    await refused(
      await call("reserve", bodyFor(dark, darkReturn, 500_00), headers(dark)),
      404,
      "feature_disabled",
    );
    expect(
      await db.deliveryReturnCharge.count({ where: { returnId: darkReturn } }),
    ).toBe(0);

    const lit = await awardedDelivery(5_000_00);
    const returnId = newReturnId();
    await ok(
      await call("reserve", bodyFor(lit, returnId, 500_00), headers(lit)),
    );
    // The kill switch is thrown after the reservation…
    await db.flagRule.update({
      where: {
        flagKey_cityId: {
          flagKey: "marketplace_delivery",
          cityId: lit.city.cityId,
        },
      },
      data: { enabled: false },
    });
    // …which stops new commitments, never the settlement of an existing one.
    await refused(
      await call("reserve", bodyFor(lit, newReturnId(), 500_00), headers(lit)),
      404,
      "feature_disabled",
    );
    await ok(
      await call("capture", bodyFor(lit, returnId, 500_00), headers(lit)),
    );
  });

  it("binds the payee to the award's driver and needs a captured award", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const stranger = await party(delivery.city, "Stranger", 0);
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, newReturnId(), 500_00, { driverId: stranger.userId }),
        headers(delivery),
      ),
      409,
      "conflict",
    );
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, newReturnId(), 500_00, { awardId: uid("awd") }),
        headers(delivery),
      ),
      409,
      "conflict",
    );
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, newReturnId(), 500_00, {
          senderId: delivery.driver.userId,
        }),
        headers(delivery),
      ),
      422,
      "validation_failed",
    );
  });

  it("validates money and requires an Idempotency-Key and a city", async () => {
    const delivery = await awardedDelivery(5_000_00);
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, newReturnId(), 0),
        headers(delivery),
      ),
      422,
      "validation_failed",
    );
    await refused(
      await call(
        "reserve",
        bodyFor(delivery, newReturnId(), 500_00, { currency: "KES" }),
        headers(delivery),
      ),
      422,
      "validation_failed",
    );
    const noKey = headers(delivery);
    delete noKey["Idempotency-Key"];
    await refused(
      await call("reserve", bodyFor(delivery, newReturnId(), 500_00), noKey),
      422,
      "validation_failed",
    );
    const noCity = headers(delivery);
    delete noCity["X-City-ID"];
    await refused(
      await call("reserve", bodyFor(delivery, newReturnId(), 500_00), noCity),
      404,
      "city_unsupported",
    );
  });

  it("fails closed without the service key, and when the key is unset", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const returnId = newReturnId();
    const wrong = await call(
      "reserve",
      bodyFor(delivery, returnId, 500_00),
      headers(delivery, uid("idem"), { "X-Service-Key": "not-the-key" }),
    );
    expect(wrong.status).toBe(403);

    delete process.env.INTERNAL_SERVICE_KEY;
    try {
      const unset = await call(
        "reserve",
        bodyFor(delivery, returnId, 500_00),
        headers(delivery, uid("idem"), { "X-Service-Key": "" }),
      );
      expect(unset.status).toBe(403);
    } finally {
      process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    }
    expect(await db.deliveryReturnCharge.count({ where: { returnId } })).toBe(
      0,
    );
  });

  it("writes an audit row and an outbox event with every transition", async () => {
    const delivery = await awardedDelivery(5_000_00);
    const returnId = newReturnId();
    const reserve = await ok(
      await call(
        "reserve",
        bodyFor(delivery, returnId, 600_00),
        headers(delivery),
      ),
    );
    await ok(
      await call(
        "capture",
        bodyFor(delivery, returnId, 600_00),
        headers(delivery),
      ),
    );

    const audits = await db.auditLog.findMany({
      where: {
        subjectType: "delivery_return_charge",
        subjectId: reserve.chargeId,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => row.action)).toEqual([
      "finance.delivery_return.reserved",
      "finance.delivery_return.captured",
    ]);
    const events = await db.outboxEvent.findMany({
      where: {
        aggregateType: "delivery_return_charge",
        aggregateId: reserve.chargeId,
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((row) => row.name)).toEqual([
      "transfer.held",
      "transfer.posted",
    ]);
    expect(events.map((row) => row.toVersion)).toEqual([1, 2]);
  });
});
