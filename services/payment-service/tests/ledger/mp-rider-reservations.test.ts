/**
 * Rider funding reservations (C02): the durable encumbrance behind a
 * marketplace selection.
 *
 * What these tests prove, against a real database:
 *  - the wallet row lock makes competing authorizations serialize, so two
 *    selections can never both pass on the same money;
 *  - the award id is the idempotency authority — one reservation per award,
 *    identical replays converge, different terms conflict;
 *  - release is exactly-once and forgiving (missing/released answer state,
 *    consumed is reported distinctly);
 *  - settlement CONSUMES the reservation in the same transaction as the fare
 *    postings, exactly once, and a replay changes nothing;
 *  - the award reversal path frees the reservation in the same transaction
 *    that hands the commission back.
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
import { captureHold, reserveHold } from "../../src/ledger/mp-holds";
import { reverseCapturedHold } from "../../src/ledger/mp-holds";
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

async function riderWith(amountMinor: number): Promise<{
  cityId: string;
  currency: string;
  userId: string;
  walletId: string;
}> {
  const city = await seedCity(db);
  const user = await seedUser(db, "Rider");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return {
    cityId: city.cityId,
    currency: city.currency,
    userId: user.id,
    walletId: wallet.id,
  };
}

function input(
  rider: { cityId: string; currency: string; userId: string },
  amountMinor: number,
  awardId = uid("awd"),
) {
  return {
    requesterId: rider.userId,
    requestId: uid("mpr"),
    awardId,
    paymentMethodId: "wallet",
    amountMinor,
    currency: rider.currency,
    cityId: rider.cityId,
  };
}

describe("reservation serialization under the wallet lock", () => {
  it("two concurrent authorizes whose sum exceeds spendable admit exactly one", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);

    const [a, b] = await Promise.allSettled([
      authorizeMarketplaceFunding(deps, input(rider, 300_000)),
      authorizeMarketplaceFunding(deps, input(rider, 300_000)),
    ]);

    const outcomes = [a, b];
    const wins = outcomes.filter((o) => o.status === "fulfilled");
    const losses = outcomes.filter((o) => o.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "insufficient_funds",
      details: { shortfallMinor: 100_000 },
    });

    // Exactly one reservation stands; spendable dropped exactly once.
    expect(
      await db.mpRiderReservation.count({
        where: { walletId: rider.walletId, status: "active" },
      }),
    ).toBe(1);
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(200_000, rider.currency),
    );
  });

  it("a duplicate authorize for the same award converges on one row; different terms conflict", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);
    const body = input(rider, 200_000);

    const first = await authorizeMarketplaceFunding(deps, body);
    const replay = await authorizeMarketplaceFunding(deps, body);
    expect(replay.reservationId).toBe(first.reservationId);
    expect(
      await db.mpRiderReservation.count({ where: { awardId: body.awardId } }),
    ).toBe(1);
    // Spendable dropped once, not twice.
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(300_000, rider.currency),
    );

    // A replay with different terms is a caller bug, not a bigger hold.
    await expect(
      authorizeMarketplaceFunding(deps, { ...body, amountMinor: 250_000 }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      authorizeMarketplaceFunding(deps, {
        ...body,
        requesterId: uid("other"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a reservation and a commission hold both subtract from the one spendable", async () => {
    const rider = await riderWith(1_000_000);
    const deps = makeDeps(db);

    await authorizeMarketplaceFunding(deps, input(rider, 400_000));
    await reserveHold(
      deps,
      {
        driverId: rider.userId,
        bidRef: uid("bid"),
        requestRef: uid("mpr"),
        amountMinor: 100_000,
        baseMinor: 1_000_000,
        currency: rider.currency,
        policyVersion: 1,
        cityId: rider.cityId,
      },
      uid("idem"),
    );

    expect(await balanceOf(db, rider.walletId, rider.currency)).toEqual(
      money(1_000_000, rider.currency),
    );
    expect(
      await activeRiderReservationsMinor(db, rider.walletId, rider.currency),
    ).toEqual(money(400_000, rider.currency));
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(500_000, rider.currency),
    );
  });
});

describe("release idempotency", () => {
  it("releases an active reservation once, answers current state on replays, and reports consumed distinctly", async () => {
    const rider = await riderWith(500_000);
    const driver = await riderWith(0);
    const deps = makeDeps(db);
    const body = input(rider, 300_000);

    await authorizeMarketplaceFunding(deps, body);

    const released = await releaseMarketplaceFunding(deps, {
      awardId: body.awardId,
      reason: "capture_refused",
    });
    expect(released).toMatchObject({ released: true, status: "released" });
    // The encumbrance is gone and the reason is on the row.
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(500_000, rider.currency),
    );
    const row = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: body.awardId },
    });
    expect(row.status).toBe("released");
    expect(row.reason).toBe("capture_refused");
    expect(row.resolvedAt).not.toBeNull();

    // A replay answers the current state without erroring or double-freeing.
    const replay = await releaseMarketplaceFunding(deps, {
      awardId: body.awardId,
      reason: "capture_refused",
    });
    expect(replay).toMatchObject({ released: false, status: "released" });

    // A release for an award that never had a reservation answers `missing`.
    const missing = await releaseMarketplaceFunding(deps, {
      awardId: uid("awd"),
      reason: "sweep_retry",
    });
    expect(missing).toMatchObject({
      released: false,
      status: "missing",
      reservationId: null,
    });

    // A CONSUMED reservation is a distinct answer — the caller must alarm,
    // because the award already settled with this money.
    const settledBody = input(rider, 200_000);
    await authorizeMarketplaceFunding(deps, settledBody);
    await settleMarketplaceCompletion(deps, {
      awardId: settledBody.awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(200_000, rider.currency),
      method: "wallet",
      cityId: rider.cityId,
    });
    const consumed = await releaseMarketplaceFunding(deps, {
      awardId: settledBody.awardId,
      reason: "late_compensation",
    });
    expect(consumed).toMatchObject({ released: false, status: "consumed" });
  });
});

describe("settlement consumption (exactly once)", () => {
  it("consumes the reservation in the settlement transaction — even when the rider holds EXACTLY the fare", async () => {
    const rider = await riderWith(500_000);
    const driver = await riderWith(0);
    const deps = makeDeps(db);
    const body = input(rider, 500_000);

    await authorizeMarketplaceFunding(deps, body);
    // Every minor unit is encumbered by the award's own reservation. The
    // settlement must still debit: consumption ends the encumbrance in the
    // same transaction, never before, never after.
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(0, rider.currency),
    );

    const settleInput = {
      awardId: body.awardId,
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(500_000, rider.currency),
      method: "wallet" as const,
      cityId: rider.cityId,
    };
    const first = await settleMarketplaceCompletion(deps, settleInput);
    expect(first.replayed).toBe(false);
    expect(first.journalEntryId).not.toBeNull();

    const row = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: body.awardId },
    });
    expect(row.status).toBe("consumed");
    expect(row.resolvedAt).not.toBeNull();
    expect(await balanceOf(db, rider.walletId, rider.currency)).toEqual(
      money(0, rider.currency),
    );
    expect(await balanceOf(db, driver.walletId, driver.currency)).toEqual(
      money(500_000, rider.currency),
    );

    const journalCount = async () =>
      db.journalEntry.count({
        where: { reference: `mp_ride:${settleInput.executionRef.id}` },
      });
    const consumedAudits = async () =>
      db.auditLog.count({
        where: {
          action: "wallet.mp_funding.consumed",
          subjectId: body.awardId,
        },
      });
    expect(await journalCount()).toBe(1);
    expect(await consumedAudits()).toBe(1);

    // A duplicate settlement replay answers the original outcome and cannot
    // double-consume: journal, reservation and audit trail all unchanged.
    const replay = await settleMarketplaceCompletion(deps, settleInput);
    expect(replay.replayed).toBe(true);
    expect(replay.journalEntryId).toBe(first.journalEntryId);
    expect(await journalCount()).toBe(1);
    expect(await consumedAudits()).toBe(1);
    const after = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: body.awardId },
    });
    expect(after.status).toBe("consumed");
    expect(after.resolvedAt).toEqual(row.resolvedAt);
  });

  it("settles a wallet award that has NO reservation — but writes an explicit audit anomaly", async () => {
    const rider = await riderWith(500_000);
    const driver = await riderWith(0);
    const deps = makeDeps(db);
    const awardId = uid("awd");

    const result = await settleMarketplaceCompletion(deps, {
      awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(200_000, rider.currency),
      method: "wallet",
      cityId: rider.cityId,
    });
    expect(result.settled).toBe(true);
    expect(await balanceOf(db, driver.walletId, driver.currency)).toEqual(
      money(200_000, rider.currency),
    );

    const anomaly = await db.auditLog.findFirst({
      where: {
        action: "wallet.mp_funding.reservation_anomaly",
        subjectId: awardId,
      },
    });
    expect(anomaly).not.toBeNull();
    expect(anomaly?.after).toMatchObject({
      anomaly: "wallet settlement without an active funding reservation",
    });
  });

  it("a cash settlement records no anomaly — cash awards never had a reservation", async () => {
    const rider = await riderWith(0);
    const driver = await riderWith(0);
    const deps = makeDeps(db);
    const awardId = uid("awd");

    await settleMarketplaceCompletion(deps, {
      awardId,
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(200_000, rider.currency),
      method: "cash",
      cityId: rider.cityId,
    });
    expect(
      await db.auditLog.count({
        where: {
          action: "wallet.mp_funding.reservation_anomaly",
          subjectId: awardId,
        },
      }),
    ).toBe(0);
  });
});

describe("award reversal frees the reservation", () => {
  it("reverseCapturedHold releases the rider's reservation in the same transaction, with a linked reason", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await riderWith(500_000);

    // A funded driver with a captured commission hold under this award.
    const driverUser = await seedUser(db, "Driver");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const driverWallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", driverUser.id, config.city),
    );
    createdWalletIds.push(driverWallet.id);
    await fundWallet(db, driverWallet.id, city.currency, 1_000_000);

    const { hold } = await reserveHold(
      deps,
      {
        driverId: driverUser.id,
        bidRef: uid("bid"),
        requestRef: uid("mpr"),
        amountMinor: 100_000,
        baseMinor: 1_000_000,
        currency: city.currency,
        policyVersion: 1,
        cityId: city.cityId,
      },
      uid("idem"),
    );
    const awardId = uid("awd");
    await captureHold(
      deps,
      hold.reservationId,
      {
        awardId,
        expectedAmountMinor: { amountMinor: 100_000, currency: city.currency },
      },
      uid("idem"),
    );

    // The rider's funding reservation for the same award. NOTE: the funding
    // body carries the rider's own city/currency fixture, so re-point it.
    await authorizeMarketplaceFunding(deps, {
      requesterId: rider.userId,
      requestId: uid("mpr"),
      awardId,
      paymentMethodId: "wallet",
      amountMinor: 300_000,
      currency: rider.currency,
      cityId: rider.cityId,
    });

    await reverseCapturedHold(
      deps,
      hold.reservationId,
      { awardId, reason: "queued_award_cancelled" },
      uid("idem"),
    );

    const reservation = await db.mpRiderReservation.findUniqueOrThrow({
      where: { awardId },
    });
    expect(reservation.status).toBe("released");
    expect(reservation.reason).toBe("award_reversed: queued_award_cancelled");
    expect(await spendableOf(db, rider.walletId, rider.currency)).toEqual(
      money(500_000, rider.currency),
    );
  });
});
