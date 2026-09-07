import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { createCityConfigProvider } from "../../src/ledger/city-config";
import { dateInZone, dayWindow, rangeWindow } from "../../src/ledger/day-window";
import { postEntry } from "../../src/ledger/post-entry";
import { buildStatement } from "../../src/ledger/statements";
import {
  resetPin,
  setWalletLock,
  walletOverview,
} from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";

import { closeTestDb, makeDeps, seedCity, seedUser, testDb, uid } from "./helpers";

const db = testDb();

afterAll(async () => {
  await closeTestDb();
});

async function move(
  walletId: string,
  currency: string,
  amountMinor: number,
  occurredAt: Date,
  counterpartRef: string,
): Promise<void> {
  await db.$transaction((tx) =>
    postEntry(tx, {
      kind: amountMinor > 0 ? "topup" : "p2p_transfer",
      reference: `${counterpartRef}:${uid("r")}`,
      occurredAt,
      description: amountMinor > 0 ? "top-up" : "sent",
      lines: [
        {
          account: "wallet",
          walletId,
          amount: money(amountMinor, currency),
          counterpartRef,
        },
        {
          account: amountMinor > 0 ? "psp_settlement" : "ubi_float",
          amount: money(-amountMinor, currency),
          counterpartRef,
        },
      ],
    }),
  );
}

describe("timezone-aware day windows", () => {
  it("bounds a Lagos day at Lagos midnight, not UTC midnight", () => {
    const window = dayWindow("2025-03-04", "Africa/Lagos");
    expect(window.start.toISOString()).toBe("2025-03-03T23:00:00.000Z");
    expect(window.end.toISOString()).toBe("2025-03-04T23:00:00.000Z");
    expect(dateInZone(new Date("2025-03-03T23:30:00.000Z"), "Africa/Lagos")).toBe(
      "2025-03-04",
    );
  });

  it("spans an inclusive range and refuses a backwards one", () => {
    const range = rangeWindow("2025-03-01", "2025-03-03", "Africa/Lagos");
    expect(range.start.toISOString()).toBe("2025-02-28T23:00:00.000Z");
    expect(range.end.toISOString()).toBe("2025-03-03T23:00:00.000Z");
    expect(() => rangeWindow("2025-03-05", "2025-03-01", "Africa/Lagos")).toThrow(
      /must not be before/,
    );
  });
});

describe("wallet statements", () => {
  it("computes opening, in, out and closing from the journal", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const user = await seedUser(db, "Yemi");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const wallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", user.id, config.city),
    );

    // Before the period.
    await move(wallet.id, city.currency, 500_000, new Date("2025-01-10T09:00:00Z"), "topup:seed");
    // Inside it.
    await move(wallet.id, city.currency, 200_000, new Date("2025-02-03T09:00:00Z"), "topup:feb");
    await move(wallet.id, city.currency, -75_000, new Date("2025-02-04T10:00:00Z"), "transfer:feb");
    // After it.
    await move(wallet.id, city.currency, 900_000, new Date("2025-03-01T09:00:00Z"), "topup:mar");

    const statement = await buildStatement(deps, {
      actor: { id: user.id, role: "rider" },
      cityId: city.cityId,
      from: "2025-02-01",
      to: "2025-02-28",
      format: "json",
    });

    expect(statement.opening).toEqual(money(500_000, city.currency));
    expect(statement.in).toEqual(money(200_000, city.currency));
    expect(statement.out).toEqual(money(-75_000, city.currency));
    expect(statement.closing).toEqual(money(625_000, city.currency));
    expect(statement.lines).toHaveLength(2);
    // Every row is traceable back to what caused it.
    expect(statement.lines.every((line) => line.counterpartRef !== null)).toBe(true);
    expect(statement.lines.map((line) => line.runningBalanceMinor)).toEqual([
      700_000, 625_000,
    ]);

    const persisted = await db.walletStatement.findFirstOrThrow({
      where: { walletId: wallet.id },
    });
    expect(Number(persisted.closingMinor)).toBe(625_000);
    expect(Number(persisted.openingMinor)).toBe(500_000);
  });

  it("says which formats it can actually produce", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const user = await seedUser(db, "Femi");
    await expect(
      buildStatement(deps, {
        actor: { id: user.id, role: "rider" },
        cityId: city.cityId,
        from: "2025-02-01",
        to: "2025-02-28",
        format: "pdf",
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      details: { supported: ["json"] },
    });
  });
});

describe("wallet controls", () => {
  it("reports a derived balance, the tier and what is left today", async () => {
    const city = await seedCity(db, { dailyOutMinor: 400_000 });
    const deps = makeDeps(db);
    const user = await seedUser(db, "Rita");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const wallet = await db.$transaction((tx) =>
      ensureWallet(tx, "user", user.id, config.city),
    );
    await move(wallet.id, city.currency, 300_000, new Date(), "topup:now");

    const overview = await walletOverview(deps, { id: user.id, role: "rider" }, city.cityId);
    expect(overview.balance).toEqual(money(300_000, city.currency));
    expect(overview.tier).toBe("tier1");
    expect(overview.limits.dailyOut).toEqual(money(400_000, city.currency));
    expect(overview.limits.remainingToday).toEqual(money(400_000, city.currency));
    expect(overview.safeMode.active).toBe(false);
    expect(overview.locked).toBe(false);
  });

  it("lets the owner freeze the wallet but not thaw it", async () => {
    const city = await seedCity(db);
    const deps = makeDeps(db);
    const user = await seedUser(db, "Kola");

    const locked = await setWalletLock(deps, {
      actor: { id: user.id, role: "rider" },
      cityId: city.cityId,
      locked: true,
      reason: "phone stolen",
    });
    expect(locked.locked).toBe(true);

    await expect(
      setWalletLock(deps, {
        actor: { id: user.id, role: "rider" },
        cityId: city.cityId,
        locked: false,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const byOps = await setWalletLock(deps, {
      actor: { id: "ops-1", role: "SUPPORT" },
      cityId: city.cityId,
      ownerId: user.id,
      locked: false,
    });
    expect(byOps.locked).toBe(false);
    expect(byOps.walletId).toBe(locked.walletId);
    const audit = await db.auditLog.findMany({
      where: { subjectType: "wallet", subjectId: locked.walletId },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual([
      "wallet.locked",
      "wallet.unlocked",
    ]);
  });

  it("needs a passed step-up to reset a PIN, and starts a cooling window", async () => {
    const city = await seedCity(db, { policy: { pinResetCoolingMinutes: 120 } });
    const deps = makeDeps(db);
    const user = await seedUser(db, "Zara");

    await expect(
      resetPin(deps, {
        actor: { id: user.id, role: "rider" },
        cityId: city.cityId,
        newPin: "3141",
        stepUpChallengeId: "no-such-challenge",
      }),
    ).rejects.toMatchObject({ code: "step_up_required" });

    const challenge = await db.stepUpChallenge.create({
      data: {
        id: uid("suc"),
        userId: user.id,
        method: "face",
        status: "passed",
      },
    });

    const result = await resetPin(deps, {
      actor: { id: user.id, role: "rider" },
      cityId: city.cityId,
      newPin: "3141",
      stepUpChallengeId: challenge.id,
    });
    expect(new Date(result.coolingUntil).getTime()).toBeGreaterThan(Date.now());

    const events = await db.outboxEvent.findMany({
      where: { aggregateId: result.walletId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.name)).toEqual(["pin.rotated", "cooling.started"]);
  });
});
