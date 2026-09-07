import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { sendTransfer } from "../../src/ledger/transfers";
import { setInitialPin } from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";

import {
  closeTestDb,
  makeDeps,
  RecordingTopupRail,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeedCityOptions,
} from "./helpers";

const db = testDb();
const PIN = "2468";

afterAll(async () => {
  await closeTestDb();
});

async function sagaScenario(options: SeedCityOptions = {}) {
  const city = await seedCity(db, options);
  const rail = new RecordingTopupRail();
  const deps = makeDeps(db, { topupRail: rail });
  const senderUser = await seedUser(db, "Chidi");
  const recipientUser = await seedUser(db, "Ngozi");
  const config = await createCityConfigProvider(db).load(city.cityId);

  const senderWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", senderUser.id, config.city),
  );
  const recipientWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", recipientUser.id, config.city),
  );
  await setInitialPin(
    deps,
    { id: senderUser.id, role: "rider" },
    city.cityId,
    PIN,
  );

  return {
    city,
    rail,
    deps,
    sender: { id: senderUser.id, walletId: senderWallet.id },
    recipient: { id: recipientUser.id, walletId: recipientWallet.id },
  };
}

describe("top-up + transfer saga", () => {
  it("posts both legs or neither — the happy path posts both", async () => {
    const s = await sagaScenario();
    const result = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      toUserId: s.recipient.id,
      amountMinor: 150_000,
      pin: PIN,
      topup: { methodId: "card", amountMinor: 150_000 },
      idempotencyKey: uid("idem"),
    });

    expect(result.status).toBe("posted");
    expect(result.topupId).not.toBeNull();
    expect(s.rail.captures).toHaveLength(1);
    expect(s.rail.refunds).toHaveLength(0);

    // The wallet started empty: the top-up funded exactly what left again.
    expect(await balanceOf(db, s.sender.walletId, s.city.currency)).toEqual(
      money(0, s.city.currency),
    );
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(150_000, s.city.currency),
    );

    const topup = await db.topup.findUniqueOrThrow({
      where: { id: result.topupId! },
    });
    expect(topup.status).toBe("captured");
    expect(topup.sagaTransferId).toBe(result.transferId);
    expect(topup.entryId).not.toBeNull();
  });

  it("leaves no partial state when the transfer leg fails after the top-up leg", async () => {
    // The top-up leg posts first inside the ledger transaction; the transfer
    // leg then breaches the tier's single-transfer cap and takes the whole
    // transaction down with it.
    const s = await sagaScenario({ singleTransferMinor: 200_000 });

    const before = await balanceOf(db, s.sender.walletId, s.city.currency);
    expect(before).toEqual(money(0, s.city.currency));

    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.city.cityId,
        toUserId: s.recipient.id,
        amountMinor: 400_000,
        pin: PIN,
        topup: { methodId: "card", amountMinor: 400_000 },
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });

    // Nothing of the top-up survives: no balance, no topup row, no journal.
    expect(await balanceOf(db, s.sender.walletId, s.city.currency)).toEqual(
      money(0, s.city.currency),
    );
    expect(
      await db.topup.count({ where: { walletId: s.sender.walletId } }),
    ).toBe(0);
    expect(
      await db.journalLine.count({ where: { walletId: s.sender.walletId } }),
    ).toBe(0);
    expect(
      await db.journalLine.count({ where: { walletId: s.recipient.walletId } }),
    ).toBe(0);

    // And the capture that did happen at the rail was compensated.
    expect(s.rail.captures).toHaveLength(1);
    expect(s.rail.refunds).toHaveLength(1);

    // The refusal is still recorded, so a replay answers the same way.
    const rejected = await db.transfer.findFirstOrThrow({
      where: { fromWallet: s.sender.walletId },
    });
    expect(rejected.status).toBe("rejected_limit");
    expect(rejected.entryId).toBeNull();
  });

  it("does not fund the wallet when risk holds the transfer", async () => {
    const s = await sagaScenario({
      policy: { newRecipientHoldAboveMinor: 50_000 },
    });

    const result = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      toUserId: s.recipient.id,
      amountMinor: 120_000,
      pin: PIN,
      topup: { methodId: "card", amountMinor: 120_000 },
      idempotencyKey: uid("idem"),
    });

    // A held transfer has not posted, so its top-up must not have posted either.
    expect(result.status).toBe("held_risk");
    expect(result.topupId).toBeNull();
    expect(await balanceOf(db, s.sender.walletId, s.city.currency)).toEqual(
      money(0, s.city.currency),
    );
    expect(
      await db.topup.count({ where: { walletId: s.sender.walletId } }),
    ).toBe(0);
    expect(s.rail.refunds).toHaveLength(1);
    expect(result.reviewCaseId).not.toBeNull();
  });

  it("refuses a top-up on a payment method the city has switched off", async () => {
    const s = await sagaScenario();
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.city.cityId,
        toUserId: s.recipient.id,
        amountMinor: 10_000,
        pin: PIN,
        topup: { methodId: "bank_transfer", amountMinor: 10_000 },
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "payment_method_unavailable" });
    expect(s.rail.captures).toHaveLength(0);
  });

  it("says the rail is unavailable rather than pretending to capture", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db, { topupRail: null });
    const senderUser = await seedUser(db, "Emeka");
    const recipientUser = await seedUser(db, "Zainab");
    await setInitialPin(
      deps,
      { id: senderUser.id, role: "rider" },
      city.cityId,
      PIN,
    );

    await expect(
      sendTransfer(deps, {
        actor: { id: senderUser.id, role: "rider" },
        cityId: city.cityId,
        toUserId: recipientUser.id,
        amountMinor: 10_000,
        pin: PIN,
        topup: { methodId: "card", amountMinor: 10_000 },
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
  });
});
