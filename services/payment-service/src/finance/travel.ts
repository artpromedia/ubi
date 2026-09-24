/**
 * Supplier travel payments on the canonical ledger (P7, recheck T02).
 *
 * travel-service runs a per-item ladder (its ops/checkout.ts): authorize a
 * hold for exactly the revalidated price, ask the supplier to book, then
 * capture on a confirmed booking or release on a failed one, and refund on
 * cancellation. Its payment port (services/travel-service/src/ports/
 * payment-port.ts) posts to `/v1/finance/travel/{op}` by default, served by
 * ./travel-routes.ts over this module. The rules:
 *
 *  - ONE item per travel order (travel-service creates one order per cart
 *    item), keyed on the order id: one authorization per item, ever;
 *  - authorize is a durable ENCUMBRANCE, not a journal movement — a
 *    `travel_payment_items` row in `authorized` that every spendable check
 *    subtracts (ledger/balances.ts), exactly like a commission hold or a rider
 *    funding reservation. The cleared balance does not move;
 *  - capture posts ONE entry (traveller wallet → `travel_clearing`) and ends
 *    the encumbrance in the same transaction; release ends it without moving
 *    money; refund posts a LINKED counter-entry (`travel_clearing` → wallet)
 *    whose counterpart reference names the capture entry — the capture is
 *    never edited, and refunds can never exceed it;
 *  - supplier travel never touches a marketplace commission hold,
 *    `ubi_commission` or a ride account: the 10% driver commission is a
 *    marketplace rule, not a travel one, and the traveller's funding is its
 *    own row;
 *  - every POST is idempotent on its scoped Idempotency-Key: a replay answers
 *    the original result verbatim, and a replay carrying different money
 *    terms is `idempotency_key_reuse` (409). The free-text `reason` is
 *    descriptive and does not take part in that comparison;
 *  - the item state machine is closed (TRANSITIONS below). An illegal move —
 *    capture after release, a second capture, refund of an unsettled item — is
 *    `illegal_transition` (409) and a refund beyond what was captured is a
 *    `conflict` (409); both carry the item as it stands so the caller can
 *    reconcile. `travelPaymentStatus` answers the same view on demand, for a
 *    caller whose request timed out and does not know what happened;
 *  - every transition writes its audit row and outbox event in the same
 *    transaction as the state change;
 *  - a NEW authorization is deny-by-default: it needs a travel booking
 *    vertical (`flights_booking` or `stays_booking`) switched on in the city.
 *    Capture, release and refund of an EXISTING item are never blocked by that
 *    switch — a kill switch stops new commitments, it must not strand a
 *    traveller's money.
 *
 * The endpoint is service-to-service: travel-service authenticates with the
 * internal service key, so the audited actor is the travel service itself.
 * Whoever the travel service says it acted for is recorded beside it as
 * context (`onBehalfOf`), verified only when a gateway-signed identity came
 * with the request.
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

import type { Actor, JsonRecord, LedgerDb, LedgerTx } from "../ledger/types";

export const TRAVEL_ITEM_STATES = [
  "authorized",
  "captured",
  "released",
  "partially_refunded",
  "refunded",
] as const;

export type TravelItemState = (typeof TRAVEL_ITEM_STATES)[number];

export const TRAVEL_PAYMENT_OPS = [
  "authorize",
  "capture",
  "release",
  "refund",
] as const;

export type TravelPaymentOpName = (typeof TRAVEL_PAYMENT_OPS)[number];

/**
 * The closed item machine. `released` and `refunded` are terminal; a partial
 * refund may be followed by further refunds until the capture is used up.
 */
const TRANSITIONS: Readonly<
  Record<TravelItemState, readonly TravelItemState[]>
> = {
  authorized: ["captured", "released"],
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  released: [],
  refunded: [],
};

/** The authenticated principal: the endpoint is service-to-service. */
export const TRAVEL_SERVICE_ACTOR: Actor = {
  id: "travel-service",
  role: "service",
};

/**
 * The outbox names these transitions publish under. The event catalog has no
 * dedicated travel-payment names yet, so each op uses the catalog's generic
 * payment-service name for the same kind of movement, disambiguated by
 * `aggregateType: "travel_payment"` — the same convention marketplace
 * settlement uses with `transfer.posted` (catalog-additions.md, G15).
 */
const OP_EVENT: Readonly<Record<TravelPaymentOpName, EventName>> = {
  authorize: "transfer.held",
  capture: "transfer.posted",
  release: "payment.auth_released",
  refund: "refund.posted",
};

const OP_AUDIT_ACTION: Readonly<Record<TravelPaymentOpName, string>> = {
  authorize: "finance.travel.authorized",
  capture: "finance.travel.captured",
  release: "finance.travel.released",
  refund: "finance.travel.refunded",
};

const AGGREGATE_TYPE = "travel_payment";

/** Who the calling service said it acted for. Context, not authentication. */
export interface OnBehalfOf {
  readonly id: string;
  readonly role: string;
  /** True only when a gateway-signed identity context verified it. */
  readonly verified: boolean;
}

export interface TravelPaymentInput {
  readonly orderId: string;
  /** The traveller whose wallet funds the item. */
  readonly userId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly cityId: string;
  readonly reason: string | null;
  readonly onBehalfOf: OnBehalfOf | null;
}

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export type TravelPaymentItemView = {
  readonly itemId: string;
  readonly orderId: string;
  readonly userId: string;
  readonly walletId: string;
  readonly cityId: string;
  readonly state: TravelItemState;
  readonly authorized: MoneyView;
  readonly captured: MoneyView;
  readonly refunded: MoneyView;
  /** What a refund may still return: captured − refunded. */
  readonly refundable: MoneyView;
  /** What the item still encumbers: the authorization while `authorized`, else zero. */
  readonly encumbered: MoneyView;
  readonly captureEntryId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly capturedAt: string | null;
  readonly releasedAt: string | null;
};

/** What an op answers, and what a replay of it answers verbatim. */
export type TravelPaymentOpResult = {
  /** payment-service's id for this authorization / capture / release / refund. */
  readonly ref: string;
  readonly op: TravelPaymentOpName;
  readonly itemId: string;
  readonly orderId: string;
  /** The journal entry the op posted; null for authorize and release. */
  readonly entryId: string | null;
  readonly amount: MoneyView;
  /** The item's state right after this op. */
  readonly state: TravelItemState;
  /** The item as this op left it (a snapshot — read the status for "now"). */
  readonly item: TravelPaymentItemView;
};

export interface TravelPaymentOutcome {
  readonly result: TravelPaymentOpResult;
  readonly replayed: boolean;
}

export type TravelPaymentOpView = {
  readonly ref: string;
  readonly op: TravelPaymentOpName;
  /** The Idempotency-Key exactly as the caller sent it. */
  readonly clientKey: string;
  readonly amount: MoneyView;
  readonly entryId: string | null;
  readonly onBehalfOf: { readonly id: string; readonly role: string } | null;
  readonly createdAt: string;
};

export interface TravelPaymentStatusView {
  readonly item: TravelPaymentItemView;
  readonly ops: readonly TravelPaymentOpView[];
}

/** The row shape Prisma hands back for `travel_payment_items`. */
interface ItemRow {
  readonly id: string;
  readonly orderId: string;
  readonly userId: string;
  readonly walletId: string;
  readonly cityId: string;
  readonly currency: string;
  readonly state: string;
  readonly authorizedMinor: bigint;
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
  readonly captureEntryId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly capturedAt: Date | null;
  readonly releasedAt: Date | null;
}

interface OpRow {
  readonly id: string;
  readonly op: string;
  readonly clientKey: string;
  readonly payloadHash: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly entryId: string | null;
  readonly onBehalfOfId: string | null;
  readonly onBehalfOfRole: string | null;
  readonly result: unknown;
  readonly createdAt: Date;
}

function isItemState(value: string): value is TravelItemState {
  return (TRAVEL_ITEM_STATES as readonly string[]).includes(value);
}

function isOpName(value: string): value is TravelPaymentOpName {
  return (TRAVEL_PAYMENT_OPS as readonly string[]).includes(value);
}

function stateOf(row: ItemRow): TravelItemState {
  if (!isItemState(row.state)) {
    // The CHECK constraint makes this unreachable; kept so a widened state set
    // fails loudly here instead of answering an unknown state.
    throw new ContractError(
      "internal_error",
      "travel payment item is in an unknown state",
      { itemId: row.id, state: row.state },
    );
  }
  return row.state;
}

export function itemView(row: ItemRow): TravelPaymentItemView {
  const state = stateOf(row);
  const authorized = fromDbMinor(row.authorizedMinor);
  const captured = fromDbMinor(row.capturedMinor);
  const refunded = fromDbMinor(row.refundedMinor);
  return {
    itemId: row.id,
    orderId: row.orderId,
    userId: row.userId,
    walletId: row.walletId,
    cityId: row.cityId,
    state,
    authorized: money(authorized, row.currency),
    captured: money(captured, row.currency),
    refunded: money(refunded, row.currency),
    refundable: money(captured - refunded, row.currency),
    encumbered: money(state === "authorized" ? authorized : 0, row.currency),
    captureEntryId: row.captureEntryId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    capturedAt: row.capturedAt === null ? null : row.capturedAt.toISOString(),
    releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
  };
}

function opView(row: OpRow): TravelPaymentOpView {
  if (!isOpName(row.op)) {
    throw new ContractError(
      "internal_error",
      "travel payment op has an unknown kind",
      { ref: row.id, op: row.op },
    );
  }
  return {
    ref: row.id,
    op: row.op,
    clientKey: row.clientKey,
    amount: money(fromDbMinor(row.amountMinor), row.currency),
    entryId: row.entryId,
    onBehalfOf:
      row.onBehalfOfId === null
        ? null
        : { id: row.onBehalfOfId, role: row.onBehalfOfRole ?? "unknown" },
    createdAt: row.createdAt.toISOString(),
  };
}

function scopedKey(op: TravelPaymentOpName, clientKey: string): string {
  return scopedIdempotencyKey(
    `finance.travel.${op}`,
    TRAVEL_SERVICE_ACTOR.id,
    clientKey,
  );
}

/** The money terms a replay must repeat. `reason` is descriptive and excluded. */
function termsHashOf(op: TravelPaymentOpName, input: TravelPaymentInput) {
  return payloadHashOf({
    op,
    orderId: input.orderId,
    userId: input.userId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    cityId: input.cityId,
  });
}

function assertMoneyTerms(input: TravelPaymentInput): void {
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor <= 0 ||
    !/^[A-Z]{3}$/.test(input.currency)
  ) {
    throw new ContractError(
      "validation_failed",
      "a travel payment needs a positive integer amount in minor units and an explicit ISO currency",
      { amountMinor: input.amountMinor, currency: input.currency },
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
): Promise<TravelPaymentOutcome | null> {
  const op = await db.travelPaymentOp.findUnique({
    where: { idempotencyKey: key },
  });
  if (op === null) {
    return null;
  }
  if (op.payloadHash !== hash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this idempotency key was already used with different payment terms",
      { ref: op.id, op: op.op },
    );
  }
  return { result: op.result as TravelPaymentOpResult, replayed: true };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * The losing side of a same-key race: a unique index refused our insert, and
 * the winner's recorded op is the answer (CLAUDE.md #3 — including when the
 * original attempt was still in flight when we arrived).
 */
async function replayAfterRace(
  db: LedgerDb,
  error: unknown,
  key: string,
  hash: string,
): Promise<TravelPaymentOutcome | null> {
  if (!isUniqueViolation(error)) {
    return null;
  }
  const replay = await replayOf(db, key, hash);
  return replay;
}

/**
 * The unlocked fast-path checks (item exists, same party, legal transition,
 * amount bounds) run BEFORE any lock, so a same-key retry racing its own
 * original can read the state the original just committed — `captured`,
 * `released`, `refunded`, or an authorization that already exists — and would
 * be refused as illegal although it is a replay. Before refusing, look for the
 * original once more: when this key already recorded the op, its result is the
 * answer (CLAUDE.md #3), never a 409.
 */
async function refuseUnlessReplay(
  db: LedgerTx,
  key: string,
  hash: string,
  error: unknown,
): Promise<TravelPaymentOutcome> {
  const replay = await replayOf(db, key, hash);
  if (replay !== null) {
    return replay;
  }
  throw error;
}

async function requireItemByOrder(
  db: LedgerTx,
  orderId: string,
): Promise<ItemRow> {
  const row = await db.travelPaymentItem.findUnique({ where: { orderId } });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this travel order has no payment authorization",
      { orderId },
    );
  }
  return row;
}

/**
 * Locks the item row for the rest of the transaction. Every path that also
 * needs the wallet row locks the WALLET FIRST (capture, refund), so the lock
 * order is the same everywhere and two ops on one item cannot deadlock.
 */
async function lockItem(tx: LedgerTx, itemId: string): Promise<ItemRow> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM travel_payment_items WHERE id = ${itemId} FOR UPDATE
  `;
  const row = await tx.travelPaymentItem.findUnique({ where: { id: itemId } });
  if (row === null) {
    throw new ContractError("not_found", "travel payment item not found", {
      itemId,
    });
  }
  return row;
}

/** A capture, release or refund must name the item's own traveller, currency and city. */
function assertSameParty(row: ItemRow, input: TravelPaymentInput): void {
  if (
    row.userId !== input.userId ||
    row.currency !== input.currency ||
    row.cityId !== input.cityId
  ) {
    throw new ContractError(
      "conflict",
      "this request does not match the order's payment authorization",
      {
        orderId: row.orderId,
        itemUserMatches: row.userId === input.userId,
        itemCurrency: row.currency,
        requestCurrency: input.currency,
        itemCityMatches: row.cityId === input.cityId,
      },
    );
  }
}

function assertItemTransition(row: ItemRow, to: TravelItemState): void {
  const from = stateOf(row);
  if (!TRANSITIONS[from].includes(to)) {
    throw new ContractError(
      "illegal_transition",
      `a travel payment item cannot move from ${from} to ${to}`,
      { orderId: row.orderId, from, to, item: itemView(row) },
    );
  }
}

function assertCaptureWithinAuthorization(
  row: ItemRow,
  amountMinor: number,
): void {
  const authorized = fromDbMinor(row.authorizedMinor);
  if (amountMinor > authorized) {
    throw new ContractError(
      "conflict",
      "a capture cannot exceed the authorized amount",
      {
        orderId: row.orderId,
        authorizedMinor: authorized,
        requestedMinor: amountMinor,
      },
    );
  }
}

/** A release frees the WHOLE unused authorization; its amount must say so. */
function assertReleasesAuthorization(row: ItemRow, amountMinor: number): void {
  const authorized = fromDbMinor(row.authorizedMinor);
  if (amountMinor !== authorized) {
    throw new ContractError(
      "conflict",
      "a release must name the authorized amount it frees",
      {
        orderId: row.orderId,
        authorizedMinor: authorized,
        requestedMinor: amountMinor,
      },
    );
  }
}

function assertRefundable(row: ItemRow, amountMinor: number): void {
  // Both captured and partially_refunded may move to refunded; nothing else
  // may be refunded at all.
  assertItemTransition(row, "refunded");
  const captured = fromDbMinor(row.capturedMinor);
  const refunded = fromDbMinor(row.refundedMinor);
  if (amountMinor > captured - refunded) {
    throw new ContractError(
      "conflict",
      "a refund cannot exceed what was captured and not yet refunded",
      {
        orderId: row.orderId,
        capturedMinor: captured,
        refundedMinor: refunded,
        refundableMinor: captured - refunded,
        requestedMinor: amountMinor,
      },
    );
  }
}

/**
 * New travel money commitments need a travel booking vertical on in the city
 * (CLAUDE.md #5, deny-by-default). No new flag: the same switches that gate
 * travel search gate the money behind it.
 */
function assertTravelPaymentsEnabled(flags: FlagSet, cityId: string): void {
  if (
    !isEnabled(flags, "flights_booking") &&
    !isEnabled(flags, "stays_booking")
  ) {
    throw new ContractError(
      "feature_disabled",
      "travel payments are not enabled in this city",
      { cityId, requires: ["flights_booking", "stays_booking"] },
    );
  }
}

function onBehalfOfJson(input: TravelPaymentInput): JsonRecord | null {
  if (input.onBehalfOf === null) {
    return null;
  }
  return {
    id: input.onBehalfOf.id,
    role: input.onBehalfOf.role,
    verified: input.onBehalfOf.verified,
  };
}

interface FinishOpArgs {
  readonly op: TravelPaymentOpName;
  readonly key: string;
  readonly clientKey: string;
  readonly hash: string;
  readonly input: TravelPaymentInput;
  readonly before: ItemRow | null;
  readonly after: ItemRow;
  readonly amountMinor: number;
  readonly entryId: string | null;
  readonly now: Date;
}

/**
 * Records the op (the idempotency row carrying the response a replay will
 * answer), its audit row and its outbox event — inside the caller's
 * transaction, so none of them can exist without the state change or vice
 * versa (CLAUDE.md #2).
 */
async function finishOp(
  tx: LedgerTx,
  args: FinishOpArgs,
): Promise<TravelPaymentOutcome> {
  const ref = generateId("tpo");
  const item = itemView(args.after);
  const result: TravelPaymentOpResult = {
    ref,
    op: args.op,
    itemId: args.after.id,
    orderId: args.after.orderId,
    entryId: args.entryId,
    amount: money(args.amountMinor, args.after.currency),
    state: item.state,
    item,
  };

  await tx.travelPaymentOp.create({
    data: {
      id: ref,
      itemId: args.after.id,
      op: args.op,
      idempotencyKey: args.key,
      clientKey: args.clientKey,
      payloadHash: args.hash,
      amountMinor: toDbMinor(args.amountMinor),
      currency: args.after.currency,
      entryId: args.entryId,
      onBehalfOfId: args.input.onBehalfOf?.id ?? null,
      onBehalfOfRole: args.input.onBehalfOf?.role ?? null,
      reason: args.input.reason,
      result,
    },
  });

  await writeAudit(tx, {
    actor: TRAVEL_SERVICE_ACTOR,
    action: OP_AUDIT_ACTION[args.op],
    subjectType: AGGREGATE_TYPE,
    subjectId: args.after.id,
    before:
      args.before === null
        ? null
        : {
            state: args.before.state,
            capturedMinor: fromDbMinor(args.before.capturedMinor),
            refundedMinor: fromDbMinor(args.before.refundedMinor),
          },
    after: {
      state: item.state,
      orderId: args.after.orderId,
      opRef: ref,
      entryId: args.entryId,
      amountMinor: args.amountMinor,
      currency: args.after.currency,
      authorizedMinor: item.authorized.amountMinor,
      capturedMinor: item.captured.amountMinor,
      refundedMinor: item.refunded.amountMinor,
      onBehalfOf: onBehalfOfJson(args.input),
    },
    reason: args.input.reason,
  });

  await publishEvent(tx, {
    name: OP_EVENT[args.op],
    aggregateType: AGGREGATE_TYPE,
    aggregateId: args.after.id,
    fromVersion: args.before === null ? null : args.before.version,
    toVersion: args.after.version,
    actor: TRAVEL_SERVICE_ACTOR,
    actorType: "service",
    cityId: args.after.cityId,
    idempotencyKey: `${args.key}:${args.op}`,
    occurredAt: args.now,
    // Ids and amounts only — never PII (CLAUDE.md #12).
    payload: {
      itemId: args.after.id,
      orderId: args.after.orderId,
      op: args.op,
      opRef: ref,
      walletId: args.after.walletId,
      state: item.state,
      amountMinor: args.amountMinor,
      currency: args.after.currency,
      entryId: args.entryId,
    },
  });

  return { result, replayed: false };
}

// ── Authorize ──────────────────────────────────────────────────────────────

/**
 * Reserves the traveller's funds for one travel order item: a durable
 * `authorized` row, checked against spendable under the wallet lock. No money
 * moves; spendable drops by the amount until capture or release.
 */
export async function authorizeTravelItem(
  deps: WalletDeps,
  input: TravelPaymentInput,
  clientKey: string,
): Promise<TravelPaymentOutcome> {
  assertMoneyTerms(input);
  const now = deps.now();
  const key = scopedKey("authorize", clientKey);
  const hash = termsHashOf("authorize", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  const { city, flags } = await deps.config.load(input.cityId);
  if (city.currency !== input.currency) {
    throw new ContractError(
      "validation_failed",
      "the travel payment currency does not match the city's wallet currency",
      { currency: input.currency, cityCurrency: city.currency },
    );
  }
  assertTravelPaymentsEnabled(flags, input.cityId);
  if (!paymentMethodAvailable(city, "wallet")) {
    throw new ContractError(
      "payment_method_unavailable",
      "wallet payment is not available in this city",
      { paymentMethodId: "wallet" },
    );
  }

  const existing = await deps.db.travelPaymentItem.findUnique({
    where: { orderId: input.orderId },
  });
  if (existing !== null) {
    return refuseUnlessReplay(
      deps.db,
      key,
      hash,
      new ContractError(
        "conflict",
        "this travel order already has a payment authorization",
        { orderId: input.orderId, item: itemView(existing) },
      ),
    );
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const wallet = await ensureWallet(tx, "user", input.userId, city);
      assertNotLocked(wallet);
      assertNotSafeMode(wallet, now);
      await lockWallet(tx, wallet.id);

      // Re-read under the wallet lock: a rival authorize may have committed
      // while we waited on the row.
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      const rival = await tx.travelPaymentItem.findUnique({
        where: { orderId: input.orderId },
      });
      if (rival !== null) {
        throw new ContractError(
          "conflict",
          "this travel order already has a payment authorization",
          { orderId: input.orderId, item: itemView(rival) },
        );
      }

      // The one spendable guard every debit path uses: cleared balance minus
      // every live encumbrance (holds, rider reservations, travel items).
      await assertSufficientFunds(
        tx,
        wallet,
        money(input.amountMinor, wallet.currency),
      );

      const item = await tx.travelPaymentItem.create({
        data: {
          id: generateId("tpi"),
          orderId: input.orderId,
          userId: input.userId,
          walletId: wallet.id,
          cityId: input.cityId,
          currency: wallet.currency,
          state: "authorized",
          authorizedMinor: toDbMinor(input.amountMinor),
        },
      });

      return finishOp(tx, {
        op: "authorize",
        key,
        clientKey,
        hash,
        input,
        before: null,
        after: item,
        amountMinor: input.amountMinor,
        entryId: null,
        now,
      });
    });
  } catch (error) {
    const replay = await replayAfterRace(deps.db, error, key, hash);
    if (replay !== null) {
      return replay;
    }
    if (isUniqueViolation(error)) {
      // Lost the per-order race to a DIFFERENT key: one authorization per
      // item, ever — the winner's item is reported, never a second hold.
      const winner = await deps.db.travelPaymentItem.findUnique({
        where: { orderId: input.orderId },
      });
      if (winner !== null) {
        throw new ContractError(
          "conflict",
          "this travel order already has a payment authorization",
          { orderId: input.orderId, item: itemView(winner) },
        );
      }
    }
    throw error;
  }
}

// ── Capture ────────────────────────────────────────────────────────────────

/**
 * `authorized → captured`: posts the ONE capture entry (traveller wallet →
 * travel_clearing) for at most the authorized amount and ends the
 * encumbrance in the same transaction. A second capture — under any key other
 * than the first one's — is an illegal transition, never a second debit.
 */
export async function captureTravelItem(
  deps: WalletDeps,
  input: TravelPaymentInput,
  clientKey: string,
): Promise<TravelPaymentOutcome> {
  assertMoneyTerms(input);
  const now = deps.now();
  const key = scopedKey("capture", clientKey);
  const hash = termsHashOf("capture", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  let pre: ItemRow;
  try {
    pre = await requireItemByOrder(deps.db, input.orderId);
    assertSameParty(pre, input);
    assertItemTransition(pre, "captured");
    assertCaptureWithinAuthorization(pre, input.amountMinor);
  } catch (error) {
    return refuseUnlessReplay(deps.db, key, hash, error);
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, pre.walletId);
      const item = await lockItem(tx, pre.id);
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      // Re-checked under both locks: a rival capture or release may have
      // committed while we waited.
      assertItemTransition(item, "captured");
      assertCaptureWithinAuthorization(item, input.amountMinor);

      // The item stops encumbering the wallet as it is captured; the ordinary
      // debit guard then proves the wallet can pay — a capture never
      // overdraws, and a failure rolls the state change back with it.
      await tx.travelPaymentItem.update({
        where: { id: item.id },
        data: {
          state: "captured",
          capturedMinor: toDbMinor(input.amountMinor),
          capturedAt: now,
          version: { increment: 1 },
        },
      });
      const wallet = await requireWallet(tx, item.walletId);
      await assertSufficientFunds(
        tx,
        wallet,
        money(input.amountMinor, item.currency),
      );

      const orderRef = `travel_order:${item.orderId}`;
      const entry = await postEntry(tx, {
        kind: "travel_capture",
        reference: orderRef,
        occurredAt: now,
        idempotencyKey: key,
        description: input.reason ?? "travel order item captured",
        lines: movement(
          {
            account: "wallet",
            walletId: item.walletId,
            counterpartRef: orderRef,
          },
          { account: "travel_clearing", counterpartRef: orderRef },
          input.amountMinor,
          item.currency,
        ),
      });
      const after = await tx.travelPaymentItem.update({
        where: { id: item.id },
        data: { captureEntryId: entry.id },
      });

      return finishOp(tx, {
        op: "capture",
        key,
        clientKey,
        hash,
        input,
        before: item,
        after,
        amountMinor: input.amountMinor,
        entryId: entry.id,
        now,
      });
    });
  } catch (error) {
    const replay = await replayAfterRace(deps.db, error, key, hash);
    if (replay !== null) {
      return replay;
    }
    throw error;
  }
}

// ── Release ────────────────────────────────────────────────────────────────

/**
 * `authorized → released`: frees an unused authorization. No journal entry —
 * nothing moved at authorize, so nothing moves back; spendable simply rises.
 */
export async function releaseTravelItem(
  deps: WalletDeps,
  input: TravelPaymentInput,
  clientKey: string,
): Promise<TravelPaymentOutcome> {
  assertMoneyTerms(input);
  const now = deps.now();
  const key = scopedKey("release", clientKey);
  const hash = termsHashOf("release", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  let pre: ItemRow;
  try {
    pre = await requireItemByOrder(deps.db, input.orderId);
    assertSameParty(pre, input);
    assertItemTransition(pre, "released");
    assertReleasesAuthorization(pre, input.amountMinor);
  } catch (error) {
    return refuseUnlessReplay(deps.db, key, hash, error);
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const item = await lockItem(tx, pre.id);
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      assertItemTransition(item, "released");

      const after = await tx.travelPaymentItem.update({
        where: { id: item.id },
        data: {
          state: "released",
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
        before: item,
        after,
        amountMinor: fromDbMinor(item.authorizedMinor),
        entryId: null,
        now,
      });
    });
  } catch (error) {
    const replay = await replayAfterRace(deps.db, error, key, hash);
    if (replay !== null) {
      return replay;
    }
    throw error;
  }
}

// ── Refund ─────────────────────────────────────────────────────────────────

/**
 * `captured | partially_refunded → partially_refunded | refunded`: returns up
 * to what was captured and not yet refunded with a LINKED counter-entry
 * (travel_clearing → traveller wallet). Both lines carry
 * `travel_capture:<capture entry id>` as their counterpart, so every refund
 * traces back to the capture it reverses; the capture itself is never edited.
 */
export async function refundTravelItem(
  deps: WalletDeps,
  input: TravelPaymentInput,
  clientKey: string,
): Promise<TravelPaymentOutcome> {
  assertMoneyTerms(input);
  const now = deps.now();
  const key = scopedKey("refund", clientKey);
  const hash = termsHashOf("refund", input);

  const prior = await replayOf(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }

  let pre: ItemRow;
  try {
    pre = await requireItemByOrder(deps.db, input.orderId);
    assertSameParty(pre, input);
    assertRefundable(pre, input.amountMinor);
  } catch (error) {
    return refuseUnlessReplay(deps.db, key, hash, error);
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      // Wallet first, then item: the same lock order as capture.
      await lockWallet(tx, pre.walletId);
      const item = await lockItem(tx, pre.id);
      const raced = await replayOf(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      assertRefundable(item, input.amountMinor);
      if (item.captureEntryId === null) {
        throw new ContractError(
          "internal_error",
          "a captured travel item is missing its capture entry",
          { itemId: item.id },
        );
      }

      const captured = fromDbMinor(item.capturedMinor);
      const refundedAfter = fromDbMinor(item.refundedMinor) + input.amountMinor;
      const next: TravelItemState =
        refundedAfter === captured ? "refunded" : "partially_refunded";
      assertItemTransition(item, next);

      const link = `travel_capture:${item.captureEntryId}`;
      const entry = await postEntry(tx, {
        kind: "travel_refund",
        reference: `travel_order:${item.orderId}:refund`,
        occurredAt: now,
        idempotencyKey: key,
        description: input.reason ?? "travel order item refunded",
        lines: movement(
          { account: "travel_clearing", counterpartRef: link },
          { account: "wallet", walletId: item.walletId, counterpartRef: link },
          input.amountMinor,
          item.currency,
        ),
      });

      const after = await tx.travelPaymentItem.update({
        where: { id: item.id },
        data: {
          state: next,
          refundedMinor: toDbMinor(refundedAfter),
          version: { increment: 1 },
        },
      });

      return finishOp(tx, {
        op: "refund",
        key,
        clientKey,
        hash,
        input,
        before: item,
        after,
        amountMinor: input.amountMinor,
        entryId: entry.id,
        now,
      });
    });
  } catch (error) {
    const replay = await replayAfterRace(deps.db, error, key, hash);
    if (replay !== null) {
      return replay;
    }
    throw error;
  }
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * The item as it stands now, with every op recorded against it (and the key
 * each arrived under). A caller whose POST timed out reads this to learn
 * whether its op happened instead of guessing — or simply replays the same
 * Idempotency-Key, which answers the original result.
 */
export async function travelPaymentStatus(
  deps: WalletDeps,
  orderId: string,
): Promise<TravelPaymentStatusView> {
  const row = await deps.db.travelPaymentItem.findUnique({
    where: { orderId },
    include: { ops: { orderBy: { createdAt: "asc" } } },
  });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this travel order has no payment authorization",
      { orderId },
    );
  }
  return { item: itemView(row), ops: row.ops.map(opView) };
}
