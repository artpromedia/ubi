import { money } from "@ubi/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assignBreak,
  closeRecon,
  getRecon,
  recordExternalTotal,
  resolveBreak,
  runRecon,
} from "../../src/finance/recon";
import { postEntry } from "../../src/ledger/post-entry";
import type { Actor } from "../../src/ledger/types";

import {
  closeTestDb,
  makeDeps,
  seedCity,
  testDb,
  uid,
} from "../ledger/helpers";

const db = testDb();
const deps = makeDeps(db);
const OPS: Actor = { id: "finance-1", role: "ADMIN" };

/**
 * `recon_runs` is keyed by date alone, so the fixtures below own a fixed window
 * of June 2024 and clear it before they run. Nothing else in the suite posts
 * into that window.
 */
const WINDOW_START = new Date("2024-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2024-07-01T00:00:00.000Z");

beforeAll(async () => {
  const rails = await db.reconRail.findMany({
    where: { date: { gte: WINDOW_START, lt: WINDOW_END } },
    select: { id: true },
  });
  await db.reconBreak.deleteMany({
    where: { railId: { in: rails.map((rail) => rail.id) } },
  });
  await db.reconRail.deleteMany({
    where: { date: { gte: WINDOW_START, lt: WINDOW_END } },
  });
  await db.reconRun.deleteMany({
    where: { date: { gte: WINDOW_START, lt: WINDOW_END } },
  });
  await db.journalLine.deleteMany({
    where: { entry: { occurredAt: { gte: WINDOW_START, lt: WINDOW_END } } },
  });
  await db.journalEntry.deleteMany({
    where: { occurredAt: { gte: WINDOW_START, lt: WINDOW_END } },
  });
  await db.outboxEvent.deleteMany({
    where: { aggregateType: "recon", aggregateId: { startsWith: "2024-06" } },
  });
});

afterAll(async () => {
  await closeTestDb();
});

/** Mid-morning in Lagos on the given day, comfortably inside the window. */
const at = (isoDate: string): Date => new Date(`${isoDate}T09:00:00.000Z`);

async function seedDay(
  currency: string,
  isoDate: string,
  amounts: { topup: number; nip: number; cashCommission: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await postEntry(tx, {
      kind: "topup",
      reference: `topup:${uid("t")}`,
      occurredAt: at(isoDate),
      lines: [
        {
          account: "psp_settlement",
          amount: money(-amounts.topup, currency),
          counterpartRef: "recon-fixture",
        },
        {
          account: "ubi_float",
          amount: money(amounts.topup, currency),
          counterpartRef: "recon-fixture",
        },
      ],
    });
    await postEntry(tx, {
      kind: "nip_transfer",
      reference: `nip:${uid("n")}`,
      occurredAt: at(isoDate),
      lines: [
        {
          account: "ubi_float",
          amount: money(-amounts.nip, currency),
          counterpartRef: "recon-fixture",
        },
        {
          account: "bank_settlement",
          amount: money(amounts.nip, currency),
          counterpartRef: "recon-fixture",
        },
      ],
    });
    await postEntry(tx, {
      kind: "ride_completion_cash",
      reference: `ride:${uid("r")}`,
      occurredAt: at(isoDate),
      lines: [
        {
          account: "cash_owed",
          amount: money(-amounts.cashCommission, currency),
          counterpartRef: "recon-fixture",
        },
        {
          account: "ubi_commission",
          amount: money(amounts.cashCommission, currency),
          counterpartRef: "recon-fixture",
        },
      ],
    });
  });
}

describe("daily reconciliation", () => {
  it("sums to zero on a day where every rail agrees, and closes", async () => {
    const currency = "GHS";
    const city = await seedCity(db, { currency });
    const date = "2024-06-03";
    await seedDay(currency, date, {
      topup: 1_000_000,
      nip: 400_000,
      cashCommission: 20_000,
    });

    // What the counterparties' own statements say for the day.
    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "psp_settlement",
      amountMinor: 1_000_000,
      source: "psp settlement file",
    });
    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "nip",
      amountMinor: -400_000,
      source: "bank statement",
    });
    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "driver_cash",
      amountMinor: 20_000,
      source: "driver cash acknowledgements",
    });

    const report = await runRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });

    expect(report.rails).toHaveLength(3);
    for (const rail of report.rails) {
      expect(rail.diff).toEqual(money(0, currency));
      expect(rail.status).toBe("balanced");
      expect(
        rail.breaks.filter((entry) => entry.resolvedAt === null),
      ).toHaveLength(0);
    }
    expect(
      report.rails.reduce((total, rail) => total + rail.diff.amountMinor, 0),
    ).toBe(0);
    expect(report.unexplained).toEqual(money(0, currency));
    expect(report.closeAllowed).toBe(true);

    const closed = await closeRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    expect(closed.status).toBe("closed");
    expect(closed.closedBy).toBe(OPS.id);
    expect(closed.closeAllowed).toBe(false);

    const run = await db.reconRun.findUniqueOrThrow({
      where: { date: new Date(`${date}T00:00:00.000Z`) },
    });
    expect(Number(run.unexplainedMinor)).toBe(0);
  });

  it("opens an owned break and refuses the close until it is adjusted", async () => {
    const currency = "RWF";
    const city = await seedCity(db, { currency });
    const date = "2024-06-04";
    await seedDay(currency, date, {
      topup: 500_000,
      nip: 0,
      cashCommission: 0,
    });

    // The PSP's file is 12 500 short of what the ledger says arrived.
    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "psp_settlement",
      amountMinor: 487_500,
      source: "psp settlement file",
    });

    const report = await runRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    const psp = report.rails.find((rail) => rail.rail === "psp_settlement");
    expect(psp?.diff).toEqual(money(12_500, currency));
    expect(psp?.status).toBe("break");
    const open = psp?.breaks.find((entry) => entry.resolvedAt === null);
    expect(open).toBeDefined();
    expect(open?.deadline).not.toBeNull();
    expect(report.unexplained).toEqual(money(12_500, currency));
    expect(report.closeAllowed).toBe(false);

    await expect(
      closeRecon(deps, { actor: OPS, cityId: city.cityId, date }),
    ).rejects.toMatchObject({
      code: "recon_unexplained",
      status: 409,
      details: { unexplainedMinor: 12_500 },
    });

    const owned = await assignBreak(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      breakId: open!.id,
      owner: "treasury@ubi",
      deadline: new Date(`${date}T23:00:00.000Z`).toISOString(),
    });
    expect(owned.owner).toBe("treasury@ubi");

    // Resolve by posting an adjustment that references the case. The original
    // entries are untouched; a new entry moves the 12 500 off the rail.
    const entriesBefore = await db.journalEntry.count({
      where: { occurredAt: { gte: new Date(`${date}T00:00:00.000Z`) } },
    });
    const caseRef = uid("case");
    const resolved = await resolveBreak(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      breakId: open!.id,
      caseRef,
      note: "PSP withheld a chargeback; posting the offset",
      adjustment: {
        lines: [
          { account: "psp_settlement", amountMinor: 12_500 },
          { account: "ubi_float", amountMinor: -12_500 },
        ],
      },
    });
    expect(resolved.entryId).not.toBeNull();
    expect(resolved.resolutionRef).toBe(`entry:${resolved.entryId}`);

    const adjustment = await db.journalEntry.findUniqueOrThrow({
      where: { id: resolved.entryId! },
      include: { lines: true },
    });
    expect(adjustment.kind).toBe("recon_adjustment");
    expect(adjustment.caseRef).toBe(caseRef);
    expect(
      adjustment.lines.reduce(
        (total, line) => total + Number(line.amountMinor),
        0,
      ),
    ).toBe(0);
    expect(
      await db.journalEntry.count({
        where: { occurredAt: { gte: new Date(`${date}T00:00:00.000Z`) } },
      }),
    ).toBe(entriesBefore + 1);

    const after = await closeRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    expect(after.status).toBe("closed");
    expect(after.unexplained).toEqual(money(0, currency));
    const pspAfter = after.rails.find((rail) => rail.rail === "psp_settlement");
    expect(pspAfter?.diff).toEqual(money(0, currency));
  });

  it("accepts an explanation against a case as a way to clear a break", async () => {
    const currency = "ZAR";
    const city = await seedCity(db, { currency });
    const date = "2024-06-05";
    await seedDay(currency, date, {
      topup: 300_000,
      nip: 0,
      cashCommission: 0,
    });

    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "psp_settlement",
      // A timing difference: the last batch settles tomorrow.
      amountMinor: 280_000,
      source: "psp settlement file",
    });
    const report = await runRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    const open = report.rails[0]?.breaks.find(
      (entry) => entry.resolvedAt === null,
    );
    expect(open?.amount).toEqual(money(20_000, currency));

    await expect(
      closeRecon(deps, { actor: OPS, cityId: city.cityId, date }),
    ).rejects.toMatchObject({ code: "recon_unexplained" });

    const caseRef = uid("case");
    const resolved = await resolveBreak(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      breakId: open!.id,
      caseRef,
      note: "settles in tomorrow's batch",
    });
    expect(resolved.resolutionRef).toBe(`case:${caseRef}`);
    expect(resolved.entryId).toBeNull();

    const closed = await closeRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    expect(closed.status).toBe("closed");
    // The difference is still on the rail — it is explained, not erased.
    expect(closed.rails[0]?.diff).toEqual(money(20_000, currency));
    expect(closed.unexplained).toEqual(money(0, currency));
  });

  it("refuses to touch a day that is already closed", async () => {
    const currency = "ETB";
    const city = await seedCity(db, { currency });
    const date = "2024-06-06";
    await seedDay(currency, date, {
      topup: 100_000,
      nip: 0,
      cashCommission: 0,
    });
    await recordExternalTotal(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
      rail: "psp_settlement",
      amountMinor: 100_000,
      source: "psp settlement file",
    });
    await closeRecon(deps, { actor: OPS, cityId: city.cityId, date });

    await expect(
      closeRecon(deps, { actor: OPS, cityId: city.cityId, date }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      recordExternalTotal(deps, {
        actor: OPS,
        cityId: city.cityId,
        date,
        rail: "nip",
        amountMinor: 1,
        source: "late file",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("leaves a day with nothing on it out of the report rather than asserting it balanced", async () => {
    const currency = "USD";
    const city = await seedCity(db, { currency });
    const date = "2024-06-07";
    const report = await runRecon(deps, {
      actor: OPS,
      cityId: city.cityId,
      date,
    });
    expect(report.rails).toHaveLength(0);
    expect(report.unexplained).toEqual(money(0, currency));
  });
});
