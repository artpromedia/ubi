/**
 * Rider funding amendments (A02 item 5) — how a post-award fare change moves
 * the rider's funding reservation without editing it.
 *
 * The award's original reservation (mp-funding.ts) is immutable: its amount
 * stays the SELECTED fare, so the authorize replay guard still accepts the
 * original terms and still refuses changed ones. Each amendment instead adds
 * ONE linked adjustment row, keyed `amendment:<awardId>:<amendmentId>`
 * (unique — an amendment adjusts an award's funding at most once, ever):
 *
 *  - `topUpFunding` (fare increase, before commit): reserves the additional
 *    amount under the same wallet rules as the original authorization (row
 *    lock, frozen/safe-mode guards, spendable check) as a `reserved` row;
 *  - `commitFundingTopUp` (amendment committed): `reserved → committed`;
 *  - `releaseFundingTopUp` (amendment rejected/expired): `reserved →
 *    released`. A release that arrives before any top-up closes the
 *    amendment, so a late top-up cannot encumber a rejected amendment;
 *  - `partialReleaseFunding` (fare decrease, at commit): a `committed` row of
 *    NEGATIVE amount — a linked credit against the award's encumbrance.
 *
 * The award's encumbrance is the signed sum of its encumbering rows, so the
 * one spendable figure (balances.ts) needs no special case. At completion the
 * settlement consumes the original plus every committed adjustment exactly
 * once, and releases any top-up whose amendment never committed.
 *
 * The caller states the award's prior funded amount and the new fare; this
 * module verifies the prior against original + committed adjustments (a
 * stale prior is a `version_conflict` carrying the refreshed amount) and
 * derives the delta itself. One amendment top-up may be open per award.
 *
 * CASH stays unsecured exactly as authorization treats it (an explicit
 * `secured: false` audit, no row) and every other method fails CLOSED.
 */
import {
  type CityConfig,
  ContractError,
  paymentMethodAvailable,
} from "@ubi/contracts";

import { writeAudit } from "./audit";
import { spendableOf } from "./balances";
import { lockWallet, type WalletDeps } from "./context";
import { fromDbMinor, fromNullableDbMinor, toDbMinor } from "./minor-units";
import {
  assertLinkId,
  FUNDING_ADJUSTMENT_COMMITTED,
  FUNDING_ADJUSTMENT_OPEN,
  fundingAdjustmentKey,
  fundingAdjustmentPrefix,
} from "./mp-amendment-refs";
import { isAwardIdRace, type ReservationRow } from "./mp-funding";
import { payloadHashOf } from "./mp-holds";
import { assertNotLocked, assertNotSafeMode, requireWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "./types";

const MP_SERVICE_ACTOR: Actor = { id: "marketplace-engine", role: "service" };

const ACTION_TOPPED_UP = "wallet.mp_funding.topped_up";
const ACTION_PARTIALLY_RELEASED = "wallet.mp_funding.partially_released";
const ACTION_CLOSED = "wallet.mp_funding.top_up_closed";
const CREATION_ACTIONS = [
  ACTION_TOPPED_UP,
  ACTION_PARTIALLY_RELEASED,
  ACTION_CLOSED,
];

// ── Wire shapes ────────────────────────────────────────────────────────────

/** A top-up (increase) or a partial release (decrease) of one award's funding. */
export interface FundingAmendmentInput {
  readonly requesterId: string;
  readonly awardId: string;
  readonly amendmentId: string;
  readonly paymentMethodId: string;
  /** The award's funded amount as the caller last knew it. */
  readonly priorAmountMinor: number;
  /** The amended fare the award must be funded to. */
  readonly newAmountMinor: number;
  readonly currency: string;
  readonly cityId: string;
}

export interface FundingTopUpCommitInput {
  readonly awardId: string;
  readonly amendmentId: string;
  /** The committed fare; must be the amount the top-up reserved for. */
  readonly newAmountMinor: number;
}

export interface FundingTopUpReleaseInput {
  readonly awardId: string;
  readonly amendmentId: string;
  readonly reason: string;
}

/** `none`: the amendment was closed (released) before any top-up landed. */
export type FundingAdjustmentKind = "top_up" | "partial_release" | "none";

/**
 * `unsecured`: a cash award — nothing to encumber. `missing`: the award has
 * no funding reservation at all, so there is nothing to commit or release.
 */
export type FundingAdjustmentStatus =
  | "reserved"
  | "committed"
  | "consumed"
  | "released"
  | "unsecured"
  | "missing";

export interface FundingAdjustmentResult {
  readonly awardId: string;
  readonly amendmentId: string;
  readonly kind: FundingAdjustmentKind;
  /** True when a durable row backs the adjustment; false for cash. */
  readonly secured: boolean;
  readonly status: FundingAdjustmentStatus;
  /** The adjustment's own row; null for cash and when nothing exists. */
  readonly adjustmentId: string | null;
  /** The award's original funding reservation it is linked to. */
  readonly reservationId: string | null;
  /** The magnitude the adjustment moves: |new − prior|. */
  readonly deltaMinor: number;
  readonly priorAmountMinor: number | null;
  readonly newAmountMinor: number | null;
  readonly currency: string | null;
  readonly replayed: boolean;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function assertPositiveMinor(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ContractError(
      "validation_failed",
      `${field} must be a positive integer in minor units`,
      { field, value },
    );
  }
}

interface AdjustmentTerms {
  readonly priorAmountMinor: number | null;
  readonly newAmountMinor: number | null;
  readonly payloadHash: string | null;
}

/**
 * The terms an adjustment was created with live on its creation audit row
 * (append-only, on the award's own audit trail): the amendment's prior and
 * new amounts and the hash a replay must match.
 */
async function termsOf(
  client: LedgerTx,
  awardId: string,
  amendmentId: string,
): Promise<AdjustmentTerms> {
  const rows = await client.auditLog.findMany({
    where: {
      subjectType: "mp_award",
      subjectId: awardId,
      action: { in: CREATION_ACTIONS },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const row of rows) {
    const after = (row.after ?? null) as Record<string, unknown> | null;
    if (after !== null && after.amendmentId === amendmentId) {
      return {
        priorAmountMinor:
          typeof after.priorAmountMinor === "number"
            ? after.priorAmountMinor
            : null,
        newAmountMinor:
          typeof after.newAmountMinor === "number"
            ? after.newAmountMinor
            : null,
        payloadHash:
          typeof after.payloadHash === "string" ? after.payloadHash : null,
      };
    }
  }
  return { priorAmountMinor: null, newAmountMinor: null, payloadHash: null };
}

function kindOf(row: ReservationRow): FundingAdjustmentKind {
  const amount = fromDbMinor(row.amountMinor);
  if (amount === 0) {
    return "none";
  }
  return amount > 0 ? "top_up" : "partial_release";
}

function viewOf(
  row: ReservationRow,
  original: ReservationRow | null,
  awardId: string,
  amendmentId: string,
  terms: AdjustmentTerms,
  replayed: boolean,
): FundingAdjustmentResult {
  return {
    awardId,
    amendmentId,
    kind: kindOf(row),
    secured: true,
    status: row.status as FundingAdjustmentStatus,
    adjustmentId: row.id,
    reservationId: original?.id ?? null,
    deltaMinor: Math.abs(fromDbMinor(row.amountMinor)),
    priorAmountMinor: terms.priorAmountMinor,
    newAmountMinor: terms.newAmountMinor,
    currency: row.currency,
    replayed,
  };
}

/**
 * Under the award's reservation row lock a conditional transition cannot
 * lose to a rival; if it moved nothing, the row is already settled.
 */
function settledOrUnreachable(
  answer: FundingAdjustmentResult | null,
): FundingAdjustmentResult {
  if (answer === null) {
    throw new ContractError(
      "internal_error",
      "a funding adjustment did not transition under its row lock",
    );
  }
  return answer;
}

function nothingToAdjust(
  awardId: string,
  amendmentId: string,
  status: "unsecured" | "missing",
): FundingAdjustmentResult {
  return {
    awardId,
    amendmentId,
    kind: "none",
    secured: false,
    status,
    adjustmentId: null,
    reservationId: null,
    deltaMinor: 0,
    priorAmountMinor: null,
    newAmountMinor: null,
    currency: null,
    replayed: false,
  };
}

/**
 * Takes the award's ORIGINAL reservation row lock. Every adjustment takes it
 * first — before the rider wallet lock — which is the order the settlement
 * transaction takes them in (consume, then post), so an adjustment racing
 * completion or the award's reversal queues behind it and then sees the
 * resolved award, never deadlocks and never lands after it.
 */
async function lockReservation(
  tx: LedgerTx,
  reservationId: string,
): Promise<ReservationRow> {
  await tx.$queryRaw`
    SELECT id FROM mp_rider_reservations WHERE id = ${reservationId} FOR UPDATE
  `;
  return tx.mpRiderReservation.findUniqueOrThrow({
    where: { id: reservationId },
  });
}

/** Original + every committed adjustment: what the award is funded to now. */
async function fundedAmountMinor(
  tx: LedgerTx,
  original: ReservationRow,
): Promise<number> {
  const committed = await tx.mpRiderReservation.aggregate({
    _sum: { amountMinor: true },
    where: {
      awardId: { startsWith: fundingAdjustmentPrefix(original.awardId) },
      status: FUNDING_ADJUSTMENT_COMMITTED,
    },
  });
  return (
    fromDbMinor(original.amountMinor) +
    fromNullableDbMinor(committed._sum.amountMinor)
  );
}

function staleFunding(
  original: ReservationRow,
  fundedMinor: number,
  priorAmountMinor: number,
): ContractError {
  return new ContractError(
    "version_conflict",
    "the prior amount is not what the award is funded to; refresh and retry",
    {
      awardId: original.awardId,
      reservationId: original.id,
      priorAmountMinor,
      refreshedTerms: {
        fundedAmountMinor: fundedMinor,
        currency: original.currency,
      },
    },
  );
}

/** One open top-up per award: a prior amount must mean one thing. */
async function refuseOpenTopUp(
  tx: LedgerTx,
  original: ReservationRow,
  fundedMinor: number,
): Promise<void> {
  const open = await tx.mpRiderReservation.findFirst({
    where: {
      awardId: { startsWith: fundingAdjustmentPrefix(original.awardId) },
      status: FUNDING_ADJUSTMENT_OPEN,
    },
  });
  if (open !== null) {
    throw new ContractError(
      "conflict",
      "another amendment's top-up is still open on this award",
      {
        awardId: original.awardId,
        openAdjustmentId: open.id,
        refreshedTerms: {
          fundedAmountMinor: fundedMinor,
          currency: original.currency,
        },
      },
    );
  }
}

/**
 * The award's wallet reservation the adjustment attaches to. A wallet
 * adjustment for an award that has none — or whose reservation belongs to a
 * different requester or method — is a caller bug, refused.
 */
async function requireWalletOriginal(
  client: LedgerTx,
  input: FundingAmendmentInput,
): Promise<ReservationRow> {
  const original = await client.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  if (original === null) {
    throw new ContractError(
      "conflict",
      "this award has no wallet funding reservation to amend",
      { awardId: input.awardId },
    );
  }
  if (
    original.requesterId !== input.requesterId ||
    original.paymentMethodId !== input.paymentMethodId ||
    original.currency !== input.currency
  ) {
    throw new ContractError(
      "conflict",
      "this award's funding reservation has different terms",
      {
        awardId: input.awardId,
        reservationId: original.id,
        reservedPaymentMethodId: original.paymentMethodId,
        reservedCurrency: original.currency,
      },
    );
  }
  return original;
}

function assertAmendmentInput(input: FundingAmendmentInput): void {
  assertLinkId("awardId", input.awardId);
  assertLinkId("amendmentId", input.amendmentId);
  assertPositiveMinor("priorAmountMinor", input.priorAmountMinor);
  assertPositiveMinor("newAmountMinor", input.newAmountMinor);
}

/**
 * Same gate as authorization: the city's currency and method availability,
 * then wallet → secured, cash → explicitly unsecured, anything else → fail
 * closed (config availability is not provider authorization).
 */
async function methodPath(
  deps: WalletDeps,
  input: FundingAmendmentInput,
): Promise<{ path: "wallet" | "cash"; city: CityConfig }> {
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
  if (input.paymentMethodId === "wallet" || input.paymentMethodId === "cash") {
    return { path: input.paymentMethodId, city };
  }
  throw new ContractError(
    "payment_method_unavailable",
    "provider authorization is not yet supported for marketplace funding; " +
      "config availability is not provider authorization",
    { paymentMethodId: input.paymentMethodId },
  );
}

/**
 * Cash: no custody, no row — an explicit `secured: false` audit, exactly as
 * a cash authorization. A cash adjustment on an award that carries a wallet
 * reservation is a method switch mid-award, refused.
 */
async function unsecuredCashAdjustment(
  deps: WalletDeps,
  input: FundingAmendmentInput,
  kind: "top_up" | "partial_release",
): Promise<FundingAdjustmentResult> {
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
  const deltaMinor = Math.abs(input.newAmountMinor - input.priorAmountMinor);
  await deps.db.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: MP_SERVICE_ACTOR,
      action: kind === "top_up" ? ACTION_TOPPED_UP : ACTION_PARTIALLY_RELEASED,
      subjectType: "mp_award",
      subjectId: input.awardId,
      after: {
        amendmentId: input.amendmentId,
        requesterId: input.requesterId,
        paymentMethodId: input.paymentMethodId,
        priorAmountMinor: input.priorAmountMinor,
        newAmountMinor: input.newAmountMinor,
        deltaMinor,
        currency: input.currency,
        secured: false,
        adjustmentId: null,
        note: "unsecured cash collection — no wallet custody to encumber",
      },
    });
  });
  return {
    awardId: input.awardId,
    amendmentId: input.amendmentId,
    kind,
    secured: false,
    status: "unsecured",
    adjustmentId: null,
    reservationId: null,
    deltaMinor,
    priorAmountMinor: input.priorAmountMinor,
    newAmountMinor: input.newAmountMinor,
    currency: input.currency,
    replayed: false,
  };
}

/**
 * The shared replay answer for top-up and partial release: the amendment's
 * row, with the same terms, answers as a replay; a closed amendment or
 * different terms conflict.
 */
async function adjustmentReplay(
  client: LedgerTx,
  input: FundingAmendmentInput,
  hash: string,
): Promise<FundingAdjustmentResult | null> {
  const row = await client.mpRiderReservation.findUnique({
    where: {
      awardId: fundingAdjustmentKey(input.awardId, input.amendmentId),
    },
  });
  if (row === null) {
    return null;
  }
  if (kindOf(row) === "none") {
    throw new ContractError(
      "conflict",
      "this amendment was already released; it cannot adjust the award's funding",
      { awardId: input.awardId, amendmentId: input.amendmentId },
    );
  }
  const terms = await termsOf(client, input.awardId, input.amendmentId);
  if (terms.payloadHash !== hash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this amendment already adjusted the award's funding with different terms",
      {
        awardId: input.awardId,
        amendmentId: input.amendmentId,
        adjustmentId: row.id,
      },
    );
  }
  const original = await client.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  return viewOf(row, original, input.awardId, input.amendmentId, terms, true);
}

function hashOf(
  op: "top_up" | "partial_release",
  input: FundingAmendmentInput,
): string {
  return payloadHashOf({
    op,
    requesterId: input.requesterId,
    awardId: input.awardId,
    amendmentId: input.amendmentId,
    paymentMethodId: input.paymentMethodId,
    priorAmountMinor: input.priorAmountMinor,
    newAmountMinor: input.newAmountMinor,
    currency: input.currency,
    cityId: input.cityId,
  });
}

// ── Top-up (fare increase, before commit) ──────────────────────────────────

export async function topUpFunding(
  deps: WalletDeps,
  input: FundingAmendmentInput,
): Promise<FundingAdjustmentResult> {
  assertAmendmentInput(input);
  if (input.newAmountMinor <= input.priorAmountMinor) {
    throw new ContractError(
      "validation_failed",
      "a top-up is only for an increase; a decrease is a partial release at commit",
      {
        priorAmountMinor: input.priorAmountMinor,
        newAmountMinor: input.newAmountMinor,
      },
    );
  }
  const { path } = await methodPath(deps, input);
  if (path === "cash") {
    return unsecuredCashAdjustment(deps, input, "top_up");
  }

  const now = deps.now();
  const hash = hashOf("top_up", input);
  const pre = await adjustmentReplay(deps.db, input, hash);
  if (pre !== null) {
    return pre;
  }
  const original = await requireWalletOriginal(deps.db, input);

  try {
    return await deps.db.$transaction(async (tx) => {
      const current = await lockReservation(tx, original.id);
      const wallet = await requireWallet(tx, current.walletId);
      assertNotLocked(wallet);
      assertNotSafeMode(wallet, now);
      await lockWallet(tx, wallet.id);

      const raced = await adjustmentReplay(tx, input, hash);
      if (raced !== null) {
        return raced;
      }
      if (current.status !== "active") {
        throw new ContractError(
          "conflict",
          "this award's funding reservation is no longer active",
          {
            awardId: input.awardId,
            reservationId: current.id,
            status: current.status,
          },
        );
      }
      const fundedMinor = await fundedAmountMinor(tx, current);
      await refuseOpenTopUp(tx, current, fundedMinor);
      if (fundedMinor !== input.priorAmountMinor) {
        throw staleFunding(current, fundedMinor, input.priorAmountMinor);
      }
      const deltaMinor = input.newAmountMinor - fundedMinor;

      const spendable = await spendableOf(tx, wallet.id, wallet.currency);
      if (spendable.amountMinor < deltaMinor) {
        throw new ContractError(
          "insufficient_funds",
          "the wallet cannot cover the amended fare",
          {
            requiredMinor: deltaMinor,
            spendableMinor: spendable.amountMinor,
            shortfallMinor: deltaMinor - spendable.amountMinor,
          },
        );
      }

      const row = await tx.mpRiderReservation.create({
        data: {
          id: generateId("mra"),
          awardId: fundingAdjustmentKey(input.awardId, input.amendmentId),
          requestId: current.requestId,
          requesterId: current.requesterId,
          walletId: current.walletId,
          amountMinor: toDbMinor(deltaMinor),
          currency: current.currency,
          cityId: current.cityId,
          paymentMethodId: current.paymentMethodId,
          status: FUNDING_ADJUSTMENT_OPEN,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: ACTION_TOPPED_UP,
        subjectType: "mp_award",
        subjectId: input.awardId,
        after: {
          amendmentId: input.amendmentId,
          adjustmentId: row.id,
          reservationId: current.id,
          status: FUNDING_ADJUSTMENT_OPEN,
          priorAmountMinor: fundedMinor,
          newAmountMinor: input.newAmountMinor,
          deltaMinor,
          currency: current.currency,
          walletId: current.walletId,
          secured: true,
          payloadHash: hash,
        },
      });

      return viewOf(
        row,
        current,
        input.awardId,
        input.amendmentId,
        {
          priorAmountMinor: fundedMinor,
          newAmountMinor: input.newAmountMinor,
          payloadHash: hash,
        },
        false,
      );
    });
  } catch (error) {
    // Lost the per-amendment insert race: the winner's row is the answer.
    if (isAwardIdRace(error)) {
      const answer = await adjustmentReplay(deps.db, input, hash);
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}

// ── Commit (amendment committed) ───────────────────────────────────────────

export async function commitFundingTopUp(
  deps: WalletDeps,
  input: FundingTopUpCommitInput,
): Promise<FundingAdjustmentResult> {
  assertLinkId("awardId", input.awardId);
  assertLinkId("amendmentId", input.amendmentId);
  assertPositiveMinor("newAmountMinor", input.newAmountMinor);
  const now = deps.now();
  const key = fundingAdjustmentKey(input.awardId, input.amendmentId);

  // Answers a replay, refuses what can never commit, or returns null for a
  // reserved top-up this call should commit.
  const settledAnswer = async (
    client: LedgerTx,
    row: ReservationRow,
    original: ReservationRow,
  ): Promise<FundingAdjustmentResult | null> => {
    if (kindOf(row) !== "top_up") {
      throw new ContractError(
        "conflict",
        "this amendment's adjustment is not a top-up; there is nothing to commit",
        {
          awardId: input.awardId,
          amendmentId: input.amendmentId,
          kind: kindOf(row),
        },
      );
    }
    const terms = await termsOf(client, input.awardId, input.amendmentId);
    if (terms.newAmountMinor !== input.newAmountMinor) {
      throw new ContractError(
        "conflict",
        "the committed amount is not the amount this top-up reserved for",
        {
          awardId: input.awardId,
          amendmentId: input.amendmentId,
          reservedNewAmountMinor: terms.newAmountMinor,
        },
      );
    }
    if (row.status === "committed" || row.status === "consumed") {
      return viewOf(
        row,
        original,
        input.awardId,
        input.amendmentId,
        terms,
        true,
      );
    }
    if (row.status === "released") {
      throw new ContractError(
        "conflict",
        "this amendment's top-up was released; it can no longer commit",
        { awardId: input.awardId, amendmentId: input.amendmentId },
      );
    }
    return null;
  };

  const original = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  const pre = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: key },
  });
  if (pre === null || original === null) {
    if (original === null) {
      // A cash (or legacy) award has no custody, so nothing to commit.
      return nothingToAdjust(input.awardId, input.amendmentId, "unsecured");
    }
    throw new ContractError(
      "not_found",
      "no top-up is reserved for this amendment",
      { awardId: input.awardId, amendmentId: input.amendmentId },
    );
  }
  const preAnswer = await settledAnswer(deps.db, pre, original);
  if (preAnswer !== null) {
    return preAnswer;
  }

  return deps.db.$transaction(async (tx) => {
    const current = await lockReservation(tx, original.id);
    const row = await tx.mpRiderReservation.findUniqueOrThrow({
      where: { awardId: key },
    });
    const replay = await settledAnswer(tx, row, current);
    if (replay !== null) {
      return replay;
    }
    // A reserved top-up outlives its award only if something skipped the
    // award's resolution — the award's release or consumption resolves it.
    if (current.status !== "active") {
      throw new ContractError(
        "conflict",
        "this award's funding reservation is no longer active",
        { awardId: input.awardId, status: current.status },
      );
    }
    const fundedMinor = await fundedAmountMinor(tx, current);
    const deltaMinor = fromDbMinor(row.amountMinor);
    if (fundedMinor + deltaMinor !== input.newAmountMinor) {
      throw staleFunding(
        current,
        fundedMinor,
        input.newAmountMinor - deltaMinor,
      );
    }

    // A conditional transition: exactly one caller moves reserved → committed.
    const moved = await tx.mpRiderReservation.updateMany({
      where: { id: row.id, status: FUNDING_ADJUSTMENT_OPEN },
      data: { status: FUNDING_ADJUSTMENT_COMMITTED },
    });
    const updated = await tx.mpRiderReservation.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (moved.count === 0) {
      return settledOrUnreachable(await settledAnswer(tx, updated, current));
    }
    await writeAudit(tx, {
      actor: MP_SERVICE_ACTOR,
      action: "wallet.mp_funding.top_up_committed",
      subjectType: "mp_award",
      subjectId: input.awardId,
      before: {
        status: FUNDING_ADJUSTMENT_OPEN,
        fundedAmountMinor: fundedMinor,
      },
      after: {
        status: FUNDING_ADJUSTMENT_COMMITTED,
        amendmentId: input.amendmentId,
        adjustmentId: row.id,
        reservationId: current.id,
        deltaMinor,
        fundedAmountMinor: input.newAmountMinor,
        committedAt: now.toISOString(),
      },
    });
    return viewOf(
      updated,
      current,
      input.awardId,
      input.amendmentId,
      {
        priorAmountMinor: fundedMinor,
        newAmountMinor: input.newAmountMinor,
        payloadHash: null,
      },
      false,
    );
  });
}

// ── Release (amendment rejected / expired) ─────────────────────────────────

export async function releaseFundingTopUp(
  deps: WalletDeps,
  input: FundingTopUpReleaseInput,
): Promise<FundingAdjustmentResult> {
  assertLinkId("awardId", input.awardId);
  assertLinkId("amendmentId", input.amendmentId);
  const now = deps.now();
  const key = fundingAdjustmentKey(input.awardId, input.amendmentId);

  const settledAnswer = async (
    client: LedgerTx,
    row: ReservationRow,
    original: ReservationRow | null,
  ): Promise<FundingAdjustmentResult | null> => {
    if (kindOf(row) === "partial_release") {
      throw new ContractError(
        "conflict",
        "this amendment committed a partial release; there is no top-up to release",
        { awardId: input.awardId, amendmentId: input.amendmentId },
      );
    }
    if (row.status === "released") {
      const terms = await termsOf(client, input.awardId, input.amendmentId);
      return viewOf(
        row,
        original,
        input.awardId,
        input.amendmentId,
        terms,
        true,
      );
    }
    if (row.status === "committed" || row.status === "consumed") {
      throw new ContractError(
        "conflict",
        "this amendment's top-up was committed; a fare decrease is a partial release",
        {
          awardId: input.awardId,
          amendmentId: input.amendmentId,
          status: row.status,
        },
      );
    }
    return null;
  };

  const original = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: input.awardId },
  });
  if (original === null) {
    // No reservation ever existed (cash or legacy award): nothing to release.
    return nothingToAdjust(input.awardId, input.amendmentId, "missing");
  }
  const pre = await deps.db.mpRiderReservation.findUnique({
    where: { awardId: key },
  });
  if (pre !== null) {
    const answer = await settledAnswer(deps.db, pre, original);
    if (answer !== null) {
      return answer;
    }
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const current = await lockReservation(tx, original.id);
      const row = await tx.mpRiderReservation.findUnique({
        where: { awardId: key },
      });

      if (row === null) {
        // Close the amendment before any top-up landed: a zero-amount row,
        // released at birth, holding the amendment's unique key.
        const closed = await tx.mpRiderReservation.create({
          data: {
            id: generateId("mra"),
            awardId: key,
            requestId: current.requestId,
            requesterId: current.requesterId,
            walletId: current.walletId,
            amountMinor: 0n,
            currency: current.currency,
            cityId: current.cityId,
            paymentMethodId: current.paymentMethodId,
            status: "released",
            reason: input.reason,
            resolvedAt: now,
          },
        });
        await writeAudit(tx, {
          actor: MP_SERVICE_ACTOR,
          action: ACTION_CLOSED,
          subjectType: "mp_award",
          subjectId: input.awardId,
          after: {
            amendmentId: input.amendmentId,
            adjustmentId: closed.id,
            reservationId: current.id,
            status: "released",
            closedWithoutReservation: true,
          },
          reason: input.reason,
        });
        return viewOf(
          closed,
          current,
          input.awardId,
          input.amendmentId,
          { priorAmountMinor: null, newAmountMinor: null, payloadHash: null },
          false,
        );
      }

      const replay = await settledAnswer(tx, row, current);
      if (replay !== null) {
        return replay;
      }
      const moved = await tx.mpRiderReservation.updateMany({
        where: { id: row.id, status: FUNDING_ADJUSTMENT_OPEN },
        data: { status: "released", reason: input.reason, resolvedAt: now },
      });
      const updated = await tx.mpRiderReservation.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (moved.count === 0) {
        return settledOrUnreachable(await settledAnswer(tx, updated, current));
      }
      const terms = await termsOf(tx, input.awardId, input.amendmentId);
      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_funding.top_up_released",
        subjectType: "mp_award",
        subjectId: input.awardId,
        before: { status: FUNDING_ADJUSTMENT_OPEN },
        after: {
          status: "released",
          amendmentId: input.amendmentId,
          adjustmentId: row.id,
          reservationId: current.id,
          deltaMinor: fromDbMinor(row.amountMinor),
        },
        reason: input.reason,
      });
      return viewOf(
        updated,
        current,
        input.awardId,
        input.amendmentId,
        terms,
        false,
      );
    });
  } catch (error) {
    if (isAwardIdRace(error)) {
      const winner = await deps.db.mpRiderReservation.findUnique({
        where: { awardId: key },
      });
      if (winner !== null) {
        const answer = await settledAnswer(deps.db, winner, original);
        if (answer !== null) {
          return answer;
        }
      }
    }
    throw error;
  }
}

// ── Partial release (fare decrease, at commit) ─────────────────────────────

export async function partialReleaseFunding(
  deps: WalletDeps,
  input: FundingAmendmentInput,
): Promise<FundingAdjustmentResult> {
  assertAmendmentInput(input);
  if (input.newAmountMinor >= input.priorAmountMinor) {
    throw new ContractError(
      "validation_failed",
      "a partial release is only for a decrease; an increase is a top-up",
      {
        priorAmountMinor: input.priorAmountMinor,
        newAmountMinor: input.newAmountMinor,
      },
    );
  }
  const { path } = await methodPath(deps, input);
  if (path === "cash") {
    return unsecuredCashAdjustment(deps, input, "partial_release");
  }

  const hash = hashOf("partial_release", input);
  const pre = await adjustmentReplay(deps.db, input, hash);
  if (pre !== null) {
    return pre;
  }
  const original = await requireWalletOriginal(deps.db, input);

  try {
    return await deps.db.$transaction(async (tx) => {
      const current = await lockReservation(tx, original.id);
      await lockWallet(tx, current.walletId);

      const raced = await adjustmentReplay(tx, input, hash);
      if (raced !== null) {
        return raced;
      }
      if (current.status !== "active") {
        throw new ContractError(
          "conflict",
          "this award's funding reservation is no longer active",
          {
            awardId: input.awardId,
            reservationId: current.id,
            status: current.status,
          },
        );
      }
      const fundedMinor = await fundedAmountMinor(tx, current);
      await refuseOpenTopUp(tx, current, fundedMinor);
      if (fundedMinor !== input.priorAmountMinor) {
        throw staleFunding(current, fundedMinor, input.priorAmountMinor);
      }
      // newAmountMinor ≥ 1, so the release is always strictly inside what is
      // funded: the award's encumbrance can shrink, never go negative.
      const deltaMinor = fundedMinor - input.newAmountMinor;

      const row = await tx.mpRiderReservation.create({
        data: {
          id: generateId("mra"),
          awardId: fundingAdjustmentKey(input.awardId, input.amendmentId),
          requestId: current.requestId,
          requesterId: current.requesterId,
          walletId: current.walletId,
          amountMinor: toDbMinor(-deltaMinor),
          currency: current.currency,
          cityId: current.cityId,
          paymentMethodId: current.paymentMethodId,
          status: FUNDING_ADJUSTMENT_COMMITTED,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: ACTION_PARTIALLY_RELEASED,
        subjectType: "mp_award",
        subjectId: input.awardId,
        after: {
          amendmentId: input.amendmentId,
          adjustmentId: row.id,
          reservationId: current.id,
          status: FUNDING_ADJUSTMENT_COMMITTED,
          priorAmountMinor: fundedMinor,
          newAmountMinor: input.newAmountMinor,
          deltaMinor,
          currency: current.currency,
          walletId: current.walletId,
          secured: true,
          payloadHash: hash,
        },
      });

      return viewOf(
        row,
        current,
        input.awardId,
        input.amendmentId,
        {
          priorAmountMinor: fundedMinor,
          newAmountMinor: input.newAmountMinor,
          payloadHash: hash,
        },
        false,
      );
    });
  } catch (error) {
    if (isAwardIdRace(error)) {
      const answer = await adjustmentReplay(deps.db, input, hash);
      if (answer !== null) {
        return answer;
      }
    }
    throw error;
  }
}
