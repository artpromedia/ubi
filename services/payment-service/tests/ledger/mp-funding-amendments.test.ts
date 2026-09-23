/**
 * Rider funding amendments (A02 item 5) against a real Postgres.
 *
 * What these tests prove:
 *  - a fare increase tops the award's funding up under the same wallet rules
 *    as the original authorization, and a decrease partially releases it —
 *    each a LINKED adjustment row, never an edit of the original reservation,
 *    so the authorize replay guard still accepts the original terms and still
 *    refuses changed ones;
 *  - reject/expiry releases a top-up; a release that lands first closes the
 *    amendment so a late top-up cannot encumber;
 *  - settlement consumes original + committed top-ups − committed partial
 *    releases exactly once, and releases a top-up that never committed;
 *  - the award's reversal releases its adjustments with it;
 *  - stale priors, conflicting replays, concurrency, cash and PSP methods.
 */
import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  activeRiderReservationsMinor,
  balanceOf,
  spendableOf,
} from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import {
  authorizeMarketplaceFunding,
  releaseMarketplaceFunding,
} from "../../src/ledger/mp-funding";
import {
  commitFundingTopUp,
  type FundingAmendmentInput,
  partialReleaseFunding,
  releaseFundingTopUp,
  topUpFunding,
} from "../../src/ledger/mp-funding-amendments";
import {
  captureHold,
  reserveHold,
  reverseCapturedHold,
} from "../../src/ledger/mp-holds";
import { settleMarketplaceCompletion } from "../../src/ledger/mp-settlement";
import { ensureWallet } from "../../src/ledger/wallets";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const db = testDb();
const deps = makeDeps(db);
const createdWalletIds: string[] = [];

afterAll(async () => {
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await db.mpRiderReservation.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Party {
  readonly cityId: string;
  readonly currency: string;
  readonly userId: string;
  readonly walletId: string;
}

async function partyWith(amountMinor: number, cityId?: string): Promise<Party> {
  const resolvedCity =
    cityId === undefined ? (await seedCity(db)).cityId : cityId;
  const user = await seedUser(db, "Rider");
  const config = await createCityConfigProvider(db).load(resolvedCity);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, config.city.currency, amountMinor);
  }
  return {
    cityId: resolvedCity,
    currency: config.city.currency,
    userId: user.id,
    walletId: wallet.id,
  };
}

interface FundedAward {
  readonly awardId: string;
  readonly requestId: string;
  readonly reservationId: string;
  readonly authorize: Parameters<typeof authorizeMarketplaceFunding>[1];
}

async function fundedAward(
  rider: Party,
  amountMinor: number,
): Promise<FundedAward> {
  const authorize = {
    requesterId: rider.userId,
    requestId: uid("mpr"),
    awardId: uid("awd"),
    paymentMethodId: "wallet",
    amountMinor,
    currency: rider.currency,
    cityId: rider.cityId,
  };
  const result = await authorizeMarketplaceFunding(deps, authorize);
  return {
    awardId: authorize.awardId,
    requestId: authorize.requestId,
    reservationId: result.reservationId ?? "",
    authorize,
  };
}

function amendment(
  rider: Party,
  award: FundedAward,
  priorAmountMinor: number,
  newAmountMinor: number,
  amendmentId = uid("amd"),
): FundingAmendmentInput {
  return {
    requesterId: rider.userId,
    awardId: award.awardId,
    amendmentId,
    paymentMethodId: "wallet",
    priorAmountMinor,
    newAmountMinor,
    currency: rider.currency,
    cityId: rider.cityId,
  };
}

async function expectSpendable(
  rider: Party,
  expected: { clearedMinor: number; encumberedMinor: number },
): Promise<void> {
  expect(await balanceOf(db, rider.walletId, rider.currency)).toEqual(
    money(expected.clearedMinor, rider.currency),
  );
  expect(
    await activeRiderReservationsMinor(db, rider.walletId, rider.currency),
  ).toEqual(money(expected.encumberedMinor, rider.currency));
  expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
    money(expected.clearedMinor - expected.encumberedMinor, rider.currency),
  );
}

describe("top-up, partial release and consumption reconcile exactly", () => {
  it("original + committed top-up − committed partial release is consumed once at settlement", async () => {
    const rider = await partyWith(10_000_00);
    const driver = await partyWith(0, rider.cityId);
    const award = await fundedAward(rider, 5_000_00);
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_000_00,
    });

    // A: the fare rises to 6,000.00 — the additional 1,000.00 is reserved.
    const a = amendment(rider, award, 5_000_00, 6_000_00);
    const topUp = await topUpFunding(deps, a);
    expect(topUp).toMatchObject({
      kind: "top_up",
      secured: true,
      status: "reserved",
      reservationId: award.reservationId,
      deltaMinor: 1_000_00,
      priorAmountMinor: 5_000_00,
      newAmountMinor: 6_000_00,
      replayed: false,
    });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 6_000_00,
    });

    // The original reservation is untouched, so its authorize replay guard
    // still accepts the SELECTED terms and still refuses changed ones.
    const original = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: award.awardId },
    });
    expect(Number(original.amountMinor)).toBe(5_000_00);
    const authorizeReplay = await authorizeMarketplaceFunding(
      deps,
      award.authorize,
    );
    expect(authorizeReplay.reservationId).toBe(award.reservationId);
    await expect(
      authorizeMarketplaceFunding(deps, {
        ...award.authorize,
        amountMinor: 6_000_00,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const committed = await commitFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: a.amendmentId,
      newAmountMinor: 6_000_00,
    });
    expect(committed).toMatchObject({
      status: "committed",
      adjustmentId: topUp.adjustmentId,
      replayed: false,
    });
    const commitReplay = await commitFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: a.amendmentId,
      newAmountMinor: 6_000_00,
    });
    expect(commitReplay.replayed).toBe(true);
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 6_000_00,
    });

    // B: the fare drops to 5,500.00 at commit — 500.00 released, linked.
    const b = amendment(rider, award, 6_000_00, 5_500_00);
    const partial = await partialReleaseFunding(deps, b);
    expect(partial).toMatchObject({
      kind: "partial_release",
      status: "committed",
      deltaMinor: 500_00,
      priorAmountMinor: 6_000_00,
      newAmountMinor: 5_500_00,
    });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_500_00,
    });

    // Completion at the final fare: consumption ends every encumbrance in
    // the settlement transaction, exactly once.
    const settleInput = {
      awardId: award.awardId,
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_500_00, rider.currency),
      method: "wallet" as const,
      cityId: rider.cityId,
    };
    const settled = await settleMarketplaceCompletion(deps, settleInput);
    expect(settled.replayed).toBe(false);
    await expectSpendable(rider, {
      clearedMinor: 4_500_00,
      encumberedMinor: 0,
    });
    const rows = await db.mpRiderReservation.findMany({
      where: {
        OR: [
          { awardId: award.awardId },
          { awardId: { startsWith: `amendment:${award.awardId}:` } },
        ],
      },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "consumed")).toBe(true);
    const consumedAudit = await db.auditLog.findFirstOrThrow({
      where: {
        action: "wallet.mp_funding.consumed",
        subjectId: award.awardId,
      },
    });
    expect(consumedAudit.after).toMatchObject({
      reservedMinor: 5_000_00,
      adjustmentsMinor: 500_00,
      adjustmentsConsumed: 2,
      uncommittedTopUpsReleased: 0,
      consumedMinor: 5_500_00,
      settledFareMinor: 5_500_00,
    });

    // A settlement replay changes nothing and consumes nothing twice.
    const replay = await settleMarketplaceCompletion(deps, settleInput);
    expect(replay.replayed).toBe(true);
    expect(
      await db.auditLog.count({
        where: {
          action: "wallet.mp_funding.consumed",
          subjectId: award.awardId,
        },
      }),
    ).toBe(1);
    await expectSpendable(rider, {
      clearedMinor: 4_500_00,
      encumberedMinor: 0,
    });
    // A settled award takes no further adjustment.
    await expect(
      topUpFunding(deps, amendment(rider, award, 5_500_00, 5_800_00)),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a top-up whose amendment never committed is released at settlement, not consumed", async () => {
    const rider = await partyWith(10_000_00);
    const driver = await partyWith(0, rider.cityId);
    const award = await fundedAward(rider, 5_000_00);
    const pending = await topUpFunding(
      deps,
      amendment(rider, award, 5_000_00, 5_700_00),
    );

    await settleMarketplaceCompletion(deps, {
      awardId: award.awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, rider.currency),
      method: "wallet",
      cityId: rider.cityId,
    });
    const row = await db.mpRiderReservation.findUniqueOrThrow({
      where: { id: pending.adjustmentId ?? "" },
    });
    expect(row.status).toBe("released");
    expect(row.reason).toBe("amendment_uncommitted_at_settlement");
    const consumedAudit = await db.auditLog.findFirstOrThrow({
      where: {
        action: "wallet.mp_funding.consumed",
        subjectId: award.awardId,
      },
    });
    expect(consumedAudit.after).toMatchObject({
      consumedMinor: 5_000_00,
      uncommittedTopUpsReleased: 1,
    });
    await expectSpendable(rider, {
      clearedMinor: 5_000_00,
      encumberedMinor: 0,
    });
  });
});

describe("reject / expiry and recovery", () => {
  it("releases a reserved top-up once, replays, and refuses to commit it afterwards", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    const a = amendment(rider, award, 5_000_00, 6_000_00);
    await topUpFunding(deps, a);

    const released = await releaseFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: a.amendmentId,
      reason: "amendment_expired",
    });
    expect(released).toMatchObject({ status: "released", replayed: false });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_000_00,
    });
    const replay = await releaseFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: a.amendmentId,
      reason: "amendment_expired",
    });
    expect(replay.replayed).toBe(true);
    await expect(
      commitFundingTopUp(deps, {
        awardId: award.awardId,
        amendmentId: a.amendmentId,
        newAmountMinor: 6_000_00,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    // The prior is back to the original: the next amendment starts there.
    const next = await topUpFunding(
      deps,
      amendment(rider, award, 5_000_00, 5_200_00),
    );
    expect(next.deltaMinor).toBe(200_00);
  });

  it("a release that lands before the top-up closes the amendment; a committed top-up cannot be released", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    const late = amendment(rider, award, 5_000_00, 6_000_00);

    const closed = await releaseFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: late.amendmentId,
      reason: "amendment_rejected",
    });
    expect(closed).toMatchObject({ kind: "none", status: "released" });
    await expect(topUpFunding(deps, late)).rejects.toMatchObject({
      code: "conflict",
    });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_000_00,
    });

    const b = amendment(rider, award, 5_000_00, 5_400_00);
    await topUpFunding(deps, b);
    await commitFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: b.amendmentId,
      newAmountMinor: 5_400_00,
    });
    await expect(
      releaseFundingTopUp(deps, {
        awardId: award.awardId,
        amendmentId: b.amendmentId,
        reason: "too_late",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_400_00,
    });
  });

  it("the award's reversal (and plain funding release) frees the adjustments with the reservation", async () => {
    const rider = await partyWith(10_000_00);
    const driver = await partyWith(1_000_00, rider.cityId);
    const award = await fundedAward(rider, 5_000_00);
    // The award's commission hold, captured under the same award id.
    const hold = await reserveHold(
      deps,
      {
        driverId: driver.userId,
        bidRef: uid("bid"),
        requestRef: award.requestId,
        amountMinor: 500_00,
        baseMinor: 5_000_00,
        currency: rider.currency,
        policyVersion: 1,
        cityId: rider.cityId,
      },
      uid("idem"),
    );
    await captureHold(
      deps,
      hold.hold.reservationId,
      {
        awardId: award.awardId,
        expectedAmountMinor: money(500_00, rider.currency),
      },
      uid("idem"),
    );
    const a = amendment(rider, award, 5_000_00, 6_000_00);
    await topUpFunding(deps, a);
    await commitFundingTopUp(deps, {
      awardId: award.awardId,
      amendmentId: a.amendmentId,
      newAmountMinor: 6_000_00,
    });
    await topUpFunding(deps, amendment(rider, award, 6_000_00, 6_300_00));
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 6_300_00,
    });

    await reverseCapturedHold(
      deps,
      hold.hold.reservationId,
      { awardId: award.awardId, reason: "award_cancelled" },
      uid("idem"),
    );
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 0,
    });
    const statuses = await db.mpRiderReservation.findMany({
      where: {
        OR: [
          { awardId: award.awardId },
          { awardId: { startsWith: `amendment:${award.awardId}:` } },
        ],
      },
      select: { status: true },
    });
    expect(statuses.map((row) => row.status)).toEqual([
      "released",
      "released",
      "released",
    ]);
    // The funding release endpoint then converges on the released state.
    const release = await releaseMarketplaceFunding(deps, {
      awardId: award.awardId,
      reason: "sweep",
    });
    expect(release.status).toBe("released");
  });
});

describe("guards: insufficient funds, stale prior, replays, concurrency", () => {
  it("refuses a top-up the rider cannot cover — one minor unit short — without a row", async () => {
    const rider = await partyWith(6_000_00 - 1);
    const award = await fundedAward(rider, 5_000_00);
    await expect(
      topUpFunding(deps, amendment(rider, award, 5_000_00, 6_000_00)),
    ).rejects.toMatchObject({
      code: "insufficient_funds",
      status: 422,
      details: { requiredMinor: 1_000_00, shortfallMinor: 1 },
    });
    expect(
      await db.mpRiderReservation.count({
        where: { awardId: { startsWith: `amendment:${award.awardId}:` } },
      }),
    ).toBe(0);
    await expectSpendable(rider, {
      clearedMinor: 6_000_00 - 1,
      encumberedMinor: 5_000_00,
    });
  });

  it("answers a stale prior with 409 and the refreshed funded amount", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    for (const attempt of [
      () => topUpFunding(deps, amendment(rider, award, 4_800_00, 6_000_00)),
      () =>
        partialReleaseFunding(
          deps,
          amendment(rider, award, 5_200_00, 4_000_00),
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: "version_conflict",
        status: 409,
        details: { refreshedTerms: { fundedAmountMinor: 5_000_00 } },
      });
    }
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_000_00,
    });
  });

  it("replays identical requests and refuses the same amendment with different terms", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    const a = amendment(rider, award, 5_000_00, 6_000_00);
    const first = await topUpFunding(deps, a);
    const replay = await topUpFunding(deps, a);
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      topUpFunding(deps, { ...a, newAmountMinor: 6_500_00 }),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });
    await expect(
      partialReleaseFunding(deps, { ...a, newAmountMinor: 4_000_00 }),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });
    await expect(
      commitFundingTopUp(deps, {
        awardId: award.awardId,
        amendmentId: a.amendmentId,
        newAmountMinor: 6_100_00,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    // One open top-up per award: another amendment waits for this one.
    await expect(
      topUpFunding(deps, amendment(rider, award, 5_000_00, 5_100_00)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 6_000_00,
    });
  });

  it("concurrent top-ups for one amendment converge on one row; a rival amendment is refused", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    const a = amendment(rider, award, 5_000_00, 6_000_00);
    const results = await Promise.all([
      topUpFunding(deps, a),
      topUpFunding(deps, a),
      topUpFunding(deps, a),
    ]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.adjustmentId)).size).toBe(1);

    const rivals = await Promise.allSettled([
      partialReleaseFunding(deps, amendment(rider, award, 5_000_00, 4_000_00)),
      topUpFunding(deps, amendment(rider, award, 5_000_00, 7_000_00)),
    ]);
    expect(rivals.every((outcome) => outcome.status === "rejected")).toBe(true);
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 6_000_00,
    });
  });
});

describe("payment methods, exactly as authorization treats them", () => {
  it("keeps cash explicitly unsecured and fails closed for PSP methods", async () => {
    const rider = await partyWith(0);
    const awardId = uid("awd");
    const cash: FundingAmendmentInput = {
      requesterId: rider.userId,
      awardId,
      amendmentId: uid("amd"),
      paymentMethodId: "cash",
      priorAmountMinor: 5_000_00,
      newAmountMinor: 6_000_00,
      currency: rider.currency,
      cityId: rider.cityId,
    };
    const topUp = await topUpFunding(deps, cash);
    expect(topUp).toMatchObject({
      secured: false,
      status: "unsecured",
      adjustmentId: null,
      deltaMinor: 1_000_00,
    });
    const partial = await partialReleaseFunding(deps, {
      ...cash,
      amendmentId: uid("amd"),
      priorAmountMinor: 6_000_00,
      newAmountMinor: 5_000_00,
    });
    expect(partial).toMatchObject({ secured: false, status: "unsecured" });
    expect(
      await db.mpRiderReservation.count({
        where: { awardId: { startsWith: `amendment:${awardId}:` } },
      }),
    ).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "wallet.mp_funding.topped_up", subjectId: awardId },
    });
    expect(audit.after).toMatchObject({ secured: false });
    // Committing or releasing a cash amendment has nothing to move.
    expect(
      await commitFundingTopUp(deps, {
        awardId,
        amendmentId: cash.amendmentId,
        newAmountMinor: 6_000_00,
      }),
    ).toMatchObject({ secured: false, status: "unsecured" });
    expect(
      await releaseFundingTopUp(deps, {
        awardId,
        amendmentId: cash.amendmentId,
        reason: "rejected",
      }),
    ).toMatchObject({ secured: false, status: "missing" });

    await expect(
      topUpFunding(deps, { ...cash, paymentMethodId: "card" }),
    ).rejects.toMatchObject({ code: "payment_method_unavailable" });
    await expect(
      topUpFunding(deps, { ...cash, paymentMethodId: "bank_transfer" }),
    ).rejects.toMatchObject({ code: "payment_method_unavailable" });
    await expect(
      topUpFunding(deps, { ...cash, currency: "KES" }),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
  });

  it("refuses a cash amendment on a wallet-funded award (a method switch) and a wallet one on an unfunded award", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    await expect(
      topUpFunding(deps, {
        ...amendment(rider, award, 5_000_00, 6_000_00),
        paymentMethodId: "cash",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      topUpFunding(deps, {
        ...amendment(rider, award, 5_000_00, 6_000_00),
        awardId: uid("awd"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      topUpFunding(deps, {
        ...amendment(rider, award, 5_000_00, 6_000_00),
        requesterId: uid("usr"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to authorize an award id in the amendment-adjustment namespace, so no reservation can squat an amendment's key", async () => {
    const rider = await partyWith(10_000_00);
    const award = await fundedAward(rider, 5_000_00);
    const amendmentId = uid("amd");
    await expect(
      authorizeMarketplaceFunding(deps, {
        ...award.authorize,
        awardId: `amendment:${award.awardId}:${amendmentId}`,
      }),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    // The real amendment still lands on its own key.
    const topUp = await topUpFunding(
      deps,
      amendment(rider, award, 5_000_00, 5_500_00, amendmentId),
    );
    expect(topUp).toMatchObject({ status: "reserved", replayed: false });
    await expectSpendable(rider, {
      clearedMinor: 10_000_00,
      encumberedMinor: 5_500_00,
    });
  });
});

describe("prefix scans are exact (LIKE metacharacters escaped)", () => {
  it("an award id whose '_' would be a LIKE wildcard never releases or consumes another award's adjustments", async () => {
    // Prisma's startsWith is an unescaped LIKE: without escaping, award
    // `awd_<x>`'s adjustment scan `amendment:awd_<x>:%` also matches award
    // `awdQ<x>`'s rows — releasing or consuming the neighbour's top-up.
    const rider = await partyWith(20_000_00);
    const driver = await partyWith(0, rider.cityId);
    const suffix = uid("x").replace(/_/g, "");
    const authorizeFor = async (awardId: string): Promise<FundedAward> => {
      const authorize = {
        requesterId: rider.userId,
        requestId: uid("mpr"),
        awardId,
        paymentMethodId: "wallet",
        amountMinor: 5_000_00,
        currency: rider.currency,
        cityId: rider.cityId,
      };
      const result = await authorizeMarketplaceFunding(deps, authorize);
      return {
        awardId,
        requestId: authorize.requestId,
        reservationId: result.reservationId ?? "",
        authorize,
      };
    };
    const neighbour = await authorizeFor(`awdQ${suffix}`);
    const award = await authorizeFor(`awd_${suffix}`);
    const raise = amendment(rider, neighbour, 5_000_00, 6_000_00);
    await topUpFunding(deps, raise);
    await commitFundingTopUp(deps, {
      awardId: neighbour.awardId,
      amendmentId: raise.amendmentId,
      newAmountMinor: 6_000_00,
    });
    await expectSpendable(rider, {
      clearedMinor: 20_000_00,
      encumberedMinor: 11_000_00,
    });

    // The other award settles at its own 5,000.00: only its own row ends.
    await settleMarketplaceCompletion(deps, {
      awardId: award.awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, rider.currency),
      method: "wallet",
      cityId: rider.cityId,
    });
    const consumedAudit = await db.auditLog.findFirstOrThrow({
      where: { action: "wallet.mp_funding.consumed", subjectId: award.awardId },
    });
    expect(consumedAudit.after).toMatchObject({
      adjustmentsMinor: 0,
      adjustmentsConsumed: 0,
      consumedMinor: 5_000_00,
    });
    await expectSpendable(rider, {
      clearedMinor: 15_000_00,
      encumberedMinor: 6_000_00,
    });
    const neighbourTopUp = await db.mpRiderReservation.findUniqueOrThrow({
      where: {
        awardId: `amendment:${neighbour.awardId}:${raise.amendmentId}`,
      },
    });
    expect(neighbourTopUp.status).toBe("committed");
  });
});
