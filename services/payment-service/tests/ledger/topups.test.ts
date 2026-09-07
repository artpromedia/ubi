import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { createTopup } from "../../src/ledger/topups";
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

afterAll(async () => {
  await closeTestDb();
});

async function topupScenario(options: SeedCityOptions = {}) {
  const city = await seedCity(db, options);
  const rail = new RecordingTopupRail();
  const deps = makeDeps(db, { topupRail: rail });
  const user = await seedUser(db, "Segun");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  return { city, rail, deps, user, wallet };
}

describe("wallet top-ups", () => {
  it("captures at the rail and credits the wallet in one entry", async () => {
    const s = await topupScenario();
    const result = await createTopup(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      methodId: "card",
      amountMinor: 750_000,
      idempotencyKey: uid("idem"),
    });

    expect(result.status).toBe("captured");
    expect(result.balanceAfter).toEqual(money(750_000, s.city.currency));
    expect(s.rail.captures).toHaveLength(1);

    const lines = await db.journalLine.findMany({ where: { entryId: result.entryId! } });
    expect(lines.map((line) => line.account).sort()).toEqual([
      "psp_settlement",
      "wallet",
    ]);
    expect(lines.reduce((total, line) => total + Number(line.amountMinor), 0)).toBe(0);
  });

  it("replays rather than charging the card twice", async () => {
    const s = await topupScenario();
    const key = uid("idem");
    const first = await createTopup(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      methodId: "card",
      amountMinor: 100_000,
      idempotencyKey: key,
    });
    const second = await createTopup(s.deps, {
      actor: { id: s.user.id, role: "rider" },
      cityId: s.city.cityId,
      methodId: "card",
      amountMinor: 100_000,
      idempotencyKey: key,
    });
    expect(second.topupId).toBe(first.topupId);
    expect(second.replayed).toBe(true);
    expect(await balanceOf(db, s.wallet.id, s.city.currency)).toEqual(
      money(100_000, s.city.currency),
    );
  });

  it("refuses a top-up that would breach the tier's balance cap", async () => {
    const s = await topupScenario({ balanceCapMinor: 200_000 });
    await expect(
      createTopup(s.deps, {
        actor: { id: s.user.id, role: "rider" },
        cityId: s.city.cityId,
        methodId: "card",
        amountMinor: 250_000,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
    // Nothing was charged: the cap is checked before the rail is touched.
    expect(s.rail.captures).toHaveLength(0);
  });

  it("names the reason a payment method is unavailable", async () => {
    const s = await topupScenario();
    await expect(
      createTopup(s.deps, {
        actor: { id: s.user.id, role: "rider" },
        cityId: s.city.cityId,
        methodId: "bank_transfer",
        amountMinor: 10_000,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({
      code: "payment_method_unavailable",
      message: "not enabled in this city yet",
    });
  });
});
