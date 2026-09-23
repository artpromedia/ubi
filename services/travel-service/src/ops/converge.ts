/**
 * Converging an order to what the supplier says NOW (CLAUDE.md #24).
 *
 * Reconcile (a lookup on UBI's own reference) and verified supplier webhooks
 * both end here with a `LookupResult` freshly read from the supplier. The
 * order moves only FORWARD, through the contract machine:
 *
 *  - confirmed / ticketed → capture the hold (converging payment, one key)
 *    and advance; documents are written once each (deduped by number);
 *  - failed (definitive) → release the hold and fail the order — only from a
 *    pre-confirmation state;
 *  - cancelled at the supplier before UBI captured → release and fail;
 *  - pending / unknown → nothing changes.
 *
 * Anything that contradicts money UBI already moved — the supplier says
 * "failed" or "cancelled" for an order UBI captured, or payment-service's
 * record forbids the posting — is ESCALATED (an audit row for ops), never
 * "fixed" automatically. Because every step is monotonic and idempotent,
 * duplicate or out-of-order triggers converge to the same end state.
 */
import { canTransition, ContractError, money } from "@ubi/contracts";

import { toJson } from "./json";
import { advanceOrder, type AdvanceInput, type OrderRow } from "./ladder";
import { withOutbox } from "./outbox";
import { settlePayment } from "./payment-settle";
import { generateId } from "../lib/ids";
import { reconcileLogger } from "../lib/logger";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { LookupHint, LookupResult, SupplierRefs } from "../adapters/types";

export interface ConvergeInput {
  readonly order: OrderRow;
  readonly lookup: LookupResult;
  readonly actor: Actor;
  readonly actorType: string;
  /** The order's own city (payment-service scopes the item to it). */
  readonly cityId: string | null;
  readonly via: "lookup" | "webhook";
  readonly correlationId: string | null;
}

export interface ConvergeOutcome {
  readonly order: OrderRow;
  readonly action: string;
}

export function refsJson(refs: SupplierRefs): JsonRecord {
  const out: JsonRecord = {};
  if (refs.pnr !== undefined) {
    out.pnr = refs.pnr;
  }
  if (refs.bookingRef !== undefined) {
    out.bookingRef = refs.bookingRef;
  }
  if (refs.orderRef !== undefined) {
    out.orderRef = refs.orderRef;
  }
  if (refs.ticketNumbers !== undefined) {
    out.ticketNumbers = [...refs.ticketNumbers];
  }
  return out;
}

export function refsOf(value: unknown): SupplierRefs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const tickets = Array.isArray(record.ticketNumbers)
    ? record.ticketNumbers.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : undefined;
  return {
    ...(typeof record.pnr === "string" ? { pnr: record.pnr } : {}),
    ...(typeof record.bookingRef === "string"
      ? { bookingRef: record.bookingRef }
      : {}),
    ...(typeof record.orderRef === "string"
      ? { orderRef: record.orderRef }
      : {}),
    ...(tickets === undefined ? {} : { ticketNumbers: tickets }),
  };
}

/** What UBI knows about an order, for a supplier lookup. */
export function hintFor(order: {
  supplierRefs: unknown;
  supplierOfferRef?: string | null;
  offerSnapshot: unknown;
}): LookupHint {
  const snapshot =
    typeof order.offerSnapshot === "object" && order.offerSnapshot !== null
      ? (order.offerSnapshot as JsonRecord)
      : null;
  return {
    supplierRefs: refsOf(order.supplierRefs),
    supplierOfferRef: order.supplierOfferRef ?? null,
    offerSnapshot: snapshot,
  };
}

/** Records an exception for ops without changing state or money. */
export async function escalate(
  deps: TravelDeps,
  order: OrderRow,
  actor: Actor,
  reason: string,
  detail: JsonRecord = {},
): Promise<void> {
  reconcileLogger.error(
    { orderId: order.id, state: order.state, reason },
    "travel order escalated to ops",
  );
  await deps.db.travelOrderEvent.create({
    data: {
      orderId: order.id,
      fromState: order.state,
      toState: order.state,
      actor: actor.id,
      detail: toJson({ escalated: true, reason, ...detail }),
    },
  });
}

/**
 * Creates a document row unless it exists. `skipDuplicates` is Postgres
 * `ON CONFLICT DO NOTHING` on the unique (order_id, kind, number) index, so a
 * racing writer that got there first is simply a no-op.
 */
async function createDocumentOnce(
  deps: TravelDeps,
  data: {
    orderId: string;
    kind: "eticket" | "booking_confirmation";
    number: string;
    passengerIndex?: number;
    issuedAt: Date;
  },
): Promise<void> {
  await deps.db.travelDocument.createMany({
    data: [{ id: generateId("tdoc"), ...data }],
    skipDuplicates: true,
  });
}

/**
 * Writes each document once — a repeated or racing trigger never duplicates a
 * ticket. The unique (order_id, kind, number) index is the guarantee; the
 * reads only save a round trip.
 */
export async function writeDocumentsOnce(
  deps: TravelDeps,
  orderId: string,
  kind: string,
  refs: SupplierRefs,
): Promise<void> {
  const issuedAt = deps.now();
  if (kind === "flight") {
    const tickets = refs.ticketNumbers ?? [];
    for (let index = 0; index < tickets.length; index += 1) {
      const number = tickets[index];
      if (number === undefined) {
        continue;
      }
      await createDocumentOnce(deps, {
        orderId,
        kind: "eticket",
        number,
        passengerIndex: index,
        issuedAt,
      });
    }
    return;
  }
  const seen = await deps.db.travelDocument.findFirst({
    where: { orderId, kind: "booking_confirmation" },
  });
  if (seen !== null) {
    return;
  }
  // The hotel's own confirmation code first, then the supplier's booking id.
  await createDocumentOnce(deps, {
    orderId,
    kind: "booking_confirmation",
    number: refs.orderRef ?? refs.bookingRef ?? orderId,
    issuedAt,
  });
}

async function reload(deps: TravelDeps, orderId: string): Promise<OrderRow> {
  const row = await deps.db.travelOrder.findUnique({ where: { id: orderId } });
  if (row === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  return row as unknown as OrderRow;
}

function amountOf(order: OrderRow) {
  return money(Number(order.priceMinor), order.currency);
}

/**
 * Advances under a row lock, re-reading the order first: when a racing path
 * (a webhook and a reconcile at once) has already moved it, the transition is
 * a no-op and the current row is returned — never a duplicate step. Money is
 * already safe (same key → replay); this keeps the audit trail single too.
 */
async function advanceLocked(
  deps: TravelDeps,
  orderId: string,
  input: Omit<AdvanceInput, "order">,
): Promise<{ readonly order: OrderRow; readonly moved: boolean }> {
  const outcome = await withOutbox<{ order: OrderRow; moved: boolean }>(
    deps.db,
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM travel_orders WHERE id = ${orderId} FOR UPDATE`;
      const row = await tx.travelOrder.findUnique({ where: { id: orderId } });
      if (row === null) {
        throw new ContractError("not_found", "no such order", { orderId });
      }
      const current = row as unknown as OrderRow;
      if (!canTransition("travelOrder", current.state, input.to)) {
        return { result: { order: current, moved: false }, events: [] };
      }
      const advance = await advanceOrder(tx, { ...input, order: current });
      return {
        result: { order: advance.order, moved: true },
        events: advance.events,
      };
    },
  );
  return outcome;
}

export async function convergeOrder(
  deps: TravelDeps,
  input: ConvergeInput,
): Promise<ConvergeOutcome> {
  const { lookup, actor } = input;
  let order = input.order;
  const occurredAt = deps.now();
  const refs = refsJson(lookup.supplierRefs);
  const detailBase: JsonRecord = { resolvedBy: input.via };

  if (lookup.state === "confirmed" || lookup.state === "ticketed") {
    let action = "already_resolved";
    if (canTransition("travelOrder", order.state, "confirmed")) {
      if (input.cityId === null) {
        await escalate(deps, order, actor, "order_city_unknown", {
          supplierState: lookup.state,
        });
        return { order, action: "escalated" };
      }
      let capture;
      try {
        capture = await settlePayment(deps, "capture", {
          orderId: order.id,
          userId: order.userId,
          amount: amountOf(order),
          cityId: input.cityId,
          reason: `travel ${input.via} capture`,
          actor,
        });
      } catch (error) {
        await escalate(deps, order, actor, "capture_unresolved", {
          supplierState: lookup.state,
          error: error instanceof ContractError ? error.code : "unknown",
        });
        return { order, action: "escalated" };
      }
      const advanced = await advanceLocked(deps, order.id, {
        to: "confirmed",
        actor,
        actorType: input.actorType,
        cityId: input.cityId,
        detail: { ...detailBase, captureRef: capture.ref },
        occurredAt,
        correlationId: input.correlationId,
        supplierRefs: refs,
        chargedMinor: capture.amount.amountMinor,
      });
      order = advanced.order;
      if (advanced.moved) {
        action = "confirmed";
      }
    }
    if (
      lookup.state === "ticketed" &&
      lookup.documentsIssued &&
      order.kind === "flight" &&
      canTransition("travelOrder", order.state, "ticketed")
    ) {
      const advanced = await advanceLocked(deps, order.id, {
        to: "ticketed",
        actor,
        actorType: input.actorType,
        cityId: input.cityId,
        detail: detailBase,
        occurredAt,
        correlationId: input.correlationId,
        supplierRefs: refs,
      });
      order = advanced.order;
      if (advanced.moved) {
        action = "ticketed";
      }
    }
    if (
      lookup.documentsIssued &&
      (order.state === "confirmed" || order.state === "ticketed")
    ) {
      await writeDocumentsOnce(deps, order.id, order.kind, lookup.supplierRefs);
    }
    return { order: await reload(deps, order.id), action };
  }

  if (lookup.state === "failed" || lookup.state === "cancelled") {
    if (canTransition("travelOrder", order.state, "failed_released")) {
      if (input.cityId === null) {
        await escalate(deps, order, actor, "order_city_unknown", {
          supplierState: lookup.state,
        });
        return { order, action: "escalated" };
      }
      let release;
      try {
        release = await settlePayment(deps, "release", {
          orderId: order.id,
          userId: order.userId,
          amount: amountOf(order),
          cityId: input.cityId,
          reason: `travel ${input.via} release`,
          actor,
        });
      } catch (error) {
        await escalate(deps, order, actor, "release_unresolved", {
          supplierState: lookup.state,
          error: error instanceof ContractError ? error.code : "unknown",
        });
        return { order, action: "escalated" };
      }
      const advanced = await advanceLocked(deps, order.id, {
        to: "failed_released",
        actor,
        actorType: input.actorType,
        cityId: input.cityId,
        detail: {
          ...detailBase,
          releaseRef: release.ref,
          supplierState: lookup.state,
        },
        occurredAt,
        correlationId: input.correlationId,
        releasedMinor: release.amount.amountMinor,
      });
      return {
        order: advanced.order,
        action: advanced.moved ? "failed_released" : "already_resolved",
      };
    }
    if (order.state === "confirmed" || order.state === "ticketed") {
      // Money was captured for a booking the supplier now calls failed or
      // cancelled: a human decides (refund / rebook), never an automatic move.
      await escalate(deps, order, actor, `supplier_reports_${lookup.state}`, {
        supplierRefs: refs,
      });
      return { order, action: "supplier_conflict" };
    }
    return { order, action: "already_resolved" };
  }

  return { order, action: "unresolved" };
}
