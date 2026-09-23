/**
 * Post-capture commission deltas (A02 item 5) against a real Postgres.
 *
 * The subject is the invariant a post-award amendment must never break: the
 * 10% fee is captured ONCE at selection and never re-charged; an amendment
 * moves only the difference, as a linked record, so after any sequence of
 * amendments the award's captured commission is exactly commission(final
 * fare). Every assertion reads the real journal, the real hold rows and the
 * real outbox — the deferred double-entry trigger and the unique keys are the
 * database's, not a stand-in's.
 */
import { commissionMinorFor, ContractError, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  activeHoldsMinor,
  balanceFromView,
  balanceOf,
  spendableOf,
} from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import {
  captureCommissionDelta,
  refundCommissionDelta,
  releaseCommissionDelta,
  reserveCommissionDelta,
} from "../../src/ledger/mp-commission-deltas";
import {
  captureHold,
  getMpWalletOverview,
  releaseHold,
  reserveHold,
  reverseCapturedHold,
} from "../../src/ledger/mp-holds";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeededCity,
} from "./helpers";

const db = testDb();
const deps = makeDeps(db);
const createdWalletIds: string[] = [];

afterAll(async () => {
  // The suite shares one database across files: sweep this file's holds so
  // nothing it reserved can encumber anyone else's arithmetic.
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Driver {
  readonly city: SeededCity;
  readonly userId: string;
  readonly wallet: WalletRecord;
}

async function fundedDriver(amountMinor: number): Promise<Driver> {
  const city = await seedCity(db);
  const user = await seedUser(db, "Driver");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { city, userId: user.id, wallet };
}

interface Award {
  readonly reservationId: string;
  readonly awardId: string;
  readonly receiptId: string;
  readonly fareMinor: number;
}

/** A bid on `fareMinor`, selected: the ONE 10% capture has happened. */
async function capturedAward(
  driver: Driver,
  fareMinor: number,
): Promise<Award> {
  return capturedAwardWithId(driver, fareMinor, uid("awd"));
}

async function capturedAwardWithId(
  driver: Driver,
  fareMinor: number,
  awardId: string,
): Promise<Award> {
  const commission = commissionMinorFor(fareMinor);
  const reserved = await reserveHold(
    deps,
    {
      driverId: driver.userId,
      bidRef: uid("bid"),
      requestRef: uid("req"),
      amountMinor: commission,
      baseMinor: fareMinor,
      currency: driver.city.currency,
      policyVersion: 1,
      cityId: driver.city.cityId,
    },
    uid("idem"),
  );
  const captured = await captureHold(
    deps,
    reserved.hold.reservationId,
    { awardId, expectedAmountMinor: money(commission, driver.city.currency) },
    uid("idem"),
  );
  return {
    reservationId: reserved.hold.reservationId,
    awardId,
    receiptId: captured.receiptId,
    fareMinor,
  };
}

function terms(
  award: Award,
  driver: Driver,
  priorTotalMinor: number,
  newFareMinor: number,
) {
  return {
    awardId: award.awardId,
    priorTotalMinor,
    newTotalMinor: commissionMinorFor(newFareMinor),
    newBaseMinor: newFareMinor,
    currency: driver.city.currency,
  };
}

/**
 * The award's commission read from the FEE side of the journal — the
 * `ubi_commission` lines — independently of the wallet-side derivation the
 * module under test uses. The prefix is LIKE-escaped by hand (Prisma's
 * startsWith does not escape `_`).
 */
async function feeSideCommission(awardId: string): Promise<number> {
  const prefix = `award:${awardId}:`.replace(/[\\%_]/g, (char) => `\\${char}`);
  const lines = await db.journalLine.findMany({
    where: {
      account: "ubi_commission",
      OR: [
        { counterpartRef: `award:${awardId}` },
        { counterpartRef: { startsWith: prefix } },
      ],
    },
  });
  return lines.reduce((total, line) => total + Number(line.amountMinor), 0);
}

/** Every journal entry touching the wallet balances to zero (double entry). */
async function expectEveryEntryBalanced(walletId: string): Promise<void> {
  const lines = await db.journalLine.findMany({
    where: { walletId },
    select: { entryId: true },
  });
  const entryIds = [...new Set(lines.map((line) => line.entryId))];
  for (const entryId of entryIds) {
    const all = await db.journalLine.findMany({ where: { entryId } });
    const sum = all.reduce(
      (total, line) => total + Number(line.amountMinor),
      0,
    );
    expect(sum, `entry ${entryId} must balance`).toBe(0);
  }
}

/** Cleared balance, the DB view, holds and spendable — all agreeing. */
async function expectWallet(
  driver: Driver,
  expected: { clearedMinor: number; heldMinor: number },
): Promise<void> {
  const currency = driver.city.currency;
  expect(await balanceOf(db, driver.wallet.id, currency)).toEqual(
    money(expected.clearedMinor, currency),
  );
  expect(await balanceFromView(db, driver.wallet.id, currency)).toEqual(
    money(expected.clearedMinor, currency),
  );
  expect(await activeHoldsMinor(db, driver.wallet.id, currency)).toEqual(
    money(expected.heldMinor, currency),
  );
  expect(await spendableOf(db, driver.wallet.id, currency)).toEqual(
    money(expected.clearedMinor - expected.heldMinor, currency),
  );
  await expectEveryEntryBalanced(driver.wallet.id);
}

describe("a fare increase: reserve the increment, capture it at commit", () => {
  it("reconciles the award to commission(final fare) with ONE original capture and one linked increment", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });

    // The amendment raises the fare to 6,005.00: 10% half-up is 600.50.
    const amendmentId = uid("amd");
    const newFare = 6_005_00;
    const reserved = await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, newFare),
      uid("idem"),
    );
    expect(reserved.replayed).toBe(false);
    expect(reserved.delta).toMatchObject({
      reservationId: award.reservationId,
      amendmentId,
      awardId: award.awardId,
      direction: "increase",
      state: "active",
      originalReceiptId: award.receiptId,
      receiptId: null,
      journalEntryId: null,
    });
    expect(reserved.delta.deltaMinor).toEqual(money(100_50, "NGN"));
    expect(reserved.delta.priorTotalMinor).toEqual(money(500_00, "NGN"));
    expect(reserved.delta.newTotalMinor).toEqual(money(600_50, "NGN"));

    // Reserving moves no money: cleared stays, only spendable drops, and the
    // driver's overview shows the increment as a hold.
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_50 });
    const overview = await getMpWalletOverview(
      deps,
      driver.userId,
      driver.city.cityId,
    );
    expect(overview.heldMinor).toEqual(money(100_50, "NGN"));
    expect(overview.holds.map((hold) => hold.reservationId)).toEqual([
      reserved.delta.deltaReservationId,
    ]);

    const captured = await captureCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      {
        awardId: award.awardId,
        newTotalMinor: 600_50,
        currency: driver.city.currency,
      },
      uid("idem"),
    );
    expect(captured.replayed).toBe(false);
    expect(captured.delta.state).toBe("captured");
    expect(captured.delta.receiptId).toMatch(/^mcr/);
    expect(captured.delta.receiptId).not.toBe(award.receiptId);
    await expectWallet(driver, { clearedMinor: 399_50, heldMinor: 0 });

    // The invariant: captured for the award == commission(final fare), from
    // BOTH sides of the journal.
    expect(await feeSideCommission(award.awardId)).toBe(
      commissionMinorFor(newFare),
    );
    // Never re-charged: still exactly one original capture entry, and one
    // linked increment entry of exactly the difference.
    expect(
      await db.journalEntry.count({
        where: {
          kind: "mp_commission_capture",
          reference: `mp_award:${award.awardId}`,
        },
      }),
    ).toBe(1);
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: captured.delta.journalEntryId ?? "" },
      include: { lines: true },
    });
    expect(entry.kind).toBe("mp_commission_delta_capture");
    expect(entry.reference).toBe(
      `mp_award:${award.awardId}:amendment:${amendmentId}`,
    );
    expect(entry.description).toContain(award.receiptId);
    expect(
      entry.lines.map((line) => [
        line.account,
        Number(line.amountMinor),
        line.counterpartRef,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["wallet", -100_50, `award:${award.awardId}:amendment:${amendmentId}`],
        [
          "ubi_commission",
          100_50,
          `award:${award.awardId}:amendment:${amendmentId}`,
        ],
      ]),
    );

    // Transactional outbox + audit, linked to the original capture.
    const capturedEvent = await db.outboxEvent.findFirstOrThrow({
      where: {
        name: "mp.commission.captured",
        aggregateId: reserved.delta.deltaReservationId ?? "",
      },
    });
    expect(capturedEvent.payload).toMatchObject({
      kind: "amendment_delta",
      originalReservationId: award.reservationId,
      originalReceiptId: award.receiptId,
      amendmentId,
      amountMinor: 100_50,
      newTotalMinor: 600_50,
    });
    expect(
      await db.auditLog.count({
        where: {
          subjectType: "mp_hold",
          subjectId: award.reservationId,
          action: {
            in: [
              "wallet.mp_hold.delta_reserved",
              "wallet.mp_hold.delta_captured",
            ],
          },
        },
      }),
    ).toBe(2);

    // Replays answer the original outcome and move nothing.
    const reserveReplay = await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, newFare),
      uid("idem"),
    );
    expect(reserveReplay.replayed).toBe(true);
    expect(reserveReplay.delta.deltaReservationId).toBe(
      reserved.delta.deltaReservationId,
    );
    const captureReplay = await captureCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      {
        awardId: award.awardId,
        newTotalMinor: 600_50,
        currency: driver.city.currency,
      },
      uid("idem"),
    );
    expect(captureReplay.replayed).toBe(true);
    expect(captureReplay.delta.receiptId).toBe(captured.delta.receiptId);
    expect(captureReplay.delta.journalEntryId).toBe(
      captured.delta.journalEntryId,
    );
    await expectWallet(driver, { clearedMinor: 399_50, heldMinor: 0 });
  });

  it("refuses an increase the driver cannot cover — one minor unit short — with no side effects", async () => {
    // Exactly the original commission: after capture, nothing is spendable
    // except the 1.00 top-up below.
    const driver = await fundedDriver(500_00 + 99);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    const eventsBefore = await db.outboxEvent.count();
    const auditsBefore = await db.auditLog.count({
      where: { subjectType: "mp_hold", subjectId: award.reservationId },
    });

    // 5,010.00 → 501.00: an increment of 1.00 against 0.99 spendable.
    const attempt = reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 5_010_00),
      uid("idem"),
    );
    await expect(attempt).rejects.toMatchObject({
      code: "insufficient_spendable",
      status: 422,
      details: { requiredMinor: 1_00, spendableMinor: 99, shortfallMinor: 1 },
    });

    expect(
      await db.mpCommissionHold.count({
        where: { bidRef: { startsWith: `mpdelta:${award.reservationId}:` } },
      }),
    ).toBe(0);
    expect(await db.outboxEvent.count()).toBe(eventsBefore);
    expect(
      await db.auditLog.count({
        where: { subjectType: "mp_hold", subjectId: award.reservationId },
      }),
    ).toBe(auditsBefore);
    await expectWallet(driver, { clearedMinor: 99, heldMinor: 0 });

    // The same amendment passes once it fits exactly: the refusal left no
    // trace that could block a retry.
    await fundWallet(db, driver.wallet.id, driver.city.currency, 1);
    const retried = await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 5_010_00),
      uid("idem"),
    );
    expect(retried.replayed).toBe(false);
    await expectWallet(driver, { clearedMinor: 1_00, heldMinor: 1_00 });
  });

  it("counts the driver's live bid holds against the increment, like any reservation", async () => {
    const driver = await fundedDriver(700_00);
    const award = await capturedAward(driver, 5_000_00);
    // A live bid elsewhere encumbers 150.00 of the remaining 200.00.
    await reserveHold(
      deps,
      {
        driverId: driver.userId,
        bidRef: uid("bid"),
        requestRef: uid("req"),
        amountMinor: 150_00,
        baseMinor: 1_500_00,
        currency: driver.city.currency,
        policyVersion: 1,
        cityId: driver.city.cityId,
      },
      uid("idem"),
    );
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: { requiredMinor: 100_00, spendableMinor: 50_00 },
    });
  });
});

describe("a fare decrease: a linked partial reversal at commit", () => {
  it("refunds exactly prior − new to the driver, never more than captured", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");

    const refunded = await refundCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 4_000_00),
      uid("idem"),
    );
    expect(refunded.replayed).toBe(false);
    expect(refunded.delta).toMatchObject({
      direction: "decrease",
      state: "refunded",
      deltaReservationId: null,
      originalReceiptId: award.receiptId,
    });
    expect(refunded.delta.deltaMinor).toEqual(money(100_00, "NGN"));
    await expectWallet(driver, { clearedMinor: 600_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(400_00);

    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: refunded.delta.journalEntryId ?? "" },
      include: { lines: true },
    });
    expect(entry.kind).toBe("mp_commission_delta_refund");
    expect(entry.reference).toBe(
      `mp_award:${award.awardId}:amendment:${amendmentId}:refund`,
    );
    // The original capture is untouched: linked compensation, never an edit.
    const hold = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: award.reservationId },
    });
    expect(hold.state).toBe("captured");
    expect(Number(hold.amountMinor)).toBe(500_00);
    const reversedEvent = await db.outboxEvent.findFirstOrThrow({
      where: {
        name: "mp.commission.reversed",
        aggregateId: award.reservationId,
      },
    });
    expect(reversedEvent.payload).toMatchObject({
      kind: "amendment_delta_refund",
      partial: true,
      amendmentId,
      amountMinor: 100_00,
      priorTotalMinor: 500_00,
      newTotalMinor: 400_00,
    });

    // An identical replay answers the original receipt and refunds nothing.
    const replay = await refundCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 4_000_00),
      uid("idem"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.delta).toEqual(refunded.delta);
    await expectWallet(driver, { clearedMinor: 600_00, heldMinor: 0 });

    // The same amendment with different terms is refused, not re-applied.
    await expect(
      refundCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        terms(award, driver, 500_00, 3_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });
    // …and the same amendment can never also reserve an increase.
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        terms(award, driver, 400_00, 4_500_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expectWallet(driver, { clearedMinor: 600_00, heldMinor: 0 });
  });

  it("answers a stale prior total with 409 and the refreshed captured total", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);

    for (const attempt of [
      () =>
        refundCommissionDelta(
          deps,
          award.reservationId,
          uid("amd"),
          terms(award, driver, 450_00, 4_000_00),
          uid("idem"),
        ),
      () =>
        reserveCommissionDelta(
          deps,
          award.reservationId,
          uid("amd"),
          terms(award, driver, 450_00, 6_000_00),
          uid("idem"),
        ),
    ]) {
      const error = await attempt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ContractError);
      expect(error).toMatchObject({
        code: "version_conflict",
        status: 409,
        details: {
          refreshedTerms: { capturedTotalMinor: money(500_00, "NGN") },
        },
      });
    }
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(500_00);
  });
});

describe("a rejected or expired amendment releases its increment", () => {
  it("releases once, replays, and can never capture afterwards", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    const reserved = await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 6_000_00),
      uid("idem"),
    );
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_00 });

    const released = await releaseCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      { awardId: award.awardId, reason: "amendment_expired" },
      uid("idem"),
    );
    expect(released.replayed).toBe(false);
    expect(released.delta.state).toBe("released");
    expect(released.delta.deltaReservationId).toBe(
      reserved.delta.deltaReservationId,
    );
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });

    const replay = await releaseCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      { awardId: award.awardId, reason: "amendment_expired" },
      uid("idem"),
    );
    expect(replay.replayed).toBe(true);
    expect(
      await db.outboxEvent.count({
        where: {
          name: "mp.commission.released",
          aggregateId: reserved.delta.deltaReservationId ?? "",
        },
      }),
    ).toBe(1);

    await expect(
      captureCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        {
          awardId: award.awardId,
          newTotalMinor: 600_00,
          currency: driver.city.currency,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await feeSideCommission(award.awardId)).toBe(500_00);
  });

  it("a release that lands before the reserve closes the amendment: a late reserve is refused", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");

    const closed = await releaseCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      { awardId: award.awardId, reason: "amendment_rejected" },
      uid("idem"),
    );
    expect(closed.delta).toMatchObject({
      direction: "none",
      state: "released",
      priorTotalMinor: null,
    });
    expect(closed.delta.deltaMinor).toEqual(money(0, "NGN"));

    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });
  });
});

describe("concurrency and idempotency", () => {
  it("two concurrent captures of the same increment post exactly one debit", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 7_000_00),
      uid("idem"),
    );

    const capture = () =>
      captureCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        {
          awardId: award.awardId,
          newTotalMinor: 700_00,
          currency: driver.city.currency,
        },
        uid("idem"),
      );
    const results = await Promise.all([capture(), capture(), capture()]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.delta.receiptId)).size).toBe(
      1,
    );
    expect(
      await db.journalEntry.count({
        where: {
          kind: "mp_commission_delta_capture",
          reference: `mp_award:${award.awardId}:amendment:${amendmentId}`,
        },
      }),
    ).toBe(1);
    await expectWallet(driver, { clearedMinor: 300_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(700_00);
  });

  it("two concurrent reserves of the same amendment converge on one row; different terms conflict", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    const reserve = () =>
      reserveCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      );
    const results = await Promise.all([reserve(), reserve()]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results[0]?.delta.deltaReservationId).toBe(
      results[1]?.delta.deltaReservationId,
    );
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_00 });

    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        terms(award, driver, 500_00, 6_500_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_00 });
  });

  it("a concurrent refund and reserve under different amendments cannot both apply on one prior", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const outcomes = await Promise.allSettled([
      refundCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 4_000_00),
        uid("idem"),
      ),
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ]);
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Whichever lost saw a moved total (refund first) or an open delta
    // (reserve first) — both 409s, and nothing half-applied.
    expect(["version_conflict", "conflict"]).toContain(
      (rejected[0]?.reason as ContractError).code,
    );
    await expectEveryEntryBalanced(driver.wallet.id);
  });

  it("three concurrent refunds of the same amendment post exactly one partial reversal", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        refundCommissionDelta(
          deps,
          award.reservationId,
          amendmentId,
          terms(award, driver, 500_00, 4_000_00),
          uid("idem"),
        ),
      ),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.delta.receiptId)).size).toBe(
      1,
    );
    expect(
      await db.journalEntry.count({
        where: {
          kind: "mp_commission_delta_refund",
          reference: `mp_award:${award.awardId}:amendment:${amendmentId}:refund`,
        },
      }),
    ).toBe(1);
    await expectWallet(driver, { clearedMinor: 600_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(400_00);
  });

  it("a commit racing a rejection of the same increment: exactly one wins, nothing half-applied", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 6_000_00),
      uid("idem"),
    );
    const outcomes = await Promise.allSettled([
      captureCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        {
          awardId: award.awardId,
          newTotalMinor: 600_00,
          currency: driver.city.currency,
        },
        uid("idem"),
      ),
      releaseCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        { awardId: award.awardId, reason: "amendment_rejected" },
        uid("idem"),
      ),
    ]);
    const [captured, released] = outcomes;
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    expect((loser?.reason as ContractError).code).toBe("conflict");
    // Either the increment was debited once, or it was freed — never both,
    // and never left encumbering.
    if (captured?.status === "fulfilled") {
      await expectWallet(driver, { clearedMinor: 400_00, heldMinor: 0 });
      expect(await feeSideCommission(award.awardId)).toBe(600_00);
    } else {
      expect(released?.status).toBe("fulfilled");
      await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });
      expect(await feeSideCommission(award.awardId)).toBe(500_00);
    }
  });
});

describe("prefix scans are exact (LIKE metacharacters escaped)", () => {
  it("an award id whose '_' would be a LIKE wildcard never reads another award's amendment lines", async () => {
    // Prisma's startsWith is an unescaped LIKE: without escaping, award
    // `awd_<x>`'s scan `award:awd_<x>:amendment:%` also matches award
    // `awdQ<x>`'s amendment lines on the same driver wallet.
    const driver = await fundedDriver(2_000_00);
    const suffix = uid("x").replace(/_/g, "");
    const neighbour = await capturedAwardWithId(
      driver,
      5_000_00,
      `awdQ${suffix}`,
    );
    const award = await capturedAwardWithId(driver, 5_000_00, `awd_${suffix}`);

    // The neighbour's fee rises to 600.00.
    const raise = uid("amd");
    await reserveCommissionDelta(
      deps,
      neighbour.reservationId,
      raise,
      terms(neighbour, driver, 500_00, 6_000_00),
      uid("idem"),
    );
    await captureCommissionDelta(
      deps,
      neighbour.reservationId,
      raise,
      {
        awardId: neighbour.awardId,
        newTotalMinor: 600_00,
        currency: driver.city.currency,
      },
      uid("idem"),
    );

    // The other award's captured total is still exactly its own 500.00…
    const refunded = await refundCommissionDelta(
      deps,
      award.reservationId,
      uid("amd"),
      terms(award, driver, 500_00, 4_000_00),
      uid("idem"),
    );
    expect(refunded.delta.priorTotalMinor).toEqual(money(500_00, "NGN"));
    // …and its reversal hands back only its own net 400.00.
    await reverseCapturedHold(
      deps,
      award.reservationId,
      { awardId: award.awardId, reason: "award_cancelled" },
      uid("idem"),
    );
    expect(await feeSideCommission(award.awardId)).toBe(0);
    // 2,000.00 − 600.00 (neighbour) − 500.00 + 100.00 + 400.00 (award).
    await expectWallet(driver, { clearedMinor: 1_400_00, heldMinor: 0 });
    // The neighbour's increment row was not swept by the other reversal.
    const increment = await db.mpCommissionHold.findUniqueOrThrow({
      where: { bidRef: `mpdelta:${neighbour.reservationId}:${raise}` },
    });
    expect(increment.state).toBe("captured");
  });
});

describe("several amendments on one award", () => {
  it("increase, decrease, increase again, then a full reversal — exact after every step", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const start = 1_000_00;
    const commissionOf = commissionMinorFor;

    // A: 5,000.00 → 6,000.00 (+100.00 reserved, then captured).
    const a = uid("amd");
    await reserveCommissionDelta(
      deps,
      award.reservationId,
      a,
      terms(award, driver, commissionOf(5_000_00), 6_000_00),
      uid("idem"),
    );
    await expectWallet(driver, {
      clearedMinor: start - 500_00,
      heldMinor: 100_00,
    });
    // One open delta per award: a second amendment waits for A to resolve.
    await expect(
      refundCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 4_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await captureCommissionDelta(
      deps,
      award.reservationId,
      a,
      {
        awardId: award.awardId,
        newTotalMinor: 600_00,
        currency: driver.city.currency,
      },
      uid("idem"),
    );
    await expectWallet(driver, { clearedMinor: start - 600_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(commissionOf(6_000_00));

    // B: 6,000.00 → 5,500.00 (a partial reversal of 50.00).
    await refundCommissionDelta(
      deps,
      award.reservationId,
      uid("amd"),
      terms(award, driver, 600_00, 5_500_00),
      uid("idem"),
    );
    await expectWallet(driver, { clearedMinor: start - 550_00, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(commissionOf(5_500_00));

    // C: 5,500.00 → 5,505.00 — the half-up rounding adds exactly 0.50.
    const c = uid("amd");
    const cReserved = await reserveCommissionDelta(
      deps,
      award.reservationId,
      c,
      terms(award, driver, 550_00, 5_505_00),
      uid("idem"),
    );
    expect(cReserved.delta.deltaMinor).toEqual(money(50, "NGN"));
    await captureCommissionDelta(
      deps,
      award.reservationId,
      c,
      {
        awardId: award.awardId,
        newTotalMinor: commissionOf(5_505_00),
        currency: driver.city.currency,
      },
      uid("idem"),
    );
    const finalCommission = commissionOf(5_505_00);
    expect(finalCommission).toBe(550_50);
    await expectWallet(driver, {
      clearedMinor: start - finalCommission,
      heldMinor: 0,
    });
    expect(await feeSideCommission(award.awardId)).toBe(finalCommission);
    // Still exactly one original 10% capture.
    expect(
      await db.journalEntry.count({
        where: {
          kind: "mp_commission_capture",
          reference: `mp_award:${award.awardId}`,
        },
      }),
    ).toBe(1);

    // The award is then cancelled: the reversal hands back the NET captured
    // commission — not the original 500.00 — so the award nets to zero.
    const reversed = await reverseCapturedHold(
      deps,
      award.reservationId,
      { awardId: award.awardId, reason: "award_cancelled_after_amendments" },
      uid("idem"),
    );
    expect(reversed.hold.state).toBe("reversed");
    await expectWallet(driver, { clearedMinor: start, heldMinor: 0 });
    expect(await feeSideCommission(award.awardId)).toBe(0);
    const deltaRows = await db.mpCommissionHold.findMany({
      where: { bidRef: { startsWith: `mpdelta:${award.reservationId}:` } },
    });
    expect(deltaRows.map((row) => row.state).sort()).toEqual([
      "reversed",
      "reversed",
    ]);
    const original = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: award.reservationId },
    });
    const reversal = await db.journalLine.findFirstOrThrow({
      where: { entryId: original.reversalEntryId ?? "", account: "wallet" },
    });
    expect(Number(reversal.amountMinor)).toBe(finalCommission);

    // A reversed award can no longer be amended.
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 0, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("the award's reversal releases an increment still only reserved", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const amendmentId = uid("amd");
    const reserved = await reserveCommissionDelta(
      deps,
      award.reservationId,
      amendmentId,
      terms(award, driver, 500_00, 6_000_00),
      uid("idem"),
    );
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_00 });

    await reverseCapturedHold(
      deps,
      award.reservationId,
      { awardId: award.awardId, reason: "award_cancelled" },
      uid("idem"),
    );
    // Only the captured 500.00 goes back; the reserved 100.00 simply stops
    // encumbering.
    await expectWallet(driver, { clearedMinor: 1_000_00, heldMinor: 0 });
    const row = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: reserved.delta.deltaReservationId ?? "" },
    });
    expect(row.state).toBe("released");
    await expect(
      captureCommissionDelta(
        deps,
        award.reservationId,
        amendmentId,
        {
          awardId: award.awardId,
          newTotalMinor: 600_00,
          currency: driver.city.currency,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("validation and linkage", () => {
  it("refuses a currency mismatch (422), a new total that is not 10% of the new fare, and the wrong direction", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);

    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        { ...terms(award, driver, 500_00, 6_000_00), currency: "KES" },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    await expect(
      refundCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        { ...terms(award, driver, 500_00, 4_000_00), currency: "KES" },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    // Client-side money: 590.00 is not 10% of 6,000.00.
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        {
          ...terms(award, driver, 500_00, 6_000_00),
          newTotalMinor: 590_00,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { expectedMinor: 600_00 },
    });
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 4_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      refundCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    // Amendment ids travel inside composite keys: no separators.
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        "amd:1",
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 0 });
  });

  it("amends only a captured reservation, under its own award", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    await expect(
      reserveCommissionDelta(
        deps,
        award.reservationId,
        uid("amd"),
        { ...terms(award, driver, 500_00, 6_000_00), awardId: uid("awd") },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    // A live (uncaptured) bid hold is adjusted, not amended.
    const live = await reserveHold(
      deps,
      {
        driverId: driver.userId,
        bidRef: uid("bid"),
        requestRef: uid("req"),
        amountMinor: 100_00,
        baseMinor: 1_000_00,
        currency: driver.city.currency,
        policyVersion: 1,
        cityId: driver.city.cityId,
      },
      uid("idem"),
    );
    await expect(
      refundCommissionDelta(
        deps,
        live.hold.reservationId,
        uid("amd"),
        {
          awardId: uid("awd"),
          priorTotalMinor: 100_00,
          newTotalMinor: 50_00,
          newBaseMinor: 500_00,
          currency: driver.city.currency,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      reserveCommissionDelta(
        deps,
        uid("mph"),
        uid("amd"),
        terms(award, driver, 500_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("the generic bid-hold operations refuse an increment row, and the delta namespace is reserved", async () => {
    const driver = await fundedDriver(1_000_00);
    const award = await capturedAward(driver, 5_000_00);
    const reserved = await reserveCommissionDelta(
      deps,
      award.reservationId,
      uid("amd"),
      terms(award, driver, 500_00, 6_000_00),
      uid("idem"),
    );
    const deltaId = reserved.delta.deltaReservationId ?? "";

    await expect(
      captureHold(
        deps,
        deltaId,
        { awardId: award.awardId, expectedAmountMinor: money(100_00, "NGN") },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(releaseHold(deps, deltaId, uid("idem"))).rejects.toMatchObject(
      { code: "conflict" },
    );
    await expect(
      reverseCapturedHold(
        deps,
        deltaId,
        { awardId: award.awardId, reason: "wrong_route" },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      reserveCommissionDelta(
        deps,
        deltaId,
        uid("amd"),
        terms(award, driver, 100_00, 6_000_00),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      reserveHold(
        deps,
        {
          driverId: driver.userId,
          bidRef: `mpdelta:${award.reservationId}:squat`,
          requestRef: uid("req"),
          amountMinor: 100_00,
          baseMinor: 1_000_00,
          currency: driver.city.currency,
          policyVersion: 1,
          cityId: driver.city.cityId,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expectWallet(driver, { clearedMinor: 500_00, heldMinor: 100_00 });
  });
});
