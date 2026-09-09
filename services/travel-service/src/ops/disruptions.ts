/**
 * Disruptions and ₦0 switching (CLAUDE.md #23, machine `travelOrder`).
 *
 * "Journey Protection" / a free switch appears ONLY when the disruption's
 * `eligibility.covered` is true under a funded rule id. When it is not covered,
 * the traveller is shown the operating carrier's statutory options and a refund
 * path — never a free UBI switch. `switchOrder` refuses unless the disruption is
 * covered, so a covered promise can never be made without a funding rule behind
 * it.
 *
 * A disruption is detected from a verified supplier signal (a webhook). It moves
 * the order to `disrupted`; the switch moves it on to `ticketed` on the new
 * flight, all through the contract machine.
 */
import { ContractError, money, type Money } from "@ubi/contracts";

import { generateId } from "../lib/ids";
import { advanceOrder, orderView, type OrderRow, type OrderView } from "./ladder";
import { toJson } from "./json";
import { withOutbox } from "./outbox";
import { actorTypeFor, isOpsRole } from "./roles";
import { adapterFor, contextFor, loadSupplier } from "./suppliers";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

export interface AlternativeInput {
  readonly id: string;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departAt: string;
  readonly arriveAt: string;
  readonly fareFamily?: string;
  readonly priceMinor: number;
  readonly coveredMinor: number;
  readonly customerPaysMinor: number;
  readonly heldUntil?: string;
}

export interface CreateDisruptionInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly cause: "airline_cancelled" | "schedule_change" | "delay_major";
  readonly source: string;
  readonly covered: boolean;
  readonly ruleId: string | null;
  readonly fundedBy: string | null;
  readonly capMinor: number | null;
  readonly alternatives: readonly AlternativeInput[];
  readonly airlineOptions: readonly AlternativeInput[];
  readonly refundPath: string | null;
  readonly correlationId: string | null;
}

/** Detects a disruption on a confirmed/ticketed order and moves it to `disrupted`. */
export async function createDisruption(
  deps: TravelDeps,
  input: CreateDisruptionInput,
): Promise<void> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
  }
  const existing = await deps.db.travelDisruption.findFirst({
    where: { orderId: input.orderId, resolvedAt: null },
  });
  if (existing !== null) {
    return; // already recorded; idempotent
  }
  if (order.state !== "confirmed" && order.state !== "ticketed") {
    throw new ContractError(
      "conflict",
      "only a confirmed or ticketed order can be disrupted",
      { orderId: input.orderId, state: order.state },
    );
  }

  const occurredAt = deps.now();
  const disruptionId = generateId("tdis");
  await withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: "disrupted",
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      detail: { cause: input.cause, covered: input.covered },
      occurredAt,
      correlationId: input.correlationId,
    });
    await tx.travelDisruption.create({
      data: {
        id: disruptionId,
        orderId: input.orderId,
        cause: input.cause,
        verifiedAt: occurredAt,
        source: input.source,
        covered: input.covered,
        ruleId: input.ruleId,
        fundedBy: input.fundedBy,
        capMinor: input.capMinor === null ? null : BigInt(input.capMinor),
        alternatives: toJson(input.alternatives),
        airlineOptions: toJson(input.airlineOptions),
      },
    });
    const currency = order.currency;
    return {
      result: undefined,
      events: [
        ...advance.events,
        {
          name: "travel.disruption.detected" as const,
          aggregateType: "travel_order",
          aggregateId: input.orderId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `travel.disruption.detected:${disruptionId}`,
          correlationId: input.correlationId,
          occurredAt,
          payload: {
            orderId: input.orderId,
            cause: input.cause,
            covered: input.covered,
            ruleId: input.ruleId,
          },
        },
        {
          name: "travel.disruption.options_ready" as const,
          aggregateType: "travel_order",
          aggregateId: input.orderId,
          fromVersion: null,
          toVersion: 2,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `travel.disruption.options_ready:${disruptionId}`,
          correlationId: input.correlationId,
          occurredAt,
          payload: {
            orderId: input.orderId,
            alternatives: input.alternatives.length,
            covered: input.covered,
            currency,
          },
        },
      ],
    };
  });
}

interface DisruptionRow {
  id: string;
  orderId: string;
  cause: string;
  verifiedAt: Date;
  covered: boolean;
  ruleId: string | null;
  fundedBy: string | null;
  capMinor: bigint | null;
  alternatives: unknown;
  airlineOptions: unknown;
  resolution: string | null;
}

function altView(alt: AlternativeInput, currency: string): JsonRecord {
  return {
    id: alt.id,
    carrier: alt.carrier,
    flightNumber: alt.flightNumber,
    departAt: alt.departAt,
    arriveAt: alt.arriveAt,
    fareFamily: alt.fareFamily ?? null,
    price: { amountMinor: alt.priceMinor, currency },
    covered: { amountMinor: alt.coveredMinor, currency },
    customerPays: { amountMinor: alt.customerPaysMinor, currency },
    ...(alt.heldUntil === undefined ? {} : { heldUntil: alt.heldUntil }),
  };
}

export async function getDisruption(
  deps: TravelDeps,
  actor: Actor,
  orderId: string,
): Promise<JsonRecord> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  if (order.userId !== actor.id && !isOpsRole(actor.role)) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  const row = (await deps.db.travelDisruption.findFirst({
    where: { orderId },
    orderBy: { verifiedAt: "desc" },
  })) as DisruptionRow | null;
  if (row === null) {
    throw new ContractError("not_found", "no disruption on this order", { orderId });
  }
  const currency = order.currency;
  const alternatives = Array.isArray(row.alternatives)
    ? (row.alternatives as AlternativeInput[])
    : [];
  const airlineOptions = Array.isArray(row.airlineOptions)
    ? (row.airlineOptions as AlternativeInput[])
    : [];
  return {
    cause: row.cause,
    verifiedAt: row.verifiedAt.toISOString(),
    eligibility: {
      covered: row.covered,
      ruleId: row.ruleId,
      fundedBy: row.fundedBy,
      cap: row.capMinor === null ? null : { amountMinor: Number(row.capMinor), currency },
      reason: row.covered ? null : "not covered under a funded rule",
    },
    airlineOptions: airlineOptions.map((alt) => altView(alt, currency)),
    alternatives: alternatives.map((alt) => altView(alt, currency)),
    refund: null,
  };
}

export async function switchOrder(
  deps: TravelDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly orderId: string;
    readonly alternativeId: string;
    readonly grantId: string | null;
    readonly correlationId: string | null;
  },
): Promise<OrderView> {
  const order = await deps.db.travelOrder.findUnique({ where: { id: input.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
  }
  if (order.userId !== input.actor.id && !isOpsRole(input.actor.role)) {
    throw new ContractError("not_found", "no such order", { orderId: input.orderId });
  }
  const row = (await deps.db.travelDisruption.findFirst({
    where: { orderId: input.orderId, resolvedAt: null },
    orderBy: { verifiedAt: "desc" },
  })) as DisruptionRow | null;
  if (row === null) {
    throw new ContractError("not_found", "no active disruption on this order", {
      orderId: input.orderId,
    });
  }

  // A ₦0 switch is only offered when the disruption is covered under a funded
  // rule (CLAUDE.md #23). Not covered ⇒ no free switch.
  if (!row.covered || row.ruleId === null) {
    throw new ContractError(
      "conflict",
      "this disruption is not covered, so a switch is not available; see the airline options and refund",
      { orderId: input.orderId },
    );
  }

  const alternatives = Array.isArray(row.alternatives)
    ? (row.alternatives as AlternativeInput[])
    : [];
  const chosen = alternatives.find((alt) => alt.id === input.alternativeId);
  if (chosen === undefined) {
    throw new ContractError("not_found", "no such alternative", {
      alternativeId: input.alternativeId,
    });
  }
  const now = deps.now();
  if (chosen.heldUntil === undefined || new Date(chosen.heldUntil).getTime() < now.getTime()) {
    throw new ContractError("conflict", "that alternative is no longer held", {
      alternativeId: input.alternativeId,
    });
  }

  const supplier = await loadSupplier(deps.db, order.supplierId);
  const adapter = adapterFor(supplier);
  const change = await adapter.change(contextFor(supplier, deps.now), {
    ourRef: order.id,
    offerSnapshot: (order.offerSnapshot ?? {}) as JsonRecord,
    alternativeRef: input.alternativeId,
    idempotencyKey: `travel.switch:${order.id}:${input.alternativeId}`,
  });
  if (change.outcome !== "changed") {
    throw new ContractError("conflict", "the switch could not be completed", {
      orderId: input.orderId,
      outcome: change.outcome,
    });
  }

  const refs: JsonRecord = {};
  if (change.supplierRefs.pnr !== undefined) refs.pnr = change.supplierRefs.pnr;
  if (change.supplierRefs.orderRef !== undefined) refs.orderRef = change.supplierRefs.orderRef;
  if (change.supplierRefs.ticketNumbers !== undefined) {
    refs.ticketNumbers = [...change.supplierRefs.ticketNumbers];
  }

  const covered: Money = money(chosen.coveredMinor, order.currency);
  const result = await withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: "ticketed",
      actor: input.actor,
      actorType: actorTypeFor(input.actor.role),
      cityId: input.cityId,
      detail: { switchedTo: input.alternativeId, covered: covered.amountMinor },
      occurredAt: now,
      correlationId: input.correlationId,
      supplierRefs: refs,
    });
    await tx.travelDisruption.update({
      where: { id: row.id },
      data: { resolution: "switched", resolvedAt: now },
    });
    return {
      result: advance.order,
      events: [
        ...advance.events,
        {
          name: "travel.disruption.switched" as const,
          aggregateType: "travel_order",
          aggregateId: input.orderId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `travel.disruption.switched:${row.id}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            orderId: input.orderId,
            alternativeId: input.alternativeId,
            covered: covered.amountMinor,
            ruleId: row.ruleId,
          },
        },
      ],
    };
  });
  return orderView(result);
}
