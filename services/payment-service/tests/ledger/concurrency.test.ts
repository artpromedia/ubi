import { ContractError, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { sendTransfer } from "../../src/ledger/transfers";
import { setInitialPin } from "../../src/ledger/wallet-ops";
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
const PIN = "8080";

afterAll(async () => {
  await closeTestDb();
});

describe("concurrent spending from one wallet", () => {
  it("cannot be raced past the balance", async () => {
    const city = await seedCity(db, {
      policy: {
        velocityMaxTransfers: 50,
        newRecipientHoldAboveMinor: 100_000_000,
      },
    });
    const deps = makeDeps(db);
    const sender = await seedUser(db, "Nneka");
    const first = await seedUser(db, "Uche");
    const second = await seedUser(db, "Dami");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const senderWallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", sender.id, config.city),
    );
    await setInitialPin(
      deps,
      { id: sender.id, role: "rider" },
      city.cityId,
      PIN,
    );
    await fundWallet(db, senderWallet.id, city.currency, 100_000);

    // Two transfers of 60 000 launched together against a 100 000 balance.
    // The wallet row lock serialises them, so exactly one can be funded.
    const attempt = (toUserId: string) =>
      sendTransfer(deps, {
        actor: { id: sender.id, role: "rider" },
        cityId: city.cityId,
        toUserId,
        amountMinor: 60_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      });

    const results = await Promise.allSettled([
      attempt(first.id),
      attempt(second.id),
    ]);
    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter((entry) => entry.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult)
      .reason as ContractError;
    expect(reason.code).toBe("insufficient_funds");

    const balance = await balanceOf(db, senderWallet.id, city.currency);
    expect(balance).toEqual(money(40_000, city.currency));
    expect(balance.amountMinor).toBeGreaterThanOrEqual(0);

    const posted = await db.transfer.count({
      where: { fromWallet: senderWallet.id, status: "posted" },
    });
    expect(posted).toBe(1);
  });

  it("posts once when the same idempotency key arrives twice at the same moment", async () => {
    const city = await seedCity(db, {
      policy: { newRecipientHoldAboveMinor: 100_000_000 },
    });
    const deps = makeDeps(db);
    const sender = await seedUser(db, "Bisi");
    const recipient = await seedUser(db, "Tayo");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const senderWallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", sender.id, config.city),
    );
    const recipientWallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", recipient.id, config.city),
    );
    await setInitialPin(
      deps,
      { id: sender.id, role: "rider" },
      city.cityId,
      PIN,
    );
    await fundWallet(db, senderWallet.id, city.currency, 500_000);

    const key = uid("idem");
    const send = () =>
      sendTransfer(deps, {
        actor: { id: sender.id, role: "rider" },
        cityId: city.cityId,
        toUserId: recipient.id,
        amountMinor: 70_000,
        pin: PIN,
        idempotencyKey: key,
      });

    const results = await Promise.all([send(), send()]);
    const posted = await db.transfer.count({
      where: { fromWallet: senderWallet.id, status: "posted" },
    });

    // Both callers are answered, both with the same transfer, and the money
    // moved exactly once: the loser of the race replayed the winner's result
    // rather than surfacing a constraint violation.
    expect(posted).toBe(1);
    expect(results[0]?.transferId).toBe(results[1]?.transferId);
    expect(results.some((entry) => entry.replayed)).toBe(true);
    expect(await balanceOf(db, recipientWallet.id, city.currency)).toEqual(
      money(70_000, city.currency),
    );
  });
});
