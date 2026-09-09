/**
 * Reconciliation-first handling of uncertain outcomes, and settlement diffs.
 *
 * CLAUDE.md #24: `unknown_reconciling` is resolved ONLY by a lookup on UBI's own
 * reference — never by re-purchasing and never by compensating first. This
 * module is that lookup. It moves the order to `confirmed` (capturing the hold
 * that was left in place) or to `failed_released` (releasing it), strictly
 * through the contract machine. It never books anything.
 *
 * A settlement difference is the gap between what UBI charged the traveller and
 * what the supplier later invoiced. It is recorded and surfaced to ops and
 * finance recon; it never silently adjusts the traveller's charge.
 */
import { ContractError, money } from "@ubi/contracts";

import { generateId } from "../lib/ids";
import { reconcileLogger } from "../lib/logger";
import { advanceOrder, orderView, type OrderRow, type OrderView } from "./ladder";
import { withOutbox } from "./outbox";
import { actorTypeFor } from "./roles";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";

import type { LookupResult } from "../adapters/types";
import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

export async function reconcileOrder(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly correlationId: string | null;
  },
): Promise<OrderView> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
  }
  if (order.state !== "unknown_reconciling") {
    // Only an uncertain order is reconciled; anything else is already resolved.
    return orderView(order as unknown as OrderRow);
  }

  const supplier = await loadSupplier(deps.db, order.supplierId);
  const adapter = adapterFor(supplier);
  const lookup = await adapter.reconcile(contextFor(supplier, deps.now), order.id);

  if (lookup.state === "pending" || lookup.state === "unknown" || !lookup.found) {
    // Still uncertain. Leave it exactly where it is; do not touch the hold.
    reconcileLogger.info(
      { orderId: order.id, state: lookup.state },
      "order still unresolved after lookup",
    );
    return orderView(order as unknown as OrderRow);
  }

  const occurredAt = deps.now();

  if (lookup.state === "failed") {
    const release = await deps.payment.release({
      orderId: order.id,
      userId: order.userId,
      amount: money(Number(order.priceMinor), order.currency),
      cityId: input.cityId,
      reason: "travel reconcile release",
      idempotencyKey: `${order.id}:rel`,
      actor: input.actor,
    });
    const result = await withOutbox(deps.db, async (tx) => {
      const advance = await advanceOrder(tx, {
        order: order as unknown as OrderRow,
        to: "failed_released",
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        detail: { resolvedBy: "lookup", releaseRef: release.ref },
        occurredAt,
        correlationId: input.correlationId,
        releasedMinor: release.amount.amountMinor,
      });
      return { result: advance.order, events: advance.events };
    });
    return orderView(result);
  }

  // confirmed or ticketed: capture the hold that was never captured.
  const capture = await deps.payment.capture({
    orderId: order.id,
    userId: order.userId,
    amount: money(Number(order.priceMinor), order.currency),
    cityId: input.cityId,
    reason: "travel reconcile capture",
    idempotencyKey: `${order.id}:cap`,
    actor: input.actor,
  });

  const refs = supplierRefsJson(lookup);
  const result = await withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: "confirmed",
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      detail: { resolvedBy: "lookup", captureRef: capture.ref },
      occurredAt,
      correlationId: input.correlationId,
      supplierRefs: refs,
      chargedMinor: capture.amount.amountMinor,
    });
    let latest = advance.order;
    const events = [...advance.events];
    if (lookup.state === "ticketed" && lookup.documentsIssued && order.kind === "flight") {
      const ticketed = await advanceOrder(tx, {
        order: latest,
        to: "ticketed",
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        detail: { resolvedBy: "lookup" },
        occurredAt,
        correlationId: input.correlationId,
        supplierRefs: refs,
      });
      latest = ticketed.order;
      events.push(...ticketed.events);
    }
    return { result: latest, events };
  });
  return orderView(result);
}

function supplierRefsJson(lookup: LookupResult): JsonRecord {
  const refs: JsonRecord = {};
  if (lookup.supplierRefs.pnr !== undefined) refs.pnr = lookup.supplierRefs.pnr;
  if (lookup.supplierRefs.bookingRef !== undefined) {
    refs.bookingRef = lookup.supplierRefs.bookingRef;
  }
  if (lookup.supplierRefs.orderRef !== undefined) {
    refs.orderRef = lookup.supplierRefs.orderRef;
  }
  if (lookup.supplierRefs.ticketNumbers !== undefined) {
    refs.ticketNumbers = [...lookup.supplierRefs.ticketNumbers];
  }
  return refs;
}

/**
 * Records a settlement difference (charged vs invoiced). Emits the event only
 * when the two disagree; a matching settlement is stored as accepted.
 */
export async function recordSettlement(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly invoicedMinor: number;
    readonly correlationId: string | null;
  },
): Promise<{ readonly settlementId: string; readonly differenceMinor: number }> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
  }
  const chargedMinor = Number(order.chargedMinor);
  const differenceMinor = chargedMinor - input.invoicedMinor;
  const settlementId = generateId("tset");
  const occurredAt = deps.now();

  await withOutbox(deps.db, async (tx) => {
    await tx.travelSettlement.create({
      data: {
        id: settlementId,
        orderId: input.orderId,
        chargedMinor: BigInt(chargedMinor),
        invoicedMinor: BigInt(input.invoicedMinor),
        differenceMinor: BigInt(differenceMinor),
        currency: order.currency,
        resolution: differenceMinor === 0 ? "accepted" : null,
        ...(differenceMinor === 0
          ? { resolvedBy: "system", resolvedAt: occurredAt }
          : {}),
      },
    });
    const events =
      differenceMinor === 0
        ? []
        : [
            {
              name: "travel.settlement.difference" as const,
              aggregateType: "travel_settlement",
              aggregateId: settlementId,
              fromVersion: null,
              toVersion: 1,
              actor: input.actor,
              actorType: actorTypeFor(input.actor.role),
              cityId: input.cityId,
              idempotencyKey: `travel.settlement.difference:${settlementId}`,
              correlationId: input.correlationId,
              occurredAt,
              payload: {
                orderId: input.orderId,
                charged: chargedMinor,
                invoiced: input.invoicedMinor,
                difference: differenceMinor,
              } as JsonRecord,
            },
          ];
    return { result: undefined, events };
  });

  return { settlementId, differenceMinor };
}
