/**
 * Weekly fleet remittance settlement on the canonical ledger (A05; decisions
 * doc Q2 / Q7 / Q8) against real Postgres, with inputs served over real HTTP
 * by a faithful double of fleet-service's contract B.
 *
 * Proven here: the lines balance (and the deferred double-entry trigger
 * refuses to let them not); the Q2 pro-rata including zero-shift and
 * full-maintenance weeks, and over the whole week's signed shift when a
 * mid-week supersession splits it; unplanned off-road hours are never deducted;
 * percent_of_net on the driver's net read from the ledger; the derived
 * carry-forward accumulating and capped at maxWeeks; idempotent and
 * concurrent re-runs; a closed week never re-settled (a linked adjustment in
 * the next open week instead); the commission never touched and never
 * funded twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";
import { envelopeFromRow, type RawOutboxRow } from "@ubi/outbox";

import {
  clientFor,
  closeTestDb,
  depsAt,
  driverWallet,
  exampleInputs,
  fleetCity,
  FleetServiceDouble,
  fundWallet,
  item,
  jobAt,
  testDb,
  uid,
  weekOf,
  type ItemOverrides,
} from "./fixtures";
import {
  assertNoCommissionLines,
  resolveCommissionFunding,
} from "../../src/fleet/commission-funding";
import { carryBalances, carryTotalMinor } from "../../src/fleet/ledger-reads";
import {
  carryOwedRef,
  FLEET_SETTLEMENT_ACTOR,
  settlementEntryKey,
  settlementEventKey,
} from "../../src/fleet/model";
import {
  carryForwardView,
  runWeeklySettlement,
  settlementsOfWeek,
  type ItemResult,
  type SettlementRunResult,
} from "../../src/fleet/settlement";
import { runFleetSettlementSweep } from "../../src/fleet/sweep";
import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { ensureWallet } from "../../src/ledger/wallets";

import type { SettlementInputItem } from "../../src/fleet/inputs";
import type { SeededCity } from "../ledger/helpers";

const db = testDb();
const double = new FleetServiceDouble();
let baseUrl = "";

// Mondays, all ended well before NOW.
const W1 = "2026-08-03";
const W2 = "2026-08-10";
const W3 = "2026-08-17";
const W4 = "2026-08-24";
const NOW = new Date("2026-09-29T08:00:00Z");

beforeAll(async () => {
  baseUrl = await double.start();
});

afterAll(async () => {
  await double.stop();
  await closeTestDb();
});

async function settle(
  city: SeededCity,
  weekStart: string,
  items: readonly SettlementInputItem[],
  now: Date = NOW,
): Promise<SettlementRunResult> {
  double.setWeek(city.cityId, weekOf(weekStart, items));
  const result = await runWeeklySettlement(
    depsAt(db, now),
    clientFor(baseUrl),
    { cityId: city.cityId, weekStart, actor: FLEET_SETTLEMENT_ACTOR },
  );
  return result;
}

function only(result: SettlementRunResult): ItemResult {
  expect(result.items).toHaveLength(1);
  return result.items[0]!;
}

function remittanceOf(result: ItemResult) {
  if (result.status === "refused") {
    throw new Error(`item refused: ${result.code} ${result.reason ?? ""}`);
  }
  return result.remittance;
}

async function fleetWalletId(city: SeededCity, fleetId: string) {
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const ensured = await ensureWallet(tx, "fleet", fleetId, config.city);
    return ensured;
  });
  return wallet.id;
}

async function linesOf(entryId: string | null) {
  if (entryId === null) {
    return [];
  }
  const lines = await db.journalLine.findMany({ where: { entryId } });
  return lines;
}

async function entryTotal(entryId: string): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ total: bigint | null }>>`
    SELECT SUM(amount_minor) AS total FROM journal_lines WHERE entry_id = ${entryId}
  `;
  return Number(row?.total ?? 0n);
}

/** Every line of one fleet + driver pair on the carry memorandum account. */
async function carryAccountTotal(fleetId: string, driverId: string) {
  const [row] = await db.$queryRaw<Array<{ total: bigint | null }>>`
    SELECT SUM(amount_minor) AS total FROM journal_lines
     WHERE account = 'fleet_remittance_carry'
       AND counterpart_ref LIKE ${`fleet_carry:${fleetId}:${driverId}:%`}
  `;
  return Number(row?.total ?? 0n);
}

/**
 * Every outbox row for the aggregate passes the relay's own envelope
 * validation (subject type, ≤ 64-char idempotency key, actor type), so the
 * relay would publish it rather than quarantine it.
 */
async function expectPublishable(aggregateId: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<RawOutboxRow[]>(
    `SELECT id, name, schema_version, aggregate_type, aggregate_id,
            from_version, to_version, sequence, city_id, actor_type, actor_id,
            idempotency_key, correlation_id, causation_id, payload,
            occurred_at, published_at, attempts, last_error, created_at
       FROM outbox_events WHERE aggregate_id = $1`,
    aggregateId,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const parsed = envelopeFromRow(row);
    expect(parsed.ok ? "ok" : parsed.error).toBe("ok");
  }
}

describe("the contract example: weekly_fixed pro-rated for planned maintenance (Q2)", () => {
  let city: SeededCity;
  beforeAll(async () => {
    city = await fleetCity(db);
  });

  it("collects floor(25 000.00 × 48/60) from the driver into the fleet wallet, in lines that balance", async () => {
    const [example] = exampleInputs().items;
    // The example's numbers; ids made unique so the ledger never sees a rerun.
    const ex = {
      ...example!,
      assignmentId: uid("asg"),
      fleetId: uid("flt"),
      driverId: uid("drv"),
    };
    const driver = await driverWallet(db, city, ex.driverId, 5_000_000);
    const result = await settle(city, "2026-09-21", [ex]);
    const outcome = only(result);
    expect(outcome.status).toBe("settled");
    const remittance = remittanceOf(outcome);
    expect(remittance).toMatchObject({
      dueMinor: 2_000_000,
      collectedMinor: 2_000_000,
      shortfallMinor: 0,
      carryInMinor: 0,
      carryOutMinor: 0,
      capApplied: false,
      commissionFunding: "driver_wallet",
      termsVersion: 3,
      maxWeeks: 4,
    });

    const entry = await db.journalEntry.findUniqueOrThrow({
      where: { id: remittance.journalEntryId ?? "" },
    });
    expect(entry.kind).toBe("fleet_remittance_settlement");
    expect(entry.idempotencyKey).toBe(
      settlementEntryKey(ex.assignmentId, "2026-09-21"),
    );
    const fleet = await fleetWalletId(city, ex.fleetId);
    const lines = await linesOf(entry.id);
    expect(
      lines.map((line) => [line.walletId, Number(line.amountMinor)]).sort(),
    ).toEqual(
      [
        [driver.id, -2_000_000],
        [fleet, 2_000_000],
      ].sort(),
    );
    expect(lines.every((line) => line.account === "wallet")).toBe(true);
    expect(await entryTotal(entry.id)).toBe(0);
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(
      money(3_000_000, "NGN"),
    );
    expect(await balanceOf(db, fleet, "NGN")).toEqual(money(2_000_000, "NGN"));
    const wallet = await db.wallet.findUniqueOrThrow({ where: { id: fleet } });
    expect([wallet.ownerType, wallet.ownerId]).toEqual(["fleet", ex.fleetId]);

    // The record is the outbox event: ids and amounts, no driver net (Q7).
    const event = await db.outboxEvent.findUniqueOrThrow({
      where: {
        idempotencyKey: settlementEventKey(ex.assignmentId, "2026-09-21"),
      },
    });
    expect(event.name).toBe("remittance.applied");
    expect(event.aggregateType).toBe("assignment");
    expect(JSON.stringify(event.payload)).not.toMatch(/net/i);
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        subjectType: "fleet_assignment_week",
        subjectId: `${ex.assignmentId}:2026-09-21`,
      },
    });
    expect(audit.action).toBe("fleet.remittance.settled");
    await expectPublishable(ex.assignmentId);
  });

  it("is protected by the deferred double-entry trigger: a settlement entry cannot be left unbalanced", async () => {
    const ex = item({ amountMinor: 1_000_001, shift: 7, planned: 3 });
    await driverWallet(db, city, ex.driverId, 2_000_000);
    const remittance = remittanceOf(only(await settle(city, W1, [ex])));
    // 1 000 001 × 4/7 = 571 429.14… → floored; driver and fleet lines equal.
    expect(remittance.dueMinor).toBe(571_429);
    expect(remittance.collectedMinor).toBe(571_429);
    const entryId = remittance.journalEntryId ?? "";
    expect(await entryTotal(entryId)).toBe(0);

    const fleet = await fleetWalletId(city, ex.fleetId);
    await expect(
      db.$transaction(async (tx) => {
        const tampered = await tx.journalLine.create({
          data: {
            id: uid("jl"),
            entryId,
            account: "wallet",
            walletId: fleet,
            amountMinor: 1n,
            currency: "NGN",
            counterpartRef: "tamper",
          },
        });
        return tampered;
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await entryTotal(entryId)).toBe(0);
  });
});

describe("what reduces a weekly_fixed remittance, and what does not", () => {
  let city: SeededCity;
  beforeAll(async () => {
    city = await fleetCity(db);
  });

  async function dueFor(overrides: ItemOverrides): Promise<{
    due: number;
    entryId: string | null;
  }> {
    const it = item(overrides);
    await driverWallet(db, city, it.driverId, 10_000_000);
    const remittance = remittanceOf(only(await settle(city, W1, [it])));
    return { due: remittance.dueMinor, entryId: remittance.journalEntryId };
  }

  it("never deducts UNPLANNED off-road hours (Q8): the shortfall rule applies instead", async () => {
    expect((await dueFor({ shift: 60, planned: 0, unplanned: 24 })).due).toBe(
      2_500_000,
    );
    expect((await dueFor({ shift: 60, planned: 12, unplanned: 24 })).due).toBe(
      2_000_000,
    );
  });

  it("owes nothing in a zero-shift week or a full-maintenance week — and posts nothing, but records the week", async () => {
    const zero = await dueFor({ shift: 0, planned: 0 });
    expect(zero).toEqual({ due: 0, entryId: null });
    const full = await dueFor({ shift: 40, planned: 40 });
    expect(full).toEqual({ due: 0, entryId: null });
  });

  it("bounds a week's due by the city's remittance cap, and says so", async () => {
    const capped = await fleetCity(db, { remittanceCapMinor: 1_500_000 });
    const it = item({ amountMinor: 2_500_000 });
    await driverWallet(db, capped, it.driverId, 5_000_000);
    const remittance = remittanceOf(only(await settle(capped, W1, [it])));
    expect(remittance).toMatchObject({
      dueMinor: 1_500_000,
      capApplied: true,
      collectedMinor: 1_500_000,
    });
  });
});

describe("a mid-week supersession never charges two weekly amounts for one week", () => {
  // fleet-service reports a material change signed mid-week as two items of
  // the same fleet + driver whose active windows meet (the superseded
  // version's activeTo IS the new version's activeFrom), each with only its
  // own part of the week's signed shift (fleet-service tests/settlement.test.ts
  // "gives a mid-week terms change two items").
  const THURSDAY_LAGOS = "2026-08-05T23:00:00.000Z";

  it("pro-rates each version over the week's whole signed shift; the week's total is one week's worth", async () => {
    const city = await fleetCity(db);
    const pair = { fleetId: uid("flt"), driverId: uid("drv") };
    const before = item({
      ...pair,
      amountMinor: 2_500_000,
      shift: 36,
      activeFrom: "2026-07-01T00:00:00Z",
      activeTo: THURSDAY_LAGOS,
    });
    const after = item({
      ...pair,
      termsVersion: 2,
      amountMinor: 3_000_000,
      shift: 48,
      planned: 6,
      activeFrom: THURSDAY_LAGOS,
      activeTo: null,
    });
    const driver = await driverWallet(db, city, pair.driverId, 10_000_000);
    const result = await settle(city, W1, [before, after]);
    const [old, current] = result.items.map(remittanceOf);
    // 2 500 000 × 36/84 = 1 071 428.57… → 1 071 428 (not the full 2 500 000);
    // 3 000 000 × (48 − 6)/84 = 1 500 000.
    expect(old).toMatchObject({
      dueMinor: 1_071_428,
      shiftHours: 36,
      shiftBasisHours: 84,
    });
    expect(current).toMatchObject({
      dueMinor: 1_500_000,
      shiftHours: 48,
      shiftBasisHours: 84,
    });
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(
      money(10_000_000 - 2_571_428, "NGN"),
    );
    expect(
      await balanceOf(db, await fleetWalletId(city, pair.fleetId), "NGN"),
    ).toEqual(money(2_571_428, "NGN"));

    // fleet-service corrects the NEW version's hours for the closed week:
    // the old version's basis moved with them, so BOTH are linked
    // adjustments at the next open week — never a re-settlement.
    const corrected = await settle(city, W1, [
      before,
      { ...after, shiftHoursInWeek: 36 },
    ]);
    expect(corrected.items.map((row) => row.status)).toEqual([
      "adjusted",
      "adjusted",
    ]);
    const [oldAdj, newAdj] = corrected.items.map((row) =>
      row.status === "adjusted" ? row.adjustment : null,
    );
    // 2 500 000 × 36/72 = 1 250 000 (+178 572); 3 000 000 × 30/72 = 1 250 000 (−250 000).
    expect(oldAdj).toMatchObject({ dueMinor: 1_250_000, deltaMinor: 178_572 });
    expect(newAdj).toMatchObject({ dueMinor: 1_250_000, deltaMinor: -250_000 });
    expect(await carryTotalMinor(db, pair.fleetId, pair.driverId, "NGN")).toBe(
      178_572 - 250_000,
    );
  });

  it("keeps a full weekly amount for each of two CONCURRENT arrangements (windows overlap, shifts do not)", async () => {
    const city = await fleetCity(db);
    const pair = { fleetId: uid("flt"), driverId: uid("drv") };
    const weekdays = item({
      ...pair,
      amountMinor: 700_000,
      shift: 40,
      activeFrom: "2026-07-01T00:00:00Z",
    });
    const weekends = item({
      ...pair,
      amountMinor: 300_000,
      shift: 20,
      activeFrom: "2026-07-15T00:00:00Z",
    });
    await driverWallet(db, city, pair.driverId, 5_000_000);
    const result = await settle(city, W1, [weekdays, weekends]);
    expect(result.items.map(remittanceOf)).toMatchObject([
      { dueMinor: 700_000, shiftBasisHours: 40 },
      { dueMinor: 300_000, shiftBasisHours: 20 },
    ]);
  });
});

describe("percent_of_net on the driver's net for the week, from the ledger", () => {
  it("takes the percent of fares less the ONE commission each, in the active window only, never tips", async () => {
    const city = await fleetCity(db);
    const it = item({
      type: "percent_of_net",
      percent: 25.5,
      activeFrom: "2026-08-03T00:00:00Z",
      // Ends Friday 00:00 Lagos: Saturday's job is not this arrangement's.
      activeTo: "2026-08-06T23:00:00Z",
    });
    const driver = await driverWallet(db, city, it.driverId, 1_000_000);
    // Inside the week and the window (Tuesday, Wednesday).
    await jobAt(
      db,
      city,
      it.driverId,
      driver.id,
      500_000,
      new Date("2026-08-04T10:00:00Z"),
      20_000,
    );
    await jobAt(
      db,
      city,
      it.driverId,
      driver.id,
      300_000,
      new Date("2026-08-05T15:00:00Z"),
    );
    // The week before, and after activeTo (Saturday): not this week's net.
    await jobAt(
      db,
      city,
      it.driverId,
      driver.id,
      1_000_000,
      new Date("2026-07-29T10:00:00Z"),
    );
    await jobAt(
      db,
      city,
      it.driverId,
      driver.id,
      200_000,
      new Date("2026-08-08T10:00:00Z"),
    );

    const remittance = remittanceOf(only(await settle(city, W1, [it])));
    // net = 500 000 + 300 000 − 50 000 − 30 000 = 720 000 (the 20 000 tip is the
    // driver's alone); 25.5% → 183 600.
    expect(remittance.dueMinor).toBe(183_600);
    expect(remittance.collectedMinor).toBe(183_600);

    // The net stays in the audit row (ops), never on the event (Q7).
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        subjectType: "fleet_assignment_week",
        subjectId: `${it.assignmentId}:${W1}`,
      },
    });
    expect(
      (audit.after as { computation: { netMinor: number } }).computation
        .netMinor,
    ).toBe(720_000);
  });

  it("owes nothing on a week with no positive net", async () => {
    const city = await fleetCity(db);
    const it = item({ type: "percent_of_net", percent: 30 });
    await driverWallet(db, city, it.driverId, 1_000_000);
    const remittance = remittanceOf(only(await settle(city, W1, [it])));
    expect(remittance.dueMinor).toBe(0);
    expect(remittance.journalEntryId).toBeNull();
  });
});

describe("shortfall carry-forward: derived from the ledger, capped at maxWeeks", () => {
  it("carries what the wallet could not cover, lapses what outlived maxWeeks, and pays the oldest first", async () => {
    const city = await fleetCity(db);
    const fleetId = uid("flt");
    const driverId = uid("drv");
    const base = {
      fleetId,
      driverId,
      assignmentId: uid("asg"),
      vehicleId: uid("veh"),
      amountMinor: 1_000_000,
      shift: 50,
      maxWeeks: 1,
    };
    const driver = await driverWallet(db, city, driverId, 300_000);
    const fleet = await fleetWalletId(city, fleetId);

    // Week 1: 300 000 of 1 000 000 collected; 700 000 carried (origin W1).
    const w1 = remittanceOf(only(await settle(city, W1, [item(base)])));
    expect(w1).toMatchObject({
      dueMinor: 1_000_000,
      collectedMinor: 300_000,
      shortfallMinor: 700_000,
      carryOutMinor: 700_000,
    });
    expect(await carryBalances(db, fleetId, driverId, "NGN")).toEqual([
      { origin: W1, amountMinor: 700_000 },
    ]);
    await expectPublishable(base.assignmentId);
    for (const name of ["remittance.shortfall", "remittance.carried"]) {
      expect(
        await db.outboxEvent.count({
          where: { name, aggregateId: base.assignmentId },
        }),
      ).toBe(1);
    }

    // Week 2: nothing to collect; the carry accumulates.
    const w2 = remittanceOf(only(await settle(city, W2, [item(base)])));
    expect(w2).toMatchObject({
      carryInMinor: 700_000,
      owedMinor: 1_700_000,
      collectedMinor: 0,
      carryOutMinor: 1_700_000,
    });
    expect(await carryTotalMinor(db, fleetId, driverId, "NGN")).toBe(1_700_000);

    // Week 3: W1's shortfall is 2 weeks old > maxWeeks 1 — it lapses before
    // collection. 1 500 000 pays W2 (oldest) and half of W3.
    await fundWallet(db, driver.id, "NGN", 1_500_000);
    const w3 = remittanceOf(only(await settle(city, W3, [item(base)])));
    expect(w3).toMatchObject({
      expiredMinor: 700_000,
      carryInMinor: 1_000_000,
      owedMinor: 2_000_000,
      collectedMinor: 1_500_000,
      carryOutMinor: 500_000,
      shortfallMinor: 500_000,
    });
    expect(await carryBalances(db, fleetId, driverId, "NGN")).toEqual([
      { origin: W3, amountMinor: 500_000 },
    ]);

    // Derived, never stored: the view is the sum of journal lines, the memo
    // account nets to zero for the pair, and the money only ever moved from
    // the driver's wallet to the fleet's.
    const view = await carryForwardView(
      depsAt(db, NOW),
      fleetId,
      driverId,
      "NGN",
    );
    expect(view.outstanding).toEqual(money(500_000, "NGN"));
    const [owedSql] = await db.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT SUM(amount_minor) AS total FROM journal_lines
       WHERE account = 'fleet_remittance_carry'
         AND counterpart_ref = ${carryOwedRef(fleetId, driverId, W3)}
    `;
    expect(Number(owedSql?.total ?? 0n)).toBe(500_000);
    expect(await carryAccountTotal(fleetId, driverId)).toBe(0);
    expect(await balanceOf(db, fleet, "NGN")).toEqual(money(1_800_000, "NGN"));
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(money(0, "NGN"));
    for (const week of [w1, w2, w3]) {
      if (week.journalEntryId !== null) {
        expect(await entryTotal(week.journalEntryId)).toBe(0);
      }
    }
  });

  it("never collects from a frozen wallet: the whole week is carried", async () => {
    const city = await fleetCity(db);
    const it = item({ amountMinor: 600_000 });
    const driver = await driverWallet(db, city, it.driverId, 5_000_000);
    await db.wallet.update({
      where: { id: driver.id },
      data: { locked: true },
    });
    const remittance = remittanceOf(only(await settle(city, W1, [it])));
    expect(remittance).toMatchObject({
      driverWalletLocked: true,
      collectedMinor: 0,
      carryOutMinor: 600_000,
    });
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(
      money(5_000_000, "NGN"),
    );
  });
});

describe("idempotent and restart-safe", () => {
  it("replays a re-run: nothing posts twice", async () => {
    const city = await fleetCity(db);
    const it = item({ amountMinor: 800_000 });
    const driver = await driverWallet(db, city, it.driverId, 5_000_000);
    const first = only(await settle(city, W1, [it]));
    const again = await settle(city, W1, [it]);
    expect(again.items[0]?.status).toBe("replayed");
    expect(again.totals).toMatchObject({ settled: 0, replayed: 1 });
    expect(remittanceOf(again.items[0]!)).toEqual(remittanceOf(first));
    expect(
      await db.journalEntry.count({
        where: { idempotencyKey: settlementEntryKey(it.assignmentId, W1) },
      }),
    ).toBe(1);
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(
      money(4_200_000, "NGN"),
    );
  });

  it("settles each (assignment, week) exactly once under concurrent runs", async () => {
    const city = await fleetCity(db);
    const items = [
      item({ amountMinor: 100_000 }),
      item({ amountMinor: 200_000 }),
      item({ amountMinor: 300_000 }),
    ];
    for (const it of items) {
      await driverWallet(db, city, it.driverId, 1_000_000);
    }
    double.setWeek(city.cityId, weekOf(W2, items));
    const runs = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const run = await runWeeklySettlement(
          depsAt(db, NOW),
          clientFor(baseUrl),
          { cityId: city.cityId, weekStart: W2, actor: FLEET_SETTLEMENT_ACTOR },
        );
        return run;
      }),
    );
    const statuses = runs.flatMap((run) => run.items.map((row) => row.status));
    expect(statuses.filter((status) => status === "settled")).toHaveLength(3);
    expect(statuses.filter((status) => status === "replayed")).toHaveLength(9);
    let fleetTotal = 0;
    for (const it of items) {
      expect(
        await db.journalEntry.count({
          where: { idempotencyKey: settlementEntryKey(it.assignmentId, W2) },
        }),
      ).toBe(1);
      fleetTotal += (
        await balanceOf(db, await fleetWalletId(city, it.fleetId), "NGN")
      ).amountMinor;
    }
    expect(fleetTotal).toBe(600_000);
  });
});

describe("a closed week is never re-settled", () => {
  it("records a changed input as a linked adjustment collected in the NEXT open week", async () => {
    const city = await fleetCity(db);
    const pair = {
      fleetId: uid("flt"),
      driverId: uid("drv"),
      assignmentId: uid("asg"),
      vehicleId: uid("veh"),
      amountMinor: 1_000_000,
      shift: 50,
    };
    const driver = await driverWallet(db, city, pair.driverId, 10_000_000);
    const fleet = await fleetWalletId(city, pair.fleetId);

    const closed = remittanceOf(only(await settle(city, W1, [item(pair)])));
    expect(closed.collectedMinor).toBe(1_000_000);
    const closedLines = await linesOf(closed.journalEntryId);

    // fleet-service corrects W1: 10 of the 50 signed hours were planned
    // maintenance after all → W1's due is now 800 000 (Δ −200 000).
    const corrected = await settle(city, W1, [item({ ...pair, planned: 10 })]);
    const adjusted = only(corrected);
    expect(adjusted.status).toBe("adjusted");
    if (adjusted.status !== "adjusted") {
      return;
    }
    expect(adjusted.adjustment).toMatchObject({
      closedWeekStart: W1,
      appliesToWeekStart: W2,
      sequence: 1,
      previousDueMinor: 1_000_000,
      dueMinor: 800_000,
      deltaMinor: -200_000,
      settlementEntryId: closed.journalEntryId,
    });
    // The closed week's entry is exactly what it was — never re-settled.
    expect(adjusted.remittance).toEqual(closed);
    expect(await linesOf(closed.journalEntryId)).toEqual(closedLines);
    expect(
      await db.journalEntry.count({
        where: { idempotencyKey: settlementEntryKey(pair.assignmentId, W1) },
      }),
    ).toBe(1);
    // The adjustment moves no money itself: memo lines at origin W2 only.
    const adjustmentLines = await linesOf(adjusted.adjustment.journalEntryId);
    expect(
      adjustmentLines.every((l) => l.account === "fleet_remittance_carry"),
    ).toBe(true);
    expect(
      adjustmentLines.find(
        (l) =>
          l.counterpartRef === carryOwedRef(pair.fleetId, pair.driverId, W2),
      )?.amountMinor,
    ).toBe(-200_000n);
    expect(await balanceOf(db, fleet, "NGN")).toEqual(money(1_000_000, "NGN"));

    // The same correction again is a replay, not a second adjustment.
    const repeat = only(
      await settle(city, W1, [item({ ...pair, planned: 10 })]),
    );
    expect(repeat.status).toBe("replayed");

    // W2 (the next open week) nets the credit against its own due.
    const next = remittanceOf(only(await settle(city, W2, [item(pair)])));
    expect(next).toMatchObject({
      dueMinor: 1_000_000,
      carryInMinor: -200_000,
      owedMinor: 800_000,
      collectedMinor: 800_000,
      carryOutMinor: 0,
    });
    // Over both weeks the fleet holds exactly 800 000 + 1 000 000.
    expect(await balanceOf(db, fleet, "NGN")).toEqual(money(1_800_000, "NGN"));
    expect(await balanceOf(db, driver.id, "NGN")).toEqual(
      money(8_200_000, "NGN"),
    );

    // A later increase on W3 (planned hours were over-reported) goes to W4.
    const w3 = remittanceOf(
      only(await settle(city, W3, [item({ ...pair, planned: 25 })])),
    );
    expect(w3.dueMinor).toBe(500_000);
    const raised = only(
      await settle(city, W3, [item({ ...pair, planned: 0 })]),
    );
    expect(raised.status === "adjusted" && raised.adjustment).toMatchObject({
      appliesToWeekStart: W4,
      deltaMinor: 500_000,
    });
    const w4 = remittanceOf(only(await settle(city, W4, [item(pair)])));
    expect(w4).toMatchObject({
      carryInMinor: 500_000,
      collectedMinor: 1_500_000,
    });

    await expectPublishable(pair.assignmentId);
    const week = await settlementsOfWeek(depsAt(db, NOW), city.cityId, W1);
    expect(week.settlements.map((row) => row.assignmentId)).toEqual([
      pair.assignmentId,
    ]);
    expect(week.adjustments).toHaveLength(1);
  });

  it("refuses a closed week whose fleet or driver changed: ops must review it", async () => {
    const city = await fleetCity(db);
    const it = item({ amountMinor: 100_000 });
    await driverWallet(db, city, it.driverId, 1_000_000);
    await settle(city, W1, [it]);
    const moved = only(
      await settle(city, W1, [{ ...it, fleetId: uid("flt") }]),
    );
    expect(moved).toMatchObject({
      status: "refused",
      code: "conflict",
      reason: "assignment_parties_changed",
    });
  });
});

describe("the commission is never touched and never funded twice", () => {
  it("settles a fleet week while the driver's commission stays ONE capture from the driver's wallet", async () => {
    const city = await fleetCity(db);
    const it = item({ type: "percent_of_net", percent: 20 });
    const driver = await driverWallet(db, city, it.driverId, 500_000);
    const job = await jobAt(
      db,
      city,
      it.driverId,
      driver.id,
      1_000_000,
      new Date("2026-08-04T09:00:00Z"),
    );
    const fleet = await fleetWalletId(city, it.fleetId);

    const remittance = remittanceOf(only(await settle(city, W1, [it])));
    expect(remittance.commissionFunding).toBe("driver_wallet");
    // (1 000 000 − 100 000) × 20% = 180 000.
    expect(remittance.dueMinor).toBe(180_000);

    const commissionLines = await db.journalLine.findMany({
      where: {
        OR: [
          { counterpartRef: `award:${job.awardId}` },
          { counterpartRef: { startsWith: `award:${job.awardId}:` } },
        ],
      },
      include: { entry: true },
    });
    expect(commissionLines).toHaveLength(2);
    expect(
      commissionLines.every((l) => l.entry.kind === "mp_commission_capture"),
    ).toBe(true);
    expect(commissionLines.find((l) => l.account === "wallet")?.walletId).toBe(
      driver.id,
    );
    expect(
      Number(
        commissionLines.find((l) => l.account === "ubi_commission")
          ?.amountMinor,
      ),
    ).toBe(job.commissionMinor);

    // Nothing the settlement posted touches the commission; the fleet wallet
    // only ever received the remittance.
    const settlementLines = await linesOf(remittance.journalEntryId);
    expect(settlementLines.some((l) => l.account === "ubi_commission")).toBe(
      false,
    );
    const fleetLines = await db.journalLine.findMany({
      where: { walletId: fleet },
      include: { entry: true },
    });
    expect(fleetLines.map((l) => l.entry.kind)).toEqual([
      "fleet_remittance_settlement",
    ]);

    // Sponsorship is refused — never charged to the fleet on top of the driver.
    expect(() =>
      resolveCommissionFunding(it.driverId, {
        source: "fleet_sponsorship",
        fleetId: it.fleetId,
      }),
    ).toThrow(/sponsorship/);
    expect(() =>
      assertNoCommissionLines([{ account: "ubi_commission" }]),
    ).toThrow();
  });
});

describe("deny-by-default and the guards", () => {
  it("refuses a city whose fleet flag is off — without asking fleet-service", async () => {
    const city = await fleetCity(db, { fleet: false });
    const asked = double.requests.length;
    await expect(settle(city, W1, [item()])).rejects.toMatchObject({
      code: "feature_disabled",
    });
    expect(double.requests.length).toBe(asked);
  });

  it("refuses a week that has not ended yet, and a week not named by its Monday", async () => {
    const city = await fleetCity(db);
    await expect(
      settle(city, W1, [item()], new Date("2026-08-09T20:00:00Z")),
    ).rejects.toMatchObject({ code: "illegal_transition" });
    await expect(settle(city, "2026-08-04", [item()])).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("refuses one bad item and settles the rest of the week", async () => {
    const city = await fleetCity(db);
    const good = item({ amountMinor: 100_000 });
    await driverWallet(db, city, good.driverId, 1_000_000);
    const result = await settle(city, W1, [
      item({ currency: "KES" }),
      good,
      item({ driverId: "drv:with:colons" }),
    ]);
    expect(result.items.map((row) => row.status)).toEqual([
      "refused",
      "settled",
      "refused",
    ]);
    expect(result.totals).toMatchObject({ settled: 1, refused: 2 });
  });

  it("settles nothing when fleet-service answers another zone", async () => {
    const city = await fleetCity(db);
    const it = item();
    double.setWeek(city.cityId, {
      ...weekOf(W1, [it]),
      zone: "Africa/Nairobi",
    });
    await expect(
      runWeeklySettlement(depsAt(db, NOW), clientFor(baseUrl), {
        cityId: city.cityId,
        weekStart: W1,
        actor: FLEET_SETTLEMENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(
      await db.outboxEvent.count({ where: { aggregateId: it.assignmentId } }),
    ).toBe(0);
  });
});

describe("the sweep", () => {
  it("settles the last two completed weeks for cities with the flag on, and skips the rest", async () => {
    const on = await fleetCity(db);
    const off = await fleetCity(db, { fleet: false });
    const it = item({ amountMinor: 300_000 });
    await driverWallet(db, on, it.driverId, 1_000_000);
    // Now: Wednesday 16 Sep 2026 → last completed week 7 Sep, then 31 Aug.
    const now = new Date("2026-09-16T12:00:00Z");
    double.setWeek(on.cityId, weekOf("2026-08-31", [it]));
    double.setWeek(on.cityId, weekOf("2026-09-07", [it]));
    const report = await runFleetSettlementSweep(
      depsAt(db, now),
      clientFor(baseUrl),
      { cityIds: [on.cityId, off.cityId] },
    );
    expect(report.runs.map((run) => [run.cityId, run.weekStart])).toEqual([
      [on.cityId, "2026-08-31"],
      [on.cityId, "2026-09-07"],
    ]);
    expect(report.runs.every((run) => run.totals?.settled === 1)).toBe(true);
    const again = await runFleetSettlementSweep(
      depsAt(db, now),
      clientFor(baseUrl),
      { cityIds: [on.cityId] },
    );
    expect(again.runs.every((run) => run.totals?.replayed === 1)).toBe(true);
  });
});
