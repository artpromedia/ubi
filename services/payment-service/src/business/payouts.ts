/**
 * The driver's side of a committed business trip (round-7 follow-up to A06
 * part C) — paid out of `business_clearing`.
 *
 * The organization's budget paid the trip's ACTUAL total into
 * `business_clearing` at commit (./reservations.ts). This module pays the
 * awarded driver out of it, in the SAME transaction as the commit whenever
 * the driver is known:
 *
 *   business_clearing −committed  →  driver wallet +committed
 *   (kind `business_trip_payout`, idempotency key `business.payout:<reservation>`)
 *
 * so the booking's clearing lines net to zero per booking ref, as recon
 * expects. The FULL committed fare is credited because the driver's 10% was
 * captured from the driver's own wallet ONCE at selection (the M04 hold on
 * the award) and any fare change since moved it only by linked deltas: the
 * driver therefore nets the committed fare less that one commission, and
 * this entry carries no commission line of any kind — the commission is
 * never charged again, and the organization is never charged it.
 *
 * WHO IS PAID is derived, never asserted: the booking ref IS ride-service's
 * award id (packages/contracts business-travel.ts, step 3), and the award's
 * captured commission hold names the driver and their wallet. With no
 * captured hold yet (or a wallet in another currency), the commit still
 * stands — the organization's money is committed — and the payout is
 * PENDING: audited, reported by `GET /v1/finance/business/payouts/:bookingRef`,
 * retried by `POST /v1/finance/business/payouts` and by the sweep below.
 * Money never leaves `business_clearing` for anyone but that driver.
 */
import { commissionMinorFor, ContractError, money } from "@ubi/contracts";

import { BUSINESS_SERVICE_ACTOR } from "./model";
import { publishEvent, writeAudit } from "../ledger/audit";
import { lockWallet, type WalletDeps } from "../ledger/context";
import { fromDbMinor } from "../ledger/minor-units";
import {
  capturedCommissionMinor,
  isCommissionDeltaBidRef,
} from "../ledger/mp-amendment-refs";
import { postEntry } from "../ledger/post-entry";
import { logger } from "../lib/logger";

import type { LedgerTx } from "../ledger/types";
import type { OrgBudgetReservation } from "@prisma/client/index";

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export const PAYOUT_PENDING_REASONS = [
  "not_committed",
  "no_captured_commission",
  "currency_mismatch",
  /** The award's capture has landed since the commit: the next retry pays. */
  "retry_due",
] as const;
export type PayoutPendingReason = (typeof PAYOUT_PENDING_REASONS)[number];

export type PayoutView = {
  readonly bookingRef: string;
  readonly reservationId: string;
  readonly state: "paid" | "pending";
  readonly pendingReason: PayoutPendingReason | null;
  readonly driverId: string | null;
  /** The committed fare credited to the driver (null until committed). */
  readonly amount: MoneyView | null;
  /** The award's commission captured from the driver to date — never re-charged. */
  readonly commissionCaptured: MoneyView | null;
  /** amount − commissionCaptured: what the driver nets on the trip. */
  readonly driverNet: MoneyView | null;
  readonly entryId: string | null;
  readonly paidAt: string | null;
};

export function payoutEntryKey(reservationId: string): string {
  return `business.payout:${reservationId}`;
}

export function payoutReference(bookingRef: string): string {
  return `business_payout:${bookingRef}`;
}

interface AwardHold {
  readonly id: string;
  readonly driverId: string;
  readonly walletId: string;
  readonly currency: string;
}

/** The award's ORIGINAL captured commission hold — it names the driver. */
async function capturedAwardHold(
  tx: LedgerTx,
  awardId: string,
): Promise<AwardHold | null> {
  const holds = await tx.mpCommissionHold.findMany({
    where: { awardRef: awardId, state: "captured" },
    select: {
      id: true,
      driverId: true,
      walletId: true,
      currency: true,
      bidRef: true,
    },
  });
  const original = holds.filter(
    (hold) => !isCommissionDeltaBidRef(hold.bidRef),
  );
  return original[0] ?? null;
}

async function paidEntry(
  tx: LedgerTx,
  reservationId: string,
): Promise<{ id: string; occurredAt: Date } | null> {
  const entry = await tx.journalEntry.findUnique({
    where: { idempotencyKey: payoutEntryKey(reservationId) },
    select: { id: true, occurredAt: true },
  });
  return entry;
}

async function paidView(
  tx: LedgerTx,
  row: OrgBudgetReservation,
  entry: { id: string; occurredAt: Date },
): Promise<PayoutView> {
  const lines = await tx.journalLine.findMany({
    where: { entryId: entry.id, account: "wallet" },
    select: { walletId: true, amountMinor: true, currency: true },
  });
  const credit = lines[0];
  const wallet =
    credit?.walletId === null || credit === undefined
      ? null
      : await tx.wallet.findUnique({ where: { id: credit.walletId } });
  const amountMinor =
    credit === undefined ? 0 : fromDbMinor(credit.amountMinor);
  const commission =
    wallet === null
      ? 0
      : await capturedCommissionMinor(
          tx,
          wallet.id,
          row.bookingRef,
          row.currency,
        );
  return {
    bookingRef: row.bookingRef,
    reservationId: row.id,
    state: "paid",
    pendingReason: null,
    driverId: wallet?.ownerId ?? null,
    amount: money(amountMinor, row.currency),
    commissionCaptured: money(commission, row.currency),
    driverNet: money(amountMinor - commission, row.currency),
    entryId: entry.id,
    paidAt: entry.occurredAt.toISOString(),
  };
}

function pendingView(
  row: OrgBudgetReservation,
  reason: PayoutPendingReason,
  driverId: string | null,
): PayoutView {
  return {
    bookingRef: row.bookingRef,
    reservationId: row.id,
    state: "pending",
    pendingReason: reason,
    driverId,
    amount:
      row.committedMinor === null
        ? null
        : money(fromDbMinor(row.committedMinor), row.currency),
    commissionCaptured: null,
    driverNet: null,
    entryId: null,
    paidAt: null,
  };
}

/**
 * Pays the awarded driver for a COMMITTED reservation, inside the caller's
 * transaction (the commit's, or a retry's). Exactly once: the journal entry's
 * idempotency key names the reservation, so a second payout cannot post.
 */
export async function payOutInTx(
  tx: LedgerTx,
  row: OrgBudgetReservation,
  now: Date,
  options: { readonly auditPending?: boolean } = {},
): Promise<PayoutView> {
  // A pending payout is audited when it first becomes pending (the commit)
  // and on a manual retry — not on every sweep pass.
  const auditPending = options.auditPending ?? true;
  const prior = await paidEntry(tx, row.id);
  if (prior !== null) {
    return paidView(tx, row, prior);
  }
  if (row.state !== "committed" || row.committedMinor === null) {
    return pendingView(row, "not_committed", null);
  }
  const committedMinor = fromDbMinor(row.committedMinor);
  const hold = await capturedAwardHold(tx, row.bookingRef);
  if (hold === null) {
    if (auditPending) {
      await writeAudit(tx, {
        actor: BUSINESS_SERVICE_ACTOR,
        action: "business.payout.pending",
        subjectType: "business_payout",
        subjectId: row.id,
        after: {
          bookingRef: row.bookingRef,
          reason: "no_captured_commission",
          committedMinor,
        },
      });
    }
    return pendingView(row, "no_captured_commission", null);
  }
  if (hold.currency !== row.currency) {
    if (auditPending) {
      await writeAudit(tx, {
        actor: BUSINESS_SERVICE_ACTOR,
        action: "business.payout.pending",
        subjectType: "business_payout",
        subjectId: row.id,
        after: {
          bookingRef: row.bookingRef,
          reason: "currency_mismatch",
          holdCurrency: hold.currency,
          currency: row.currency,
        },
      });
    }
    return pendingView(row, "currency_mismatch", hold.driverId);
  }

  // The driver wallet's lock serializes this against any linked commission
  // delta on the same award, so the commission read below is exact.
  await lockWallet(tx, hold.walletId);
  const commissionMinor = await capturedCommissionMinor(
    tx,
    hold.walletId,
    row.bookingRef,
    row.currency,
  );
  const bookingLink = `business_booking:${row.bookingRef}`;
  const entry = await postEntry(tx, {
    kind: "business_trip_payout",
    reference: payoutReference(row.bookingRef),
    occurredAt: now,
    idempotencyKey: payoutEntryKey(row.id),
    description:
      "business trip paid to the driver (commission captured at selection)",
    lines: [
      {
        account: "business_clearing",
        amount: money(-committedMinor, row.currency),
        counterpartRef: bookingLink,
      },
      {
        account: "wallet",
        walletId: hold.walletId,
        amount: money(committedMinor, row.currency),
        counterpartRef: bookingLink,
      },
    ],
  });

  const expectedCommission = commissionMinorFor(committedMinor);
  await writeAudit(tx, {
    actor: BUSINESS_SERVICE_ACTOR,
    action: "business.payout.paid",
    subjectType: "business_payout",
    subjectId: row.id,
    after: {
      bookingRef: row.bookingRef,
      entryId: entry.id,
      driverWalletId: hold.walletId,
      holdId: hold.id,
      committedMinor,
      commissionCapturedMinor: commissionMinor,
      driverNetMinor: committedMinor - commissionMinor,
      currency: row.currency,
    },
  });
  if (commissionMinor !== expectedCommission) {
    // Visible to ops, never "fixed" here: a commission changes only through
    // the amendment engine's linked deltas — this payout never charges it.
    await writeAudit(tx, {
      actor: BUSINESS_SERVICE_ACTOR,
      action: "business.payout.commission_mismatch",
      subjectType: "business_payout",
      subjectId: row.id,
      after: {
        bookingRef: row.bookingRef,
        committedMinor,
        commissionCapturedMinor: commissionMinor,
        commissionAtCommittedFareMinor: expectedCommission,
      },
      reason: "captured commission differs from 10% of the committed fare",
    });
  }
  await publishEvent(tx, {
    // A posted wallet movement, under the catalog's generic name — the
    // business-budget convention (./ops.ts), with its own payload kind.
    name: "transfer.posted",
    aggregateType: "booking",
    aggregateId: row.id,
    fromVersion: row.version,
    toVersion: row.version,
    actor: BUSINESS_SERVICE_ACTOR,
    actorType: "system",
    cityId: row.cityId,
    idempotencyKey: payoutEntryKey(row.id),
    occurredAt: now,
    payload: {
      kind: "business_payout",
      reservationId: row.id,
      bookingRef: row.bookingRef,
      walletId: hold.walletId,
      amountMinor: committedMinor,
      currency: row.currency,
      entryId: entry.id,
    },
  });
  return {
    bookingRef: row.bookingRef,
    reservationId: row.id,
    state: "paid",
    pendingReason: null,
    driverId: hold.driverId,
    amount: money(committedMinor, row.currency),
    commissionCaptured: money(commissionMinor, row.currency),
    driverNet: money(committedMinor - commissionMinor, row.currency),
    entryId: entry.id,
    paidAt: now.toISOString(),
  };
}

async function requireReservationRow(
  tx: LedgerTx,
  bookingRef: string,
): Promise<OrgBudgetReservation> {
  const row = await tx.orgBudgetReservation.findUnique({
    where: { bookingRef },
  });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this booking has no business budget reservation",
      { bookingRef },
    );
  }
  return row;
}

/** Where the driver's payout for a booking stands (read-only). */
export async function payoutStatus(
  deps: WalletDeps,
  bookingRef: string,
): Promise<PayoutView> {
  const row = await requireReservationRow(deps.db, bookingRef);
  const entry = await paidEntry(deps.db, row.id);
  if (entry !== null) {
    return paidView(deps.db, row, entry);
  }
  if (row.state !== "committed") {
    return pendingView(row, "not_committed", null);
  }
  const hold = await capturedAwardHold(deps.db, row.bookingRef);
  if (hold === null) {
    return pendingView(row, "no_captured_commission", null);
  }
  return pendingView(
    row,
    hold.currency === row.currency ? "retry_due" : "currency_mismatch",
    hold.driverId,
  );
}

/**
 * Pays a committed booking whose payout is still pending — for ride-service
 * or ops after the award's capture landed. Idempotent on the reservation:
 * a paid booking answers its payout; nothing posts twice.
 */
export async function retryPayout(
  deps: WalletDeps,
  bookingRef: string,
  options: { readonly auditPending?: boolean } = {},
): Promise<{ readonly result: PayoutView; readonly replayed: boolean }> {
  const reservation = await requireReservationRow(deps.db, bookingRef);
  const prior = await paidEntry(deps.db, reservation.id);
  if (prior !== null) {
    return {
      result: await paidView(deps.db, reservation, prior),
      replayed: true,
    };
  }
  if (reservation.state !== "committed") {
    throw new ContractError(
      "illegal_transition",
      "only a committed business booking pays its driver",
      { bookingRef, state: reservation.state },
    );
  }
  try {
    const result = await deps.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM org_budget_reservations WHERE id = ${reservation.id} FOR UPDATE`;
      const row = await requireReservationRow(tx, bookingRef);
      return payOutInTx(tx, row, deps.now(), options);
    });
    return { result, replayed: false };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2002") {
      const again = await paidEntry(deps.db, reservation.id);
      if (again !== null) {
        return {
          result: await paidView(deps.db, reservation, again),
          replayed: true,
        };
      }
    }
    throw error;
  }
}

/**
 * The sweep: pays every committed booking whose payout is pending and has
 * become payable (the award's capture landed), oldest first, a bounded batch
 * per pass. Safe to run anywhere, any number of times — each payout is
 * exactly-once on its reservation.
 */
export async function sweepPendingPayouts(
  deps: WalletDeps,
  options: { readonly limit?: number } = {},
): Promise<{ readonly paid: number; readonly pending: number }> {
  // Committed bookings with no payout entry yet whose award's ORIGINAL
  // commission hold is now captured in the booking's currency — i.e. the ones
  // a retry can pay — oldest first. A booking that cannot pay yet is not
  // selected, so it can never crowd payable ones out of the batch.
  const unpaid = await deps.db.$queryRaw<
    Array<{ id: string; booking_ref: string }>
  >`
    SELECT r.id, r.booking_ref
      FROM org_budget_reservations r
     WHERE r.state = 'committed'
       AND NOT EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je.idempotency_key = 'business.payout:' || r.id)
       AND EXISTS (
             SELECT 1 FROM mp_commission_holds h
              WHERE h.award_ref = r.booking_ref
                AND h.state = 'captured'
                AND h.currency = r.currency
                AND h.bid_ref NOT LIKE 'mpdelta:%')
     ORDER BY r.committed_at ASC
     LIMIT ${options.limit ?? 200}
  `;
  let paid = 0;
  let pending = 0;
  for (const row of unpaid) {
    try {
      const outcome = await retryPayout(deps, row.booking_ref, {
        auditPending: false,
      });
      if (outcome.result.state === "paid") {
        paid += 1;
      } else {
        pending += 1;
      }
    } catch (error) {
      pending += 1;
      logger.error(
        {
          err: error,
          component: "business-payout",
          bookingRef: row.booking_ref,
        },
        "business payout retry failed; the next sweep retries it",
      );
    }
  }
  return { paid, pending };
}
