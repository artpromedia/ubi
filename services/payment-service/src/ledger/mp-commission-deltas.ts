/**
 * Post-capture commission deltas (A02 item 5) — how a post-award amendment
 * changes an award's captured 10% commission WITHOUT re-charging it.
 *
 * Before this module a captured commission could only be reversed in full
 * (`reverseCapturedHold`), so a fare change after award would have needed
 * reverse-and-recapture — charging the 10% a second time. Instead, every
 * amendment moves ONLY the difference, as a linked record keyed by
 * (the award's captured reservation, amendmentId):
 *
 *  - fare INCREASE: `reserveCommissionDelta` encumbers the incremental fee on
 *    the driver's spendable (an `mp_commission_holds` row, same spendability
 *    rules as a bid reservation); at commit `captureCommissionDelta` debits
 *    exactly that increment once (`mp_commission_delta_capture`); on
 *    reject/expiry `releaseCommissionDelta` frees it;
 *  - fare DECREASE: at commit `refundCommissionDelta` posts a linked PARTIAL
 *    reversal back to the driver (`mp_commission_delta_refund`), never more
 *    than captured to date.
 *
 * The caller states the award's prior total and its new total (the 10% of the
 * new fare, which must be the ONE commission function's answer); this module
 * derives the captured total from the journal, refuses a stale prior with a
 * `version_conflict` carrying the refreshed total, and derives the delta
 * itself. So, after any sequence of amendments, the award's captured
 * commission is exactly commission(final fare) and nothing is captured twice.
 *
 * Every operation: is idempotent on the amendment id (a replay answers the
 * original outcome; the same amendment with different terms is refused); runs
 * under the driver wallet's row lock with unique keys behind it; writes its
 * audit row and outbox event (the existing `mp.commission.*` names, with
 * `kind: "amendment_delta"`) in the same transaction; handles integer minor
 * units in the hold's single currency (a mismatch is refused).
 *
 * At most one amendment delta may be open (reserved, not yet captured or
 * released) per award at a time, so a prior total always means one thing.
 */
import {
  assertTransition,
  commissionMinorFor,
  ContractError,
  type Money,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import {
  activeHoldsMinor,
  activeRiderReservationsMinor,
  activeTravelAuthorizationsMinor,
  spendableOf,
} from "./balances";
import { lockWallet, type WalletDeps } from "./context";
import { isIdempotencyRace } from "./idempotency";
import { fromDbMinor, toDbMinor } from "./minor-units";
import {
  assertLinkId,
  capturedCommissionMinor,
  commissionDeltaBidRef,
  commissionDeltaPrefix,
  deltaCaptureCounterpartRef,
  deltaRefundCounterpartRef,
  isCommissionDeltaBidRef,
} from "./mp-amendment-refs";
import {
  type HoldRow,
  insufficientSpendable,
  isBidRefRace,
  MP_COMMISSION_BPS,
  MP_ROUNDING_RULE,
  payloadHashOf,
} from "./mp-holds";
import { movement, postEntry } from "./post-entry";
import { assertNotLocked, requireWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "./types";

const HOLD_MACHINE = "mpHold" as const;

const MP_SERVICE_ACTOR: Actor = { id: "marketplace-engine", role: "service" };

type DeltaOp = "delta" | "delta_capture" | "delta_release" | "delta_refund";

/**
 * Amendment-scoped keys: the (reservation, amendment) pair is the idempotency
 * authority, not the caller's Idempotency-Key header (as the award id is for
 * the original capture, ADR 0002).
 */
function deltaKey(
  op: DeltaOp,
  reservationId: string,
  amendmentId: string,
): string {
  return scopedIdempotencyKey(
    `wallet.mp_hold.${op}`,
    MP_SERVICE_ACTOR.id,
    `${reservationId}:amendment:${amendmentId}`,
  );
}

// ── Wire shapes ────────────────────────────────────────────────────────────

export type CommissionDeltaDirection = "increase" | "decrease" | "none";

export type CommissionDeltaState =
  | "active"
  | "capture_pending"
  | "captured"
  | "released"
  | "refunded"
  | "reversed";

/** One amendment's commission delta against one award's captured reservation. */
export interface MpCommissionDeltaView {
  /** The award's captured reservation the delta is linked to. */
  readonly reservationId: string;
  readonly amendmentId: string;
  readonly awardId: string;
  /** `none`: the amendment was released before any increment was reserved. */
  readonly direction: CommissionDeltaDirection;
  readonly state: CommissionDeltaState;
  /** The increment's own reservation row; null for a decrease. */
  readonly deltaReservationId: string | null;
  /** The magnitude moved (or reserved): newTotal − priorTotal, unsigned. */
  readonly deltaMinor: Money;
  readonly priorTotalMinor: Money | null;
  readonly newTotalMinor: Money | null;
  readonly newBaseMinor: Money | null;
  /** The increment capture's or the refund's own receipt. */
  readonly receiptId: string | null;
  readonly journalEntryId: string | null;
  /** The award's original capture receipt this delta is linked to. */
  readonly originalReceiptId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface MpCommissionDeltaResult {
  readonly delta: MpCommissionDeltaView;
  readonly replayed: boolean;
}

/** The terms an amendment brings: prior and new award totals, and the new fare. */
export interface CommissionDeltaTermsInput {
  readonly awardId: string;
  /** The award's captured commission as the caller last knew it. */
  readonly priorTotalMinor: number;
  /** 10% of `newBaseMinor`, half-up — the award's commission after commit. */
  readonly newTotalMinor: number;
  /** The amended commissionable fare. */
  readonly newBaseMinor: number;
  readonly currency: string;
}

export interface CaptureCommissionDeltaInput {
  readonly awardId: string;
  /** The committed amendment's total; must be the reserved increment's target. */
  readonly newTotalMinor: number;
  readonly currency: string;
}

export interface ReleaseCommissionDeltaInput {
  readonly awardId: string;
  readonly reason: string;
}

// ── Shared guards ──────────────────────────────────────────────────────────

/**
 * A row closing an amendment that never reserved an increment (a release
 * that arrived first). It carries no money; it exists so a late reserve for
 * the same amendment is refused instead of encumbering after the fact.
 */
function isTombstone(row: HoldRow): boolean {
  return row.amountMinor === 0n && row.baseMinor === 0n;
}

const TOMBSTONE_HASH = payloadHashOf({ op: "closed_without_reservation" });

function deltaRowView(
  row: HoldRow,
  original: HoldRow,
  amendmentId: string,
): MpCommissionDeltaView {
  const deltaMinor = fromDbMinor(row.amountMinor);
  const baseMinor = fromDbMinor(row.baseMinor);
  const tombstone = isTombstone(row);
  const newTotalMinor = tombstone ? null : commissionMinorFor(baseMinor);
  const resolvedAt = row.capturedAt ?? row.releasedAt;
  return {
    reservationId: original.id,
    amendmentId,
    awardId: row.awardRef ?? "",
    direction: tombstone ? "none" : "increase",
    state: row.state as CommissionDeltaState,
    deltaReservationId: row.id,
    deltaMinor: money(deltaMinor, row.currency),
    priorTotalMinor:
      newTotalMinor === null
        ? null
        : money(newTotalMinor - deltaMinor, row.currency),
    newTotalMinor:
      newTotalMinor === null ? null : money(newTotalMinor, row.currency),
    newBaseMinor: tombstone ? null : money(baseMinor, row.currency),
    receiptId: row.receiptId,
    journalEntryId: row.journalEntryId,
    originalReceiptId: original.receiptId,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: resolvedAt === null ? null : resolvedAt.toISOString(),
  };
}

function assertMinorUnits(field: string, value: number, minimum: 0 | 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new ContractError(
      "validation_failed",
      `${field} must be ${minimum === 0 ? "a non-negative" : "a positive"} integer in minor units`,
      { field, value },
    );
  }
}

/**
 * Server-authoritative arithmetic: the new total must be the ONE commission
 * function's answer for the new fare, or the caller computed money itself.
 */
function assertDeltaTerms(input: CommissionDeltaTermsInput): void {
  assertLinkId("awardId", input.awardId);
  assertMinorUnits("priorTotalMinor", input.priorTotalMinor, 0);
  assertMinorUnits("newTotalMinor", input.newTotalMinor, 0);
  assertMinorUnits("newBaseMinor", input.newBaseMinor, 1);
  const expected = commissionMinorFor(input.newBaseMinor);
  if (input.newTotalMinor !== expected) {
    throw new ContractError(
      "validation_failed",
      "the new total is not 10% of the new base, rounded half-up",
      {
        newTotalMinor: input.newTotalMinor,
        newBaseMinor: input.newBaseMinor,
        expectedMinor: expected,
      },
    );
  }
}

async function requireOriginal(
  client: LedgerTx,
  reservationId: string,
): Promise<HoldRow> {
  const row = await client.mpCommissionHold.findUnique({
    where: { id: reservationId },
  });
  if (row === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId,
    });
  }
  if (isCommissionDeltaBidRef(row.bidRef)) {
    throw new ContractError(
      "validation_failed",
      "amendment deltas attach to the award's captured reservation, not to another delta",
      { reservationId },
    );
  }
  return row;
}

/**
 * The award's captured reservation must still carry the award, in the
 * caller's currency, under the policy the commission function implements.
 * Currency first: a mismatch is always a 422, never a state conflict.
 */
function assertAmendable(
  hold: HoldRow,
  awardId: string,
  currency: string,
): void {
  if (hold.currency !== currency) {
    throw new ContractError(
      "validation_failed",
      "the amendment currency does not match the reservation's currency",
      { currency, holdCurrency: hold.currency },
    );
  }
  if (hold.state === "active" || hold.state === "capture_pending") {
    throw new ContractError(
      "conflict",
      "this reservation's commission is not captured yet; a live hold is adjusted, not amended",
      { reservationId: hold.id, state: hold.state },
    );
  }
  if (hold.awardRef !== awardId) {
    throw new ContractError(
      "conflict",
      "this reservation was captured under a different award",
      { reservationId: hold.id, awardRef: hold.awardRef },
    );
  }
  if (hold.state !== "captured") {
    throw new ContractError(
      "conflict",
      "the award's commission is no longer captured; it cannot be amended",
      { reservationId: hold.id, state: hold.state },
    );
  }
  if (
    hold.commissionBps !== MP_COMMISSION_BPS ||
    hold.roundingRule !== MP_ROUNDING_RULE
  ) {
    // Historical charges are never recomputed under a different policy.
    throw new ContractError(
      "conflict",
      "the reservation's commission policy snapshot is not the policy amendments price with",
      {
        reservationId: hold.id,
        commissionBps: hold.commissionBps,
        roundingRule: hold.roundingRule,
      },
    );
  }
}

function staleTerms(
  hold: HoldRow,
  awardId: string,
  capturedMinor: number,
  priorTotalMinor: number,
): ContractError {
  return new ContractError(
    "version_conflict",
    "the prior total is not the award's captured commission; refresh and retry",
    {
      reservationId: hold.id,
      awardId,
      priorTotalMinor: money(priorTotalMinor, hold.currency),
      refreshedTerms: {
        capturedTotalMinor: money(capturedMinor, hold.currency),
      },
    },
  );
}

/** One open amendment delta per award: a prior total must mean one thing. */
async function refuseOpenDelta(
  tx: LedgerTx,
  hold: HoldRow,
  capturedMinor: number,
): Promise<void> {
  const open = await tx.mpCommissionHold.findFirst({
    where: {
      bidRef: { startsWith: commissionDeltaPrefix(hold.id) },
      state: { in: ["active", "capture_pending"] },
    },
  });
  if (open !== null) {
    throw new ContractError(
      "conflict",
      "another amendment's commission delta is still open on this award",
      {
        reservationId: hold.id,
        openDeltaReservationId: open.id,
        refreshedTerms: {
          capturedTotalMinor: money(capturedMinor, hold.currency),
        },
      },
    );
  }
}

/** The refund entry for an amendment — its existence means a committed decrease. */
async function refundEntryFor(
  client: LedgerTx,
  reservationId: string,
  amendmentId: string,
): Promise<{ id: string } | null> {
  const entry = await client.journalEntry.findUnique({
    where: {
      idempotencyKey: deltaKey("delta_refund", reservationId, amendmentId),
    },
    select: { id: true },
  });
  return entry;
}

async function insufficientFor(
  tx: LedgerTx,
  hold: HoldRow,
  requiredMinor: number,
  spendableMinor: number,
): Promise<ContractError> {
  const held = await activeHoldsMinor(tx, hold.walletId, hold.currency);
  const reserved = await activeRiderReservationsMinor(
    tx,
    hold.walletId,
    hold.currency,
  );
  const travel = await activeTravelAuthorizationsMinor(
    tx,
    hold.walletId,
    hold.currency,
  );
  const encumberedMinor =
    held.amountMinor + reserved.amountMinor + travel.amountMinor;
  return insufficientSpendable(
    requiredMinor,
    spendableMinor,
    encumberedMinor,
    spendableMinor + encumberedMinor,
  );
}

// ── Reserve (fare increase, before commit) ─────────────────────────────────

/**
 * Reserves the incremental commission of a fare-raising amendment on the
 * driver's spendable funds — cleared balance minus active holds, rider
 * reservations and travel authorizations, exactly as a bid reservation is
 * checked. A shortfall refuses with `insufficient_spendable` and writes
 * nothing. The increment is its own hold row linked to the award's captured
 * reservation; the captured row itself is never touched.
 */
export async function reserveCommissionDelta(
  deps: WalletDeps,
  reservationId: string,
  amendmentId: string,
  input: CommissionDeltaTermsInput,
  clientKey: string,
): Promise<MpCommissionDeltaResult> {
  const now = deps.now();
  void clientKey;
  assertLinkId("amendmentId", amendmentId);
  assertDeltaTerms(input);
  if (input.newTotalMinor <= input.priorTotalMinor) {
    throw new ContractError(
      "validation_failed",
      "a commission delta is reserved only for an increase; a decrease is refunded at commit",
      {
        priorTotalMinor: input.priorTotalMinor,
        newTotalMinor: input.newTotalMinor,
      },
    );
  }

  const bidRef = commissionDeltaBidRef(reservationId, amendmentId);
  const key = deltaKey("delta", reservationId, amendmentId);
  const hash = payloadHashOf({
    op: "reserve",
    awardId: input.awardId,
    priorTotalMinor: input.priorTotalMinor,
    newTotalMinor: input.newTotalMinor,
    newBaseMinor: input.newBaseMinor,
    currency: input.currency,
  });

  const original = await requireOriginal(deps.db, reservationId);

  const replayOf = (row: HoldRow | null): MpCommissionDeltaResult | null => {
    if (row === null) {
      return null;
    }
    if (row.payloadHash !== hash) {
      if (isTombstone(row)) {
        throw new ContractError(
          "conflict",
          "this amendment was already released; it cannot reserve a delta",
          { reservationId, amendmentId, deltaReservationId: row.id },
        );
      }
      throw new ContractError(
        "idempotency_key_reuse",
        "this amendment already reserved a commission delta with different terms",
        { reservationId, amendmentId, deltaReservationId: row.id },
      );
    }
    return { delta: deltaRowView(row, original, amendmentId), replayed: true };
  };

  const pre = replayOf(
    await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
  );
  if (pre !== null) {
    return pre;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      // The driver wallet's row lock serialises every money operation on it:
      // rival deltas, refunds, captures, the award's reversal and every other
      // spend all queue here, so the checks below cannot go stale.
      await lockWallet(tx, original.walletId);
      const hold = await requireOriginal(tx, reservationId);
      const raced = replayOf(
        await tx.mpCommissionHold.findUnique({ where: { bidRef } }),
      );
      if (raced !== null) {
        return raced;
      }
      assertAmendable(hold, input.awardId, input.currency);

      if ((await refundEntryFor(tx, reservationId, amendmentId)) !== null) {
        throw new ContractError(
          "conflict",
          "this amendment already committed a commission decrease",
          { reservationId, amendmentId },
        );
      }
      const capturedMinor = await capturedCommissionMinor(
        tx,
        hold.walletId,
        input.awardId,
        hold.currency,
      );
      await refuseOpenDelta(tx, hold, capturedMinor);
      if (capturedMinor !== input.priorTotalMinor) {
        throw staleTerms(
          hold,
          input.awardId,
          capturedMinor,
          input.priorTotalMinor,
        );
      }
      const deltaMinor = input.newTotalMinor - capturedMinor;

      const wallet = await requireWallet(tx, hold.walletId);
      assertNotLocked(wallet);
      const spendable = await spendableOf(tx, hold.walletId, hold.currency);
      if (spendable.amountMinor < deltaMinor) {
        throw await insufficientFor(
          tx,
          hold,
          deltaMinor,
          spendable.amountMinor,
        );
      }

      const row = await tx.mpCommissionHold.create({
        data: {
          id: generateId("mph"),
          walletId: hold.walletId,
          driverId: hold.driverId,
          bidRef,
          requestRef: hold.requestRef,
          awardRef: input.awardId,
          amountMinor: toDbMinor(deltaMinor),
          baseMinor: toDbMinor(input.newBaseMinor),
          currency: hold.currency,
          // The award's snapshot, never today's policy.
          commissionBps: hold.commissionBps,
          roundingRule: hold.roundingRule,
          policyVersion: hold.policyVersion,
          state: "active",
          idempotencyKey: key,
          payloadHash: hash,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.delta_reserved",
        subjectType: "mp_hold",
        subjectId: hold.id,
        after: {
          state: "active",
          deltaReservationId: row.id,
          amendmentId,
          awardId: input.awardId,
          priorTotalMinor: capturedMinor,
          newTotalMinor: input.newTotalMinor,
          newBaseMinor: input.newBaseMinor,
          deltaMinor,
          walletId: hold.walletId,
        },
      });
      await publishEvent(tx, {
        name: "mp.commission.reserved",
        aggregateType: "mp_hold",
        aggregateId: row.id,
        fromVersion: null,
        toVersion: 1,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${key}:reserved`,
        occurredAt: now,
        payload: {
          reservationId: row.id,
          kind: "amendment_delta",
          originalReservationId: hold.id,
          amendmentId,
          awardId: input.awardId,
          bidRef: hold.bidRef,
          requestRef: hold.requestRef,
          walletId: hold.walletId,
          amountMinor: deltaMinor,
          priorTotalMinor: capturedMinor,
          newTotalMinor: input.newTotalMinor,
          currency: hold.currency,
        },
      });

      return { delta: deltaRowView(row, hold, amendmentId), replayed: false };
    });
  } catch (error) {
    // Lost a race to a rival insert for the same amendment (bid ref or key):
    // the winner's row is the answer — same terms replay, others conflict.
    if (isIdempotencyRace(error) || isBidRefRace(error)) {
      const answer = replayOf(
        await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
      );
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}

// ── Capture (amendment commit) ─────────────────────────────────────────────

/**
 * `active → capture_pending → captured` for the increment: ONE debit of
 * exactly the reserved increment (driver wallet → `ubi_commission`), linked
 * to the award through `award:<id>:amendment:<amendmentId>` and to the
 * original capture receipt in the audit and event. Idempotent on the
 * amendment: the journal key is amendment-scoped, so however many times —
 * and however concurrently — commit is retried, the increment is debited
 * once and every caller gets the same receipt.
 */
export async function captureCommissionDelta(
  deps: WalletDeps,
  reservationId: string,
  amendmentId: string,
  input: CaptureCommissionDeltaInput,
  clientKey: string,
): Promise<MpCommissionDeltaResult> {
  const now = deps.now();
  void clientKey;
  assertLinkId("amendmentId", amendmentId);
  assertLinkId("awardId", input.awardId);
  assertMinorUnits("newTotalMinor", input.newTotalMinor, 0);

  const bidRef = commissionDeltaBidRef(reservationId, amendmentId);
  const journalKey = deltaKey("delta_capture", reservationId, amendmentId);
  const original = await requireOriginal(deps.db, reservationId);

  const requireDelta = (row: HoldRow | null): HoldRow => {
    if (row === null) {
      throw new ContractError(
        "not_found",
        "no commission delta is reserved for this amendment",
        { reservationId, amendmentId },
      );
    }
    return row;
  };

  // Answers a replay, refuses what can never be captured, or returns null
  // for an active increment that this call should capture.
  const settledAnswer = (row: HoldRow): MpCommissionDeltaResult | null => {
    if (row.currency !== input.currency) {
      throw new ContractError(
        "validation_failed",
        "the capture currency does not match the delta's currency",
        { currency: input.currency, deltaCurrency: row.currency },
      );
    }
    if (row.awardRef !== input.awardId) {
      throw new ContractError(
        "conflict",
        "this amendment's delta belongs to a different award",
        { reservationId, amendmentId, awardRef: row.awardRef },
      );
    }
    if (isTombstone(row)) {
      throw new ContractError(
        "conflict",
        "this amendment was released without an increment; nothing to capture",
        { reservationId, amendmentId },
      );
    }
    const reservedTotalMinor = commissionMinorFor(fromDbMinor(row.baseMinor));
    if (reservedTotalMinor !== input.newTotalMinor) {
      throw new ContractError(
        "conflict",
        "the committed total is not the total this amendment reserved for",
        {
          reservationId,
          amendmentId,
          newTotalMinor: money(input.newTotalMinor, row.currency),
          reservedNewTotalMinor: money(reservedTotalMinor, row.currency),
        },
      );
    }
    if (row.state === "captured" || row.state === "reversed") {
      return {
        delta: deltaRowView(row, original, amendmentId),
        replayed: true,
      };
    }
    if (row.state === "released") {
      throw new ContractError(
        "conflict",
        "this amendment's increment was released; it can no longer be captured",
        { reservationId, amendmentId, deltaReservationId: row.id },
      );
    }
    if (row.state === "capture_pending") {
      throw new ContractError(
        "award_unresolved",
        "this amendment's increment capture has not resolved",
        { reservationId, amendmentId, deltaReservationId: row.id },
      );
    }
    return null;
  };

  const pre = settledAnswer(
    requireDelta(
      await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
    ),
  );
  if (pre !== null) {
    return pre;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, original.walletId);
      const hold = await requireOriginal(tx, reservationId);
      const row = requireDelta(
        await tx.mpCommissionHold.findUnique({ where: { bidRef } }),
      );
      const replay = settledAnswer(row);
      if (replay !== null) {
        return replay;
      }
      assertAmendable(hold, input.awardId, input.currency);

      // The award's captured total cannot have moved since the reserve (one
      // open delta per award; the award's reversal releases it), but the
      // commit is where money moves, so it is proven, not assumed.
      const deltaMinor = fromDbMinor(row.amountMinor);
      const capturedMinor = await capturedCommissionMinor(
        tx,
        hold.walletId,
        input.awardId,
        hold.currency,
      );
      if (capturedMinor + deltaMinor !== input.newTotalMinor) {
        throw staleTerms(
          hold,
          input.awardId,
          capturedMinor,
          input.newTotalMinor - deltaMinor,
        );
      }

      assertTransition(HOLD_MACHINE, row.state, "capture_pending");
      await tx.mpCommissionHold.update({
        where: { id: row.id },
        data: { state: "capture_pending" },
      });

      const entry = await postEntry(tx, {
        kind: "mp_commission_delta_capture",
        reference: `mp_award:${input.awardId}:amendment:${amendmentId}`,
        occurredAt: now,
        idempotencyKey: journalKey,
        description:
          `marketplace commission increment for amendment ${amendmentId}` +
          ` (linked to capture receipt ${hold.receiptId ?? "unknown"})`,
        lines: movement(
          {
            account: "wallet",
            walletId: hold.walletId,
            counterpartRef: deltaCaptureCounterpartRef(
              input.awardId,
              amendmentId,
            ),
          },
          {
            account: "ubi_commission",
            counterpartRef: deltaCaptureCounterpartRef(
              input.awardId,
              amendmentId,
            ),
          },
          deltaMinor,
          hold.currency,
        ),
      });

      assertTransition(HOLD_MACHINE, "capture_pending", "captured");
      const receiptId = generateId("mcr");
      const updated = await tx.mpCommissionHold.update({
        where: { id: row.id },
        data: {
          state: "captured",
          receiptId,
          journalEntryId: entry.id,
          capturedAt: now,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.delta_captured",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { state: row.state, capturedTotalMinor: capturedMinor },
        after: {
          state: "captured",
          deltaReservationId: row.id,
          amendmentId,
          awardId: input.awardId,
          receiptId,
          journalEntryId: entry.id,
          deltaMinor,
          capturedTotalMinor: input.newTotalMinor,
          originalReceiptId: hold.receiptId,
        },
      });
      await publishEvent(tx, {
        name: "mp.commission.captured",
        aggregateType: "mp_hold",
        aggregateId: row.id,
        fromVersion: 1,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${journalKey}:captured`,
        occurredAt: now,
        payload: {
          reservationId: row.id,
          kind: "amendment_delta",
          originalReservationId: hold.id,
          originalReceiptId: hold.receiptId,
          originalJournalEntryId: hold.journalEntryId,
          amendmentId,
          awardId: input.awardId,
          walletId: hold.walletId,
          receiptId,
          journalEntryId: entry.id,
          amountMinor: deltaMinor,
          newTotalMinor: input.newTotalMinor,
          currency: hold.currency,
        },
      });

      return {
        delta: deltaRowView(updated, hold, amendmentId),
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the amendment-scoped journal/outbox race: the winner captured.
    if (isIdempotencyRace(error)) {
      const answer = settledAnswer(
        requireDelta(
          await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
        ),
      );
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}

// ── Release (amendment rejected / expired) ─────────────────────────────────

/**
 * `active → released` for a reserved increment, exactly once; a repeat
 * replays. A release that arrives before any reserve (the reserve failed, or
 * is still in flight) CLOSES the amendment with a zero-amount released row,
 * so a late reserve is refused instead of encumbering a rejected amendment.
 * A captured increment is never released — only a decreasing amendment or
 * the award's full reversal hands it back.
 */
export async function releaseCommissionDelta(
  deps: WalletDeps,
  reservationId: string,
  amendmentId: string,
  input: ReleaseCommissionDeltaInput,
  clientKey: string,
): Promise<MpCommissionDeltaResult> {
  const now = deps.now();
  void clientKey;
  assertLinkId("amendmentId", amendmentId);
  assertLinkId("awardId", input.awardId);

  const bidRef = commissionDeltaBidRef(reservationId, amendmentId);
  const releaseKey = deltaKey("delta_release", reservationId, amendmentId);
  const original = await requireOriginal(deps.db, reservationId);

  const settledAnswer = (
    row: HoldRow | null,
  ): MpCommissionDeltaResult | null => {
    if (row === null) {
      return null;
    }
    if (row.awardRef !== input.awardId) {
      throw new ContractError(
        "conflict",
        "this amendment's delta belongs to a different award",
        { reservationId, amendmentId, awardRef: row.awardRef },
      );
    }
    if (row.state === "released") {
      return {
        delta: deltaRowView(row, original, amendmentId),
        replayed: true,
      };
    }
    if (row.state === "captured" || row.state === "reversed") {
      throw new ContractError(
        "conflict",
        "this amendment's increment was captured; it is undone only by a decreasing amendment or the award's reversal",
        { reservationId, amendmentId, deltaReservationId: row.id },
      );
    }
    if (row.state === "capture_pending") {
      throw new ContractError(
        "award_unresolved",
        "this amendment's increment capture has not resolved",
        { reservationId, amendmentId, deltaReservationId: row.id },
      );
    }
    return null;
  };

  const pre = settledAnswer(
    await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
  );
  if (pre !== null) {
    return pre;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, original.walletId);
      const hold = await requireOriginal(tx, reservationId);
      const row = await tx.mpCommissionHold.findUnique({ where: { bidRef } });
      const replay = settledAnswer(row);
      if (replay !== null) {
        return replay;
      }
      if (hold.awardRef !== input.awardId) {
        throw new ContractError(
          "conflict",
          "this reservation was not captured under that award",
          { reservationId, awardRef: hold.awardRef },
        );
      }

      if (row === null) {
        if ((await refundEntryFor(tx, reservationId, amendmentId)) !== null) {
          throw new ContractError(
            "conflict",
            "this amendment already committed a commission decrease",
            { reservationId, amendmentId },
          );
        }
        // Close the amendment: a zero-amount row, born and released in one
        // transaction, holding the amendment's unique keys.
        assertTransition(HOLD_MACHINE, "active", "released");
        const closed = await tx.mpCommissionHold.create({
          data: {
            id: generateId("mph"),
            walletId: hold.walletId,
            driverId: hold.driverId,
            bidRef,
            requestRef: hold.requestRef,
            awardRef: input.awardId,
            amountMinor: 0n,
            baseMinor: 0n,
            currency: hold.currency,
            commissionBps: hold.commissionBps,
            roundingRule: hold.roundingRule,
            policyVersion: hold.policyVersion,
            state: "released",
            idempotencyKey: deltaKey("delta", reservationId, amendmentId),
            payloadHash: TOMBSTONE_HASH,
            releasedAt: now,
          },
        });
        await writeAudit(tx, {
          actor: MP_SERVICE_ACTOR,
          action: "wallet.mp_hold.delta_released",
          subjectType: "mp_hold",
          subjectId: hold.id,
          after: {
            state: "released",
            deltaReservationId: closed.id,
            amendmentId,
            awardId: input.awardId,
            amountMinor: 0,
            closedWithoutReservation: true,
          },
          reason: input.reason,
        });
        await publishEvent(tx, {
          name: "mp.commission.released",
          aggregateType: "mp_hold",
          aggregateId: closed.id,
          fromVersion: null,
          toVersion: 1,
          actor: MP_SERVICE_ACTOR,
          actorType: "service",
          cityId: null,
          idempotencyKey: `${releaseKey}:released`,
          occurredAt: now,
          payload: {
            reservationId: closed.id,
            kind: "amendment_delta",
            originalReservationId: hold.id,
            amendmentId,
            awardId: input.awardId,
            walletId: hold.walletId,
            amountMinor: 0,
            currency: hold.currency,
            closedWithoutReservation: true,
            reason: input.reason,
          },
        });
        return {
          delta: deltaRowView(closed, hold, amendmentId),
          replayed: false,
        };
      }

      assertTransition(HOLD_MACHINE, row.state, "released");
      const updated = await tx.mpCommissionHold.update({
        where: { id: row.id },
        data: { state: "released", releasedAt: now },
      });
      const deltaMinor = fromDbMinor(row.amountMinor);
      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.delta_released",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { state: row.state },
        after: {
          state: "released",
          deltaReservationId: row.id,
          amendmentId,
          awardId: input.awardId,
          amountMinor: deltaMinor,
        },
        reason: input.reason,
      });
      await publishEvent(tx, {
        name: "mp.commission.released",
        aggregateType: "mp_hold",
        aggregateId: row.id,
        fromVersion: 1,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${releaseKey}:released`,
        occurredAt: now,
        payload: {
          reservationId: row.id,
          kind: "amendment_delta",
          originalReservationId: hold.id,
          amendmentId,
          awardId: input.awardId,
          walletId: hold.walletId,
          amountMinor: deltaMinor,
          currency: hold.currency,
          reason: input.reason,
        },
      });
      return {
        delta: deltaRowView(updated, hold, amendmentId),
        replayed: false,
      };
    });
  } catch (error) {
    if (isIdempotencyRace(error) || isBidRefRace(error)) {
      const answer = settledAnswer(
        await deps.db.mpCommissionHold.findUnique({ where: { bidRef } }),
      );
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}

// ── Refund (fare decrease, at commit) ──────────────────────────────────────

interface RefundRecord {
  readonly amendmentId?: unknown;
  readonly awardId?: unknown;
  readonly amountMinor?: unknown;
  readonly priorTotalMinor?: unknown;
  readonly newTotalMinor?: unknown;
  readonly newBaseMinor?: unknown;
  readonly currency?: unknown;
  readonly receiptId?: unknown;
  readonly reversalEntryId?: unknown;
  readonly originalReceiptId?: unknown;
  readonly payloadHash?: unknown;
}

function numberField(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ContractError(
      "internal_error",
      "a recorded commission refund is missing an amount",
    );
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The durable record of a committed decrease is its outbox event (unique on
 * the amendment-scoped key, never pruned) next to the linked journal entry;
 * a replay re-reads it.
 */
function refundViewOf(
  event: { payload: unknown; occurredAt: Date },
  reservationId: string,
  amendmentId: string,
): { view: MpCommissionDeltaView; payloadHash: string | null } {
  const record = event.payload as RefundRecord;
  const currency = typeof record.currency === "string" ? record.currency : "";
  const at = event.occurredAt.toISOString();
  return {
    view: {
      reservationId,
      amendmentId,
      awardId: stringOrNull(record.awardId) ?? "",
      direction: "decrease",
      state: "refunded",
      deltaReservationId: null,
      deltaMinor: money(numberField(record.amountMinor), currency),
      priorTotalMinor: money(numberField(record.priorTotalMinor), currency),
      newTotalMinor: money(numberField(record.newTotalMinor), currency),
      newBaseMinor: money(numberField(record.newBaseMinor), currency),
      receiptId: stringOrNull(record.receiptId),
      journalEntryId: stringOrNull(record.reversalEntryId),
      originalReceiptId: stringOrNull(record.originalReceiptId),
      createdAt: at,
      resolvedAt: at,
    },
    payloadHash: stringOrNull(record.payloadHash),
  };
}

/**
 * A fare-lowering amendment's commission difference, handed back to the
 * driver at commit as a LINKED PARTIAL reversal (`ubi_commission` → driver
 * wallet). The prior total must be the award's captured total, and the
 * refund is prior − new — so it can never exceed what was captured, and the
 * award's commission lands exactly on commission(new fare). The original
 * capture entry is untouched.
 */
export async function refundCommissionDelta(
  deps: WalletDeps,
  reservationId: string,
  amendmentId: string,
  input: CommissionDeltaTermsInput,
  clientKey: string,
): Promise<MpCommissionDeltaResult> {
  const now = deps.now();
  void clientKey;
  assertLinkId("amendmentId", amendmentId);
  assertDeltaTerms(input);
  if (input.newTotalMinor >= input.priorTotalMinor) {
    throw new ContractError(
      "validation_failed",
      "a commission refund is only for a decrease; an increase is reserved and captured",
      {
        priorTotalMinor: input.priorTotalMinor,
        newTotalMinor: input.newTotalMinor,
      },
    );
  }

  const refundKey = deltaKey("delta_refund", reservationId, amendmentId);
  const eventKey = `${refundKey}:reversed`;
  const hash = payloadHashOf({
    op: "refund",
    awardId: input.awardId,
    priorTotalMinor: input.priorTotalMinor,
    newTotalMinor: input.newTotalMinor,
    newBaseMinor: input.newBaseMinor,
    currency: input.currency,
  });

  const original = await requireOriginal(deps.db, reservationId);

  const replayOf = async (
    client: LedgerTx,
  ): Promise<MpCommissionDeltaResult | null> => {
    const event = await client.outboxEvent.findUnique({
      where: { idempotencyKey: eventKey },
    });
    if (event === null) {
      return null;
    }
    const { view, payloadHash } = refundViewOf(
      event,
      reservationId,
      amendmentId,
    );
    if (payloadHash !== hash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this amendment already refunded commission with different terms",
        { reservationId, amendmentId },
      );
    }
    return { delta: view, replayed: true };
  };

  const pre = await replayOf(deps.db);
  if (pre !== null) {
    return pre;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, original.walletId);
      const hold = await requireOriginal(tx, reservationId);
      const raced = await replayOf(tx);
      if (raced !== null) {
        return raced;
      }
      assertAmendable(hold, input.awardId, input.currency);

      const deltaRow = await tx.mpCommissionHold.findUnique({
        where: { bidRef: commissionDeltaBidRef(reservationId, amendmentId) },
      });
      if (deltaRow !== null) {
        throw new ContractError(
          "conflict",
          "this amendment already reserved (or closed) an increase; it cannot also refund",
          { reservationId, amendmentId, deltaReservationId: deltaRow.id },
        );
      }
      const capturedMinor = await capturedCommissionMinor(
        tx,
        hold.walletId,
        input.awardId,
        hold.currency,
      );
      await refuseOpenDelta(tx, hold, capturedMinor);
      if (capturedMinor !== input.priorTotalMinor) {
        throw staleTerms(
          hold,
          input.awardId,
          capturedMinor,
          input.priorTotalMinor,
        );
      }
      const refundMinor = capturedMinor - input.newTotalMinor;
      if (refundMinor <= 0 || refundMinor > capturedMinor) {
        throw new ContractError(
          "internal_error",
          "a commission refund must be positive and within the captured total",
          { refundMinor, capturedMinor },
        );
      }

      const refundRef = deltaRefundCounterpartRef(input.awardId, amendmentId);
      const entry = await postEntry(tx, {
        kind: "mp_commission_delta_refund",
        reference: `mp_award:${input.awardId}:amendment:${amendmentId}:refund`,
        occurredAt: now,
        idempotencyKey: refundKey,
        description:
          `marketplace commission partial reversal for amendment ${amendmentId}` +
          ` (linked to capture receipt ${hold.receiptId ?? "unknown"})`,
        lines: movement(
          { account: "ubi_commission", counterpartRef: refundRef },
          {
            account: "wallet",
            walletId: hold.walletId,
            counterpartRef: refundRef,
          },
          refundMinor,
          hold.currency,
        ),
      });
      const receiptId = generateId("mcr");

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.delta_refunded",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { capturedTotalMinor: capturedMinor },
        after: {
          amendmentId,
          awardId: input.awardId,
          receiptId,
          reversalEntryId: entry.id,
          refundMinor,
          capturedTotalMinor: input.newTotalMinor,
          newBaseMinor: input.newBaseMinor,
          originalReceiptId: hold.receiptId,
        },
      });
      await publishEvent(tx, {
        name: "mp.commission.reversed",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: 2,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: eventKey,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          kind: "amendment_delta_refund",
          partial: true,
          amendmentId,
          awardId: input.awardId,
          walletId: hold.walletId,
          receiptId,
          reversalEntryId: entry.id,
          originalReceiptId: hold.receiptId,
          originalJournalEntryId: hold.journalEntryId,
          amountMinor: refundMinor,
          priorTotalMinor: capturedMinor,
          newTotalMinor: input.newTotalMinor,
          newBaseMinor: input.newBaseMinor,
          currency: hold.currency,
          payloadHash: hash,
        },
      });

      const at = now.toISOString();
      return {
        delta: {
          reservationId: hold.id,
          amendmentId,
          awardId: input.awardId,
          direction: "decrease" as const,
          state: "refunded" as const,
          deltaReservationId: null,
          deltaMinor: money(refundMinor, hold.currency),
          priorTotalMinor: money(capturedMinor, hold.currency),
          newTotalMinor: money(input.newTotalMinor, hold.currency),
          newBaseMinor: money(input.newBaseMinor, hold.currency),
          receiptId,
          journalEntryId: entry.id,
          originalReceiptId: hold.receiptId,
          createdAt: at,
          resolvedAt: at,
        },
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the amendment-scoped journal/outbox race: the winner refunded.
    if (isIdempotencyRace(error)) {
      const answer = await replayOf(deps.db);
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}
