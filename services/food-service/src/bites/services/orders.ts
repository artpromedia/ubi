/**
 * Orders: placement, the merchant lifecycle, the courier hand-offs, and the
 * issue / refund flow.
 *
 * The order follows the canonical `order` state machine
 * (contracts/state-machines.json). Every transition goes through
 * `assertTransition`, is guarded by the order's optimistic-concurrency
 * `version`, and is written in the same transaction as its audit row and its
 * outbox event (CLAUDE.md #2). Money is computed here in minor units from the
 * order's own captured line prices and the city config — never from the request
 * body, never from a code literal (CLAUDE.md #1, #4, #5).
 *
 * Bites does not own the ledger. It asks payment-service to hold, release,
 * capture and refund; it never posts a journal line itself.
 */
import {
  assertTransition,
  ContractError,
  money,
  paymentMethodAvailable,
  scopedIdempotencyKey,
  splitPercent,
  sumMoney,
  type Money,
} from "@ubi/contracts";
import { z } from "zod";

import { auditedTransaction } from "../audit.js";
import { assertFlagEnabled } from "../city-config.js";
import { deterministicId, numericCode } from "../lib/ids.js";
import { orderLogger } from "../lib/logger.js";
import {
  assertAddable,
  parseLines,
  priceLine,
  subtotalOf,
  type PricedLine,
} from "../pricing.js";
import { actorTypeFor, assertPermission } from "../roles.js";
import { loadItemForPricing, MERCHANT_APPROVED } from "./menu.js";

import type { AuditedTx, OutboxInput } from "../audit.js";
import type { BitesDeps } from "../context.js";
import type { Actor, JsonRecord } from "../lib/types.js";

export const ISSUE_OPEN = "open";

const TotalsSchema = z.object({
  currency: z.string(),
  subtotalMinor: z.number().int(),
  serviceFeeMinor: z.number().int(),
  deliveryFeeMinor: z.number().int(),
  totalMinor: z.number().int(),
});
export type OrderTotals = z.infer<typeof TotalsSchema>;

export const REJECT_REASONS = [
  "item_sold_out",
  "store_paused",
  "closed",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const ISSUE_TYPES = [
  "missing_item",
  "wrong_item",
  "damaged",
  "not_delivered",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export interface ReportedItem {
  readonly itemId: string;
  readonly quantity: number;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface OrderView {
  readonly orderId: string;
  readonly outletId: string;
  readonly status: string;
  readonly version: number;
  readonly currency: string;
  readonly totals: OrderTotals;
  readonly lines: readonly PricedLine[];
  readonly authCaptured: boolean;
  /** Shown to the customer only — the code they read to the courier at the door. */
  readonly deliveryCode?: string;
  /** Shown to the merchant/courier only — the counter hand-over code. */
  readonly handoverCode?: string;
  readonly createdAt: string;
}

type OrderRow = {
  id: string;
  userId: string;
  outletId: string;
  status: string;
  items: unknown;
  totals: unknown;
  currency: string;
  paymentIntentId: string | null;
  authCaptured: boolean;
  handoverCode: string | null;
  deliveryCode: string | null;
  courierId: string | null;
  version: number;
  createdAt: Date;
};

function parseTotals(value: unknown): OrderTotals {
  const parsed = TotalsSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractError(
      "internal_error",
      "stored order totals are malformed",
    );
  }
  return parsed.data;
}

function toOrderView(order: OrderRow, viewer: Actor): OrderView {
  const isCustomer = viewer.id === order.userId;
  const isMerchantOrCourier =
    viewer.role === "merchant" ||
    viewer.role === "ops_admin" ||
    (viewer.role === "driver" && viewer.id === order.courierId);
  const base: OrderView = {
    orderId: order.id,
    outletId: order.outletId,
    status: order.status,
    version: order.version,
    currency: order.currency,
    totals: parseTotals(order.totals),
    lines: parseLines(order.items),
    authCaptured: order.authCaptured,
    createdAt: order.createdAt.toISOString(),
  };
  return {
    ...base,
    ...(isCustomer && order.deliveryCode !== null
      ? { deliveryCode: order.deliveryCode }
      : {}),
    ...(isMerchantOrCourier && order.handoverCode !== null
      ? { handoverCode: order.handoverCode }
      : {}),
  };
}

function linesToJson(lines: readonly PricedLine[]): unknown {
  return lines.map((line) => ({
    lineId: line.lineId,
    itemId: line.itemId,
    name: line.name,
    quantity: line.quantity,
    currency: line.currency,
    unitBaseMinor: line.unitBaseMinor,
    options: line.options.map((option) => ({
      optionId: option.optionId,
      groupId: option.groupId,
      name: option.name,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
    unitPriceMinor: line.unitPriceMinor,
    lineTotalMinor: line.lineTotalMinor,
  }));
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface PlaceOrderParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly cartId: string;
  readonly addressId: string;
  readonly paymentMethodId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

/**
 * Places an order in a pre-authorized, not-captured state. The pre-auth hold is
 * requested from payment-service; nothing is captured until delivery. Idempotent
 * on the scoped key: a replay returns the original order rather than placing a
 * second one and holding twice.
 */
export async function placeOrder(
  deps: BitesDeps,
  params: PlaceOrderParams,
): Promise<OrderView> {
  assertPermission(params.actor.role, "order.place");
  const { city, policy, flags } = await deps.config.loadForBites(params.cityId);
  assertFlagEnabled(flags, "bites");

  const scopedKey = scopedIdempotencyKey(
    "bites.order.place",
    params.actor.id,
    params.idempotencyKey,
  );

  const replay = await deps.db.bitesOrder.findUnique({
    where: { idempotencyKey: scopedKey },
  });
  if (replay !== null) {
    return toOrderView(replay, params.actor);
  }

  const cart = await deps.db.cart.findUnique({ where: { id: params.cartId } });
  if (cart === null) {
    throw new ContractError("not_found", "no such cart");
  }
  if (cart.userId !== params.actor.id) {
    throw new ContractError("forbidden", "that cart belongs to someone else");
  }
  const cartLines = parseLines(cart.items);
  if (cartLines.length === 0) {
    throw new ContractError("validation_failed", "the cart is empty");
  }

  const outlet = await deps.db.outlet.findUnique({
    where: { id: cart.outletId },
    include: { merchant: true },
  });
  if (outlet === null || outlet.merchant.status !== MERCHANT_APPROVED) {
    throw new ContractError("not_found", "that merchant is not available");
  }
  const now = deps.now();
  const paused =
    outlet.pausedUntil !== null && outlet.pausedUntil.getTime() > now.getTime();
  if (!outlet.open || paused) {
    throw new ContractError(
      "conflict",
      "that store is not accepting orders right now",
      {
        reason: !outlet.open ? "closed" : "paused",
      },
    );
  }

  if (!paymentMethodAvailable(city, params.paymentMethodId)) {
    throw new ContractError(
      "payment_method_unavailable",
      "that payment method is not available here",
      { paymentMethodId: params.paymentMethodId },
    );
  }

  // Re-price every line from the current menu; the order captures the price the
  // server computes now, and a line that has since sold out blocks placement.
  const repriced: PricedLine[] = [];
  for (const line of cartLines) {
    const item = await loadItemForPricing(deps.db, line.itemId);
    if (item === null) {
      throw new ContractError("conflict", "an item is no longer on the menu", {
        itemId: line.itemId,
      });
    }
    assertAddable(item, now);
    repriced.push(
      priceLine(
        item,
        line.quantity,
        line.options.map((option) => option.optionId),
        line.lineId,
      ),
    );
  }

  const subtotal = subtotalOf(repriced, city.currency);
  const serviceFee = splitPercent(subtotal, city.serviceFeePct).part;
  const deliveryFee = money(policy.deliveryFeeMinor, city.currency);
  const total = sumMoney([subtotal, serviceFee, deliveryFee], city.currency);

  const totals: OrderTotals = {
    currency: city.currency,
    subtotalMinor: subtotal.amountMinor,
    serviceFeeMinor: serviceFee.amountMinor,
    deliveryFeeMinor: deliveryFee.amountMinor,
    totalMinor: total.amountMinor,
  };

  const orderId = deterministicId("order", scopedKey);

  // Place the pre-authorization hold before recording the order. The hold is
  // idempotent on its own scoped key, so a retry never holds twice.
  const authorization = await deps.payments.authorize({
    orderId,
    userId: params.actor.id,
    amount: total,
    paymentMethodId: params.paymentMethodId,
    cityId: params.cityId,
    idempotencyKey: `${scopedKey}:auth`,
    actor: params.actor,
  });

  const handoverCode = numericCode();
  const deliveryCode = numericCode();

  try {
    const created = await auditedTransaction(deps.db, async (tx) => {
      const order = await tx.bitesOrder.create({
        data: {
          id: orderId,
          userId: params.actor.id,
          outletId: cart.outletId,
          status: "placed",
          items: linesToJson(repriced) as never,
          totals: totals as unknown as never,
          currency: city.currency,
          paymentIntentId: authorization.paymentIntentId,
          authCaptured: false,
          handoverCode,
          deliveryCode,
          version: 1,
          idempotencyKey: scopedKey,
        },
      });
      const event: OutboxInput = {
        name: "order.placed",
        aggregateType: "order",
        aggregateId: orderId,
        fromVersion: null,
        toVersion: 1,
        actor: params.actor,
        actorType: actorTypeFor(params.actor.role),
        cityId: params.cityId,
        idempotencyKey: scopedKey,
        correlationId: params.correlationId,
        occurredAt: now,
        payload: {
          orderId,
          merchantId: outlet.merchantId,
          outletId: cart.outletId,
          addressId: params.addressId,
          itemCount: repriced.length,
          subtotalMinor: totals.subtotalMinor,
          totalMinor: totals.totalMinor,
          currency: city.currency,
        },
      };
      return {
        result: order,
        audit: {
          actor: params.actor,
          action: "bites.order.placed",
          subjectType: "order",
          subjectId: orderId,
          reason: null,
          after: { status: "placed", totalMinor: totals.totalMinor },
          correlationId: params.correlationId,
        },
        events: [event],
      };
    });
    return toOrderView(created, params.actor);
  } catch (error) {
    // A concurrent replay won the create race; return the row it wrote.
    const existing = await deps.db.bitesOrder.findUnique({
      where: { idempotencyKey: scopedKey },
    });
    if (existing !== null) {
      return toOrderView(existing, params.actor);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Merchant lifecycle
// ---------------------------------------------------------------------------

async function loadOrderForMerchant(
  deps: BitesDeps,
  actor: Actor,
  orderId: string,
): Promise<{ order: OrderRow; merchantId: string }> {
  assertPermission(actor.role, "merchant.manage");
  const order = await deps.db.bitesOrder.findUnique({
    where: { id: orderId },
    include: { outlet: { select: { merchantId: true } } },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order");
  }
  const merchantId = order.outlet.merchantId;
  if (actor.role !== "ops_admin" && actor.id !== merchantId) {
    throw new ContractError("forbidden", "that order is not yours");
  }
  return { order, merchantId };
}

/** Guarded status write. Returns the updated row or throws version_conflict. */
async function transitionOrder(
  tx: AuditedTx,
  order: OrderRow,
  to: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  assertTransition("order", order.status, to);
  const updated = await tx.bitesOrder.updateMany({
    where: { id: order.id, version: order.version },
    data: { status: to, version: order.version + 1, ...extra },
  });
  if (updated.count === 0) {
    throw new ContractError("version_conflict", "the order changed under you");
  }
}

export interface OrderActionParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly correlationId: string | null;
}

export async function acceptOrder(
  deps: BitesDeps,
  params: OrderActionParams,
): Promise<OrderView> {
  const { order, merchantId } = await loadOrderForMerchant(
    deps,
    params.actor,
    params.orderId,
  );
  await auditedTransaction(deps.db, async (tx) => {
    await transitionOrder(tx, order, "accepted");
    const event = orderEvent(
      deps,
      params,
      order,
      merchantId,
      "merchant.accepted",
      order.version,
      order.version + 1,
      { merchantId },
    );
    return {
      result: undefined,
      audit: transitionAudit(params, order, "accepted", null),
      events: [event],
    };
  });
  return getOrder(deps, params.actor, params.orderId);
}

export interface AdvanceParams extends OrderActionParams {
  readonly to: "preparing" | "ready";
}

export async function advanceOrder(
  deps: BitesDeps,
  params: AdvanceParams,
): Promise<OrderView> {
  const { order } = await loadOrderForMerchant(
    deps,
    params.actor,
    params.orderId,
  );
  await auditedTransaction(deps.db, async (tx) => {
    await transitionOrder(tx, order, params.to);
    return {
      result: undefined,
      audit: transitionAudit(params, order, params.to, null),
    };
  });
  return getOrder(deps, params.actor, params.orderId);
}

export interface RejectParams extends OrderActionParams {
  readonly reason: RejectReason;
  /** For `item_sold_out`: which item to sell out. */
  readonly itemId: string | null;
  /** For `store_paused`: until when. */
  readonly pausedUntil: Date | null;
}

/**
 * Rejecting an order RELEASES the pre-authorization — it is never captured and
 * never turned into a transfer (slice 05 guard). The release is asked of
 * payment-service before the order is moved to its terminal `auth_released`
 * state, and Bites posts no journal line at all.
 */
export async function rejectOrder(
  deps: BitesDeps,
  params: RejectParams,
): Promise<OrderView> {
  const { order, merchantId } = await loadOrderForMerchant(
    deps,
    params.actor,
    params.orderId,
  );

  // The machine only allows a reject from `placed`; surface anything else as an
  // illegal transition rather than a silent no-op.
  assertTransition("order", order.status, "rejected");

  if (order.paymentIntentId === null) {
    throw new ContractError("conflict", "that order has no hold to release");
  }
  // Release the hold. No capture, no transfer.
  await deps.payments.releaseAuth({
    orderId: order.id,
    paymentIntentId: order.paymentIntentId,
    reason: params.reason,
    cityId: params.cityId,
    idempotencyKey: `bites.order.release:${order.id}`,
    actor: params.actor,
  });

  const now = deps.now();
  await auditedTransaction(deps.db, async (tx) => {
    // placed -> rejected -> auth_released, faithful to the machine: two guarded
    // updates so the row's version matches the two events emitted below.
    const toRejected = await tx.bitesOrder.updateMany({
      where: { id: order.id, version: order.version },
      data: {
        status: "rejected",
        version: order.version + 1,
        authCaptured: false,
      },
    });
    if (toRejected.count === 0) {
      throw new ContractError(
        "version_conflict",
        "the order changed under you",
      );
    }
    assertTransition("order", "rejected", "auth_released");
    const toReleased = await tx.bitesOrder.updateMany({
      where: { id: order.id, version: order.version + 1 },
      data: { status: "auth_released", version: order.version + 2 },
    });
    if (toReleased.count === 0) {
      throw new ContractError(
        "version_conflict",
        "the order changed under you",
      );
    }

    const events: OutboxInput[] = [
      orderEvent(
        deps,
        params,
        order,
        merchantId,
        "merchant.rejected",
        order.version,
        order.version + 1,
        { merchantId, reason: params.reason },
      ),
      orderEvent(
        deps,
        params,
        order,
        merchantId,
        "payment.auth_released",
        order.version + 1,
        order.version + 2,
        { merchantId, paymentIntentId: order.paymentIntentId },
      ),
    ];

    // Reason side effects: sell out the item, pause the store, or close it.
    if (params.reason === "item_sold_out" && params.itemId !== null) {
      await tx.bitesMenuItem.updateMany({
        where: { id: params.itemId, outlet: { merchantId } },
        data: { soldOutUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      });
      events.push(
        sideEffectEvent(
          deps,
          params,
          "menu.item_unavailable",
          "menu_item",
          params.itemId,
          {
            merchantId,
            itemId: params.itemId,
          },
        ),
      );
    } else if (params.reason === "store_paused") {
      const pausedUntil =
        params.pausedUntil ?? new Date(now.getTime() + 60 * 60 * 1000);
      await tx.outlet.update({
        where: { id: order.outletId },
        data: { pausedUntil },
      });
      events.push(
        sideEffectEvent(
          deps,
          params,
          "store.paused",
          "outlet",
          order.outletId,
          {
            merchantId,
            outletId: order.outletId,
            pausedUntil: pausedUntil.toISOString(),
          },
        ),
      );
    } else if (params.reason === "closed") {
      await tx.outlet.update({
        where: { id: order.outletId },
        data: { open: false },
      });
    }

    return {
      result: undefined,
      audit: {
        actor: params.actor,
        action: "bites.order.rejected",
        subjectType: "order",
        subjectId: order.id,
        reason: params.reason,
        before: { status: order.status },
        after: { status: "auth_released", authCaptured: false },
        correlationId: params.correlationId,
      },
      events,
    };
  });

  return getOrder(deps, params.actor, params.orderId);
}

// ---------------------------------------------------------------------------
// Courier hand-offs
// ---------------------------------------------------------------------------

export interface HandoverParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly handoverCode: string;
  readonly correlationId: string | null;
}

/** The courier picks the order up at the counter by presenting the hand-over code. */
export async function handoverOrder(
  deps: BitesDeps,
  params: HandoverParams,
): Promise<OrderView> {
  assertPermission(params.actor.role, "courier.fulfill");
  const order = await loadOrderRow(deps, params.orderId);
  if (
    order.handoverCode === null ||
    order.handoverCode !== params.handoverCode
  ) {
    throw new ContractError("forbidden", "the hand-over code does not match");
  }
  await auditedTransaction(deps.db, async (tx) => {
    await transitionOrder(tx, order, "picked_up", {
      courierId: params.actor.id,
    });
    const event = orderEvent(
      deps,
      params,
      order,
      null,
      "order.picked_up",
      order.version,
      order.version + 1,
      { courierId: params.actor.id },
    );
    return {
      result: undefined,
      audit: transitionAudit(params, order, "picked_up", null),
      events: [event],
    };
  });
  return getOrder(deps, params.actor, params.orderId);
}

export interface DeliverParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly deliveryCode: string | null;
  readonly photoRef: string | null;
  readonly correlationId: string | null;
}

/**
 * The courier delivers at the door, proving it with the customer's delivery code
 * or a drop photo. Delivery captures the pre-authorization (the food changed
 * hands); the capture is asked of payment-service.
 */
export async function deliverOrder(
  deps: BitesDeps,
  params: DeliverParams,
): Promise<OrderView> {
  assertPermission(params.actor.role, "courier.fulfill");
  const order = await loadOrderRow(deps, params.orderId);
  if (order.courierId !== params.actor.id) {
    throw new ContractError(
      "forbidden",
      "you are not the courier for that order",
    );
  }
  const byCode =
    params.deliveryCode !== null && params.deliveryCode === order.deliveryCode;
  const byPhoto = params.photoRef !== null && params.photoRef.length > 0;
  if (!byCode && !byPhoto) {
    throw new ContractError(
      "validation_failed",
      "delivery needs the delivery code or a drop photo",
    );
  }
  if (order.paymentIntentId === null) {
    throw new ContractError("conflict", "that order has no hold to capture");
  }

  const totals = parseTotals(order.totals);
  await deps.payments.capture({
    orderId: order.id,
    paymentIntentId: order.paymentIntentId,
    amount: money(totals.totalMinor, totals.currency),
    cityId: params.cityId,
    idempotencyKey: `bites.order.capture:${order.id}`,
    actor: params.actor,
  });

  const proof = byCode ? "code" : "photo";
  await auditedTransaction(deps.db, async (tx) => {
    await transitionOrder(tx, order, "delivered", { authCaptured: true });
    const event = orderEvent(
      deps,
      params,
      order,
      null,
      "order.delivered",
      order.version,
      order.version + 1,
      { proof, courierId: params.actor.id },
    );
    return {
      result: undefined,
      audit: {
        actor: params.actor,
        action: "bites.order.delivered",
        subjectType: "order",
        subjectId: order.id,
        before: { status: order.status },
        after: { status: "delivered", authCaptured: true, proof },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });
  return getOrder(deps, params.actor, params.orderId);
}

// ---------------------------------------------------------------------------
// Issues & refunds
// ---------------------------------------------------------------------------

/** Refund at the order's captured menu price for each reported item. */
function computeIssueRefund(
  lines: readonly PricedLine[],
  reported: readonly ReportedItem[],
  currency: string,
): Money {
  const parts: Money[] = [];
  for (const item of reported) {
    const line = lines.find((candidate) => candidate.itemId === item.itemId);
    if (line === undefined) {
      throw new ContractError(
        "validation_failed",
        "an item was not in that order",
        {
          itemId: item.itemId,
        },
      );
    }
    const quantity = Math.min(item.quantity, line.quantity);
    parts.push(money(line.unitPriceMinor * quantity, currency));
  }
  return sumMoney(parts, currency);
}

export interface ReportIssueParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly items: readonly ReportedItem[];
  readonly type: IssueType;
  readonly photoRef: string | null;
  readonly correlationId: string | null;
}

export interface IssueView {
  readonly issueId: string;
  readonly orderId: string;
  readonly type: string;
  readonly status: string;
  readonly requestedMinor: number;
  readonly currency: string;
  readonly respondBy: string;
}

export async function reportIssue(
  deps: BitesDeps,
  params: ReportIssueParams,
): Promise<IssueView> {
  assertPermission(params.actor.role, "order.issue.report");
  const order = await loadOrderRow(deps, params.orderId);
  if (order.userId !== params.actor.id) {
    throw new ContractError("forbidden", "that order is not yours");
  }
  if (params.items.length === 0) {
    throw new ContractError("validation_failed", "report at least one item");
  }

  const lines = parseLines(order.items);
  // Computed server-side at the captured menu price; a client-sent amount is
  // never trusted (CLAUDE.md #1). Stored for reference only.
  const refund = computeIssueRefund(lines, params.items, order.currency);

  const { policy } = await deps.config.loadForBites(params.cityId);
  const now = deps.now();
  const respondBy = new Date(
    now.getTime() + policy.issueResponseWindowMinutes * 60 * 1000,
  );
  const issueId = deterministicId("issue", `${order.id}:${now.getTime()}`);

  const reportedJson: JsonRecord = {
    items: params.items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
    })),
  };

  await auditedTransaction(deps.db, async (tx) => {
    await transitionOrder(tx, order, "issue_reported");
    await tx.orderIssue.create({
      data: {
        id: issueId,
        orderId: order.id,
        items: reportedJson as unknown as never,
        type: params.type,
        photoRef: params.photoRef,
        requestedMinor: BigInt(refund.amountMinor),
        status: ISSUE_OPEN,
        respondBy,
      },
    });
    const event = orderEvent(
      deps,
      params,
      order,
      null,
      "order.issue_reported",
      order.version,
      order.version + 1,
      {
        orderId: order.id,
        issueId,
        type: params.type,
        itemCount: params.items.length,
        requestedMinor: refund.amountMinor,
      },
    );
    return {
      result: undefined,
      audit: {
        actor: params.actor,
        action: "bites.order.issue_reported",
        subjectType: "order",
        subjectId: order.id,
        after: { status: "issue_reported", issueId, type: params.type },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });

  return {
    issueId,
    orderId: order.id,
    type: params.type,
    status: ISSUE_OPEN,
    requestedMinor: refund.amountMinor,
    currency: order.currency,
    respondBy: respondBy.toISOString(),
  };
}

export interface RespondIssueParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly issueId: string;
  readonly decision: "accept" | "redeliver" | "dispute";
  readonly correlationId: string | null;
}

/** The merchant answers an issue within the window: accept (refund), redeliver, or dispute. */
export async function respondIssue(
  deps: BitesDeps,
  params: RespondIssueParams,
): Promise<IssueView> {
  const { order, merchantId } = await loadOrderForMerchant(
    deps,
    params.actor,
    params.orderId,
  );
  const issue = await deps.db.orderIssue.findUnique({
    where: { id: params.issueId },
  });
  if (issue === null || issue.orderId !== order.id) {
    throw new ContractError("not_found", "no such issue on that order");
  }
  if (issue.status !== ISSUE_OPEN) {
    throw new ContractError("conflict", "that issue is already resolved", {
      status: issue.status,
    });
  }

  if (params.decision === "accept") {
    return resolveWithRefund(deps, {
      actor: params.actor,
      cityId: params.cityId,
      order,
      merchantId,
      issueId: params.issueId,
      auto: false,
      correlationId: params.correlationId,
    });
  }

  const now = deps.now();
  const nextIssueStatus =
    params.decision === "redeliver" ? "redeliver" : "disputed";
  await auditedTransaction(deps.db, async (tx) => {
    if (params.decision === "redeliver") {
      // issue_reported -> merchant_redeliver -> delivered (a fresh delivery).
      await transitionOrder(tx, order, "merchant_redeliver");
      assertTransition("order", "merchant_redeliver", "delivered");
      const back = await tx.bitesOrder.updateMany({
        where: { id: order.id, version: order.version + 1 },
        data: { status: "delivered", version: order.version + 2 },
      });
      if (back.count === 0) {
        throw new ContractError(
          "version_conflict",
          "the order changed under you",
        );
      }
    } else {
      await transitionOrder(tx, order, "merchant_disputed");
    }
    await tx.orderIssue.update({
      where: { id: params.issueId },
      data: {
        status: nextIssueStatus,
        merchantResponse: params.decision,
        decidedAt: now,
      },
    });
    const event = orderEvent(
      deps,
      params,
      order,
      merchantId,
      "merchant.responded",
      order.version,
      order.version + 1,
      { issueId: params.issueId, decision: params.decision },
    );
    return {
      result: undefined,
      audit: {
        actor: params.actor,
        action: `bites.issue.${params.decision}`,
        subjectType: "order",
        subjectId: order.id,
        reason: params.decision,
        after: { issueStatus: nextIssueStatus },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });

  return issueView(deps, params.issueId);
}

interface ResolveRefundArgs {
  readonly actor: Actor;
  readonly cityId: string;
  readonly order: OrderRow;
  readonly merchantId: string;
  readonly issueId: string;
  readonly auto: boolean;
  readonly correlationId: string | null;
}

/**
 * Refunds an accepted (or auto-accepted) issue per item at the menu price and
 * moves the order to `refunded`. The refund is posted to the customer's wallet
 * by payment-service; Bites records the resulting journal-entry id and never
 * posts a line itself.
 */
async function resolveWithRefund(
  deps: BitesDeps,
  args: ResolveRefundArgs,
): Promise<IssueView> {
  const issue = await deps.db.orderIssue.findUnique({
    where: { id: args.issueId },
  });
  if (issue === null) {
    throw new ContractError("not_found", "no such issue");
  }
  const lines = parseLines(args.order.items);
  const reported = parseReportedItems(issue.items);
  const refund = computeIssueRefund(lines, reported, args.order.currency);

  // Post the refund first; if payment-service refuses, nothing here commits.
  const posted = await deps.payments.refundToWallet({
    orderId: args.order.id,
    userId: args.order.userId,
    amount: refund,
    reason: args.auto ? "issue_auto_accepted" : "issue_accepted",
    cityId: args.cityId,
    idempotencyKey: `bites.refund:${args.issueId}`,
    actor: args.actor,
  });

  const now = deps.now();
  const intermediate = args.auto ? "auto_accepted" : "merchant_accepted";
  const issueStatus = args.auto ? "auto_refunded" : "resolved_refund";
  const missingItem = issue.type === "missing_item";

  await auditedTransaction(deps.db, async (tx) => {
    // issue_reported -> (auto_accepted | merchant_accepted) -> refunded
    await transitionOrder(tx, args.order, intermediate);
    assertTransition("order", intermediate, "refunded");
    const refunded = await tx.bitesOrder.updateMany({
      where: { id: args.order.id, version: args.order.version + 1 },
      data: { status: "refunded", version: args.order.version + 2 },
    });
    if (refunded.count === 0) {
      throw new ContractError(
        "version_conflict",
        "the order changed under you",
      );
    }
    await tx.orderIssue.update({
      where: { id: args.issueId },
      data: {
        status: issueStatus,
        merchantResponse: args.auto ? "auto_accepted" : "accepted",
        decidedAt: now,
      },
    });

    // Repeated missing-item reports lower a merchant's rank (slice 05 guard).
    if (missingItem) {
      await tx.bitesMerchant.update({
        where: { id: args.merchantId },
        data: { rankScore: { decrement: 1 } },
      });
    }

    const events: OutboxInput[] = [];
    if (!args.auto) {
      events.push(
        makeOrderEvent(
          deps,
          args.actor,
          args.cityId,
          args.order,
          args.merchantId,
          {
            name: "merchant.responded",
            fromVersion: args.order.version,
            toVersion: args.order.version + 1,
            correlationId: args.correlationId,
            payload: { issueId: args.issueId, decision: "accept" },
          },
        ),
      );
    }
    events.push(
      makeOrderEvent(
        deps,
        args.actor,
        args.cityId,
        args.order,
        args.merchantId,
        {
          name: "refund.posted",
          fromVersion: args.order.version + 1,
          toVersion: args.order.version + 2,
          correlationId: args.correlationId,
          payload: {
            orderId: args.order.id,
            issueId: args.issueId,
            entryId: posted.entryId,
            refundMinor: refund.amountMinor,
            currency: args.order.currency,
            auto: args.auto,
          },
        },
      ),
    );

    return {
      result: undefined,
      audit: {
        actor: args.actor,
        action: args.auto
          ? "bites.issue.auto_accepted"
          : "bites.issue.accepted",
        subjectType: "order",
        subjectId: args.order.id,
        reason: args.auto ? "auto_accepted_after_window" : "merchant_accepted",
        after: {
          status: "refunded",
          refundMinor: refund.amountMinor,
          entryId: posted.entryId,
        },
        correlationId: args.correlationId,
      },
      events,
    };
  });

  return issueView(deps, args.issueId);
}

/** The background sweep: auto-accept issues whose response window has passed. */
export async function sweepDueIssues(deps: BitesDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db.orderIssue.findMany({
    where: { status: ISSUE_OPEN, respondBy: { lte: now } },
    orderBy: { respondBy: "asc" },
    take: 100,
  });

  let handled = 0;
  for (const issue of due) {
    const order = await deps.db.bitesOrder.findUnique({
      where: { id: issue.orderId },
      include: { outlet: { select: { merchantId: true } } },
    });
    if (order === null || order.status !== "issue_reported") {
      continue;
    }
    try {
      await resolveWithRefund(deps, {
        actor: { id: "system", role: "ops_admin" },
        cityId: await cityIdForOrder(deps, order.id),
        order,
        merchantId: order.outlet.merchantId,
        issueId: issue.id,
        auto: true,
        correlationId: null,
      });
      handled += 1;
    } catch (error) {
      orderLogger.error(
        { err: error, issueId: issue.id, orderId: order.id },
        "auto-accept sweep failed for issue",
      );
    }
  }
  return handled;
}

/**
 * The city an order belongs to. The order does not carry a city column, so the
 * sweep derives it from the order's own `order.placed` outbox event, which does.
 */
async function cityIdForOrder(
  deps: BitesDeps,
  orderId: string,
): Promise<string> {
  const placed = await deps.db.outboxEvent.findFirst({
    where: {
      aggregateType: "order",
      aggregateId: orderId,
      name: "order.placed",
    },
    orderBy: { occurredAt: "asc" },
  });
  if (placed === null || placed.cityId === null) {
    throw new ContractError(
      "config_unavailable",
      "cannot determine the order's city",
    );
  }
  return placed.cityId;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getOrder(
  deps: BitesDeps,
  actor: Actor,
  orderId: string,
): Promise<OrderView> {
  const order = await deps.db.bitesOrder.findUnique({
    where: { id: orderId },
    include: { outlet: { select: { merchantId: true } } },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order");
  }
  const isCustomer = order.userId === actor.id;
  const isCourier = actor.role === "driver" && order.courierId === actor.id;
  const isMerchant =
    (actor.role === "merchant" && order.outlet.merchantId === actor.id) ||
    actor.role === "ops_admin";
  if (!isCustomer && !isCourier && !isMerchant) {
    throw new ContractError("forbidden", "that order is not yours");
  }
  return toOrderView(order, actor);
}

async function loadOrderRow(
  deps: BitesDeps,
  orderId: string,
): Promise<OrderRow> {
  const order = await deps.db.bitesOrder.findUnique({ where: { id: orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order");
  }
  return order;
}

async function issueView(deps: BitesDeps, issueId: string): Promise<IssueView> {
  const issue = await deps.db.orderIssue.findUnique({ where: { id: issueId } });
  if (issue === null) {
    throw new ContractError("not_found", "no such issue");
  }
  const order = await deps.db.bitesOrder.findUnique({
    where: { id: issue.orderId },
  });
  return {
    issueId: issue.id,
    orderId: issue.orderId,
    type: issue.type,
    status: issue.status,
    requestedMinor:
      issue.requestedMinor === null ? 0 : Number(issue.requestedMinor),
    currency: order?.currency ?? "",
    respondBy: issue.respondBy?.toISOString() ?? "",
  };
}

function parseReportedItems(value: unknown): ReportedItem[] {
  const schema = z.object({
    items: z.array(
      z.object({ itemId: z.string(), quantity: z.number().int().positive() }),
    ),
  });
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ContractError(
      "internal_error",
      "stored issue items are malformed",
    );
  }
  return parsed.data.items;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function transitionAudit(
  params: { actor: Actor; correlationId: string | null },
  order: OrderRow,
  to: string,
  reason: string | null,
): {
  actor: Actor;
  action: string;
  subjectType: string;
  subjectId: string;
  reason: string | null;
  before: JsonRecord;
  after: JsonRecord;
  correlationId: string | null;
} {
  return {
    actor: params.actor,
    action: `bites.order.${to}`,
    subjectType: "order",
    subjectId: order.id,
    reason,
    before: { status: order.status },
    after: { status: to },
    correlationId: params.correlationId,
  };
}

function orderEvent(
  deps: BitesDeps,
  params: { actor: Actor; cityId: string; correlationId: string | null },
  order: OrderRow,
  merchantId: string | null,
  name: string,
  fromVersion: number,
  toVersion: number,
  payload: JsonRecord,
): OutboxInput {
  return {
    name,
    aggregateType: "order",
    aggregateId: order.id,
    fromVersion,
    toVersion,
    actor: params.actor,
    actorType: actorTypeFor(params.actor.role),
    cityId: params.cityId,
    idempotencyKey: `${name}:${order.id}:${fromVersion}->${toVersion}`,
    correlationId: params.correlationId,
    occurredAt: deps.now(),
    payload: merchantId === null ? payload : { merchantId, ...payload },
  };
}

function makeOrderEvent(
  deps: BitesDeps,
  actor: Actor,
  cityId: string,
  order: OrderRow,
  merchantId: string,
  spec: {
    name: string;
    fromVersion: number;
    toVersion: number;
    correlationId: string | null;
    payload: JsonRecord;
  },
): OutboxInput {
  return {
    name: spec.name,
    aggregateType: "order",
    aggregateId: order.id,
    fromVersion: spec.fromVersion,
    toVersion: spec.toVersion,
    actor,
    actorType: actorTypeFor(actor.role),
    cityId,
    idempotencyKey: `${spec.name}:${order.id}:${spec.fromVersion}->${spec.toVersion}`,
    correlationId: spec.correlationId,
    occurredAt: deps.now(),
    payload: { merchantId, ...spec.payload },
  };
}

function sideEffectEvent(
  deps: BitesDeps,
  params: { actor: Actor; cityId: string; correlationId: string | null },
  name: string,
  aggregateType: string,
  aggregateId: string,
  payload: JsonRecord,
): OutboxInput {
  return {
    name,
    aggregateType,
    aggregateId,
    fromVersion: null,
    toVersion: 1,
    actor: params.actor,
    actorType: actorTypeFor(params.actor.role),
    cityId: params.cityId,
    idempotencyKey: `${name}:${aggregateId}:${deps.now().getTime()}`,
    correlationId: params.correlationId,
    occurredAt: deps.now(),
    payload,
  };
}
