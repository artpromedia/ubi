/**
 * Rider-side funding for a marketplace selection (M05 step 3, hardened by
 * C02).
 *
 * The award saga in ride-service calls this before it captures the winning
 * commission hold. For a WALLET rider this is no longer a spendable check
 * that evaporates: it creates a durable `mp_rider_reservation` row that
 * encumbers the SELECTED amount from selection to completion, exactly the way
 * a commission hold encumbers a driver's wallet — a table row, never a
 * journal movement, so the cleared balance is untouched and only spendable
 * drops. The reservation is:
 *
 *  - idempotent ON THE AWARD ID: one reservation per award, ever. A replay
 *    with the identical terms answers the existing reservation; a replay with
 *    different terms is a caller bug and conflicts;
 *  - CONSUMED exactly once inside the settlement transaction (mp-settlement),
 *    in the same transaction as the fare postings;
 *  - RELEASED with a linked reason when the award is abandoned — by the saga
 *    compensation, by the queued-award cancellation's fee reversal, or by the
 *    ride-service sweep retrying a lost release.
 *
 * CASH stays deliberately unsecured: there is no custody to encumber, so the
 * answer is `secured: false` and the audit record says so explicitly.
 *
 * Any OTHER config-listed method (card and future PSP methods) fails CLOSED:
 * a city config listing a method as available is a statement about the city,
 * not a provider authorization. Until PSP authorization is built on the
 * canonical ledger (QUARANTINE.md residual), those methods answer
 * `payment_method_unavailable` here rather than pretending the rider can pay.
 */
import {
  type CityConfig,
  ContractError,
  paymentMethodAvailable,
} from "@ubi/contracts";

import { writeAudit } from "./audit";
import { spendableOf } from "./balances";
import { lockWallet, type WalletDeps } from "./context";
import { fromDbMinor, toDbMinor } from "./minor-units";
import { assertNotLocked, assertNotSafeMode, ensureWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "./types";

const MP_SERVICE_ACTOR: Actor = { id: "marketplace-engine", role: "service" };

export interface MarketplaceFundingInput {
  readonly requesterId: string;
  readonly requestId: string;
  readonly awardId: string;
  readonly paymentMethodId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly cityId: string;
}

export interface MarketplaceFundingResult {
  readonly authorized: true;
  readonly awardId: string;
  readonly paymentMethodId: string;
  /** True when a durable reservation encumbers the amount; false for cash. */
  readonly secured: boolean;
  /** The reservation backing a secured authorization; null for cash. */
  readonly reservationId: string | null;
}

/** The row shape Prisma hands back for `mp_rider_reservations`. */
interface ReservationRow {
  readonly id: string;
  readonly awardId: string;
  readonly requestId: string;
  readonly requesterId: string;
  readonly walletId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly cityId: string;
  readonly paymentMethodId: string;
  readonly status: string;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

/**
 * A replay must carry the terms the reservation was created with — anything
 * else is a caller bug answered with a conflict, never with someone else's
 * reservation.
 */
function assertSameTerms(
  row: ReservationRow,
  input: MarketplaceFundingInput,
): void {
  if (
    fromDbMinor(row.amountMinor) !== input.amountMinor ||
    row.currency !== input.currency ||
    row.paymentMethodId !== input.paymentMethodId ||
    row.requesterId !== input.requesterId
  ) {
    throw new ContractError(
      "conflict",
      "this award already has a funding reservation with different terms",
      {
        awardId: input.awardId,
        reservationId: row.id,
        reservedMinor: fromDbMinor(row.amountMinor),
        reservedCurrency: row.currency,
        reservedPaymentMethodId: row.paymentMethodId,
      },
    );
  }
}

/**
 * Answers a replay for an existing reservation. Only an ACTIVE reservation
 * replays as an authorization: a released or consumed one no longer encumbers
 * anything, so answering "authorized" would let a saga march forward with no
 * security behind it.
 */
function replayOf(
  row: ReservationRow,
  input: MarketplaceFundingInput,
): MarketplaceFundingResult {
  assertSameTerms(row, input);
  if (row.status !== "active") {
    throw new ContractError(
      "conflict",
      "this award's funding reservation is no longer active",
      { awardId: input.awardId, reservationId: row.id, status: row.status },
    );
  }
  return {
    authorized: true as const,
    awardId: input.awardId,
    paymentMethodId: input.paymentMethodId,
    secured: true,
    reservationId: row.id,
  };
}

/** A P2002 on the per-award unique index — the losing side of a replay race. */
function isAwardIdRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }
  const target = candidate.meta?.target;
  const fields = Array.isArray(target)
    ? target.map((field) => String(field))
    : typeof target === "string"
      ? [target]
      : [];
  return fields.some((field) => field.includes("award_id"));
}

export async function authorizeMarketplaceFunding(
  deps: WalletDeps,
  input: MarketplaceFundingInput,
): Promise<MarketplaceFundingResult> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "the funding amount must be a positive integer in minor units",
      { amountMinor: input.amountMinor },
    );
  }

  const { city } = await deps.config.loadForWallet(input.cityId);
  if (city.currency !== input.currency) {
    throw new ContractError(
      "validation_failed",
      "the funding currency does not match the city's currency",
      { currency: input.currency, cityCurrency: city.currency },
    );
  }
  if (!paymentMethodAvailable(city, input.paymentMethodId)) {
    throw new ContractError(
      "payment_method_unavailable",
      "that payment method is not available here",
      { paymentMethodId: input.paymentMethodId },
    );
  }

  if (input.paymentMethodId === "wallet") {
    return reserveWalletFunding(deps, input, city);
  }
  if (input.paymentMethodId === "cash") {
    return authorizeCashFunding(deps, input);
  }
  // FAIL CLOSED for every other config-listed method (card, PSP wallets…):
  // config availability is a statement about the city, not a provider
  // authorization, and PSP authorization is not built on the canonical
  // ledger yet (QUARANTINE.md). Marketplace selection must not treat these
  // methods as payable.
  throw new ContractError(
    "payment_method_unavailable",
    "provider authorization is not yet supported for marketplace funding; " +
      "config availability is not provider authorization",
    { paymentMethodId: input.paymentMethodId },
  );
}

/**
 * The wallet path: one transaction that locks the wallet row (the same
 * `lockWallet` FOR UPDATE serialisation every competing spend on this ledger
 * uses), recomputes spendable under the lock, and creates the reservation.
 */
async function reserveWalletFunding(
  deps: WalletDeps,
  input: MarketplaceFundingInput,
  city: CityConfig,
): Promise<MarketplaceFundingResult> {
  // Cheap replay answer before any lock is taken.
  const existing = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  if (existing !== null) {
    return replayOf(existing, input);
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const wallet = await ensureWallet(tx, "user", input.requesterId, city);
      assertNotLocked(wallet);
      assertNotSafeMode(wallet, deps.now());
      await lockWallet(tx, wallet.id);

      // Re-read under the wallet lock: a rival authorize for this award may
      // have committed while we waited on the row.
      const raced = await tx.mpRiderReservation.findUnique({
        where: { awardId: input.awardId },
      });
      if (raced !== null) {
        return replayOf(raced, input);
      }

      const spendable = await spendableOf(tx, wallet.id, wallet.currency);
      if (spendable.amountMinor < input.amountMinor) {
        throw new ContractError(
          "insufficient_funds",
          "the wallet cannot cover the selected fare",
          {
            requiredMinor: input.amountMinor,
            spendableMinor: spendable.amountMinor,
            shortfallMinor: input.amountMinor - spendable.amountMinor,
          },
        );
      }

      const reservation = await tx.mpRiderReservation.create({
        data: {
          id: generateId("mrr"),
          awardId: input.awardId,
          requestId: input.requestId,
          requesterId: input.requesterId,
          walletId: wallet.id,
          amountMinor: toDbMinor(input.amountMinor),
          currency: wallet.currency,
          cityId: input.cityId,
          paymentMethodId: input.paymentMethodId,
          status: "active",
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_funding.authorized",
        subjectType: "mp_award",
        subjectId: input.awardId,
        after: {
          requestId: input.requestId,
          requesterId: input.requesterId,
          paymentMethodId: input.paymentMethodId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          secured: true,
          reservationId: reservation.id,
          walletId: wallet.id,
        },
      });

      return {
        authorized: true as const,
        awardId: input.awardId,
        paymentMethodId: input.paymentMethodId,
        secured: true,
        reservationId: reservation.id,
      };
    });
  } catch (error) {
    // Lost the per-award insert race: the winner's row is the answer — a true
    // replay converges on it, anything else conflicts.
    if (isAwardIdRace(error)) {
      const winner = await deps.db.mpRiderReservation.findUnique({
        where: { awardId: input.awardId },
      });
      if (winner !== null) {
        return replayOf(winner, input);
      }
    }
    throw error;
  }
}

/**
 * Cash: no custody, no reservation — EXPLICITLY unsecured cash collection.
 * City-config availability was already checked; the audit record states the
 * authorization is unsecured so nobody later mistakes it for an encumbrance.
 */
async function authorizeCashFunding(
  deps: WalletDeps,
  input: MarketplaceFundingInput,
): Promise<MarketplaceFundingResult> {
  // A cash authorize for an award that already carries a wallet reservation
  // is a method switch mid-saga — a caller bug, refused.
  const existing = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  if (existing !== null) {
    throw new ContractError(
      "conflict",
      "this award already has a wallet funding reservation",
      { awardId: input.awardId, reservationId: existing.id },
    );
  }

  return deps.db.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: MP_SERVICE_ACTOR,
      action: "wallet.mp_funding.authorized",
      subjectType: "mp_award",
      subjectId: input.awardId,
      after: {
        requestId: input.requestId,
        requesterId: input.requesterId,
        paymentMethodId: input.paymentMethodId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        secured: false,
        reservationId: null,
        note: "unsecured cash collection — no wallet custody to encumber",
      },
    });
    return {
      authorized: true as const,
      awardId: input.awardId,
      paymentMethodId: input.paymentMethodId,
      secured: false,
      reservationId: null,
    };
  });
}

// ── Release ────────────────────────────────────────────────────────────────

export interface MarketplaceFundingReleaseInput {
  readonly awardId: string;
  readonly reason: string;
}

export interface MarketplaceFundingReleaseResult {
  /** True only for the call that actually moved active → released. */
  readonly released: boolean;
  /**
   * The reservation's state after this call: `released`, `consumed` (which
   * callers must treat as an alarm — the award already settled), or `missing`
   * (no reservation was ever created, e.g. a cash award).
   */
  readonly status: "released" | "consumed" | "missing";
  readonly awardId: string;
  readonly reservationId: string | null;
}

/**
 * Releases an award's ACTIVE funding reservation exactly once. Idempotent and
 * deliberately forgiving: already-released and never-created both answer 200
 * with the current state, because compensation and the sweep must converge,
 * not error-loop. A CONSUMED reservation is reported distinctly — releasing a
 * settled award's reservation means two paths disagree about the award's
 * outcome, and the caller must alarm rather than retry.
 */
export async function releaseMarketplaceFunding(
  deps: WalletDeps,
  input: MarketplaceFundingReleaseInput,
): Promise<MarketplaceFundingReleaseResult> {
  const now = deps.now();

  const answerFor = (
    row: ReservationRow | null,
  ): MarketplaceFundingReleaseResult => {
    if (row === null) {
      return {
        released: false,
        status: "missing",
        awardId: input.awardId,
        reservationId: null,
      };
    }
    return {
      released: false,
      status: row.status === "consumed" ? "consumed" : "released",
      awardId: input.awardId,
      reservationId: row.id,
    };
  };

  const pre = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  if (pre === null || pre.status !== "active") {
    return answerFor(pre);
  }

  return deps.db.$transaction(async (tx) => {
    const released = await releaseReservationInTx(
      tx,
      input.awardId,
      input.reason,
      now,
    );
    if (released === null) {
      const raced = await tx.mpRiderReservation.findUnique({
        where: { awardId: input.awardId },
      });
      return answerFor(raced);
    }
    return {
      released: true,
      status: "released" as const,
      awardId: input.awardId,
      reservationId: released.reservationId,
    };
  });
}

/**
 * The one active → released transition, inside the CALLER'S transaction, with
 * its audit row in the same commit. Returns null when there was no active
 * reservation to release (missing, already released, or consumed) — the
 * caller decides whether that silence matters. Used by the release endpoint
 * and by the award-reversal path (`reverseCapturedHold`), so a cancelled
 * award frees the rider's money in the same transaction that hands the
 * commission back.
 */
export async function releaseReservationInTx(
  tx: LedgerTx,
  awardId: string,
  reason: string,
  now: Date,
): Promise<{ reservationId: string } | null> {
  // A conditional transition, not a blind write: exactly one caller ever
  // moves active → released, and a racing consume wins or loses atomically.
  const moved = await tx.mpRiderReservation.updateMany({
    where: { awardId, status: "active" },
    data: { status: "released", reason, resolvedAt: now },
  });
  if (moved.count === 0) {
    return null;
  }
  const row = await tx.mpRiderReservation.findUnique({ where: { awardId } });
  await writeAudit(tx, {
    actor: MP_SERVICE_ACTOR,
    action: "wallet.mp_funding.released",
    subjectType: "mp_award",
    subjectId: awardId,
    before: { status: "active" },
    after: {
      status: "released",
      reservationId: row?.id ?? null,
      amountMinor: row === null ? null : fromDbMinor(row.amountMinor),
      currency: row?.currency ?? null,
      walletId: row?.walletId ?? null,
    },
    reason,
  });
  return { reservationId: row?.id ?? "" };
}

// ── Consumption (settlement-side, same transaction as the postings) ────────

export interface ConsumeReservationInput {
  readonly awardId: string;
  readonly method: string;
  readonly fareMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

export interface ConsumeReservationResult {
  /** True when an active reservation moved to consumed in this transaction. */
  readonly consumed: boolean;
  readonly reservationId: string | null;
}

/**
 * Consumes the award's ACTIVE reservation inside the CALLER'S settlement
 * transaction, so the encumbrance ends in the same commit that debits the
 * fare — never before, never after. The conditional update makes a duplicate
 * consume structurally impossible; settlement replays never even get here
 * (the outbox record answers them first).
 *
 * A WALLET settlement that finds no active reservation is NOT blocked —
 * legacy and pre-C02 awards have none — but the gap is written down as an
 * explicit audit anomaly so reconciliation sees every unsecured settlement.
 */
export async function consumeReservationForSettlement(
  tx: LedgerTx,
  input: ConsumeReservationInput,
): Promise<ConsumeReservationResult> {
  const moved = await tx.mpRiderReservation.updateMany({
    where: { awardId: input.awardId, status: "active" },
    data: { status: "consumed", resolvedAt: input.occurredAt },
  });

  if (moved.count === 1) {
    const row = await tx.mpRiderReservation.findUnique({
      where: { awardId: input.awardId },
    });
    await writeAudit(tx, {
      actor: MP_SERVICE_ACTOR,
      action: "wallet.mp_funding.consumed",
      subjectType: "mp_award",
      subjectId: input.awardId,
      before: { status: "active" },
      after: {
        status: "consumed",
        reservationId: row?.id ?? null,
        reservedMinor: row === null ? null : fromDbMinor(row.amountMinor),
        settledFareMinor: input.fareMinor,
        currency: input.currency,
      },
    });
    return { consumed: true, reservationId: row?.id ?? null };
  }

  if (input.method !== "wallet") {
    // Cash settlements carry no reservation by design — nothing to record.
    return { consumed: false, reservationId: null };
  }

  // Wallet settlement with no active reservation: the money still moves (the
  // spendable guard protects the debit), but the missing encumbrance is an
  // anomaly reconciliation must see.
  const row = await tx.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  await writeAudit(tx, {
    actor: MP_SERVICE_ACTOR,
    action: "wallet.mp_funding.reservation_anomaly",
    subjectType: "mp_award",
    subjectId: input.awardId,
    after: {
      anomaly: "wallet settlement without an active funding reservation",
      reservationId: row?.id ?? null,
      reservationStatus: row?.status ?? null,
      settledFareMinor: input.fareMinor,
      currency: input.currency,
    },
  });
  return { consumed: false, reservationId: row?.id ?? null };
}
