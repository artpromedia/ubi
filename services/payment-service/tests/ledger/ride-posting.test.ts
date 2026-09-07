import { addMoney, money, splitPercent } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import {
  breakdownFor,
  postCashSettlement,
  postRideCompletion,
} from "../../src/ledger/ride-posting";
import { ensureWallet } from "../../src/ledger/wallets";

import { closeTestDb, fundWallet, seedCity, testDb, uid } from "./helpers";

const db = testDb();

afterAll(async () => {
  await closeTestDb();
});

async function rideScenario(serviceFeePct: number) {
  const city = await seedCity(db, { serviceFeePct });
  const config = await createCityConfigProvider(db).load(city.cityId);
  const rider = await db.$transaction((tx) =>
    ensureWallet(tx, "user", uid("rider"), config.city),
  );
  const driver = await db.$transaction((tx) =>
    ensureWallet(tx, "driver", uid("driver"), config.city),
  );
  return { city, config: config.city, rider, driver };
}

describe("posting a completed ride", () => {
  it("takes commission on the fare and wait fee, and none on the tip", async () => {
    const s = await rideScenario(20);
    await fundWallet(db, s.rider.id, s.city.currency, 1_000_000);

    const { entry, breakdown } = await db.$transaction((tx) =>
      postRideCompletion(tx, s.config, {
        rideId: uid("ride"),
        method: "wallet",
        riderWalletId: s.rider.id,
        driverWalletId: s.driver.id,
        fareMinor: 90_000,
        waitFeeMinor: 10_000,
        tipMinor: 50_000,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    // 20% of (90 000 + 10 000), not of the 150 000 the rider actually paid.
    expect(breakdown.commissionable).toEqual(money(100_000, s.city.currency));
    expect(breakdown.serviceFee).toEqual(money(20_000, s.city.currency));
    expect(breakdown.driverShare).toEqual(money(80_000, s.city.currency));
    expect(breakdown.tip).toEqual(money(50_000, s.city.currency));

    expect(await balanceOf(db, s.rider.id, s.city.currency)).toEqual(
      money(850_000, s.city.currency),
    );
    // The driver keeps the whole tip on top of their share.
    expect(await balanceOf(db, s.driver.id, s.city.currency)).toEqual(
      money(130_000, s.city.currency),
    );

    const tipLines = entry.lines.filter((line) => line.account === "tips");
    expect(tipLines).toHaveLength(2);
    expect(
      tipLines.find((line) => line.walletId === s.driver.id)?.amountMinor,
    ).toBe(50_000);
    const commissionLines = entry.lines.filter(
      (line) => line.account === "ubi_commission",
    );
    expect(commissionLines).toHaveLength(1);
    expect(commissionLines[0]?.amountMinor).toBe(20_000);

    expect(
      entry.lines.reduce((total, line) => total + line.amountMinor, 0),
    ).toBe(0);
    expect(entry.lines.every((line) => line.counterpartRef !== null)).toBe(
      true,
    );
  });

  it("loses no minor unit to rounding, whatever the fare", async () => {
    const s = await rideScenario(17.5);

    for (const fareMinor of [1, 3, 7, 99, 100_003, 249_999, 1_000_001]) {
      const breakdown = breakdownFor(s.config, {
        method: "wallet",
        fareMinor,
        waitFeeMinor: 0,
        tipMinor: 0,
      });
      // The fee and the driver's share are the two halves of one split; they
      // must add back up to exactly what the rider was charged.
      expect(
        addMoney(breakdown.serviceFee, breakdown.driverShare).amountMinor,
      ).toBe(fareMinor);
      expect(breakdown.serviceFee).toEqual(
        splitPercent(money(fareMinor, s.city.currency), 17.5).part,
      );
    }
  });

  it("posts an odd split through the journal without leaking a kobo", async () => {
    const s = await rideScenario(17.5);
    await fundWallet(db, s.rider.id, s.city.currency, 1_000_000);

    const { entry } = await db.$transaction((tx) =>
      postRideCompletion(tx, s.config, {
        rideId: uid("ride"),
        method: "wallet",
        riderWalletId: s.rider.id,
        driverWalletId: s.driver.id,
        fareMinor: 100_003,
        waitFeeMinor: 0,
        tipMinor: 0,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    expect(
      entry.lines.reduce((total, line) => total + line.amountMinor, 0),
    ).toBe(0);
    const riderMoved = 1_000_000 - 100_003;
    expect(await balanceOf(db, s.rider.id, s.city.currency)).toEqual(
      money(riderMoved, s.city.currency),
    );
    expect(await balanceOf(db, s.driver.id, s.city.currency)).toEqual(
      money(100_003 - 17_501, s.city.currency),
    );
  });

  it("records what a driver owes on a cash ride and nets it at settlement", async () => {
    const s = await rideScenario(20);
    await fundWallet(db, s.driver.id, s.city.currency, 200_000);

    const { entry, breakdown } = await db.$transaction((tx) =>
      postRideCompletion(tx, s.config, {
        rideId: uid("ride"),
        method: "cash",
        driverWalletId: s.driver.id,
        fareMinor: 100_000,
        waitFeeMinor: 0,
        // Cash tip: it never entered UBI's custody, so there is nothing to
        // post and nothing to take a commission on.
        tipMinor: 40_000,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    expect(breakdown.cashOwed).toEqual(money(20_000, s.city.currency));
    expect(entry.kind).toBe("ride_completion_cash");
    expect(entry.lines.map((line) => line.account).sort()).toEqual([
      "cash_owed",
      "ubi_commission",
    ]);
    // The driver keeps the cash, so their wallet has not moved yet.
    expect(await balanceOf(db, s.driver.id, s.city.currency)).toEqual(
      money(200_000, s.city.currency),
    );

    const cashRail = await db.journalLine.aggregate({
      _sum: { amountMinor: true },
      where: {
        account: "cash_owed",
        counterpartRef: { startsWith: entry.reference },
      },
    });
    expect(Number(cashRail._sum.amountMinor)).toBe(-20_000);

    const settlement = await db.$transaction((tx) =>
      postCashSettlement(tx, {
        driverWalletId: s.driver.id,
        amount: money(20_000, s.city.currency),
        reference: entry.reference,
        occurredAt: new Date(),
        idempotencyKey: uid("idem"),
      }),
    );

    // Netting: the commission comes out of the driver's wallet and the cash
    // rail returns to zero for this ride.
    expect(await balanceOf(db, s.driver.id, s.city.currency)).toEqual(
      money(180_000, s.city.currency),
    );
    const railAfter = await db.journalLine.aggregate({
      _sum: { amountMinor: true },
      where: {
        account: "cash_owed",
        counterpartRef: { startsWith: entry.reference },
      },
    });
    expect(Number(railAfter._sum.amountMinor)).toBe(-20_000);
    const settlementLines = await db.journalLine.findMany({
      where: { entryId: settlement.id },
    });
    expect(
      settlementLines.reduce(
        (total, line) => total + Number(line.amountMinor),
        0,
      ),
    ).toBe(0);
  });

  it("refuses a wallet ride with no rider wallet", async () => {
    const s = await rideScenario(20);
    await expect(
      db.$transaction((tx) =>
        postRideCompletion(tx, s.config, {
          rideId: uid("ride"),
          method: "wallet",
          driverWalletId: s.driver.id,
          fareMinor: 10_000,
          waitFeeMinor: 0,
          tipMinor: 0,
          occurredAt: new Date(),
          idempotencyKey: uid("idem"),
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
