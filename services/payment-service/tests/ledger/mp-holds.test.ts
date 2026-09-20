/**
 * Marketplace commission reservations (M04) against a real Postgres.
 *
 * The subject is the worked example from the design pack: holds are table
 * rows, never journal movements — the wallet's total stays put while a bid is
 * live and only *spendable* drops — and the 10% fee moves exactly once, at
 * selection, under the award id.
 */
import { commissionMinorFor, ContractError, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  activeHoldsMinor,
  balanceOf,
  spendableOf,
} from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import {
  adjustHold,
  captureHold,
  getMpWalletOverview,
  releaseHold,
  reserveHold,
  reverseCapturedHold,
} from "../../src/ledger/mp-holds";
import { postMarketplaceCompletion } from "../../src/ledger/ride-posting";
import { sendTransfer } from "../../src/ledger/transfers";
import { setInitialPin } from "../../src/ledger/wallet-ops";
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
const PIN = "8080";

/** Wallets this file creates, so its holds can be swept afterwards. */
const createdWalletIds: string[] = [];

afterAll(async () => {
  // The suite shares one database across files; sweep this file's holds so
  // nothing it reserved can encumber anyone else's arithmetic.
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Funded {
  readonly city: SeededCity;
  readonly userId: string;
  readonly wallet: WalletRecord;
}

async function fundedUser(
  city: SeededCity,
  amountMinor: number,
  name = "Driver",
): Promise<Funded> {
  const user = await seedUser(db, name);
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

function reserveInput(
  funded: Funded,
  commissionMinor: number,
  overrides: Partial<Parameters<typeof reserveHold>[1]> = {},
) {
  // The base is the bid fare; the hold is the ONE commission function's
  // answer for it, or the reserve is refused.
  return {
    driverId: funded.userId,
    bidRef: uid("bid"),
    requestRef: uid("req"),
    amountMinor: commissionMinor,
    baseMinor: commissionMinor * 10,
    currency: funded.city.currency,
    policyVersion: 1,
    cityId: funded.city.cityId,
    ...overrides,
  };
}

async function entrySumMinor(entryId: string): Promise<number> {
  const lines = await db.journalLine.findMany({ where: { entryId } });
  return lines.reduce((total, line) => total + Number(line.amountMinor), 0);
}

describe("the worked example, end to end", () => {
  it("holds without moving money, captures once, and never charges the fee twice", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);

    // Section 1 — wallet ₦1,000.00; a live bid on a ₦5,000.00 fare reserves
    // the full ₦500.00 commission. The TOTAL does not move; spendable does.
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );
    expect(reserved.replayed).toBe(false);
    expect(reserved.hold.state).toBe("active");
    expect(reserved.hold.amountMinor).toEqual(money(500_00, city.currency));
    expect(reserved.hold.commissionBps).toBe(1_000);
    expect(reserved.hold.roundingRule).toBe("half_up");
    expect(commissionMinorFor(5_000_00)).toBe(500_00);

    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
    expect(await spendableOf(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );

    const overview = await getMpWalletOverview(deps, driver.userId, city.cityId);
    expect(overview.clearedMinor).toEqual(money(1_000_00, city.currency));
    expect(overview.heldMinor).toEqual(money(500_00, city.currency));
    expect(overview.spendableMinor).toEqual(money(500_00, city.currency));
    expect(overview.holds).toHaveLength(1);
    expect(overview.holds[0]?.reservationId).toBe(reserved.hold.reservationId);

    // Section 2 — selection captures the fee exactly once: balance ₦500.00,
    // nothing held any more, and the journal entry balances to zero.
    const awardId = uid("awd");
    const captured = await captureHold(
      deps,
      reserved.hold.reservationId,
      { awardId, expectedAmountMinor: money(500_00, city.currency) },
      uid("idem"),
    );
    expect(captured.replayed).toBe(false);
    expect(captured.hold.state).toBe("captured");
    expect(captured.receiptId).toMatch(/^mcr/);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );
    expect(await entrySumMinor(captured.journalEntryId)).toBe(0);
    const captureEntry = await db.journalEntry.findUniqueOrThrow({
      where: { id: captured.journalEntryId },
    });
    expect(captureEntry.kind).toBe("mp_commission_capture");
    expect(captureEntry.reference).toBe(`mp_award:${awardId}`);

    // Section 2, digital settlement — the completion credits the FULL
    // ₦5,000.00 fare; the fee already left at selection. Final: ₦5,500.00.
    const rider = await fundedUser(city, 6_000_00, "Rider");
    const completion = await db.$transaction((tx) =>
      postMarketplaceCompletion(tx, {
        rideId: uid("ride"),
        awardId,
        method: "wallet",
        riderWalletId: rider.wallet.id,
        driverWalletId: driver.wallet.id,
        fareMinor: 5_000_00,
        currency: city.currency,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );
    expect(completion.entry).not.toBeNull();
    expect(completion.entry?.kind).toBe("mp_ride_completion");
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(5_500_00, city.currency),
    );
    // No second fee: the completion entry carries no commission line at all.
    expect(
      completion.entry?.lines.some((line) => line.account === "ubi_commission"),
    ).toBe(false);
    expect(await entrySumMinor(completion.entry?.id ?? "")).toBe(0);

    // Section 3, cash settlement — the driver collected the fare in cash and
    // the fee was already captured, so completion posts NOTHING: no
    // cash_owed, no second commission.
    const cashDriver = await fundedUser(city, 1_000_00, "CashDriver");
    const cashReserved = await reserveHold(
      deps,
      reserveInput(cashDriver, 500_00),
      uid("idem"),
    );
    const cashAward = uid("awd");
    await captureHold(
      deps,
      cashReserved.hold.reservationId,
      {
        awardId: cashAward,
        expectedAmountMinor: money(500_00, city.currency),
      },
      uid("idem"),
    );
    const cashRideId = uid("ride");
    const cashCompletion = await db.$transaction((tx) =>
      postMarketplaceCompletion(tx, {
        rideId: cashRideId,
        awardId: cashAward,
        method: "cash",
        driverWalletId: cashDriver.wallet.id,
        fareMinor: 5_000_00,
        currency: city.currency,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );
    expect(cashCompletion.entry).toBeNull();
    const cashOwedLines = await db.journalLine.count({
      where: {
        account: "cash_owed",
        counterpartRef: { startsWith: `mp_ride:${cashRideId}` },
      },
    });
    expect(cashOwedLines).toBe(0);
    // The driver's wallet moved once for this trip: the ₦500.00 capture.
    expect(await balanceOf(db, cashDriver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
  });
});

describe("reserving against spendable funds", () => {
  it("passes an exactly-funded bid and refuses one a single minor unit short", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);

    const exact = await fundedUser(city, 500_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(exact, 500_00),
      uid("idem"),
    );
    expect(reserved.hold.state).toBe("active");
    expect(await spendableOf(db, exact.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );

    const short = await fundedUser(city, 500_00 - 1);
    await expect(
      reserveHold(deps, reserveInput(short, 500_00), uid("idem")),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 1 }),
    });
    // Nothing was reserved on the failed attempt.
    expect(await activeHoldsMinor(db, short.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );
  });

  it("reserves per live bid — a second bid never reuses the first bid's hold", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);

    await reserveHold(deps, reserveInput(driver, 600_00), uid("idem"));

    // Wallet 1,000.00, hold A 600.00 → bid B needing 500.00 is short exactly
    // 100.00. Independent holds; no netting, no sharing.
    await expect(
      reserveHold(deps, reserveInput(driver, 500_00), uid("idem")),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 100_00 }),
    });
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(600_00, city.currency),
    );
  });

  it("refuses an amount that is not the one commission function's answer", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    await expect(
      reserveHold(
        deps,
        reserveInput(driver, 500_00, { baseMinor: 4_000_00 }),
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("adjusting a hold atomically", () => {
  it("raises only when the delta fits spendable, and the old hold survives a refused raise", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    // Raise 500.00 → 600.00: the 100.00 delta fits the 500.00 spendable.
    const raised = await adjustHold(
      deps,
      reserved.hold.reservationId,
      { amountMinor: 600_00, baseMinor: 6_000_00, currency: city.currency },
      uid("idem"),
    );
    expect(raised.hold.amountMinor).toEqual(money(600_00, city.currency));
    expect(raised.hold.state).toBe("active");
    expect(await spendableOf(db, driver.wallet.id, city.currency)).toEqual(
      money(400_00, city.currency),
    );

    // Raise 600.00 → 1,100.00: the 500.00 delta does not fit 400.00. The
    // error carries the exact shortfall and the hold is exactly as it was.
    await expect(
      adjustHold(
        deps,
        reserved.hold.reservationId,
        {
          amountMinor: 1_100_00,
          baseMinor: 11_000_00,
          currency: city.currency,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 100_00 }),
    });
    const untouched = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: reserved.hold.reservationId },
    });
    expect(Number(untouched.amountMinor)).toBe(600_00);
    expect(untouched.state).toBe("active");

    // Lower 600.00 → 300.00 releases the difference atomically.
    const lowered = await adjustHold(
      deps,
      reserved.hold.reservationId,
      { amountMinor: 300_00, baseMinor: 3_000_00, currency: city.currency },
      uid("idem"),
    );
    expect(lowered.hold.amountMinor).toEqual(money(300_00, city.currency));
    expect(await spendableOf(db, driver.wallet.id, city.currency)).toEqual(
      money(700_00, city.currency),
    );
  });
});

describe("releasing a hold", () => {
  it("releases exactly once and replays the original on a repeat", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    const released = await releaseHold(
      deps,
      reserved.hold.reservationId,
      uid("idem"),
    );
    expect(released.replayed).toBe(false);
    expect(released.hold.state).toBe("released");
    expect(released.hold.releasedAt).not.toBeNull();
    expect(await spendableOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );

    const replay = await releaseHold(
      deps,
      reserved.hold.reservationId,
      uid("idem"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.hold.releasedAt).toBe(released.hold.releasedAt);
    // The wallet total never moved: holds are rows, not journal lines.
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );
  });

  it("refuses to release a hold whose award capture is unresolved", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    // An award whose capture outcome is unknown parks the hold in
    // capture_pending (mpAward: unknown outcomes stay pending until
    // reconciled). Such a hold neither expires nor releases.
    await db.mpCommissionHold.update({
      where: { id: reserved.hold.reservationId },
      data: { state: "capture_pending", awardRef: uid("awd") },
    });

    await expect(
      releaseHold(deps, reserved.hold.reservationId, uid("idem")),
    ).rejects.toMatchObject({ code: "award_unresolved" });

    // Still encumbering spendable — the money stays spoken for.
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
  });
});

describe("capturing and reversing under the award id", () => {
  it("captures exactly once per award, replays the receipt, and conflicts on a different award", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    const awardId = uid("awd");
    const first = await captureHold(
      deps,
      reserved.hold.reservationId,
      { awardId, expectedAmountMinor: money(500_00, city.currency) },
      uid("idem"),
    );
    // A retry under a DIFFERENT client key still answers the original
    // receipt: the award id is the idempotency authority (ADR 0002).
    const replay = await captureHold(
      deps,
      reserved.hold.reservationId,
      { awardId, expectedAmountMinor: money(500_00, city.currency) },
      uid("idem"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.receiptId).toBe(first.receiptId);
    expect(replay.journalEntryId).toBe(first.journalEntryId);

    const captureEntries = await db.journalEntry.count({
      where: { kind: "mp_commission_capture", reference: `mp_award:${awardId}` },
    });
    expect(captureEntries).toBe(1);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );

    await expect(
      captureHold(
        deps,
        reserved.hold.reservationId,
        {
          awardId: uid("awd"),
          expectedAmountMinor: money(500_00, city.currency),
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    // Reversal is a LINKED compensating entry, never an edit: the capture
    // entry survives, a new entry restores the wallet, and the pair is
    // traceable through the award refs.
    const reversed = await reverseCapturedHold(
      deps,
      reserved.hold.reservationId,
      { awardId, reason: "award_cancelled_pre_service" },
      uid("idem"),
    );
    expect(reversed.hold.state).toBe("reversed");
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );

    const row = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: reserved.hold.reservationId },
    });
    expect(row.journalEntryId).toBe(first.journalEntryId);
    expect(row.reversalEntryId).not.toBeNull();
    expect(row.reversalEntryId).not.toBe(first.journalEntryId);
    const reversal = await db.journalEntry.findUniqueOrThrow({
      where: { id: row.reversalEntryId ?? "" },
    });
    expect(reversal.kind).toBe("mp_commission_reversal");
    expect(reversal.reference).toBe(`mp_award:${awardId}:reversal`);
    expect(await entrySumMinor(reversal.id)).toBe(0);
    // The original capture entry is still there, untouched.
    expect(
      await db.journalEntry.count({ where: { id: first.journalEntryId } }),
    ).toBe(1);

    // Reversing again replays; the wallet is not credited twice.
    const reverseReplay = await reverseCapturedHold(
      deps,
      reserved.hold.reservationId,
      { awardId, reason: "award_cancelled_pre_service" },
      uid("idem"),
    );
    expect(reverseReplay.replayed).toBe(true);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );
  });
});

describe("capture against the award's pinned commission", () => {
  it("refuses — before any state change — when a revise-raise moved the hold off the awarded terms", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    // The revise-raise race: after the award pinned 500.00, an adjust
    // raises the hold to 600.00 before the capture step lands.
    await adjustHold(
      deps,
      reserved.hold.reservationId,
      { amountMinor: 600_00, baseMinor: 6_000_00, currency: city.currency },
      uid("idem"),
    );

    const awardId = uid("awd");
    await expect(
      captureHold(
        deps,
        reserved.hold.reservationId,
        { awardId, expectedAmountMinor: money(500_00, city.currency) },
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: expect.objectContaining({
        holdAmountMinor: 600_00,
        expectedAmountMinor: 500_00,
      }),
    });

    // Nothing changed: the hold is still active at 600.00, no journal entry
    // was posted, the wallet balance never moved.
    const row = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: reserved.hold.reservationId },
    });
    expect(row.state).toBe("active");
    expect(row.awardRef).toBeNull();
    expect(Number(row.amountMinor)).toBe(600_00);
    expect(
      await db.journalEntry.count({
        where: { reference: `mp_award:${awardId}` },
      }),
    ).toBe(0);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );

    // The saga can still capture the terms that WERE awarded once the hold
    // is back on them (compensation adjusted it down again).
    await adjustHold(
      deps,
      reserved.hold.reservationId,
      { amountMinor: 500_00, baseMinor: 5_000_00, currency: city.currency },
      uid("idem"),
    );
    const captured = await captureHold(
      deps,
      reserved.hold.reservationId,
      { awardId, expectedAmountMinor: money(500_00, city.currency) },
      uid("idem"),
    );
    expect(captured.hold.state).toBe("captured");
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );

    // Idempotent replay for the same award still answers the original
    // receipt, whatever client key it arrives under.
    const replay = await captureHold(
      deps,
      reserved.hold.reservationId,
      { awardId, expectedAmountMinor: money(500_00, city.currency) },
      uid("idem"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.receiptId).toBe(captured.receiptId);
  });

  it("refuses a capture whose expected currency is not the hold's", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    await expect(
      captureHold(
        deps,
        reserved.hold.reservationId,
        { awardId: uid("awd"), expectedAmountMinor: money(500_00, "GHS") },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );
  });
});

describe("the Money bodies' currency", () => {
  it("refuses a reserve denominated in a currency that is not the city's", async () => {
    const city = await seedCity(db); // NGN
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);

    await expect(
      reserveHold(
        deps,
        reserveInput(driver, 500_00, { currency: "GHS" }),
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: expect.objectContaining({
        currency: "GHS",
        cityCurrency: city.currency,
      }),
    });
    // Nothing was reserved — the mismatch was refused, not re-denominated.
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );
  });

  it("refuses an adjust denominated in a currency that is not the hold's", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const reserved = await reserveHold(
      deps,
      reserveInput(driver, 500_00),
      uid("idem"),
    );

    await expect(
      adjustHold(
        deps,
        reserved.hold.reservationId,
        { amountMinor: 600_00, baseMinor: 6_000_00, currency: "GHS" },
        uid("idem"),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const row = await db.mpCommissionHold.findUniqueOrThrow({
      where: { id: reserved.hold.reservationId },
    });
    expect(Number(row.amountMinor)).toBe(500_00);
  });
});

describe("holds versus the other debit paths", () => {
  it("a transfer racing an active hold cannot overspend spendable", async () => {
    const city = await seedCity(db, {
      policy: {
        velocityMaxTransfers: 50,
        newRecipientHoldAboveMinor: 100_000_000,
      },
    });
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);
    const recipient = await seedUser(db, "Recipient");
    await setInitialPin(
      deps,
      { id: driver.userId, role: "rider" },
      city.cityId,
      PIN,
    );

    // A 600.00 hold and a 600.00 transfer against a 1,000.00 balance,
    // launched together. The wallet row lock serialises them; whichever
    // lands second finds only 400.00 spendable.
    const results = await Promise.allSettled([
      reserveHold(deps, reserveInput(driver, 600_00), uid("idem")),
      sendTransfer(deps, {
        actor: { id: driver.userId, role: "rider" },
        cityId: city.cityId,
        toUserId: recipient.id,
        amountMinor: 600_00,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ]);

    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult)
      .reason as ContractError;
    expect(reason.code).toBe("insufficient_spendable");

    const balance = await balanceOf(db, driver.wallet.id, city.currency);
    const held = await activeHoldsMinor(db, driver.wallet.id, city.currency);
    // Whoever won, the invariant holds: nothing spent past spendable.
    expect(balance.amountMinor - held.amountMinor).toBeGreaterThanOrEqual(0);

    // And sequentially: while the hold (or the spent balance) stands, a
    // payment needing more than spendable is refused with the shortfall.
    await expect(
      sendTransfer(deps, {
        actor: { id: driver.userId, role: "rider" },
        cityId: city.cityId,
        toUserId: recipient.id,
        amountMinor: 500_00,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 100_00 }),
    });
  });
});

describe("idempotency and payload hashing", () => {
  it("replays the same key with the same body, and refuses the same key with a different body", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);

    const key = uid("idem");
    const input = reserveInput(driver, 500_00);
    const first = await reserveHold(deps, input, key);
    expect(first.replayed).toBe(false);

    const replay = await reserveHold(deps, input, key);
    expect(replay.replayed).toBe(true);
    expect(replay.hold.reservationId).toBe(first.hold.reservationId);
    // Replay decided nothing new: still exactly one hold.
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );

    // Same key, different body: a caller bug, refused — never answered with
    // the other request's outcome.
    await expect(
      reserveHold(
        deps,
        { ...input, amountMinor: 400_00, baseMinor: 4_000_00 },
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse" });
  });

  it("posts once when the same reserve key arrives twice at the same moment", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const driver = await fundedUser(city, 1_000_00);

    const key = uid("idem");
    const input = reserveInput(driver, 500_00);
    const results = await Promise.all([
      reserveHold(deps, input, key),
      reserveHold(deps, input, key),
    ]);
    expect(results[0]?.hold.reservationId).toBe(
      results[1]?.hold.reservationId,
    );
    expect(await activeHoldsMinor(db, driver.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
  });
});
