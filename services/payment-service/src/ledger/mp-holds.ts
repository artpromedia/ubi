/**
 * Marketplace commission reservations (M04) — the wallet side of the
 * negotiated-fare marketplace.
 *
 * Rules this module exists to enforce:
 *  - a hold is a table row, never a journal movement: the wallet's cleared
 *    balance stays untouched while a bid is live (₦1,000.00 with a ₦500.00
 *    hold still *totals* ₦1,000.00 — only spendable drops to ₦500.00), and
 *    money moves exactly once, at capture, through `postEntry`;
 *  - every live bid reserves the FULL commission separately — a hold is never
 *    shared or netted across bids;
 *  - the amount is the server's arithmetic: 10% of the bid fare, half-up to
 *    the minor unit (`commissionMinorFor`), snapshotted with the rate and the
 *    rounding rule on the row;
 *  - capture is idempotent on the AWARD id — a replay answers the original
 *    receipt, a different award on the same reservation is a conflict;
 *  - a captured fee is only ever undone by a LINKED compensating entry
 *    (`mp_commission_reversal`); history is never edited;
 *  - every state change goes through `assertTransition("mpHold", …)` and
 *    writes its audit row and outbox event in the same transaction.
 */
import { createHash } from "node:crypto";

import {
  assertTransition,
  commissionMinorFor,
  ContractError,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import {
  activeHoldsMinor,
  activeRiderReservationsMinor,
  activeTravelAuthorizationsMinor,
  balanceOf,
  spendableOf,
} from "./balances";
import { lockWallet, type WalletDeps } from "./context";
import { isIdempotencyRace } from "./idempotency";
import { fromDbMinor, toDbMinor } from "./minor-units";
import { releaseReservationInTx } from "./mp-funding";
import { movement, postEntry } from "./post-entry";
import { assertNotLocked, ensureWallet, findWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, JsonValue, LedgerTx } from "./types";

const HOLD_MACHINE = "mpHold" as const;

/** The commission policy the contract fixes: 10%, half-up (M04). */
export const MP_COMMISSION_BPS = 1_000;
export const MP_ROUNDING_RULE = "half_up";

/**
 * These endpoints are service-to-service (the marketplace award engine calls
 * them with `X-Service-Key`), so the audited actor is the engine itself, and
 * idempotency keys are scoped to it.
 */
const MP_SERVICE_ACTOR: Actor = { id: "marketplace-engine", role: "service" };

/** The row shape Prisma hands back for `mp_commission_holds`. */
interface HoldRow {
  readonly id: string;
  readonly walletId: string;
  readonly driverId: string;
  readonly bidRef: string;
  readonly requestRef: string;
  readonly awardRef: string | null;
  readonly receiptId: string | null;
  readonly journalEntryId: string | null;
  readonly reversalEntryId: string | null;
  readonly amountMinor: bigint;
  readonly baseMinor: bigint;
  readonly currency: string;
  readonly commissionBps: number;
  readonly roundingRule: string;
  readonly policyVersion: number;
  readonly state: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly createdAt: Date;
  readonly capturedAt: Date | null;
  readonly releasedAt: Date | null;
}

/** Wire view of a hold — `MpWalletHoldSchema` in @ubi/contracts. */
export interface MpHoldView {
  readonly reservationId: string;
  readonly bidId: string;
  readonly driverId: string;
  readonly state: string;
  readonly amountMinor: { amountMinor: number; currency: string };
  readonly commissionBps: number;
  readonly baseMinor: { amountMinor: number; currency: string };
  readonly roundingRule: string;
  readonly policyVersion: number;
  readonly createdAt: string;
  readonly releasedAt: string | null;
  readonly capturedAt: string | null;
}

export interface MpHoldResult {
  readonly hold: MpHoldView;
  readonly replayed: boolean;
}

export interface MpCaptureResult extends MpHoldResult {
  readonly receiptId: string;
  readonly journalEntryId: string;
}

export interface MpWalletOverviewResult {
  readonly clearedMinor: { amountMinor: number; currency: string };
  readonly heldMinor: { amountMinor: number; currency: string };
  readonly spendableMinor: { amountMinor: number; currency: string };
  readonly holds: readonly MpHoldView[];
}

export function holdView(row: HoldRow): MpHoldView {
  return {
    reservationId: row.id,
    bidId: row.bidRef,
    driverId: row.driverId,
    state: row.state,
    amountMinor: money(fromDbMinor(row.amountMinor), row.currency),
    commissionBps: row.commissionBps,
    baseMinor: money(fromDbMinor(row.baseMinor), row.currency),
    roundingRule: row.roundingRule,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt.toISOString(),
    releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
    capturedAt: row.capturedAt === null ? null : row.capturedAt.toISOString(),
  };
}

/**
 * The hash that makes key reuse detectable: the same idempotency key must
 * carry the same request body, or the replay is a bug on the caller's side
 * and is refused rather than silently answered with someone else's outcome.
 */
export function payloadHashOf(payload: JsonValue): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item as JsonValue)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(record).sort();
  const body = keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`,
    )
    .join(",");
  return `{${body}}`;
}

function assertSameBody(row: HoldRow, hash: string): void {
  if (row.payloadHash !== hash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this idempotency key was already used with a different request body",
      { reservationId: row.id },
    );
  }
}

function scopedKey(op: string, clientKey: string): string {
  return scopedIdempotencyKey(
    `wallet.mp_hold.${op}`,
    MP_SERVICE_ACTOR.id,
    clientKey,
  );
}

function assertCommissionArithmetic(
  amountMinor: number,
  baseMinor: number,
): void {
  if (
    !Number.isInteger(amountMinor) ||
    !Number.isInteger(baseMinor) ||
    amountMinor <= 0 ||
    baseMinor <= 0
  ) {
    throw new ContractError(
      "validation_failed",
      "hold amounts must be positive integer minor units",
      { amountMinor, baseMinor },
    );
  }
  // Server-authoritative arithmetic: the amount must be the ONE commission
  // function's answer for the base, or the caller computed money client-side.
  const expected = commissionMinorFor(baseMinor);
  if (amountMinor !== expected) {
    throw new ContractError(
      "validation_failed",
      "the hold amount is not 10% of the base, rounded half-up",
      { amountMinor, baseMinor, expectedMinor: expected },
    );
  }
}

function insufficientSpendable(
  requiredMinor: number,
  spendableMinor: number,
  heldMinor: number,
  balanceMinor: number,
): ContractError {
  return new ContractError(
    "insufficient_spendable",
    "spendable funds do not cover this reservation",
    {
      balanceMinor,
      heldMinor,
      spendableMinor,
      requiredMinor,
      shortfallMinor: requiredMinor - spendableMinor,
    },
  );
}

async function requireHold(
  tx: LedgerTx,
  reservationId: string,
): Promise<HoldRow> {
  const row = await tx.mpCommissionHold.findUnique({
    where: { id: reservationId },
  });
  if (row === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId,
    });
  }
  return row;
}

// ── Reserve ────────────────────────────────────────────────────────────────

export interface ReserveHoldInput {
  readonly driverId: string;
  readonly bidRef: string;
  readonly requestRef: string;
  readonly amountMinor: number;
  readonly baseMinor: number;
  /**
   * The currency the caller denominated the Money bodies in. It must match
   * the wallet/city currency — a mismatch is refused, never silently
   * re-denominated 1:1 into the wallet currency.
   */
  readonly currency: string;
  readonly policyVersion: number;
  readonly cityId: string;
}

/**
 * Reserves the FULL commission for one live bid against spendable funds. Each
 * bid holds separately — funds are never shared between two live bids, so the
 * spendable check is for the whole amount every time.
 */
export async function reserveHold(
  deps: WalletDeps,
  input: ReserveHoldInput,
  clientKey: string,
): Promise<MpHoldResult> {
  const now = deps.now();
  const key = scopedKey("reserve", clientKey);
  const hash = payloadHashOf({
    driverId: input.driverId,
    bidRef: input.bidRef,
    requestRef: input.requestRef,
    amountMinor: input.amountMinor,
    baseMinor: input.baseMinor,
    currency: input.currency,
    policyVersion: input.policyVersion,
    cityId: input.cityId,
  });

  const existing = await deps.db.mpCommissionHold.findUnique({
    where: { idempotencyKey: key },
  });
  if (existing !== null) {
    assertSameBody(existing, hash);
    return { hold: holdView(existing), replayed: true };
  }

  assertCommissionArithmetic(input.amountMinor, input.baseMinor);
  if (input.policyVersion < 1 || !Number.isInteger(input.policyVersion)) {
    throw new ContractError("validation_failed", "policyVersion is not valid", {
      policyVersion: input.policyVersion,
    });
  }

  const config = await deps.config.loadForWallet(input.cityId);
  // The caller's denomination must be the city's, like funding authorization
  // already requires: a config-skew between services fails loudly instead of
  // reinterpreting the amount 1:1 into the wallet currency.
  if (config.city.currency !== input.currency) {
    throw new ContractError(
      "validation_failed",
      "the hold currency does not match the city's wallet currency",
      { currency: input.currency, cityCurrency: config.city.currency },
    );
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const wallet = await ensureWallet(
        tx,
        "user",
        input.driverId,
        config.city,
      );
      assertNotLocked(wallet);
      await lockWallet(tx, wallet.id);

      // One hold per bid, ever. A second reserve for the same bid under a
      // different key is a caller bug, not a bigger hold.
      const forBid = await tx.mpCommissionHold.findUnique({
        where: { bidRef: input.bidRef },
      });
      if (forBid !== null) {
        if (forBid.idempotencyKey === key) {
          assertSameBody(forBid, hash);
          return { hold: holdView(forBid), replayed: true };
        }
        throw new ContractError(
          "conflict",
          "this bid already has a commission reservation",
          { bidRef: input.bidRef, reservationId: forBid.id },
        );
      }

      const balance = await balanceOf(tx, wallet.id, wallet.currency);
      const held = await activeHoldsMinor(tx, wallet.id, wallet.currency);
      // Rider funding reservations (C02) encumber this same wallet: a driver
      // who is also a rider cannot pledge reserved fare money as commission.
      const reserved = await activeRiderReservationsMinor(
        tx,
        wallet.id,
        wallet.currency,
      );
      // Authorized travel items (P7) encumber it too: money reserved for a
      // flight or stay is not commission money either.
      const travel = await activeTravelAuthorizationsMinor(
        tx,
        wallet.id,
        wallet.currency,
      );
      const encumberedMinor =
        held.amountMinor + reserved.amountMinor + travel.amountMinor;
      const spendableMinor = balance.amountMinor - encumberedMinor;
      if (spendableMinor < input.amountMinor) {
        throw insufficientSpendable(
          input.amountMinor,
          spendableMinor,
          encumberedMinor,
          balance.amountMinor,
        );
      }

      const hold = await tx.mpCommissionHold.create({
        data: {
          id: generateId("mph"),
          walletId: wallet.id,
          driverId: input.driverId,
          bidRef: input.bidRef,
          requestRef: input.requestRef,
          amountMinor: toDbMinor(input.amountMinor),
          baseMinor: toDbMinor(input.baseMinor),
          currency: wallet.currency,
          commissionBps: MP_COMMISSION_BPS,
          roundingRule: MP_ROUNDING_RULE,
          policyVersion: input.policyVersion,
          state: "active",
          idempotencyKey: key,
          payloadHash: hash,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.reserved",
        subjectType: "mp_hold",
        subjectId: hold.id,
        after: {
          state: "active",
          amountMinor: input.amountMinor,
          baseMinor: input.baseMinor,
          bidRef: input.bidRef,
          walletId: wallet.id,
        },
      });
      await publishEvent(tx, {
        name: "mp.commission.reserved",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: null,
        toVersion: 1,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: input.cityId,
        idempotencyKey: `${key}:reserved`,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          bidRef: input.bidRef,
          requestRef: input.requestRef,
          walletId: wallet.id,
          amountMinor: input.amountMinor,
          currency: wallet.currency,
        },
      });

      return { hold: holdView(hold), replayed: false };
    });
  } catch (error) {
    // Lost a race to a rival insert. The unique index that refused us may be
    // the idempotency key OR the per-bid uniqueness; either way the winner's
    // row is the answer — a true replay is returned, anything else conflicts.
    if (isIdempotencyRace(error) || isBidRefRace(error)) {
      const winner =
        (await deps.db.mpCommissionHold.findUnique({
          where: { idempotencyKey: key },
        })) ??
        (await deps.db.mpCommissionHold.findUnique({
          where: { bidRef: input.bidRef },
        }));
      if (winner !== null) {
        if (winner.idempotencyKey !== key) {
          throw new ContractError(
            "conflict",
            "this bid already has a commission reservation",
            { bidRef: input.bidRef, reservationId: winner.id },
          );
        }
        assertSameBody(winner, hash);
        return { hold: holdView(winner), replayed: true };
      }
    }
    throw error;
  }
}

/** A P2002 on the per-bid unique index — the losing side of a bid-level race. */
function isBidRefRace(error: unknown): boolean {
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
  return fields.some((field) => field.includes("bid_ref"));
}

// ── Adjust (atomic raise / lower) ──────────────────────────────────────────

export interface AdjustHoldInput {
  readonly amountMinor: number;
  readonly baseMinor: number;
  /** Must match the hold's currency — a mismatch is refused, never adopted. */
  readonly currency: string;
}

/**
 * `active → active`: an atomic raise or lower. A raise succeeds only if the
 * DELTA fits spendable funds — otherwise nothing is written and the old hold
 * stays exactly as it was, with the shortfall in the error. A lower releases
 * the difference by shrinking the row (holds are not journal movements, so
 * there is nothing to post).
 */
export async function adjustHold(
  deps: WalletDeps,
  reservationId: string,
  input: AdjustHoldInput,
  clientKey: string,
): Promise<MpHoldResult> {
  const now = deps.now();
  const key = scopedKey("adjust", clientKey);
  assertCommissionArithmetic(input.amountMinor, input.baseMinor);

  try {
    return await deps.db.$transaction(async (tx) => {
      const before = await requireHold(tx, reservationId);
      await lockWallet(tx, before.walletId);
      // Re-read under the wallet lock: the lock serialises every money
      // operation on this wallet, including rival hold changes.
      const hold = await requireHold(tx, reservationId);
      if (hold.currency !== input.currency) {
        throw new ContractError(
          "validation_failed",
          "the adjustment currency does not match the hold's currency",
          { currency: input.currency, holdCurrency: hold.currency },
        );
      }
      assertTransition(HOLD_MACHINE, hold.state, "active");

      const oldAmountMinor = fromDbMinor(hold.amountMinor);
      const deltaMinor = input.amountMinor - oldAmountMinor;
      if (deltaMinor > 0) {
        const spendable = await spendableOf(tx, hold.walletId, hold.currency);
        if (spendable.amountMinor < deltaMinor) {
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
          throw insufficientSpendable(
            deltaMinor,
            spendable.amountMinor,
            encumberedMinor,
            spendable.amountMinor + encumberedMinor,
          );
        }
      }

      const updated = await tx.mpCommissionHold.update({
        where: { id: hold.id },
        data: {
          amountMinor: toDbMinor(input.amountMinor),
          baseMinor: toDbMinor(input.baseMinor),
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.adjusted",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { amountMinor: oldAmountMinor },
        after: { amountMinor: input.amountMinor, baseMinor: input.baseMinor },
      });
      await publishEvent(tx, {
        name: "mp.commission.adjusted",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: 1,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${key}:adjusted`,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          bidRef: hold.bidRef,
          walletId: hold.walletId,
          fromAmountMinor: oldAmountMinor,
          toAmountMinor: input.amountMinor,
          currency: hold.currency,
        },
      });

      return { hold: holdView(updated), replayed: false };
    });
  } catch (error) {
    // A replay of the same adjust key: the winner already moved the hold to
    // this exact amount (the outbox key is unique), so answer with its state.
    if (isIdempotencyRace(error)) {
      const row = await deps.db.mpCommissionHold.findUnique({
        where: { id: reservationId },
      });
      if (row !== null && fromDbMinor(row.amountMinor) === input.amountMinor) {
        return { hold: holdView(row), replayed: true };
      }
    }
    throw error;
  }
}

// ── Release ────────────────────────────────────────────────────────────────

/**
 * Releases a hold exactly once (lost/withdrawn/expired bids). Releasing an
 * already-released hold replays the original outcome. A hold whose award is
 * still being captured (`capture_pending`) can neither expire nor release —
 * the award must reconcile first (M04).
 */
export async function releaseHold(
  deps: WalletDeps,
  reservationId: string,
  clientKey: string,
): Promise<MpHoldResult> {
  const now = deps.now();
  const key = scopedKey("release", clientKey);

  const releaseGuards = (hold: HoldRow): MpHoldResult | null => {
    if (hold.state === "released") {
      return { hold: holdView(hold), replayed: true };
    }
    if (hold.state === "capture_pending") {
      throw new ContractError(
        "award_unresolved",
        "this hold is under an award whose capture has not resolved",
        { reservationId: hold.id, awardRef: hold.awardRef },
      );
    }
    return null;
  };

  const pre = await deps.db.mpCommissionHold.findUnique({
    where: { id: reservationId },
  });
  if (pre === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId,
    });
  }
  const preReplay = releaseGuards(pre);
  if (preReplay !== null) {
    return preReplay;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, pre.walletId);
      const hold = await requireHold(tx, reservationId);
      const replay = releaseGuards(hold);
      if (replay !== null) {
        return replay;
      }
      assertTransition(HOLD_MACHINE, hold.state, "released");

      const updated = await tx.mpCommissionHold.update({
        where: { id: hold.id },
        data: { state: "released", releasedAt: now },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.released",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { state: hold.state },
        after: { state: "released" },
      });
      await publishEvent(tx, {
        name: "mp.commission.released",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: 1,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${key}:released`,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          bidRef: hold.bidRef,
          walletId: hold.walletId,
          amountMinor: fromDbMinor(hold.amountMinor),
          currency: hold.currency,
        },
      });

      return { hold: holdView(updated), replayed: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const row = await deps.db.mpCommissionHold.findUnique({
        where: { id: reservationId },
      });
      if (row !== null && row.state === "released") {
        return { hold: holdView(row), replayed: true };
      }
    }
    throw error;
  }
}

// ── Capture (the single 10% debit, at selection) ───────────────────────────

export interface CaptureHoldInput {
  readonly awardId: string;
  /**
   * The award's PINNED commission (Money). The capture debits exactly this or
   * refuses: a hold whose current amount differs — e.g. a bid revision's
   * adjust raced the selection — is a `conflict`, so the saga compensates
   * instead of debiting terms that were never awarded.
   */
  readonly expectedAmountMinor: {
    readonly amountMinor: number;
    readonly currency: string;
  };
}

/**
 * `active → capture_pending → captured` in one transaction. Posts the ONE
 * commission journal entry (driver wallet → ubi_commission) and stamps the
 * receipt. Idempotent ON THE AWARD ID: the journal entry's idempotency key is
 * derived from the award, so however many times — and under however many
 * client keys — selection is retried, the fee is debited exactly once and
 * every caller gets the original receipt. A capture for a DIFFERENT award on
 * the same reservation is a conflict, never a second debit. The hold's
 * current amount must equal the award's pinned `expectedAmountMinor` (checked
 * under the wallet lock, BEFORE any state change) or the capture is refused.
 */
export async function captureHold(
  deps: WalletDeps,
  reservationId: string,
  input: CaptureHoldInput,
  clientKey: string,
): Promise<MpCaptureResult> {
  const now = deps.now();
  // Deliberately scoped to the award, not the client key (ADR 0002): the
  // award id is the idempotency authority for the single commission debit.
  const awardKey = scopedKey("capture", `award:${input.awardId}`);
  void clientKey;

  const expected = input.expectedAmountMinor;
  if (!Number.isInteger(expected.amountMinor) || expected.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "expectedAmountMinor must be a positive integer in minor units",
      { expectedAmountMinor: expected.amountMinor },
    );
  }

  // The award's pinned commission versus the hold as it stands NOW. Runs
  // before any state change; the in-transaction call re-checks under the
  // wallet lock, so a rival adjust cannot slip between check and debit.
  const assertExpectedAmount = (hold: HoldRow): void => {
    const currentMinor = fromDbMinor(hold.amountMinor);
    if (
      currentMinor !== expected.amountMinor ||
      hold.currency !== expected.currency
    ) {
      throw new ContractError(
        "conflict",
        "the hold's current amount is not the award's pinned commission",
        {
          reservationId: hold.id,
          awardId: input.awardId,
          holdAmountMinor: currentMinor,
          holdCurrency: hold.currency,
          expectedAmountMinor: expected.amountMinor,
          expectedCurrency: expected.currency,
        },
      );
    }
  };

  const capturedReplay = (hold: HoldRow): MpCaptureResult | null => {
    if (hold.state !== "captured" && hold.state !== "reversed") {
      return null;
    }
    if (hold.awardRef !== input.awardId) {
      throw new ContractError(
        "conflict",
        "this reservation was captured under a different award",
        { reservationId: hold.id, awardRef: hold.awardRef },
      );
    }
    if (hold.receiptId === null || hold.journalEntryId === null) {
      throw new ContractError(
        "internal_error",
        "captured hold is missing its receipt",
        { reservationId: hold.id },
      );
    }
    return {
      hold: holdView(hold),
      receiptId: hold.receiptId,
      journalEntryId: hold.journalEntryId,
      replayed: true,
    };
  };

  const pre = await deps.db.mpCommissionHold.findUnique({
    where: { id: reservationId },
  });
  if (pre === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId,
    });
  }
  const preReplay = capturedReplay(pre);
  if (preReplay !== null) {
    return preReplay;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, pre.walletId);
      const hold = await requireHold(tx, reservationId);
      const replay = capturedReplay(hold);
      if (replay !== null) {
        return replay;
      }

      // Refuse BEFORE any state change when the hold no longer carries the
      // awarded terms (a revise-raise raced the selection).
      assertExpectedAmount(hold);

      // active → capture_pending: the hold is now spoken for by this award.
      assertTransition(HOLD_MACHINE, hold.state, "capture_pending");
      await tx.mpCommissionHold.update({
        where: { id: hold.id },
        data: { state: "capture_pending", awardRef: input.awardId },
      });

      const amountMinor = fromDbMinor(hold.amountMinor);
      const entry = await postEntry(tx, {
        kind: "mp_commission_capture",
        reference: `mp_award:${input.awardId}`,
        occurredAt: now,
        idempotencyKey: awardKey,
        description: "marketplace commission captured at selection",
        lines: movement(
          {
            account: "wallet",
            walletId: hold.walletId,
            counterpartRef: `award:${input.awardId}`,
          },
          {
            account: "ubi_commission",
            counterpartRef: `award:${input.awardId}`,
          },
          amountMinor,
          hold.currency,
        ),
      });

      // capture_pending → captured, with the receipt stamped in the same tx.
      assertTransition(HOLD_MACHINE, "capture_pending", "captured");
      const receiptId = generateId("mcr");
      const updated = await tx.mpCommissionHold.update({
        where: { id: hold.id },
        data: {
          state: "captured",
          receiptId,
          journalEntryId: entry.id,
          capturedAt: now,
        },
      });

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.captured",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { state: hold.state },
        after: {
          state: "captured",
          awardRef: input.awardId,
          receiptId,
          journalEntryId: entry.id,
          amountMinor,
        },
      });
      await publishEvent(tx, {
        name: "mp.commission.captured",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: 1,
        toVersion: 2,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${awardKey}:captured`,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          bidRef: hold.bidRef,
          awardId: input.awardId,
          walletId: hold.walletId,
          receiptId,
          journalEntryId: entry.id,
          amountMinor,
          currency: hold.currency,
        },
      });

      return {
        hold: holdView(updated),
        receiptId,
        journalEntryId: entry.id,
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the award-scoped idempotency race: the winner captured; answer
    // with its receipt.
    if (isIdempotencyRace(error)) {
      const row = await deps.db.mpCommissionHold.findUnique({
        where: { id: reservationId },
      });
      if (row !== null) {
        const replay = capturedReplay(row);
        if (replay !== null) {
          return replay;
        }
      }
    }
    throw error;
  }
}

// ── Reverse (linked compensation, never an edit) ───────────────────────────

export interface ReverseHoldInput {
  readonly awardId: string;
  readonly reason: string;
}

/**
 * `captured → reversed`: undoes a captured commission with a LINKED
 * compensating entry (`ubi_commission` → driver wallet). The original capture
 * entry is untouched — the journal is append-only, and the pair stays
 * traceable through `award:<id>` / `award:<id>:reversal` counterpart refs.
 */
export async function reverseCapturedHold(
  deps: WalletDeps,
  reservationId: string,
  input: ReverseHoldInput,
  clientKey: string,
): Promise<MpHoldResult> {
  const now = deps.now();
  const reverseKey = scopedKey("reverse", `award:${input.awardId}`);
  void clientKey;

  const reversedReplay = (hold: HoldRow): MpHoldResult | null => {
    if (hold.state !== "reversed") {
      return null;
    }
    if (hold.awardRef !== input.awardId) {
      throw new ContractError(
        "conflict",
        "this reservation belongs to a different award",
        { reservationId: hold.id, awardRef: hold.awardRef },
      );
    }
    return { hold: holdView(hold), replayed: true };
  };

  const pre = await deps.db.mpCommissionHold.findUnique({
    where: { id: reservationId },
  });
  if (pre === null) {
    throw new ContractError("not_found", "no such reservation", {
      reservationId,
    });
  }
  const preReplay = reversedReplay(pre);
  if (preReplay !== null) {
    return preReplay;
  }
  if (pre.state === "captured" && pre.awardRef !== input.awardId) {
    throw new ContractError(
      "conflict",
      "this reservation was captured under a different award",
      { reservationId: pre.id, awardRef: pre.awardRef },
    );
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, pre.walletId);
      const hold = await requireHold(tx, reservationId);
      const replay = reversedReplay(hold);
      if (replay !== null) {
        return replay;
      }
      assertTransition(HOLD_MACHINE, hold.state, "reversed");

      const amountMinor = fromDbMinor(hold.amountMinor);
      const entry = await postEntry(tx, {
        kind: "mp_commission_reversal",
        reference: `mp_award:${input.awardId}:reversal`,
        occurredAt: now,
        idempotencyKey: reverseKey,
        description: "marketplace commission reversed (compensation)",
        lines: movement(
          {
            account: "ubi_commission",
            counterpartRef: `award:${input.awardId}:reversal`,
          },
          {
            account: "wallet",
            walletId: hold.walletId,
            counterpartRef: `award:${input.awardId}:reversal`,
          },
          amountMinor,
          hold.currency,
        ),
      });

      const updated = await tx.mpCommissionHold.update({
        where: { id: hold.id },
        data: { state: "reversed", reversalEntryId: entry.id },
      });

      // A reversed award is an abandoned award: the rider's funding
      // reservation (C02) is released in this same transaction, with the
      // reversal's reason linked, so the commission hand-back and the fare
      // un-encumbrance commit or roll back as one unit. No-op when the award
      // never had a reservation (cash, legacy).
      await releaseReservationInTx(
        tx,
        input.awardId,
        `award_reversed: ${input.reason}`,
        now,
      );

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_hold.reversed",
        subjectType: "mp_hold",
        subjectId: hold.id,
        before: { state: hold.state },
        after: { state: "reversed", reversalEntryId: entry.id, amountMinor },
        reason: input.reason,
      });
      await publishEvent(tx, {
        name: "mp.commission.reversed",
        aggregateType: "mp_hold",
        aggregateId: hold.id,
        fromVersion: 2,
        toVersion: 3,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: null,
        idempotencyKey: `${reverseKey}:reversed`,
        occurredAt: now,
        payload: {
          reservationId: hold.id,
          awardId: input.awardId,
          walletId: hold.walletId,
          reversalEntryId: entry.id,
          amountMinor,
          currency: hold.currency,
          reason: input.reason,
        },
      });

      return { hold: holdView(updated), replayed: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const row = await deps.db.mpCommissionHold.findUnique({
        where: { id: reservationId },
      });
      if (row !== null) {
        const replay = reversedReplay(row);
        if (replay !== null) {
          return replay;
        }
      }
    }
    throw error;
  }
}

// ── Driver wallet overview (D04) ───────────────────────────────────────────

/**
 * One server-computed spendable, everywhere: cleared journal balance, the sum
 * of live holds, and their difference — plus the holds themselves.
 */
export async function getMpWalletOverview(
  deps: WalletDeps,
  driverId: string,
  cityId: string,
): Promise<MpWalletOverviewResult> {
  const config = await deps.config.loadForWallet(cityId);
  const currency = config.city.currency;
  const wallet = await findWallet(deps.db, "user", driverId, currency);
  if (wallet === null) {
    return {
      clearedMinor: money(0, currency),
      heldMinor: money(0, currency),
      spendableMinor: money(0, currency),
      holds: [],
    };
  }
  const cleared = await balanceOf(deps.db, wallet.id, currency);
  const held = await activeHoldsMinor(deps.db, wallet.id, currency);
  const rows = await deps.db.mpCommissionHold.findMany({
    where: {
      walletId: wallet.id,
      currency,
      state: { in: ["active", "capture_pending"] },
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    clearedMinor: cleared,
    heldMinor: held,
    spendableMinor: money(cleared.amountMinor - held.amountMinor, currency),
    holds: rows.map(holdView),
  };
}
