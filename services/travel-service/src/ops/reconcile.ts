/**
 * Reconciliation-first handling of uncertain outcomes, and settlement diffs.
 *
 * CLAUDE.md #24: `unknown_reconciling` is resolved ONLY by a lookup on UBI's own
 * reference — never by re-purchasing and never by compensating first. This
 * module is that lookup. It asks the supplier (with everything UBI knows about
 * the order: supplier refs, the offer it was booked from) and converges the
 * order to the answer through ./converge.ts — capturing the hold that was left
 * in place, or releasing it — strictly through the contract machine and the
 * one payment key scheme. It never books anything.
 *
 * A `supplier_pending` order (the supplier accepted but has not confirmed, e.g.
 * a Duffel 202) is reconciled the same way, so a lost webhook cannot strand it.
 * Money moves in the ORDER's city, whatever city the caller's header names:
 * payment-service scopes the item to the city it was authorized in.
 *
 * A settlement difference is the gap between what UBI charged the traveller and
 * what the supplier later invoiced. It is recorded and surfaced to ops and
 * finance recon; it never silently adjusts the traveller's charge.
 */
import { ContractError } from "@ubi/contracts";

import {
  cityProvenanceFields,
  runConsoleWrite,
  type ConsoleAnswer,
  type ConsoleCity,
  type ConsoleRecorder,
  type ConsoleWrite,
} from "./console";
import { convergeOrder, hintFor } from "./converge";
import { orderView, type OrderRow, type OrderView } from "./ladder";
import { withOutbox } from "./outbox";
import { actorTypeFor } from "./roles";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";
import { generateId } from "../lib/ids";
import { reconcileLogger } from "../lib/logger";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const RECONCILABLE = new Set(["unknown_reconciling", "supplier_pending"]);

export async function reconcileOrder(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly correlationId: string | null;
    /**
     * Where `cityId` came from (a console lookup: ./console.ts). The order's
     * own city is authoritative; only an order recorded without one falls
     * back to the caller's city, and then every event it writes says whose
     * word that city rests on.
     */
    readonly cityProvenance?: JsonRecord;
  },
): Promise<OrderView> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: input.orderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", {
      orderId: input.orderId,
    });
  }
  if (!RECONCILABLE.has(order.state)) {
    // Only an uncertain order is reconciled; anything else is already resolved.
    return orderView(order as unknown as OrderRow);
  }

  const supplier = await loadSupplier(deps.db, order.supplierId);
  const adapter = adapterFor(supplier);
  const lookup = await adapter.reconcile(
    contextFor(supplier, deps.now),
    order.id,
    hintFor(order),
  );

  if (lookup.state === "pending" || lookup.state === "unknown") {
    // Still uncertain. Leave it exactly where it is; do not touch the hold.
    reconcileLogger.info(
      { orderId: order.id, state: lookup.state },
      "order still unresolved after lookup",
    );
    return orderView(order as unknown as OrderRow);
  }

  const outcome = await convergeOrder(deps, {
    order: order as unknown as OrderRow,
    lookup,
    actor: input.actor,
    actorType: actorTypeFor(input.actor.role),
    cityId: order.cityId ?? input.cityId,
    via: "lookup",
    correlationId: input.correlationId,
    ...(order.cityId === null && input.cityProvenance !== undefined
      ? { eventPayload: input.cityProvenance }
      : {}),
  });
  return orderView(outcome.order);
}

/**
 * Records a settlement difference (charged vs invoiced) — a travel-ops
 * console write, exactly once per Idempotency-Key (./console.ts). Emits the
 * event only when the two disagree; a matching settlement is stored as
 * accepted. The event and the console's audit record carry the city's
 * provenance: an operator-declared city says which operator declared it.
 */
export async function recordSettlement(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly city: ConsoleCity;
    readonly orderId: string;
    readonly invoicedMinor: number;
    readonly idempotencyKey: string;
    readonly correlationId: string | null;
  },
): Promise<ConsoleAnswer> {
  const write: ConsoleWrite = {
    operation: "settlement",
    actor: input.actor,
    city: input.city,
    idempotencyKey: input.idempotencyKey,
    subjectType: "travel_order",
    subjectId: input.orderId,
    request: { invoicedMinor: input.invoicedMinor },
  };
  const answer = await runConsoleWrite(deps, write, async (record) => {
    const outcome = await settle(deps, input, record);
    return outcome;
  });
  return answer;
}

async function settle(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly city: ConsoleCity;
    readonly orderId: string;
    readonly invoicedMinor: number;
    readonly correlationId: string | null;
  },
  record: ConsoleRecorder,
): Promise<{ readonly status: number; readonly body: JsonRecord }> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: input.orderId },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", {
      orderId: input.orderId,
    });
  }
  const chargedMinor = Number(order.chargedMinor);
  const differenceMinor = chargedMinor - input.invoicedMinor;
  const settlementId = generateId("tset");
  const occurredAt = deps.now();
  const body: JsonRecord = { settlementId, differenceMinor };

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
              cityId: input.city.cityId,
              idempotencyKey: `travel.settlement.difference:${settlementId}`,
              correlationId: input.correlationId,
              occurredAt,
              payload: {
                orderId: input.orderId,
                charged: chargedMinor,
                invoiced: input.invoicedMinor,
                difference: differenceMinor,
                ...cityProvenanceFields(input.city),
              } as JsonRecord,
            },
          ];
    await record(tx, {
      action: "travel.ops.settlement_recorded",
      status: 201,
      result: body,
      reason:
        differenceMinor === 0
          ? "the supplier invoice matches the charge"
          : "a settlement difference was recorded for finance recon",
    });
    return { result: undefined, events };
  });

  return { status: 201, body };
}
