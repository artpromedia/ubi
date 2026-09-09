/**
 * The travel-ops exception console (contracts/openapi/growth-ops.yaml,
 * /v1/ops/travel/*).
 *
 * Ops sees orders that need a human: a PNR that has not ticketed, an unknown
 * result that must be reconciled, a refund in flight, a settlement difference.
 * The one hard rule is that ops NEVER re-books (the contract says so): the
 * actions are lookup on our own reference, escalate, accept/dispute a settlement
 * difference, chase a refund. `lookup_by_our_ref` runs the reconciliation, which
 * cannot re-purchase (CLAUDE.md #24).
 */
import { ContractError } from "@ubi/contracts";

import { advanceRefund } from "./refunds";
import { reconcileOrder } from "./reconcile";
import { toJson } from "./json";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

export const EXCEPTION_ACTIONS = [
  "lookup_by_our_ref",
  "escalate",
  "accept_difference",
  "dispute_difference",
  "chase_refund",
] as const;
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number];

function moneyObj(amountMinor: number, currency: string): JsonRecord {
  return { amountMinor, currency };
}

export async function listExceptions(deps: TravelDeps): Promise<readonly JsonRecord[]> {
  const exceptions: JsonRecord[] = [];

  const unknowns = await deps.db.travelOrder.findMany({
    where: { state: "unknown_reconciling" },
    orderBy: { stateAt: "asc" },
  });
  for (const order of unknowns) {
    exceptions.push({
      orderId: order.id,
      supplierRefs: (order.supplierRefs ?? {}) as JsonRecord,
      item: order.kind,
      kind: "unknown_result",
      state: order.state,
      since: order.stateAt.toISOString(),
      money: { held: moneyObj(Number(order.heldMinor), order.currency) },
      nextAction: "lookup_by_our_ref",
    });
  }

  const pending = await deps.db.travelOrder.findMany({
    where: { state: "supplier_pending" },
    orderBy: { stateAt: "asc" },
  });
  for (const order of pending) {
    exceptions.push({
      orderId: order.id,
      supplierRefs: (order.supplierRefs ?? {}) as JsonRecord,
      item: order.kind,
      kind: "provider_uncertain",
      state: order.state,
      since: order.stateAt.toISOString(),
      money: { held: moneyObj(Number(order.heldMinor), order.currency) },
      nextAction: "await supplier callback",
    });
  }

  const confirmedFlights = await deps.db.travelOrder.findMany({
    where: { state: "confirmed", kind: "flight" },
    orderBy: { stateAt: "asc" },
  });
  for (const order of confirmedFlights) {
    exceptions.push({
      orderId: order.id,
      supplierRefs: (order.supplierRefs ?? {}) as JsonRecord,
      item: order.kind,
      kind: "pending_ticketing",
      state: order.state,
      since: order.stateAt.toISOString(),
      money: { held: moneyObj(Number(order.chargedMinor), order.currency) },
      nextAction: "await ticketing (a PNR is not a ticket)",
    });
  }

  const refunds = await deps.db.travelRefund.findMany({
    where: { stage: { in: ["requested", "supplier_confirmed", "supplier_refund_pending"] } },
    orderBy: { createdAt: "asc" },
  });
  for (const refund of refunds) {
    exceptions.push({
      orderId: refund.orderId,
      item: "refund",
      kind: "refund_due",
      state: refund.stage,
      since: refund.createdAt.toISOString(),
      money: { owed: moneyObj(Number(refund.amountMinor), refund.currency) },
      nextAction: "chase_refund",
    });
  }

  const settlements = await deps.db.travelSettlement.findMany({
    where: { resolution: null },
    orderBy: { createdAt: "asc" },
  });
  for (const settlement of settlements) {
    exceptions.push({
      orderId: settlement.orderId,
      item: "settlement",
      kind: "settlement_difference",
      state: "unresolved",
      since: settlement.createdAt.toISOString(),
      money: { difference: moneyObj(Number(settlement.differenceMinor), settlement.currency) },
      nextAction: "accept_difference | dispute_difference",
    });
  }

  return exceptions;
}

export async function applyExceptionAction(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly action: ExceptionAction;
    readonly note: string | null;
    readonly correlationId: string | null;
  },
): Promise<JsonRecord> {
  switch (input.action) {
    case "lookup_by_our_ref": {
      const order = await reconcileOrder(deps, {
        actor: input.actor,
        cityId: input.cityId,
        orderId: input.orderId,
        correlationId: input.correlationId,
      });
      return { action: input.action, orderId: input.orderId, state: order.state };
    }
    case "escalate": {
      const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
      if (order === null) {
        throw new ContractError("not_found", "no such order", { orderId: input.orderId });
      }
      await deps.db.travelOrderEvent.create({
        data: {
          orderId: input.orderId,
          fromState: order.state,
          toState: order.state,
          actor: input.actor.id,
          detail: toJson({ escalated: true, note: input.note }),
        },
      });
      return { action: input.action, orderId: input.orderId, escalated: true };
    }
    case "accept_difference":
    case "dispute_difference": {
      const settlement = await deps.db.travelSettlement.findFirst({
        where: { orderId: input.orderId, resolution: null },
        orderBy: { createdAt: "asc" },
      });
      if (settlement === null) {
        throw new ContractError("not_found", "no open settlement difference", {
          orderId: input.orderId,
        });
      }
      const resolution = input.action === "accept_difference" ? "accepted" : "disputed";
      await deps.db.travelSettlement.update({
        where: { id: settlement.id },
        data: { resolution, resolvedBy: input.actor.id, resolvedAt: deps.now() },
      });
      return { action: input.action, settlementId: settlement.id, resolution };
    }
    case "chase_refund": {
      const refund = await deps.db.travelRefund.findFirst({
        where: { orderId: input.orderId, stage: { not: "refunded_to_wallet" } },
        orderBy: { createdAt: "desc" },
      });
      if (refund === null) {
        throw new ContractError("not_found", "no open refund", { orderId: input.orderId });
      }
      const next =
        refund.stage === "requested"
          ? "supplier_confirmed"
          : refund.stage === "supplier_confirmed"
            ? "supplier_refund_pending"
            : refund.stage === "supplier_refund_pending"
              ? "refunded_to_wallet"
              : null;
      if (next === null) {
        return { action: input.action, refundId: refund.id, stage: refund.stage };
      }
      const view = await advanceRefund(deps, {
        refundId: refund.id,
        to: next,
        actor: input.actor,
        cityId: input.cityId,
        correlationId: input.correlationId,
      });
      return { action: input.action, refundId: refund.id, stage: view.stage };
    }
    default:
      throw new ContractError("validation_failed", "unknown action", {
        action: input.action,
      });
  }
}

export async function providersHealth(deps: TravelDeps): Promise<JsonRecord> {
  const suppliers = await deps.db.travelSupplier.findMany({ orderBy: { id: "asc" } });
  const providers: JsonRecord[] = [];
  for (const supplier of suppliers) {
    const loaded = await loadSupplier(deps.db, supplier.id);
    const adapter = adapterFor(loaded);
    const health = await adapter.providerHealth(contextFor(loaded, deps.now));

    const [confirmed, ticketed, failed, unknown, pending] = await Promise.all([
      deps.db.travelOrder.count({ where: { supplierId: supplier.id, state: "confirmed" } }),
      deps.db.travelOrder.count({ where: { supplierId: supplier.id, state: "ticketed" } }),
      deps.db.travelOrder.count({ where: { supplierId: supplier.id, state: "failed_released" } }),
      deps.db.travelOrder.count({ where: { supplierId: supplier.id, state: "unknown_reconciling" } }),
      deps.db.travelOrder.count({ where: { supplierId: supplier.id, state: "supplier_pending" } }),
    ]);
    const totalOrders = confirmed + ticketed + failed + unknown + pending;
    const webhooksTotal = await deps.db.travelWebhook.count({ where: { supplierId: supplier.id } });
    const webhooksRejected = await deps.db.travelWebhook.count({
      where: { supplierId: supplier.id, signatureOk: false },
    });

    providers.push({
      supplierId: supplier.id,
      adapter: health.adapter,
      enabled: supplier.enabled,
      reachable: health.reachable,
      liveCallsBlocked: health.liveCallsBlocked,
      note: health.note ?? null,
      orders: { confirmed, ticketed, failed, unknown, pending, total: totalOrders },
      successRate:
        totalOrders === 0 ? null : Math.round(((confirmed + ticketed) / totalOrders) * 100) / 100,
      webhooks: { total: webhooksTotal, rejected: webhooksRejected },
    });
  }

  const settlementDiff = await deps.db.travelSettlement.aggregate({
    _sum: { differenceMinor: true },
    where: { resolution: null },
  });

  return {
    providers,
    unresolvedSettlementDifferenceMinor: Number(settlementDiff._sum.differenceMinor ?? 0n),
    generatedAt: deps.now().toISOString(),
  };
}
