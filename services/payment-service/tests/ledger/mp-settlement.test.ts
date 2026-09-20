/**
 * Marketplace settlement mode (M06): completion of a negotiated-fare trip.
 *
 * The 10% fee was captured at selection (`mp_commission_capture`), so the
 * completion entry must never carry a commission line — a wallet trip credits
 * the driver the FULL fare, and a cash trip posts no `cash_owed` for the fee.
 */
import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  activeHoldsMinor,
  balanceOf,
  spendableOf,
} from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { reserveHold } from "../../src/ledger/mp-holds";
import { settleMarketplaceCompletion } from "../../src/ledger/mp-settlement";
import { postMarketplaceCompletion } from "../../src/ledger/ride-posting";
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

const createdWalletIds: string[] = [];

afterAll(async () => {
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Party {
  readonly userId: string;
  readonly wallet: WalletRecord;
}

async function fundedParty(
  city: SeededCity,
  amountMinor: number,
  name: string,
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

describe("marketplace wallet completion", () => {
  it("credits the driver the full fare — no commission line — and tips bypass everything", async () => {
    const city = await seedCity(db);
    const rider = await fundedParty(city, 10_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");
    const rideId = uid("ride");

    const { entry } = await db.$transaction((tx) =>
      postMarketplaceCompletion(tx, {
        rideId,
        awardId: uid("awd"),
        method: "wallet",
        riderWalletId: rider.wallet.id,
        driverWalletId: driver.wallet.id,
        fareMinor: 5_000_00,
        tipMinor: 300_00,
        currency: city.currency,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("mp_ride_completion");
    // The whole fare and the whole tip land with the driver; the fee was
    // captured at selection, so no ubi_commission line may appear here.
    expect(entry?.lines.some((line) => line.account === "ubi_commission")).toBe(
      false,
    );
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(5_300_00, city.currency),
    );
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(4_700_00, city.currency),
    );

    const tipLines = entry?.lines.filter((line) => line.account === "tips");
    expect(tipLines).toHaveLength(2);
    expect(
      tipLines?.find((line) => line.walletId === driver.wallet.id)?.amountMinor,
    ).toBe(300_00);
    // Double entry: the completion balances to zero.
    expect(
      entry?.lines.reduce((total, line) => total + line.amountMinor, 0),
    ).toBe(0);
  });

  it("guards the rider debit: spendable, not raw balance", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 1_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");

    // The rider has their own live bid elsewhere (any user can bid), so
    // 500.00 of their 1,000.00 is encumbered.
    await reserveHold(
      deps,
      {
        driverId: rider.userId,
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

    // Balance covers 600.00 but spendable (500.00) does not: the distinct
    // code carries the exact shortfall.
    await expect(
      db.$transaction((tx) =>
        postMarketplaceCompletion(tx, {
          rideId: uid("ride"),
          awardId: uid("awd"),
          method: "wallet",
          riderWalletId: rider.wallet.id,
          driverWalletId: driver.wallet.id,
          fareMinor: 600_00,
          currency: city.currency,
          occurredAt: new Date(),
          idempotencyKey: uid("idem"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 100_00 }),
    });

    // A genuinely short balance is still insufficient_funds.
    await expect(
      db.$transaction((tx) =>
        postMarketplaceCompletion(tx, {
          rideId: uid("ride"),
          awardId: uid("awd"),
          method: "wallet",
          riderWalletId: rider.wallet.id,
          driverWalletId: driver.wallet.id,
          fareMinor: 1_500_00,
          currency: city.currency,
          occurredAt: new Date(),
          idempotencyKey: uid("idem"),
        }),
      ),
    ).rejects.toMatchObject({ code: "insufficient_funds" });

    // Nothing moved on either refusal.
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(1_000_00, city.currency),
    );
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );
    expect(await activeHoldsMinor(db, rider.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
    expect(await spendableOf(db, rider.wallet.id, city.currency)).toEqual(
      money(500_00, city.currency),
    );
  });
});

describe("marketplace cash completion", () => {
  it("posts nothing for a plain cash trip — no cash_owed, no second fee", async () => {
    const city = await seedCity(db);
    const driver = await fundedParty(city, 200_00, "Driver");
    const rideId = uid("ride");

    const { entry } = await db.$transaction((tx) =>
      postMarketplaceCompletion(tx, {
        rideId,
        awardId: uid("awd"),
        method: "cash",
        driverWalletId: driver.wallet.id,
        fareMinor: 5_000_00,
        currency: city.currency,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    // The driver holds the cash and UBI's fee already left their wallet at
    // selection; recording a cash_owed fee here would charge the 10% twice.
    expect(entry).toBeNull();
    const lines = await db.journalLine.count({
      where: { counterpartRef: { startsWith: `mp_ride:${rideId}` } },
    });
    expect(lines).toBe(0);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(200_00, city.currency),
    );
  });

  it("still moves a wallet tip on a cash trip, on tips lines only", async () => {
    const city = await seedCity(db);
    const rider = await fundedParty(city, 1_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");
    const rideId = uid("ride");

    const { entry } = await db.$transaction((tx) =>
      postMarketplaceCompletion(tx, {
        rideId,
        awardId: uid("awd"),
        method: "cash",
        riderWalletId: rider.wallet.id,
        driverWalletId: driver.wallet.id,
        fareMinor: 5_000_00,
        tipMinor: 200_00,
        currency: city.currency,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    expect(entry?.kind).toBe("mp_ride_completion_cash");
    expect(entry?.lines).toHaveLength(2);
    expect(entry?.lines.every((line) => line.account === "tips")).toBe(true);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(200_00, city.currency),
    );
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(800_00, city.currency),
    );
  });
});

describe("POST /v1/wallet/mp/settlements semantics (settleMarketplaceCompletion)", () => {
  it("settles a wallet trip once under the award id and replays the original outcome", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 10_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");
    const awardId = uid("awd");

    const input = {
      awardId,
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, city.currency),
      tipMinor: money(300_00, city.currency),
      method: "wallet" as const,
      cityId: city.cityId,
    };
    const first = await settleMarketplaceCompletion(deps, input);
    expect(first.settled).toBe(true);
    expect(first.method).toBe("wallet");
    expect(first.replayed).toBe(false);
    expect(first.journalEntryId).not.toBeNull();

    // The rider paid fare + tip; the driver got the FULL fare (fee captured
    // at selection) plus the tip; the entry carries no commission line.
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(4_700_00, city.currency),
    );
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(5_300_00, city.currency),
    );
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: first.journalEntryId ?? "" },
      include: { lines: true },
    });
    expect(entry.kind).toBe("mp_ride_completion");
    expect(entry.lines.some((line) => line.account === "ubi_commission")).toBe(
      false,
    );

    // The settlement decision is audited and published in the same tx.
    const event = await db.outboxEvent.findFirst({
      where: { aggregateType: "mp_settlement", aggregateId: awardId },
    });
    expect(event?.name).toBe("transfer.posted");

    // Replay — any number of retries — answers the original outcome and the
    // fare moves exactly once.
    const replay = await settleMarketplaceCompletion(deps, input);
    expect(replay.replayed).toBe(true);
    expect(replay.journalEntryId).toBe(first.journalEntryId);
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(4_700_00, city.currency),
    );
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(5_300_00, city.currency),
    );

    // A replay that names different terms is a caller bug, refused rather
    // than answered with the old outcome.
    await expect(
      settleMarketplaceCompletion(deps, {
        ...input,
        fareMinor: money(6_000_00, city.currency),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("settles a cash trip by posting nothing — and still answers settled", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 0, "Rider");
    const driver = await fundedParty(city, 100_00, "Driver");
    const awardId = uid("awd");

    const input = {
      awardId,
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, city.currency),
      method: "cash" as const,
      cityId: city.cityId,
    };
    const first = await settleMarketplaceCompletion(deps, input);
    expect(first).toMatchObject({
      settled: true,
      method: "cash",
      journalEntryId: null,
      replayed: false,
    });
    // The driver holds the cash; UBI's fee left at selection. No movement.
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(100_00, city.currency),
    );
    const event = await db.outboxEvent.findFirst({
      where: { aggregateType: "mp_settlement", aggregateId: awardId },
    });
    expect(event?.name).toBe("payment.cash_acknowledged");

    // Idempotent even with no journal entry: the outbox row is the durable
    // record of the outcome.
    const replay = await settleMarketplaceCompletion(deps, input);
    expect(replay).toMatchObject({
      settled: true,
      method: "cash",
      journalEntryId: null,
      replayed: true,
    });
    expect(
      await db.outboxEvent.count({
        where: { aggregateType: "mp_settlement", aggregateId: awardId },
      }),
    ).toBe(1);
  });

  it("still moves a wallet tip on a cash settlement", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 1_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");

    const result = await settleMarketplaceCompletion(deps, {
      awardId: uid("awd"),
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, city.currency),
      tipMinor: money(200_00, city.currency),
      method: "cash" as const,
      cityId: city.cityId,
    });
    expect(result.method).toBe("cash");
    expect(result.journalEntryId).not.toBeNull();
    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: result.journalEntryId ?? "" },
      include: { lines: true },
    });
    expect(entry.kind).toBe("mp_ride_completion_cash");
    expect(entry.lines.every((line) => line.account === "tips")).toBe(true);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(200_00, city.currency),
    );
  });

  it("refuses a rider short of funds and stays retryable — recovery is ops scope", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 1_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");
    const awardId = uid("awd");

    const input = {
      awardId,
      executionRef: { service: "ride" as const, id: uid("ride") },
      requesterId: rider.userId,
      driverId: driver.userId,
      fareMinor: money(5_000_00, city.currency),
      method: "wallet" as const,
      cityId: city.cityId,
    };
    // The debit refuses honestly; nothing is recorded, so nothing pretends
    // the fare settled. Chasing the rider (dunning) is deliberately not the
    // ledger's job.
    await expect(settleMarketplaceCompletion(deps, input)).rejects.toMatchObject(
      { code: "insufficient_funds" },
    );
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(0, city.currency),
    );
    expect(
      await db.outboxEvent.count({
        where: { aggregateType: "mp_settlement", aggregateId: awardId },
      }),
    ).toBe(0);

    // The settlement stays RETRYABLE: once the rider is funded, the same
    // award settles normally.
    await fundWallet(db, rider.wallet.id, city.currency, 5_000_00);
    const retried = await settleMarketplaceCompletion(deps, input);
    expect(retried.replayed).toBe(false);
    expect(await balanceOf(db, driver.wallet.id, city.currency)).toEqual(
      money(5_000_00, city.currency),
    );
  });

  it("refuses a settlement denominated in a currency that is not the city's", async () => {
    const city = await seedCity(db); // NGN
    const deps = makeDeps(db);
    const rider = await fundedParty(city, 10_000_00, "Rider");
    const driver = await fundedParty(city, 0, "Driver");

    await expect(
      settleMarketplaceCompletion(deps, {
        awardId: uid("awd"),
        executionRef: { service: "ride" as const, id: uid("ride") },
        requesterId: rider.userId,
        driverId: driver.userId,
        fareMinor: money(5_000_00, "GHS"),
        method: "wallet" as const,
        cityId: city.cityId,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(await balanceOf(db, rider.wallet.id, city.currency)).toEqual(
      money(10_000_00, city.currency),
    );
  });
});
