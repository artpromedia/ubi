import { money } from "@ubi/contracts";
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
  type SeedCityOptions,
} from "./helpers";

const db = testDb();
const PIN = "1379";

afterAll(async () => {
  await closeTestDb();
});

interface Scenario {
  readonly cityId: string;
  readonly currency: string;
  readonly deps: ReturnType<typeof makeDeps>;
  readonly sender: { id: string; walletId: string };
  readonly recipient: { id: string; walletId: string };
}

async function scenario(
  options: SeedCityOptions = {},
  senderBalanceMinor = 10_000_000,
): Promise<Scenario> {
  const city = await seedCity(db, options);
  const deps = makeDeps(db);
  const senderUser = await seedUser(db, "Ada");
  const recipientUser = await seedUser(db, "Bola");
  const config = await createCityConfigProvider(db).load(city.cityId);

  const senderWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", senderUser.id, config.city),
  );
  const recipientWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", recipientUser.id, config.city),
  );

  await setInitialPin(deps, { id: senderUser.id, role: "rider" }, city.cityId, PIN);
  if (senderBalanceMinor > 0) {
    await fundWallet(db, senderWallet.id, city.currency, senderBalanceMinor);
  }

  return {
    cityId: city.cityId,
    currency: city.currency,
    deps,
    sender: { id: senderUser.id, walletId: senderWallet.id },
    recipient: { id: recipientUser.id, walletId: recipientWallet.id },
  };
}

describe("wallet transfers", () => {
  it("posts a transfer and derives both balances from the journal", async () => {
    const s = await scenario();
    const result = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 250_000,
      pin: PIN,
      note: "lunch",
      idempotencyKey: uid("idem"),
    });

    expect(result.status).toBe("posted");
    expect(result.replayed).toBe(false);
    expect(result.entryId).not.toBeNull();

    expect(await balanceOf(db, s.sender.walletId, s.currency)).toEqual(
      money(9_750_000, s.currency),
    );
    expect(await balanceOf(db, s.recipient.walletId, s.currency)).toEqual(
      money(250_000, s.currency),
    );

    const lines = await db.journalLine.findMany({ where: { entryId: result.entryId! } });
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.counterpartRef !== null)).toBe(true);
    expect(lines.reduce((total, line) => total + Number(line.amountMinor), 0)).toBe(0);

    const audit = await db.auditLog.findFirst({
      where: { subjectType: "transfer", subjectId: result.transferId },
    });
    expect(audit?.action).toBe("wallet.transfer.posted");

    const event = await db.outboxEvent.findFirst({
      where: { aggregateType: "transfer", aggregateId: result.transferId },
    });
    expect(event?.name).toBe("transfer.posted");
    // No PII on the wire: ids and amounts only.
    expect(JSON.stringify(event?.payload)).not.toContain("Bola");
  });

  it("replays the original result and posts exactly one journal entry", async () => {
    const s = await scenario();
    const key = uid("idem");
    const first = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 120_000,
      pin: PIN,
      idempotencyKey: key,
    });
    const second = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 120_000,
      pin: PIN,
      idempotencyKey: key,
    });

    expect(second.transferId).toBe(first.transferId);
    expect(second.entryId).toBe(first.entryId);
    expect(second.replayed).toBe(true);
    expect(second.amount).toEqual(first.amount);

    const transfers = await db.transfer.count({
      where: { fromWallet: s.sender.walletId },
    });
    expect(transfers).toBe(1);
    const entries = await db.journalEntry.count({
      where: { reference: `transfer:${first.transferId}` },
    });
    expect(entries).toBe(1);
    expect(await balanceOf(db, s.recipient.walletId, s.currency)).toEqual(
      money(120_000, s.currency),
    );
  });

  it("blocks peer-to-peer entirely while the wallet is in safe mode", async () => {
    const s = await scenario();
    await db.wallet.update({
      where: { id: s.sender.walletId },
      data: { safeModeUntil: new Date(Date.now() + 3_600_000) },
    });

    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "safe_mode_active", status: 403 });

    const rejected = await db.transfer.findFirst({
      where: { fromWallet: s.sender.walletId },
    });
    expect(rejected?.status).toBe("rejected_safe_mode");
    expect(await balanceOf(db, s.recipient.walletId, s.currency)).toEqual(
      money(0, s.currency),
    );
  });

  it("enforces the tier's single-transfer limit and replays the same refusal", async () => {
    const s = await scenario({ singleTransferMinor: 200_000 });
    const key = uid("idem");
    const attempt = () =>
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 300_000,
        pin: PIN,
        idempotencyKey: key,
      });

    await expect(attempt()).rejects.toMatchObject({ code: "limit_exceeded" });
    await expect(attempt()).rejects.toMatchObject({
      code: "limit_exceeded",
      details: { replayed: true },
    });

    const rows = await db.transfer.findMany({ where: { fromWallet: s.sender.walletId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("rejected_limit");
    expect(await balanceOf(db, s.sender.walletId, s.currency)).toEqual(
      money(10_000_000, s.currency),
    );
  });

  it("enforces the tier's daily limit across several transfers", async () => {
    const s = await scenario({ dailyOutMinor: 300_000, singleTransferMinor: 300_000 });
    await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 200_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });

    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 200_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });

    expect(await balanceOf(db, s.recipient.walletId, s.currency)).toEqual(
      money(200_000, s.currency),
    );
  });

  it("refuses a transfer the wallet cannot fund", async () => {
    const s = await scenario({}, 50_000);
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 60_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(await balanceOf(db, s.sender.walletId, s.currency)).toEqual(
      money(50_000, s.currency),
    );
  });

  it("holds a risky transfer for a human instead of posting it", async () => {
    const s = await scenario({ policy: { newRecipientHoldAboveMinor: 100_000 } });
    const result = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 400_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });

    expect(result.status).toBe("held_risk");
    expect(result.riskReason).toBe("new_recipient");
    expect(result.entryId).toBeNull();
    expect(result.reviewCaseId).not.toBeNull();

    // Held means held: nothing moved, and a person has a queue item with an SLA.
    expect(await balanceOf(db, s.sender.walletId, s.currency)).toEqual(
      money(10_000_000, s.currency),
    );
    expect(await balanceOf(db, s.recipient.walletId, s.currency)).toEqual(
      money(0, s.currency),
    );
    const supportCase = await db.supportCase.findUniqueOrThrow({
      where: { id: result.reviewCaseId! },
    });
    expect(supportCase.status).toBe("open");
    expect(supportCase.category).toBe("wallet_risk_hold");
    expect(supportCase.slaDue).not.toBeNull();
  });

  it("holds on velocity once the window's ceiling is passed", async () => {
    const s = await scenario({
      policy: { velocityMaxTransfers: 1, newRecipientHoldAboveMinor: 100_000_000 },
    });
    const first = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 10_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });
    expect(first.status).toBe("posted");

    const second = await sendTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.cityId,
      toUserId: s.recipient.id,
      amountMinor: 10_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });
    expect(second.status).toBe("held_risk");
    expect(second.riskReason).toBe("velocity_count");
  });

  it("counts a wrong PIN and locks the wallet at the city's ceiling", async () => {
    const s = await scenario({ maxPinAttempts: 2 });
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: "0000",
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "wrong_pin" });

    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: "0000",
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "pin_attempts_exhausted" });

    const wallet = await db.wallet.findUniqueOrThrow({ where: { id: s.sender.walletId } });
    expect(wallet.pinFailedAttempts).toBe(2);
    expect(wallet.pinLockedUntil).not.toBeNull();

    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "pin_locked" });
  });

  it("404s when the wallet_p2p flag is off, so a deep link cannot probe it", async () => {
    const s = await scenario({ flags: { wallet_p2p: false, wallet_nip: false } });
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "feature_disabled", status: 404 });
  });

  it("fails closed when the city config has no wallet policy", async () => {
    const s = await scenario({ omitWalletPolicy: true });
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "config_unavailable", status: 503 });
  });

  it("refuses to pay a wallet its own money", async () => {
    const s = await scenario();
    await expect(
      sendTransfer(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.cityId,
        toUserId: s.sender.id,
        amountMinor: 1_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
