/**
 * Rider funding authorization for a marketplace selection (M05 step 3).
 *
 * Nothing is debited: the check answers whether the SELECTED amount — not
 * the initially requested price — is payable right now, and it deliberately
 * re-evaluates on every call rather than caching a stale "yes".
 */
import { ContractError } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
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
  it("authorizes a wallet rider whose spendable covers the selected fare, without debiting", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);

    const result = await authorizeMarketplaceFunding(
      deps,
      input(rider, 500_000),
    );
    expect(result.authorized).toBe(true);

    // Nothing moved: the balance is untouched by an authorization.
    const balance = await balanceOf(db, rider.walletId, rider.currency);
    expect(balance.amountMinor).toBe(500_000);
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

  it("re-evaluates rather than caching: the same award authorizes only while funds last", async () => {
    const rider = await riderWith(500_000);
    const deps = makeDeps(db);
    const body = input(rider, 400_000);

    await expect(
      authorizeMarketplaceFunding(deps, body),
    ).resolves.toMatchObject({ authorized: true });

    // The rider's money leaves (hold from their own bid) before a retry.
    await reserveHold(
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
    );
    await expect(authorizeMarketplaceFunding(deps, body)).rejects.toThrow(
      ContractError,
    );
  });

  it("passes cash through on availability alone — no wallet is consulted", async () => {
    const rider = await riderWith(0);
    const deps = makeDeps(db);

    await expect(
      authorizeMarketplaceFunding(deps, input(rider, 750_000, "cash")),
    ).resolves.toMatchObject({ authorized: true, paymentMethodId: "cash" });
  });

  it("refuses an unavailable payment method and a mismatched currency", async () => {
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
