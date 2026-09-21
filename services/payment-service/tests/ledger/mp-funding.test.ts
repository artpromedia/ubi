/**
 * Rider funding authorization for a marketplace selection (M05 step 3,
 * hardened by C02).
 *
 * Nothing is debited, but a WALLET authorization is no longer a check that
 * evaporates: it creates a durable reservation that encumbers the SELECTED
 * amount until settlement consumes it or a release frees it. Cash stays
 * explicitly unsecured, and config-listed PSP methods fail closed.
 */
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf, spendableOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { authorizeMarketplaceFunding } from "../../src/ledger/mp-funding";
import { reserveHold } from "../../src/ledger/mp-holds";
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
  paymentMethodId = "wallet",
) {
  return {
    requesterId: rider.userId,
    requestId: uid("mpr"),
    awardId: uid("awd"),
    paymentMethodId,
    amountMinor,
    currency: rider.currency,
    cityId: rider.cityId,
  };
}

describe("marketplace funding authorization", () => {
  it("authorizes a wallet rider by reserving the fare — no debit, spendable drops", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);

    const result = await authorizeMarketplaceFunding(
      deps,
      input(rider, 500_000),
    );
    expect(result.authorized).toBe(true);
    expect(result.secured).toBe(true);
    expect(result.reservationId).not.toBeNull();

    // Nothing moved: the balance is untouched by an authorization — but the
    // reservation encumbers the full fare, so spendable is now zero.
    const balance = await balanceOf(db, rider.walletId, rider.currency);
    expect(balance.amountMinor).toBe(500_000);
    const spendable = await spendableOf(db, rider.walletId, rider.currency);
    expect(spendable.amountMinor).toBe(0);

    const row = await db.mpRiderReservation.findUniqueOrThrow({
      where: { id: result.reservationId ?? "" },
    });
    expect(row.status).toBe("active");
    expect(Number(row.amountMinor)).toBe(500_000);
  });

  it("refuses with the exact shortfall when spendable falls short by one minor unit", async () => {
    const rider = await riderWith(499_999);
    const deps = makeDeps(db);

    await expect(
      authorizeMarketplaceFunding(deps, input(rider, 500_000)),
    ).rejects.toMatchObject({
      code: "insufficient_funds",
      details: { shortfallMinor: 1 },
    });
  });

  it("counts the rider's own active marketplace holds against spendable", async () => {
    // A rider who also drives: their live bid's hold encumbers the same
    // wallet, so a fare that fits the balance but not the spendable refuses.
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);
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

    await expect(
      authorizeMarketplaceFunding(deps, input(rider, 450_000)),
    ).rejects.toMatchObject({
      code: "insufficient_funds",
      details: { shortfallMinor: 50_000 },
    });
  });

  it("holds the reservation durably: the reserved fare cannot be pledged elsewhere, and a replay converges", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);
    const body = input(rider, 400_000);

    const first = await authorizeMarketplaceFunding(deps, body);
    expect(first).toMatchObject({ authorized: true, secured: true });

    // The reservation ENCUMBERS the fare: the rider's own bid can no longer
    // pledge money the selection already spoke for (the exact G02 leak).
    await expect(
      reserveHold(
        deps,
        {
          driverId: rider.userId,
          bidRef: uid("bid"),
          requestRef: uid("mpr"),
          amountMinor: 200_000,
          baseMinor: 2_000_000,
          currency: rider.currency,
          policyVersion: 1,
          cityId: rider.cityId,
        },
        uid("idem"),
      ),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: { shortfallMinor: 100_000 },
    });

    // The saga's retry replays the same terms and converges on the SAME
    // reservation instead of re-answering a question money already answered.
    const replay = await authorizeMarketplaceFunding(deps, body);
    expect(replay.reservationId).toBe(first.reservationId);
  });

  it("passes cash through as explicitly unsecured — no wallet consulted, no reservation row", async () => {
    const rider = await riderWith(0);
    const deps = makeDeps(db);
    const body = input(rider, 750_000, "cash");

    await expect(
      authorizeMarketplaceFunding(deps, body),
    ).resolves.toMatchObject({
      authorized: true,
      paymentMethodId: "cash",
      secured: false,
      reservationId: null,
    });
    expect(
      await db.mpRiderReservation.count({ where: { awardId: body.awardId } }),
    ).toBe(0);
    // The audit record states the authorization is unsecured.
    const audit = await db.auditLog.findFirst({
      where: {
        action: "wallet.mp_funding.authorized",
        subjectId: body.awardId,
      },
    });
    expect(audit?.after).toMatchObject({ secured: false });
  });

  it("fails closed for config-listed PSP methods: availability is not provider authorization", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);

    // "card" IS listed available in the city config fixture — and still must
    // not authorize, because no provider authorization exists yet.
    await expect(
      authorizeMarketplaceFunding(deps, input(rider, 100_000, "card")),
    ).rejects.toMatchObject({
      code: "payment_method_unavailable",
      message: expect.stringContaining("provider authorization"),
    });
    expect(
      await db.mpRiderReservation.count({
        where: { walletId: rider.walletId },
      }),
    ).toBe(0);
  });

  it("refuses an unavailable payment method, a mismatched currency and non-integer amounts", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);

    await expect(
      authorizeMarketplaceFunding(
        deps,
        input(rider, 100_000, "carrier-pigeon"),
      ),
    ).rejects.toMatchObject({ code: "payment_method_unavailable" });

    await expect(
      authorizeMarketplaceFunding(deps, {
        ...input(rider, 100_000),
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });

    for (const bad of [100.5, -100_000, 0]) {
      await expect(
        authorizeMarketplaceFunding(deps, input(rider, bad)),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(
      await db.mpRiderReservation.count({
        where: { walletId: rider.walletId },
      }),
    ).toBe(0);
  });

  it("refuses a locked wallet", async () => {
    const rider = await riderWith(500_000);
    await db.wallet.update({
      where: { id: rider.walletId },
      data: { locked: true },
    });
    const deps = makeDeps(db);

    await expect(
      authorizeMarketplaceFunding(deps, input(rider, 100_000)),
    ).rejects.toMatchObject({ code: "wallet_locked" });
  });
});
