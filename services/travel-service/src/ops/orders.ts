/**
 * Reading and cancelling a single travel order.
 *
 * Cancellation is per item, never across the trip (CLAUDE.md #25): cancelling a
 * flight leaves the hotel booked. The supplier's cancel policy decides the
 * penalty; the refund is the charged amount less that penalty, and it is tracked
 * on its own ladder (`travelRefund`) rather than paid out instantly. A PNR that
 * is only `confirmed` and a `ticketed` order are both cancellable; an order that
 * never got past `unknown_reconciling` is not — it must be reconciled first.
 */
import {
  ContractError,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { advanceOrder, orderView, type OrderRow, type OrderView } from "./ladder";
import { withOutbox } from "./outbox";
import { buildRefundRequest, refundView, type RefundView } from "./refunds";
import { actorTypeFor, isOpsRole } from "./roles";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";

import type { TravelDeps } from "./context";
import type { Actor, JsonValue } from "./types";

function assertMayRead(actor: Actor, order: { userId: string; id: string }): void {
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
  const order = await deps.db.travelOrder.findUnique({ where: { id: orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  assertMayRead(actor, order);
  return orderView(order as unknown as OrderRow);
}

const CANCELLABLE = new Set(["confirmed", "ticketed"]);

export async function cancelOrder(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string | null;
  },
): Promise<RefundView> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
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
  const cancel = await adapter.cancel(contextFor(supplier, deps.now), {
    ourRef: order.id,
    supplierRefs,
    idempotencyKey: scoped,
  });
  if (!cancel.accepted) {
    throw new ContractError("conflict", "the supplier will not cancel this order", {
      orderId: input.orderId,
      reason: cancel.reason ?? null,
    });
  }

  const penaltyMinor = Math.min(cancel.penalty.amountMinor, charged);
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
  if (typeof record.pnr === "string") refs.pnr = record.pnr;
  if (typeof record.bookingRef === "string") refs.bookingRef = record.bookingRef;
  if (typeof record.orderRef === "string") refs.orderRef = record.orderRef;
  if (Array.isArray(record.ticketNumbers)) {
    refs.ticketNumbers = record.ticketNumbers.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  return refs;
}

export { jsonRefs };
export type { JsonValue };
