/**
 * Reading and cancelling a single travel order.
 *
 * Cancellation is per item, never across the trip (CLAUDE.md #25): cancelling a
 * flight leaves the hotel booked. The supplier's cancel policy decides the
 * penalty; the refund is the charged amount less that penalty, and it is tracked
 * on its own ladder (`travelRefund`) rather than paid out instantly. A PNR that
 * is only `confirmed` and a `ticketed` order are both cancellable; an order that
 * never got past `unknown_reconciling` is not — it must be reconciled first.
 *
 * PENALTIES ARE SURFACED BEFORE ANYTHING IS CANCELLED. The supplier's live
 * terms are quoted first (`quoteCancel`: a Duffel pending cancellation, a
 * LiteAPI policy read); a non-zero penalty cancels only when the traveller
 * sends back exactly that penalty as `acceptedPenalty`. Otherwise the answer
 * is a 409 carrying the quote, and nothing is cancelled.
 */
import {
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { escalate } from "./converge";
import {
  advanceOrder,
  orderView,
  type OrderRow,
  type OrderView,
} from "./ladder";
import { withOutbox } from "./outbox";
import { buildRefundRequest, refundView, type RefundView } from "./refunds";
import { actorTypeFor, isOpsRole } from "./roles";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";

import type { TravelDeps } from "./context";
import type { Actor, JsonValue } from "./types";

function assertMayRead(
  actor: Actor,
  order: { userId: string; id: string },
): void {
  if (order.userId === actor.id || isOpsRole(actor.role)) {
    return;
  }
  // A traveller may not even learn that another traveller's order exists.
  throw new ContractError("not_found", "no such order", { orderId: order.id });
}

export async function getOrder(
  deps: TravelDeps,
  actor: Actor,
  orderId: string,
): Promise<OrderView> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: orderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  assertMayRead(actor, order);
  return orderView(order as unknown as OrderRow);
}

const CANCELLABLE = new Set(["confirmed", "ticketed"]);

export interface CancellationQuoteView {
  readonly orderId: string;
  readonly penalty: Money;
  readonly refundable: Money;
  readonly quoteRef: string | null;
  readonly expiresAt: string | null;
  readonly refundTo: string | null;
  /** True when cancelling needs `acceptedPenalty` equal to `penalty`. */
  readonly consentRequired: boolean;
}

/** The supplier's live cancellation terms for an order, without cancelling it. */
export async function getCancellationQuote(
  deps: TravelDeps,
  actor: Actor,
  orderId: string,
): Promise<CancellationQuoteView> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: orderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  assertMayRead(actor, order);
  if (!CANCELLABLE.has(order.state)) {
    throw new ContractError(
      "conflict",
      "this order is not in a cancellable state",
      {
        orderId,
        state: order.state,
      },
    );
  }
  const supplier = await loadSupplier(deps.db, order.supplierId);
  const adapter = adapterFor(supplier);
  if (adapter.quoteCancel === undefined) {
    throw new ContractError(
      "conflict",
      "this supplier cannot quote cancellation terms in advance",
      { orderId, capability: "quoteCancel", supported: false },
    );
  }
  const quote = await adapter.quoteCancel(contextFor(supplier, deps.now), {
    ourRef: order.id,
    supplierRefs: jsonRefs(order.supplierRefs),
    idempotencyKey: `travel.cancel-quote:${order.id}`,
  });
  return quoteView(order.id, order.currency, quote);
}

function quoteView(
  orderId: string,
  currency: string,
  quote: {
    readonly penalty: Money;
    readonly refundable: Money;
    readonly quoteRef: string | null;
    readonly expiresAt: string | null;
    readonly refundTo: string | null;
  },
): CancellationQuoteView {
  if (
    quote.penalty.currency !== currency ||
    quote.refundable.currency !== currency
  ) {
    // Never convert: terms in another currency cannot be applied to this charge.
    throw new ContractError(
      "conflict",
      "the supplier's cancellation terms are not in this order's currency",
      {
        orderId,
        orderCurrency: currency,
        quoteCurrency: quote.penalty.currency,
      },
    );
  }
  return {
    orderId,
    penalty: quote.penalty,
    refundable: quote.refundable,
    quoteRef: quote.quoteRef,
    expiresAt: quote.expiresAt,
    refundTo: quote.refundTo,
    consentRequired: quote.penalty.amountMinor > 0,
  };
}

export async function cancelOrder(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string | null;
    /** The penalty the traveller agreed to after seeing the quote. */
    readonly acceptedPenalty?: Money | null;
  },
): Promise<RefundView> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: input.orderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", {
      orderId: input.orderId,
    });
  }
  assertMayRead(input.actor, order);

  const scoped = scopedIdempotencyKey(
    `travel.cancel:${input.orderId}`,
    input.actor.id,
    input.idempotencyKey,
  );

  // Replay: the order is already cancelled and a refund exists.
  if (order.state === "cancelled" || order.state === "refunded") {
    const existing = await deps.db.travelRefund.findFirst({
      where: { orderId: input.orderId },
      orderBy: { createdAt: "asc" },
    });
    if (existing !== null) {
      return refundView(existing);
    }
  }

  if (!CANCELLABLE.has(order.state)) {
    throw new ContractError(
      "conflict",
      order.state === "unknown_reconciling"
        ? "this order is still being confirmed with the supplier and cannot be cancelled yet"
        : "this order is not in a cancellable state",
      { orderId: input.orderId, state: order.state },
    );
  }

  const currency = order.currency;
  const charged = Number(order.chargedMinor);

  // Ask the supplier what it will do. This is a servicing call on our reference.
  const supplier = await loadSupplier(deps.db, order.supplierId);
  const adapter = adapterFor(supplier);
  const supplierRefs = jsonRefs(order.supplierRefs);
  const ctx = contextFor(supplier, deps.now);

  // Quote first, cancel second: the penalty is surfaced before anything is
  // cancelled, and a non-zero penalty needs the traveller's exact consent.
  let quoteRef: string | null = null;
  let acceptedPenalty: Money | null = null;
  if (adapter.quoteCancel !== undefined) {
    const quote = quoteView(
      order.id,
      currency,
      await adapter.quoteCancel(ctx, {
        ourRef: order.id,
        supplierRefs,
        idempotencyKey: scoped,
      }),
    );
    const accepted = input.acceptedPenalty ?? null;
    if (
      quote.consentRequired &&
      (accepted === null ||
        accepted.currency !== quote.penalty.currency ||
        accepted.amountMinor !== quote.penalty.amountMinor)
    ) {
      throw new ContractError(
        "conflict",
        "cancelling this order costs a penalty; confirm that exact penalty to cancel",
        {
          orderId: order.id,
          reason: "cancellation_penalty_consent_required",
          penalty: quote.penalty,
          refundable: quote.refundable,
          quoteRef: quote.quoteRef,
          expiresAt: quote.expiresAt,
          refundTo: quote.refundTo,
        },
      );
    }
    quoteRef = quote.quoteRef;
    acceptedPenalty = quote.penalty;
  }

  const cancel = await adapter.cancel(ctx, {
    ourRef: order.id,
    supplierRefs,
    idempotencyKey: scoped,
    quoteRef,
    acceptedPenalty,
  });
  if (!cancel.accepted) {
    throw new ContractError(
      "conflict",
      "the supplier will not cancel this order",
      {
        orderId: input.orderId,
        reason: cancel.reason ?? null,
      },
    );
  }

  // The traveller is never charged more than the penalty they consented to:
  // when the supplier applies more than it quoted a moment ago, UBI carries
  // the difference and it is escalated for settlement review — the refund
  // follows the consent, not the supplier's second answer.
  let appliedPenaltyMinor = cancel.penalty.amountMinor;
  if (
    acceptedPenalty !== null &&
    cancel.penalty.currency === acceptedPenalty.currency &&
    appliedPenaltyMinor > acceptedPenalty.amountMinor
  ) {
    await escalate(
      deps,
      order as unknown as OrderRow,
      input.actor,
      "supplier_penalty_above_consent",
      {
        consentedPenaltyMinor: acceptedPenalty.amountMinor,
        supplierPenaltyMinor: appliedPenaltyMinor,
        currency: acceptedPenalty.currency,
      },
    );
    appliedPenaltyMinor = acceptedPenalty.amountMinor;
  }
  const penaltyMinor = Math.min(appliedPenaltyMinor, charged);
  const refundMinor = Math.max(charged - penaltyMinor, 0);
  const occurredAt = deps.now();
  const refund = buildRefundRequest(
    {
      actor: input.actor,
      cityId: input.cityId,
      orderId: input.orderId,
      amount: money(refundMinor, currency),
      penalty: money(penaltyMinor, currency),
      scopedKey: scoped,
      correlationId: input.correlationId,
      reason: "traveller cancelled",
    },
    occurredAt,
  );

  return withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: "cancelled",
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      detail: { penalty: penaltyMinor, refund: refundMinor },
      occurredAt,
      correlationId: input.correlationId,
    });
    const created = await tx.travelRefund.create({
      data: {
        id: refund.refundId,
        orderId: input.orderId,
        amountMinor: BigInt(refundMinor),
        currency,
        penaltyMinor: BigInt(penaltyMinor),
        stage: "requested",
      },
    });
    return {
      result: refundView(created),
      events: [...advance.events, refund.event],
    };
  });
}

function jsonRefs(value: unknown): {
  pnr?: string;
  bookingRef?: string;
  orderRef?: string;
  ticketNumbers?: string[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const refs: {
    pnr?: string;
    bookingRef?: string;
    orderRef?: string;
    ticketNumbers?: string[];
  } = {};
  if (typeof record.pnr === "string") {
    refs.pnr = record.pnr;
  }
  if (typeof record.bookingRef === "string") {
    refs.bookingRef = record.bookingRef;
  }
  if (typeof record.orderRef === "string") {
    refs.orderRef = record.orderRef;
  }
  if (Array.isArray(record.ticketNumbers)) {
    refs.ticketNumbers = record.ticketNumbers.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  return refs;
}

export { jsonRefs };
export type { JsonValue };
