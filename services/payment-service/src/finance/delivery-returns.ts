/**
 * Delivery return-leg funding on the canonical ledger (P17, recheck R02).
 *
 * When a marketplace delivery's recipient cannot be reached, delivery-service
 * may bring the parcel back to its sender for a fee the sender approves. This
 * module is the money side of that return leg, served at
 * `/v1/finance/delivery-returns` by ./delivery-return-routes.ts:
 *
 *   reserve  — at the sender's approval: hold the fee on the SENDER's wallet;
 *   capture  — when the driver proves the parcel is back: take it, once;
 *   release  — when the charge is cancelled, or the approval never committed.
 *
 * The rules:
 *
 *  - ONE charge per return (delivery-service's `delivery_returns.id`), ever.
 *    A second reserve under another key is a `conflict` carrying the charge.
 *  - reserve is a durable ENCUMBRANCE, not a journal movement: a companion
 *    `mp_rider_reservations` row keyed `delivery_return:<returnId>` — the same
 *    linked-key convention rider funding amendments use
 *    (`amendment:<award>:<id>`) — so the one spendable calculation
 *    (ledger/balances.ts) already subtracts it and every competing debit sees
 *    it. The key cannot collide with an award's own reservation (award ids
 *    carry no `:`) and no award-scoped path (settlement, release, amendments)
 *    ever matches it.
 *  - capture posts ONE entry (sender wallet → the driver's wallet, the whole
 *    fee, kind `delivery_return_fee`) and consumes the encumbrance in the same
 *    transaction. The return leg is a NEW charge: it never reuses, adjusts or
 *    re-captures the award's 10% commission. The only thing this module does
 *    with a commission hold is READ the award's captured one at reserve, to
 *    bind the payee to the driver who actually won the award.
 *  - release frees an active reservation. It is forgiving by design, because
 *    delivery-service calls it from compensation paths that must converge: a
 *    release of an already-released charge answers the original release, and
 *    a release that arrives BEFORE any reservation (the reserve outcome was
 *    unknown to the caller) records a `released` tombstone, so a late reserve
 *    for that return is refused instead of stranding a hold. Releasing a
 *    captured fee is an `illegal_transition` — a refund is a support remedy.
 *  - every POST is idempotent on its scoped Idempotency-Key: a replay answers
 *    the original result verbatim, and a replay carrying different money
 *    terms is `idempotency_key_reuse` (409). `reason` is descriptive only.
 *  - every transition writes its audit row and outbox event in the same
 *    transaction as the state change.
 *  - a NEW reservation is deny-by-default: it needs `marketplace_delivery`
 *    switched on in the city. Capture and release of an EXISTING charge are
 *    never blocked by that switch — a kill switch stops new commitments, it
 *    must not strand a sender's money.
 *
 * Service-to-service only: delivery-service authenticates with the internal
 * service key, so the audited actor is delivery-service itself.
 */
import {
  ContractError,
  type EventName,
  type FlagSet,
  isEnabled,
  money,
  paymentMethodAvailable,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "../ledger/audit";
import { lockWallet, type WalletDeps } from "../ledger/context";
import { assertSufficientFunds } from "../ledger/limits";
import { fromDbMinor, toDbMinor } from "../ledger/minor-units";
import { payloadHashOf } from "../ledger/mp-holds";
import { movement, postEntry } from "../ledger/post-entry";
import {
  assertNotLocked,
  assertNotSafeMode,
  ensureWallet,
  requireWallet,
} from "../ledger/wallets";
import { generateId } from "../lib/utils";

import type { Actor, LedgerDb, LedgerTx } from "../ledger/types";

export const DELIVERY_RETURN_CHARGE_STATES = [
  "reserved",
  "captured",
  "released",
] as const;

export type DeliveryReturnChargeState =
  (typeof DELIVERY_RETURN_CHARGE_STATES)[number];

export const DELIVERY_RETURN_OPS = ["reserve", "capture", "release"] as const;

export type DeliveryReturnOpName = (typeof DELIVERY_RETURN_OPS)[number];

/** The closed charge machine: both outcomes of a reservation are terminal. */
const TRANSITIONS: Readonly<
  Record<DeliveryReturnChargeState, readonly DeliveryReturnChargeState[]>
> = {
  reserved: ["captured", "released"],
  captured: [],
  released: [],
};

/** The authenticated principal: the endpoint is service-to-service. */
export const DELIVERY_SERVICE_ACTOR: Actor = {
  id: "delivery-service",
  role: "service",
};

/**
 * Outbox names. The event catalog has no dedicated delivery-return names, so
 * each op uses the catalog's generic payment name for the same kind of
 * movement, disambiguated by `aggregateType` — the convention travel payments
 * and marketplace settlement already follow.
 */
const OP_EVENT: Readonly<Record<DeliveryReturnOpName, EventName>> = {
  reserve: "transfer.held",
  capture: "transfer.posted",
  release: "payment.auth_released",
};

const OP_AUDIT_ACTION: Readonly<Record<DeliveryReturnOpName, string>> = {
  reserve: "finance.delivery_return.reserved",
  capture: "finance.delivery_return.captured",
  release: "finance.delivery_return.released",
};

const AGGREGATE_TYPE = "delivery_return_charge";

/** Commission-increment holds (mp-amendment-refs) — never the award's own capture. */
const COMMISSION_DELTA_BID_PREFIX = "mpdelta:";

/**
 * The companion rider-reservation key for a return. Its own namespace, so it
 * can never be mistaken for (or collide with) an award's reservation.
 */
export function returnReservationKey(returnId: string): string {
  return `delivery_return:${returnId}`;
}

/** Ids travel inside composite keys: no `:` and nothing exotic. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export interface DeliveryReturnChargeInput {
  readonly returnId: string;
  readonly deliveryId: string;
  /** The delivery's original marketplace award — context and payee binding only. */
  readonly awardId: string;
  /** The payer: the sender's user id. */
  readonly senderId: string;
  /** The payee: the award's driver (user id). */
  readonly driverId: string;
  readonly feeMinor: number;
  readonly currency: string;
  readonly cityId: string;
  readonly reason: string | null;
}

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export type DeliveryReturnChargeView = {
  readonly chargeId: string;
  readonly returnId: string;
  readonly deliveryId: string;
  readonly awardId: string;
  readonly senderId: string;
  readonly driverId: string;
  /** The payer's wallet; null on a tombstone (released before any reservation). */
  readonly walletId: string | null;
  readonly cityId: string;
  readonly state: DeliveryReturnChargeState;
  readonly fee: MoneyView;
  /** What the charge still encumbers: the fee while `reserved`, else zero. */
  readonly encumbered: MoneyView;
  /** What was taken: the fee once `captured`, else zero. */
  readonly captured: MoneyView;
  readonly reservationId: string | null;
  readonly captureEntryId: string | null;
  readonly releaseReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly capturedAt: string | null;
  readonly releasedAt: string | null;
};

/** What an op answers, and what a replay of it answers verbatim. */
export type DeliveryReturnOpResult = {
  readonly ref: string;
  readonly op: DeliveryReturnOpName;
  readonly chargeId: string;
  readonly returnId: string;
  /** The journal entry the op posted; null for reserve and release. */
  readonly entryId: string | null;
  readonly amount: MoneyView;
  /** The charge's state right after this op. */
  readonly state: DeliveryReturnChargeState;
  readonly charge: DeliveryReturnChargeView;
};

export interface DeliveryReturnOutcome {
  readonly result: DeliveryReturnOpResult;
  readonly replayed: boolean;
}

export type DeliveryReturnOpView = {
  readonly ref: string;
  readonly op: DeliveryReturnOpName;
  readonly clientKey: string;
  readonly amount: MoneyView;
  readonly entryId: string | null;
  readonly createdAt: string;
};

export interface DeliveryReturnStatusView {
  readonly charge: DeliveryReturnChargeView;
  readonly ops: readonly DeliveryReturnOpView[];
}

/** The row shape Prisma hands back for `delivery_return_charges`. */
interface ChargeRow {
  readonly id: string;
  readonly returnId: string;
  readonly deliveryId: string;
  readonly awardId: string;
  readonly senderId: string;
  readonly driverId: string;
  readonly walletId: string | null;
  readonly cityId: string;
  readonly currency: string;
  readonly feeMinor: bigint;
  readonly state: string;
  readonly reservationId: string | null;
  readonly captureEntryId: string | null;
  readonly releaseReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly capturedAt: Date | null;
  readonly releasedAt: Date | null;
}

interface OpRow {
  readonly id: string;
  readonly op: string;
  readonly clientKey: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly entryId: string | null;
  readonly result: unknown;
  readonly createdAt: Date;
}

function isChargeState(value: string): value is DeliveryReturnChargeState {
  return (DELIVERY_RETURN_CHARGE_STATES as readonly string[]).includes(value);
}

function isOpName(value: string): value is DeliveryReturnOpName {
  return (DELIVERY_RETURN_OPS as readonly string[]).includes(value);
}

function stateOf(row: ChargeRow): DeliveryReturnChargeState {
  if (!isChargeState(row.state)) {
    // The CHECK constraint makes this unreachable; kept so a widened state set
    // fails loudly here instead of answering an unknown state.
    throw new ContractError(
      "internal_error",
      "delivery return charge is in an unknown state",
      { chargeId: row.id, state: row.state },
    );
  }
  return row.state;
}

export function chargeView(row: ChargeRow): DeliveryReturnChargeView {
  const state = stateOf(row);
  const fee = fromDbMinor(row.feeMinor);
  return {
    chargeId: row.id,
    returnId: row.returnId,
    deliveryId: row.deliveryId,
    awardId: row.awardId,
    senderId: row.senderId,
    driverId: row.driverId,
    walletId: row.walletId,
    cityId: row.cityId,
    state,
    fee: money(fee, row.currency),
    encumbered: money(state === "reserved" ? fee : 0, row.currency),
    captured: money(state === "captured" ? fee : 0, row.currency),
    reservationId: row.reservationId,
    captureEntryId: row.captureEntryId,
    releaseReason: row.releaseReason,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    capturedAt: row.capturedAt === null ? null : row.capturedAt.toISOString(),
    releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
  };
}

function opView(row: OpRow): DeliveryReturnOpView {
  if (!isOpName(row.op)) {
    throw new ContractError(
      "internal_error",
      "delivery return op has an unknown kind",
      { ref: row.id, op: row.op },
    );
  }
  return {
    ref: row.id,
    op: row.op,
    clientKey: row.clientKey,
    amount: money(fromDbMinor(row.amountMinor), row.currency),
    entryId: row.entryId,
    createdAt: row.createdAt.toISOString(),
  };
}

function scopedKey(op: DeliveryReturnOpName, clientKey: string): string {
  return scopedIdempotencyKey(
    `finance.delivery_return.${op}`,
    DELIVERY_SERVICE_ACTOR.id,
    clientKey,
  );
}

/** The money terms a replay must repeat. `reason` is descriptive and excluded. */
function termsHashOf(
  op: DeliveryReturnOpName,
  input: DeliveryReturnChargeInput,
): string {
  return payloadHashOf({
    op,
    returnId: input.returnId,
    deliveryId: input.deliveryId,
    awardId: input.awardId,
    senderId: input.senderId,
    driverId: input.driverId,
    feeMinor: input.feeMinor,
    currency: input.currency,
    cityId: input.cityId,
  });
}

function assertTerms(input: DeliveryReturnChargeInput): void {
  if (
    !Number.isSafeInteger(input.feeMinor) ||
    input.feeMinor <= 0 ||
    !/^[A-Z]{3}$/.test(input.currency)
  ) {
    throw new ContractError(
      "validation_failed",
      "a return fee needs a positive integer amount in minor units and an explicit ISO currency",
      { feeMinor: input.feeMinor, currency: input.currency },
    );
  }
  for (const field of [
    "returnId",
    "deliveryId",
    "awardId",
    "senderId",
    "driverId",
  ] as const) {
    if (!ID_PATTERN.test(input[field])) {
      throw new ContractError(
        "validation_failed",
        `${field} must be 1-128 characters of letters, digits, '_', '.' or '-'`,
        { field },
      );
    }
  }
  if (input.senderId === input.driverId) {
    throw new ContractError(
      "validation_failed",
      "the sender paying a return fee cannot also be the driver it pays",
      { returnId: input.returnId },
    );
  }
}

/** A capture or release must repeat the charge's own parties, amount and city. */
function assertSameTerms(
  row: ChargeRow,
  input: DeliveryReturnChargeInput,
): void {
  if (
    row.deliveryId !== input.deliveryId ||
    row.awardId !== input.awardId ||
    row.senderId !== input.senderId ||
    row.driverId !== input.driverId ||
    fromDbMinor(row.feeMinor) !== input.feeMinor ||
    row.currency !== input.currency ||
    row.cityId !== input.cityId
  ) {
    throw new ContractError(
      "conflict",
      "this request does not match the return's charge",
      {
        returnId: row.returnId,
        chargeFeeMinor: fromDbMinor(row.feeMinor),
        requestFeeMinor: input.feeMinor,
        chargeCurrency: row.currency,
        requestCurrency: input.currency,
        partiesMatch:
          row.senderId === input.senderId && row.driverId === input.driverId,
        deliveryMatches:
          row.deliveryId === input.deliveryId && row.awardId === input.awardId,
        cityMatches: row.cityId === input.cityId,
      },
    );
  }
}

function assertChargeTransition(
  row: ChargeRow,
  to: DeliveryReturnChargeState,
): void {
  const from = stateOf(row);
  if (!TRANSITIONS[from].includes(to)) {
    throw new ContractError(
      "illegal_transition",
      `a delivery return charge cannot move from ${from} to ${to}`,
      { returnId: row.returnId, from, to, charge: chargeView(row) },
    );
  }
}

/**
 * A replay of an op this key already recorded: the original result verbatim,
 * or a refusal when the key now carries different money terms.
 */
async function replayOf(
  db: LedgerTx,
  key: string,
  hash: string,
): Promise<DeliveryReturnOutcome | null> {
  const op = await db.deliveryReturnChargeOp.findUnique({
    where: { idempotencyKey: key },
  });
  if (op === null) {
    return null;
  }
  if (op.payloadHash !== hash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this idempotency key was already used with different return-fee terms",
      { ref: op.id, op: op.op },
    );
  }
  return { result: op.result as DeliveryReturnOpResult, replayed: true };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * The fast-path checks run before any lock, so a same-key retry racing its
 * own original may read the state the original just committed and look
 * illegal. Before refusing, look for the original once more: when this key
 * already recorded the op, its result is the answer, never a 409.
 */
async function refuseUnlessReplay(
  db: LedgerTx,
  key: string,
  hash: string,
  error: unknown,
): Promise<DeliveryReturnOutcome> {
  const replay = await replayOf(db, key, hash);
  if (replay !== null) {
    return replay;
  }
  throw error;
}

async function requireCharge(
  db: LedgerTx,
  returnId: string,
): Promise<ChargeRow> {
  const row = await db.deliveryReturnCharge.findUnique({ where: { returnId } });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this delivery return has no fee reservation",
      { returnId },
    );
  }
  return row;
}

/**
 * Locks the charge row for the rest of the transaction. Paths that also lock
 * the sender's wallet lock the WALLET FIRST, so two ops on one charge cannot
 * deadlock.
 */
async function lockCharge(tx: LedgerTx, chargeId: string): Promise<ChargeRow> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM delivery_return_charges WHERE id = ${chargeId} FOR UPDATE
  `;
  const row = await tx.deliveryReturnCharge.findUnique({
    where: { id: chargeId },
  });
  if (row === null) {
    throw new ContractError("not_found", "delivery return charge not found", {
      chargeId,
    });
  }
  return row;
}

/**
 * New return-fee commitments need the delivery vertical on in the city
 * (deny-by-default). No new flag: the switch that gates marketplace delivery
 * gates the money behind its return leg.
 */
function assertDeliveryVerticalEnabled(flags: FlagSet, cityId: string): void {
  if (!isEnabled(flags, "marketplace_delivery")) {
    throw new ContractError(
      "feature_disabled",
      "delivery return fees are not enabled in this city",
      { cityId, requires: ["marketplace_delivery"] },
    );
  }
}

/**
 * Binds the payee to the award: the delivery's award must carry its ONE
 * captured 10% commission (the selection capture — never an amendment
 * increment), and the fee may only be paid to the driver that capture was
 * taken from. Read-only: the hold is not touched, adjusted or re-captured.
 */
async function assertAwardPayee(
  db: LedgerTx,
  input: DeliveryReturnChargeInput,
): Promise<void> {
  const hold = await db.mpCommissionHold.findFirst({
    where: {
      awardRef: input.awardId,
      state: "captured",
      NOT: { bidRef: { startsWith: COMMISSION_DELTA_BID_PREFIX } },
    },
    select: { id: true, driverId: true },
  });
  if (hold === null) {
    throw new ContractError(
      "conflict",
      "the delivery's award has no captured marketplace commission; a return fee needs a live, awarded delivery",
      { awardId: input.awardId },
    );
  }
  if (hold.driverId !== input.driverId) {
    throw new ContractError(
      "conflict",
      "a return fee can only be paid to the driver who won the delivery's award",
      { awardId: input.awardId },
    );
  }
}

interface FinishOpArgs {
  readonly op: DeliveryReturnOpName;
  readonly key: string;
  readonly clientKey: string;
  readonly hash: string;
  readonly input: DeliveryReturnChargeInput;
  readonly before: ChargeRow | null;
  readonly after: ChargeRow;
  readonly entryId: string | null;
  readonly now: Date;
}

/**
 * Records the op (the idempotency row carrying the response a replay will
 * answer), its audit row and its outbox event — inside the caller's
 * transaction, so none of them can exist without the state change or vice
 * versa.
 */
async function finishOp(
  tx: LedgerTx,
  args: FinishOpArgs,
): Promise<DeliveryReturnOutcome> {
  const ref = generateId("dro");
  const charge = chargeView(args.after);
  const amountMinor = fromDbMinor(args.after.feeMinor);
  const result: DeliveryReturnOpResult = {
    ref,
    op: args.op,
    chargeId: args.after.id,
    returnId: args.after.returnId,
    entryId: args.entryId,
    amount: money(amountMinor, args.after.currency),
    state: charge.state,
    charge,
  };

  await tx.deliveryReturnChargeOp.create({
    data: {
      id: ref,
      chargeId: args.after.id,
      op: args.op,
      idempotencyKey: args.key,
      clientKey: args.clientKey,
      payloadHash: args.hash,
      amountMinor: toDbMinor(amountMinor),
      currency: args.after.currency,
      entryId: args.entryId,
      reason: args.input.reason,
      result,
    },
  });

  await writeAudit(tx, {
    actor: DELIVERY_SERVICE_ACTOR,
    action: OP_AUDIT_ACTION[args.op],
    subjectType: AGGREGATE_TYPE,
    subjectId: args.after.id,
    before: args.before === null ? null : { state: args.before.state },
    after: {
      state: charge.state,
      returnId: args.after.returnId,
      deliveryId: args.after.deliveryId,
      awardId: args.after.awardId,
      opRef: ref,
      entryId: args.entryId,
      feeMinor: amountMinor,
      currency: args.after.currency,
      reservationId: args.after.reservationId,
      walletId: args.after.walletId,
      tombstone: args.after.reservationId === null,
    },
    reason: args.input.reason,
  });

  await publishEvent(tx, {
    name: OP_EVENT[args.op],
    aggregateType: AGGREGATE_TYPE,
    aggregateId: args.after.id,
    fromVersion: args.before === null ? null : args.before.version,
    toVersion: args.after.version,
    actor: DELIVERY_SERVICE_ACTOR,
    actorType: "service",
    cityId: args.after.cityId,
    idempotencyKey: `${args.key}:${args.op}`,
    occurredAt: args.now,
    // Ids and amounts only — never PII.
    payload: {
      chargeId: args.after.id,
      returnId: args.after.returnId,
      deliveryId: args.after.deliveryId,
      awardId: args.after.awardId,
      op: args.op,
      opRef: ref,
      walletId: args.after.walletId,
      state: charge.state,
      feeMinor: amountMinor,
      currency: args.after.currency,
      entryId: args.entryId,
    },
  });

  return { result, replayed: false };
}

// ── Reserve ────────────────────────────────────────────────────────────────

/**
 * Holds the return fee on the sender's wallet: a `reserved` charge plus its
 * companion rider reservation, checked against spendable under the wallet
 * lock. No money moves; spendable drops by the fee until capture or release.
 */
export async function reserveDeliveryReturnFee(
  deps: WalletDeps,
  input: DeliveryReturnChargeInput,
  clientKey: string,
): Promise<DeliveryReturnOutcome> {
  assertTerms(input);
  const now = deps.now();
  const key = scopedKey("reserve", clientKey);
  const hash = termsHashOf("reserve", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  const { city, flags } = await deps.config.load(input.cityId);
  if (city.currency !== input.currency) {
    throw new ContractError(
      "validation_failed",
      "the return fee currency does not match the city's wallet currency",
      { currency: input.currency, cityCurrency: city.currency },
    );
  }
  assertDeliveryVerticalEnabled(flags, input.cityId);
  if (!paymentMethodAvailable(city, "wallet")) {
    throw new ContractError(
      "payment_method_unavailable",
      "wallet payment is not available in this city",
      { paymentMethodId: "wallet" },
    );
  }

  const existing = await deps.db.deliveryReturnCharge.findUnique({
    where: { returnId: input.returnId },
  });
  if (existing !== null) {
    return refuseUnlessReplay(
      deps.db,
      key,
      hash,
      new ContractError("conflict", "this return already has a fee charge", {
        returnId: input.returnId,
        charge: chargeView(existing),
      }),
    );
  }

  await assertAwardPayee(deps.db, input);

  try {
    return await deps.db.$transaction(async (tx) => {
      const wallet = await ensureWallet(tx, "user", input.senderId, city);
      assertNotLocked(wallet);
      assertNotSafeMode(wallet, now);
      await lockWallet(tx, wallet.id);

      // Re-read under the wallet lock: a rival reserve (or a tombstoning
      // release) for this return may have committed while we waited.
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      const rival = await tx.deliveryReturnCharge.findUnique({
        where: { returnId: input.returnId },
      });
      if (rival !== null) {
        throw new ContractError(
          "conflict",
          "this return already has a fee charge",
          { returnId: input.returnId, charge: chargeView(rival) },
        );
      }

      // The one spendable guard every debit path uses: cleared balance minus
      // every live encumbrance (holds, rider reservations, travel items).
      await assertSufficientFunds(
        tx,
        wallet,
        money(input.feeMinor, wallet.currency),
      );

      const reservation = await tx.mpRiderReservation.create({
        data: {
          id: generateId("mrr"),
          awardId: returnReservationKey(input.returnId),
          requestId: input.deliveryId,
          requesterId: input.senderId,
          walletId: wallet.id,
          amountMinor: toDbMinor(input.feeMinor),
          currency: wallet.currency,
          cityId: input.cityId,
          paymentMethodId: "wallet",
          status: "active",
        },
      });

      const charge = await tx.deliveryReturnCharge.create({
        data: {
          id: generateId("drc"),
          returnId: input.returnId,
          deliveryId: input.deliveryId,
          awardId: input.awardId,
          senderId: input.senderId,
          driverId: input.driverId,
          walletId: wallet.id,
          cityId: input.cityId,
          currency: wallet.currency,
          feeMinor: toDbMinor(input.feeMinor),
          state: "reserved",
          reservationId: reservation.id,
        },
      });

      return finishOp(tx, {
        op: "reserve",
        key,
        clientKey,
        hash,
        input,
        before: null,
        after: charge,
        entryId: null,
        now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race: the same key (a replay — answer it) or a DIFFERENT key
      // for the same return (one charge per return, ever — report it).
      const replay = await replayOf(deps.db, key, hash);
      if (replay !== null) {
        return replay;
      }
      const winner = await deps.db.deliveryReturnCharge.findUnique({
        where: { returnId: input.returnId },
      });
      throw new ContractError(
        "conflict",
        "this return already has a fee charge",
        {
          returnId: input.returnId,
          charge: winner === null ? null : chargeView(winner),
        },
      );
    }
    throw error;
  }
}

// ── Capture ────────────────────────────────────────────────────────────────

/**
 * `reserved → captured`: posts the ONE capture entry (sender wallet → the
 * driver's wallet, the whole fee) and consumes the encumbrance in the same
 * transaction. A second capture under another key is an illegal transition,
 * never a second debit.
 */
export async function captureDeliveryReturnFee(
  deps: WalletDeps,
  input: DeliveryReturnChargeInput,
  clientKey: string,
): Promise<DeliveryReturnOutcome> {
  assertTerms(input);
  const now = deps.now();
  const key = scopedKey("capture", clientKey);
  const hash = termsHashOf("capture", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  let pre: ChargeRow;
  try {
    pre = await requireCharge(deps.db, input.returnId);
    assertSameTerms(pre, input);
    assertChargeTransition(pre, "captured");
  } catch (error) {
    return refuseUnlessReplay(deps.db, key, hash, error);
  }
  const senderWalletId = pre.walletId;
  if (senderWalletId === null) {
    // A reserved charge always names its wallet (CHECK constraint).
    throw new ContractError(
      "internal_error",
      "a reserved return charge is missing its wallet",
      { chargeId: pre.id },
    );
  }

  // Capture is never blocked by the vertical's kill switch; the city config
  // is read only to provision the driver's wallet in the charge's currency.
  const { city } = await deps.config.load(pre.cityId);
  if (city.currency !== pre.currency) {
    throw new ContractError(
      "config_unavailable",
      "the city's wallet currency no longer matches the reserved return fee",
      { cityCurrency: city.currency, chargeCurrency: pre.currency },
    );
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, senderWalletId);
      const charge = await lockCharge(tx, pre.id);
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      // Re-checked under both locks: a rival capture or release may have
      // committed while we waited.
      assertChargeTransition(charge, "captured");

      // The encumbrance ends as the fee is taken — exactly once: the
      // conditional update matches only an active reservation.
      const consumed = await tx.mpRiderReservation.updateMany({
        where: { id: charge.reservationId ?? "", status: "active" },
        data: { status: "consumed", resolvedAt: now },
      });
      if (consumed.count !== 1) {
        throw new ContractError(
          "internal_error",
          "a reserved return charge has no active reservation to consume",
          { chargeId: charge.id, reservationId: charge.reservationId },
        );
      }

      const feeMinor = fromDbMinor(charge.feeMinor);
      const senderWallet = await requireWallet(tx, senderWalletId);
      // The ordinary debit guard proves the wallet can pay now that its own
      // reservation no longer counts against it — a capture never overdraws,
      // and a failure rolls the consumption back with it.
      await assertSufficientFunds(
        tx,
        senderWallet,
        money(feeMinor, charge.currency),
      );
      const driverWallet = await ensureWallet(
        tx,
        "user",
        charge.driverId,
        city,
      );

      const ref = `delivery_return:${charge.returnId}`;
      const entry = await postEntry(tx, {
        kind: "delivery_return_fee",
        reference: ref,
        occurredAt: now,
        idempotencyKey: key,
        description: input.reason ?? "delivery return fee captured",
        lines: movement(
          { account: "wallet", walletId: senderWallet.id, counterpartRef: ref },
          { account: "wallet", walletId: driverWallet.id, counterpartRef: ref },
          feeMinor,
          charge.currency,
        ),
      });

      const after = await tx.deliveryReturnCharge.update({
        where: { id: charge.id },
        data: {
          state: "captured",
          captureEntryId: entry.id,
          capturedAt: now,
          version: { increment: 1 },
        },
      });

      return finishOp(tx, {
        op: "capture",
        key,
        clientKey,
        hash,
        input,
        before: charge,
        after,
        entryId: entry.id,
        now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await replayOf(deps.db, key, hash);
      if (replay !== null) {
        return replay;
      }
    }
    throw error;
  }
}

// ── Release ────────────────────────────────────────────────────────────────

/** The charge's recorded release, answered verbatim to a later release. */
async function originalRelease(
  db: LedgerTx,
  charge: ChargeRow,
): Promise<DeliveryReturnOutcome | null> {
  const op = await db.deliveryReturnChargeOp.findFirst({
    where: { chargeId: charge.id, op: "release" },
    orderBy: { createdAt: "asc" },
  });
  if (op === null) {
    return null;
  }
  return { result: op.result as DeliveryReturnOpResult, replayed: true };
}

/**
 * `reserved → released`, or a tombstone when nothing was ever reserved. No
 * journal entry — nothing moved at reserve, so nothing moves back; spendable
 * simply rises. Forgiving by design (see the module doc): compensation must
 * converge rather than error-loop. Releasing a captured fee is refused.
 */
export async function releaseDeliveryReturnFee(
  deps: WalletDeps,
  input: DeliveryReturnChargeInput,
  clientKey: string,
): Promise<DeliveryReturnOutcome> {
  assertTerms(input);
  const now = deps.now();
  const key = scopedKey("release", clientKey);
  const hash = termsHashOf("release", input);
  const reason = input.reason ?? "delivery_return_fee_released";

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  const pre = await deps.db.deliveryReturnCharge.findUnique({
    where: { returnId: input.returnId },
  });

  if (pre === null) {
    try {
      return await deps.db.$transaction(async (tx) => {
        const raced = await replayOf(tx, key, hash);
        if (raced !== null) {
          return raced;
        }
        // A tombstone: the caller released a return whose reserve outcome it
        // did not know, and nothing was reserved. Recording the release makes
        // any late reserve for this return a conflict, not a stranded hold.
        const tombstone = await tx.deliveryReturnCharge.create({
          data: {
            id: generateId("drc"),
            returnId: input.returnId,
            deliveryId: input.deliveryId,
            awardId: input.awardId,
            senderId: input.senderId,
            driverId: input.driverId,
            walletId: null,
            cityId: input.cityId,
            currency: input.currency,
            feeMinor: toDbMinor(input.feeMinor),
            state: "released",
            reservationId: null,
            releaseReason: reason,
            releasedAt: now,
          },
        });
        return finishOp(tx, {
          op: "release",
          key,
          clientKey,
          hash,
          input,
          before: null,
          after: tombstone,
          entryId: null,
          now,
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const replay = await replayOf(deps.db, key, hash);
      if (replay !== null) {
        return replay;
      }
      // A reserve committed between our read and our insert: release that.
      return releaseExisting(deps, input, clientKey, key, hash, reason, now);
    }
  }

  return releaseExisting(deps, input, clientKey, key, hash, reason, now);
}

async function releaseExisting(
  deps: WalletDeps,
  input: DeliveryReturnChargeInput,
  clientKey: string,
  key: string,
  hash: string,
  reason: string,
  now: Date,
): Promise<DeliveryReturnOutcome> {
  let pre: ChargeRow;
  try {
    pre = await requireCharge(deps.db, input.returnId);
    assertSameTerms(pre, input);
    if (stateOf(pre) === "captured") {
      assertChargeTransition(pre, "released");
    }
  } catch (error) {
    return refuseUnlessReplay(deps.db, key, hash, error);
  }
  if (stateOf(pre) === "released") {
    const original = await originalRelease(deps.db, pre);
    if (original !== null) {
      return original;
    }
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      if (pre.walletId !== null) {
        await lockWallet(tx, pre.walletId);
      }
      const charge = await lockCharge(tx, pre.id);
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      if (stateOf(charge) === "released") {
        const original = await originalRelease(tx, charge);
        if (original !== null) {
          return original;
        }
      }
      assertChargeTransition(charge, "released");

      const released = await tx.mpRiderReservation.updateMany({
        where: { id: charge.reservationId ?? "", status: "active" },
        data: { status: "released", reason, resolvedAt: now },
      });
      if (released.count !== 1) {
        throw new ContractError(
          "internal_error",
          "a reserved return charge has no active reservation to release",
          { chargeId: charge.id, reservationId: charge.reservationId },
        );
      }

      const after = await tx.deliveryReturnCharge.update({
        where: { id: charge.id },
        data: {
          state: "released",
          releaseReason: reason,
          releasedAt: now,
          version: { increment: 1 },
        },
      });

      return finishOp(tx, {
        op: "release",
        key,
        clientKey,
        hash,
        input,
        before: charge,
        after,
        entryId: null,
        now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await replayOf(deps.db, key, hash);
      if (replay !== null) {
        return replay;
      }
    }
    throw error;
  }
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * The charge as it stands now, with every op recorded against it. A caller
 * whose POST timed out reads this to learn whether its op happened — or
 * replays the same Idempotency-Key, which answers the original result.
 */
export async function deliveryReturnStatus(
  db: LedgerDb,
  returnId: string,
): Promise<DeliveryReturnStatusView> {
  const row = await db.deliveryReturnCharge.findUnique({
    where: { returnId },
    include: { ops: { orderBy: { createdAt: "asc" } } },
  });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this delivery return has no fee charge",
      { returnId },
    );
  }
  return { charge: chargeView(row), ops: row.ops.map(opView) };
}
