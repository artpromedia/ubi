import { money } from "@ubi/contracts";
import { createHmac } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { applyNipCallback, createNipTransfer } from "../../src/ledger/nip";
import { verifyWebhookSignature } from "../../src/ledger/providers";
import { setInitialPin } from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  RecordingBankRail,
  seedCity,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const db = testDb();
const PIN = "5150";

afterAll(async () => {
  await closeTestDb();
});

afterEach(() => {
  delete process.env.NIP_WEBHOOK_SECRET;
});

async function nipScenario(accountName: string | null = "Bola Recipient") {
  const city = await seedCity(db);
  const rail = new RecordingBankRail(accountName);
  const deps = makeDeps(db, { bankRail: rail });
  const user = await seedUser(db, "Kemi");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  await setInitialPin(deps, { id: user.id, role: "rider" }, city.cityId, PIN);
  await fundWallet(db, wallet.id, city.currency, 2_000_000);
  return { city, rail, deps, user, wallet };
}

describe("NIP bank payouts", () => {
  it("runs name enquiry first, then debits the wallet into the bank rail", async () => {
    const s = await nipScenario();
    const result = await createNipTransfer(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 500_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });

    expect(result.status).toBe("pending");
    expect(result.accountName).toBe("Bola Recipient");
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(1_500_000, s.city.currency),
    );

    const lines = await db.journalLine.findMany({
      where: { entryId: result.entryId! },
    });
    expect(lines.map((line) => line.account).sort()).toEqual([
      "bank_settlement",
      "wallet",
    ]);
    expect(
      lines.reduce((total, line) => total + Number(line.amountMinor), 0),
    ).toBe(0);
    // The instruction only reaches the bank once the debit is committed.
    expect(s.rail.payouts).toHaveLength(1);
  });

  it("refuses when the account cannot be resolved, and moves nothing", async () => {
    const s = await nipScenario(null);
    await expect(
      createNipTransfer(s.deps, {
        actor: { id: s.user.id, role: "rider" },
        cityId: s.city.cityId,
        bankCode: "058",
        accountNumber: "0123456789",
        amountMinor: 500_000,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "recipient_not_found" });
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(2_000_000, s.city.currency),
    );
  });

  it("treats a duplicate confirmation as a no-op", async () => {
    const s = await nipScenario();
    const result = await createNipTransfer(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 400_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });
    const row = await db.nipTransfer.findUniqueOrThrow({
      where: { id: result.nipTransferId },
    });

    const first = await applyNipCallback(s.deps, s.city.cityId, {
      sessionId: row.sessionId!,
      status: "confirmed",
      reference: `nip:${row.id}`,
    });
    expect(first.applied).toBe(true);
    expect(first.status).toBe("confirmed");

    const second = await applyNipCallback(s.deps, s.city.cityId, {
      sessionId: row.sessionId!,
      status: "confirmed",
      reference: `nip:${row.id}`,
    });
    expect(second.applied).toBe(false);
    expect(second.ignoredReason).toBe("duplicate_delivery");

    // One confirmation, one ledger position: no second entry, no double debit.
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(1_600_000, s.city.currency),
    );
    expect(
      await db.journalEntry.count({ where: { reference: `nip:${row.id}` } }),
    ).toBe(1);
  });

  it("applies a reversal that arrives before the confirmation, then ignores the confirmation", async () => {
    const s = await nipScenario();
    const result = await createNipTransfer(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 300_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });
    const row = await db.nipTransfer.findUniqueOrThrow({
      where: { id: result.nipTransferId },
    });
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(1_700_000, s.city.currency),
    );

    const reversal = await applyNipCallback(s.deps, s.city.cityId, {
      sessionId: row.sessionId!,
      status: "reversed",
      reference: `nip:${row.id}`,
      reason: "beneficiary account closed",
    });
    expect(reversal.applied).toBe(true);
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(2_000_000, s.city.currency),
    );

    // The confirmation turns up late. It must not resurrect the payout.
    const late = await applyNipCallback(s.deps, s.city.cityId, {
      sessionId: row.sessionId!,
      status: "confirmed",
      reference: `nip:${row.id}`,
    });
    expect(late.applied).toBe(false);
    expect(late.ignoredReason).toBe("out_of_order");
    expect(late.status).toBe("reversed");

    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(2_000_000, s.city.currency),
    );
    const after = await db.nipTransfer.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe("reversed");
    expect(after.confirmedAt).toBeNull();

    const ignored = await db.auditLog.findFirst({
      where: { action: "wallet.nip.callback_ignored", subjectId: s.wallet.id },
    });
    expect(ignored?.reason).toBe("out_of_order_callback");
  });

  it("replays an instruction rather than sending it twice", async () => {
    const s = await nipScenario();
    const key = uid("idem");
    const first = await createNipTransfer(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 200_000,
      pin: PIN,
      idempotencyKey: key,
    });
    const second = await createNipTransfer(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 200_000,
      pin: PIN,
      idempotencyKey: key,
    });

    expect(second.nipTransferId).toBe(first.nipTransferId);
    expect(second.replayed).toBe(true);
    expect(s.rail.payouts).toHaveLength(1);
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(1_800_000, s.city.currency),
    );
  });
});

describe("bank webhook signatures", () => {
  const body = JSON.stringify({ sessionId: "s1", status: "confirmed" });

  it("rejects an unverifiable callback rather than trusting it", () => {
    expect(() => verifyWebhookSignature(body, "deadbeef")).toThrow(
      /secret is not configured/,
    );
  });

  it("rejects a wrong or missing signature", () => {
    process.env.NIP_WEBHOOK_SECRET = "shhh-this-is-the-bank-secret";
    expect(() => verifyWebhookSignature(body, undefined)).toThrow(/missing/);
    expect(() =>
      verifyWebhookSignature(
        body,
        createHmac("sha256", "wrong").update(body).digest("hex"),
      ),
    ).toThrow(/did not verify/);
  });

  it("accepts the bank's own signature", () => {
    const secret = "shhh-this-is-the-bank-secret";
    process.env.NIP_WEBHOOK_SECRET = secret;
    const signature = createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
    expect(() => verifyWebhookSignature(body, signature)).not.toThrow();
  });
});
