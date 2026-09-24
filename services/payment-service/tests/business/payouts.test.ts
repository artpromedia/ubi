/**
 * The driver's side of a committed business trip (round-7 follow-up), against
 * real Postgres: ride-service's existing /commit call now also pays the
 * awarded driver out of `business_clearing` — the full committed fare, in
 * the same transaction — while the driver's 10% stays the ONE capture made
 * at selection. No second commission line, ever; the organization is never
 * charged the commission; the booking's clearing lines net to zero.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commissionMinorFor, money } from "@ubi/contracts";
import { envelopeFromRow, type RawOutboxRow } from "@ubi/outbox";

import {
  actorOf,
  closeTestDb,
  depsAt,
  key,
  seedOrganization,
  termsFor,
  testDb,
  uid,
  type OrgCast,
} from "./fixtures";
import { allocateBudget, topUpOrganization } from "../../src/business/budgets";
import {
  payoutEntryKey,
  payoutStatus,
  retryPayout,
  sweepPendingPayouts,
} from "../../src/business/payouts";
import { commitBudget, reserveBudget } from "../../src/business/reservations";
import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { capturedCommissionMinor } from "../../src/ledger/mp-amendment-refs";
import { captureHold, reserveHold } from "../../src/ledger/mp-holds";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";
import { fundWallet, seedUser } from "../ledger/helpers";

import type { WalletDeps } from "../../src/ledger/context";

const db = testDb();
const NOW = new Date("2026-10-15T09:00:00.000Z");
const PERIOD = "2026-10";

afterAll(async () => {
  await closeTestDb();
});

interface Driver {
  readonly id: string;
  readonly wallet: WalletRecord;
}

async function fundedBudget(
  deps: WalletDeps,
  cast: OrgCast,
  amountMinor: number,
): Promise<string> {
  await topUpOrganization(
    deps,
    actorOf(cast.owner),
    cast.orgId,
    { methodId: "card", amountMinor },
    key(),
  );
  const allocated = await allocateBudget(
    deps,
    actorOf(cast.owner),
    cast.orgId,
    { costCentreId: cast.costCentreId, period: PERIOD, amountMinor },
    key(),
  );
  return allocated.result.budget.budgetId;
}

async function driverIn(cast: OrgCast, fundMinor: number): Promise<Driver> {
  const user = await seedUser(db, "Driver");
  const config = await createCityConfigProvider(db).load(cast.city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const ensured = await ensureWallet(tx, "user", user.id, config.city);
    return ensured;
  });
  await fundWallet(db, wallet.id, cast.city.currency, fundMinor);
  return { id: user.id, wallet };
}

/** The M04 path: the driver's 10% reserved at bid and captured ONCE at selection. */
async function captureCommission(
  deps: WalletDeps,
  cast: OrgCast,
  driver: Driver,
  awardId: string,
  fareMinor: number,
): Promise<number> {
  const commission = commissionMinorFor(fareMinor);
  const hold = await reserveHold(
    deps,
    {
      driverId: driver.id,
      bidRef: uid("bid"),
      requestRef: uid("req"),
      amountMinor: commission,
      baseMinor: fareMinor,
      currency: cast.city.currency,
      policyVersion: 1,
      cityId: cast.city.cityId,
    },
    key(),
  );
  await captureHold(
    deps,
    hold.hold.reservationId,
    { awardId, expectedAmountMinor: money(commission, cast.city.currency) },
    key(),
  );
  return commission;
}

async function clearingNet(bookingRef: string): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ total: bigint | null }>>`
    SELECT SUM(amount_minor) AS total FROM journal_lines
     WHERE account = 'business_clearing'
       AND counterpart_ref = ${`business_booking:${bookingRef}`}
  `;
  return Number(row?.total ?? 0n);
}

describe("commit pays the awarded driver out of business_clearing", () => {
  let cast: OrgCast;
  let deps: WalletDeps;
  let budgetId: string;
  beforeAll(async () => {
    cast = await seedOrganization(db);
    deps = depsAt(db, NOW);
    budgetId = await fundedBudget(deps, cast, 5_000_000);
  });

  it("credits the full committed fare to the driver, nets the ONE commission, and never charges it again", async () => {
    const driver = await driverIn(cast, 1_000_000);
    const awardId = uid("award");
    const terms = termsFor(cast, {
      bookingRef: awardId,
      amountMinor: 1_200_000,
    });
    await reserveBudget(deps, terms, key("reserve"));
    const commission = await captureCommission(
      deps,
      cast,
      driver,
      awardId,
      1_200_000,
    );
    expect(commission).toBe(120_000);
    const beforeCommit = await balanceOf(db, driver.wallet.id, "NGN");
    expect(beforeCommit).toEqual(money(880_000, "NGN"));

    const committed = await commitBudget(
      deps,
      { bookingRef: awardId, actualMinor: 1_200_000, currency: "NGN" },
      key("commit"),
    );
    expect(committed.result.reservation.state).toBe("committed");

    const payout = await db.journalEntry.findUniqueOrThrow({
      where: {
        idempotencyKey: payoutEntryKey(
          committed.result.reservation.reservationId,
        ),
      },
      include: { lines: true },
    });
    expect(payout.kind).toBe("business_trip_payout");
    expect(
      payout.lines
        .map((line) => [line.account, line.walletId, Number(line.amountMinor)])
        .sort(),
    ).toEqual(
      [
        ["business_clearing", null, -1_200_000],
        ["wallet", driver.wallet.id, 1_200_000],
      ].sort(),
    );
    // No commission line of any kind on the payout.
    expect(payout.lines.some((line) => line.account === "ubi_commission")).toBe(
      false,
    );

    // The award's commission is exactly ONE capture from the driver's wallet.
    const commissionEntries = await db.journalEntry.findMany({
      where: { reference: `mp_award:${awardId}` },
    });
    expect(commissionEntries.map((entry) => entry.kind)).toEqual([
      "mp_commission_capture",
    ]);
    expect(
      await capturedCommissionMinor(db, driver.wallet.id, awardId, "NGN"),
    ).toBe(120_000);

    // Driver: +1 200 000 on the trip after −120 000 at selection = net 1 080 000.
    expect(await balanceOf(db, driver.wallet.id, "NGN")).toEqual(
      money(2_080_000, "NGN"),
    );
    // The organization paid the fare, never the commission.
    const budget = await db.orgBudgetAccount.findUniqueOrThrow({
      where: { id: budgetId },
    });
    expect(await balanceOf(db, budget.walletId, "NGN")).toEqual(
      money(3_800_000, "NGN"),
    );
    // The booking's clearing nets to zero.
    expect(await clearingNet(awardId)).toBe(0);

    const status = await payoutStatus(deps, awardId);
    expect(status).toMatchObject({
      state: "paid",
      driverId: driver.id,
      amount: { amountMinor: 1_200_000, currency: "NGN" },
      commissionCaptured: { amountMinor: 120_000, currency: "NGN" },
      driverNet: { amountMinor: 1_080_000, currency: "NGN" },
      entryId: payout.id,
    });

    // The payout's event passes the relay's envelope validation.
    const [payoutEvent] = await db.$queryRawUnsafe<RawOutboxRow[]>(
      `SELECT id, name, schema_version, aggregate_type, aggregate_id,
              from_version, to_version, sequence, city_id, actor_type, actor_id,
              idempotency_key, correlation_id, causation_id, payload,
              occurred_at, published_at, attempts, last_error, created_at
         FROM outbox_events WHERE idempotency_key = $1`,
      payoutEntryKey(committed.result.reservation.reservationId),
    );
    expect(payoutEvent?.name).toBe("transfer.posted");
    const envelope = envelopeFromRow(payoutEvent!);
    expect(envelope.ok ? "ok" : envelope.error).toBe("ok");
    expect(JSON.stringify(payoutEvent?.payload)).not.toContain(cast.orgId);

    // A commit replay, a retry and a sweep pay nothing more.
    const replay = await commitBudget(
      deps,
      { bookingRef: awardId, actualMinor: 1_200_000, currency: "NGN" },
      key("commit"),
    );
    expect(replay.replayed).toBe(true);
    const retried = await retryPayout(deps, awardId);
    expect(retried).toMatchObject({
      replayed: true,
      result: { state: "paid" },
    });
    await sweepPendingPayouts(deps);
    expect(
      await db.journalEntry.count({
        where: {
          kind: "business_trip_payout",
          reference: `business_payout:${awardId}`,
        },
      }),
    ).toBe(1);
    expect(await balanceOf(db, driver.wallet.id, "NGN")).toEqual(
      money(2_080_000, "NGN"),
    );
  });

  it("leaves the payout pending when the award's capture is not there yet, then pays it exactly once", async () => {
    const driver = await driverIn(cast, 500_000);
    const awardId = uid("award");
    await reserveBudget(
      deps,
      termsFor(cast, { bookingRef: awardId, amountMinor: 400_000 }),
      key("reserve"),
    );
    const committed = await commitBudget(
      deps,
      { bookingRef: awardId, actualMinor: 400_000, currency: "NGN" },
      key("commit"),
    );
    const reservationId = committed.result.reservation.reservationId;
    // The organization's money is committed; nobody is paid from clearing yet.
    expect(await clearingNet(awardId)).toBe(400_000);
    expect(await payoutStatus(deps, awardId)).toMatchObject({
      state: "pending",
      pendingReason: "no_captured_commission",
      entryId: null,
    });
    expect(
      await db.auditLog.count({
        where: { subjectId: reservationId, action: "business.payout.pending" },
      }),
    ).toBe(1);

    // The sweep does not pick up a booking that cannot pay yet (it would
    // only crowd payable ones out of its batch) and writes nothing for it.
    await sweepPendingPayouts(deps);
    expect(await payoutStatus(deps, awardId)).toMatchObject({
      state: "pending",
    });
    expect(
      await db.auditLog.count({
        where: { subjectId: reservationId, action: "business.payout.pending" },
      }),
    ).toBe(1);

    await captureCommission(deps, cast, driver, awardId, 400_000);
    expect(await payoutStatus(deps, awardId)).toMatchObject({
      state: "pending",
      pendingReason: "retry_due",
      driverId: driver.id,
    });

    // The sweep and a manual retry race: one payout, ever.
    const [swept, retried] = await Promise.all([
      sweepPendingPayouts(deps),
      retryPayout(deps, awardId),
    ]);
    expect(swept.paid + (retried.replayed ? 0 : 1)).toBeGreaterThanOrEqual(1);
    expect(
      await db.journalEntry.count({
        where: { idempotencyKey: payoutEntryKey(reservationId) },
      }),
    ).toBe(1);
    expect(await clearingNet(awardId)).toBe(0);
    // 500 000 − 40 000 commission + 400 000 fare.
    expect(await balanceOf(db, driver.wallet.id, "NGN")).toEqual(
      money(860_000, "NGN"),
    );
  });

  it("flags — never fixes — a captured commission that is not 10% of the committed fare", async () => {
    const driver = await driverIn(cast, 1_000_000);
    const awardId = uid("award");
    await reserveBudget(
      deps,
      termsFor(cast, { bookingRef: awardId, amountMinor: 1_000_000 }),
      key("reserve"),
    );
    await captureCommission(deps, cast, driver, awardId, 1_000_000);
    const committed = await commitBudget(
      deps,
      { bookingRef: awardId, actualMinor: 900_000, currency: "NGN" },
      key("commit"),
    );
    const reservationId = committed.result.reservation.reservationId;
    const anomaly = await db.auditLog.findFirstOrThrow({
      where: {
        subjectId: reservationId,
        action: "business.payout.commission_mismatch",
      },
    });
    expect(anomaly.after).toMatchObject({
      committedMinor: 900_000,
      commissionCapturedMinor: 100_000,
      commissionAtCommittedFareMinor: 90_000,
    });
    // Still exactly one commission capture and no commission line on the payout.
    expect(
      await db.journalEntry.count({
        where: { reference: `mp_award:${awardId}` },
      }),
    ).toBe(1);
    const payout = await db.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: payoutEntryKey(reservationId) },
      include: { lines: true },
    });
    expect(payout.lines.some((line) => line.account === "ubi_commission")).toBe(
      false,
    );
    expect(await payoutStatus(deps, awardId)).toMatchObject({
      driverNet: { amountMinor: 800_000 },
    });
  });

  it("refuses to retry a booking that was never committed", async () => {
    const awardId = uid("award");
    await reserveBudget(
      deps,
      termsFor(cast, { bookingRef: awardId, amountMinor: 100_000 }),
      key("reserve"),
    );
    await expect(retryPayout(deps, awardId)).rejects.toMatchObject({
      code: "illegal_transition",
    });
    expect(await payoutStatus(deps, awardId)).toMatchObject({
      state: "pending",
      pendingReason: "not_committed",
    });
    await expect(payoutStatus(deps, uid("nothing"))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
