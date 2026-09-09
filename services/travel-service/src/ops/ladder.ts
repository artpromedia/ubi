/**
 * The travel order ladder (CLAUDE.md #24, machine `travelOrder`).
 *
 * payment_authorized → submitted → supplier_pending → confirmed (PNR / booking
 * ref) → ticketed (documents) | failed_released | unknown_reconciling.
 *
 * A PNR is not a ticket: `confirmed` means the supplier accepted the booking and
 * returned a reference; `ticketed` is only reached when documents are issued.
 * `unknown_reconciling` is resolved ONLY by a lookup on UBI's own reference —
 * `advanceOrder` refuses any transition the machine does not allow, so an order
 * can never be re-purchased or compensated out of an unknown state; it can only
 * move to `confirmed` or `failed_released` after a lookup.
 *
 * Every transition asserts against the contract machine, writes a
 * travel_order_events row (the per-order audit trail) and, for the states the
 * event catalog names, returns an outbox event for the wrapper to publish.
 */
import {
  assertTransition,
  money,
  type EventName,
  type Money,
  type TravelOrderState,
} from "@ubi/contracts";

import { toJson } from "./json";

import type { OutboxInput } from "./outbox";
import type { Actor, JsonRecord, TravelTx } from "./types";

const MACHINE = "travelOrder" as const;

/** Order states the event catalog names. Others (cancelled, disrupted, refunded, completed)
 *  are published through the refund / disruption catalogs, not a travel.order.* event. */
const ORDER_EVENT: Partial<Record<TravelOrderState, EventName>> = {
  submitted: "travel.order.submitted",
  supplier_pending: "travel.order.supplier_pending",
  confirmed: "travel.order.confirmed",
  ticketed: "travel.order.ticketed",
  failed_released: "travel.order.failed_released",
  unknown_reconciling: "travel.order.unknown",
};

export interface OrderRow {
  id: string;
  tripId: string | null;
  cartId: string | null;
  userId: string;
  kind: string;
  supplierId: string;
  state: string;
  stateAt: Date;
  supplierRefs: unknown;
  offerSnapshot: unknown;
  capabilities: unknown;
  priceMinor: bigint;
  currency: string;
  supplierPriceMinor: bigint | null;
  supplierCurrency: string | null;
  fxRate: unknown;
  fxLockedUntil: Date | null;
  heldMinor: bigint;
  chargedMinor: bigint;
  releasedMinor: bigint;
  payAtPropertyMinor: bigint;
  policy: unknown;
  protectionRuleId: string | null;
  grantId: string | null;
  createdAt: Date;
}

export async function orderEventCount(
  tx: TravelTx,
  orderId: string,
): Promise<number> {
  return tx.travelOrderEvent.count({ where: { orderId } });
}

export interface AdvanceInput {
  readonly order: OrderRow;
  readonly to: TravelOrderState;
  readonly actor: Actor;
  readonly actorType: string;
  readonly cityId: string | null;
  readonly detail: JsonRecord;
  readonly occurredAt: Date;
  readonly correlationId?: string | null;
  readonly supplierRefs?: JsonRecord;
  readonly heldMinor?: number;
  readonly chargedMinor?: number;
  readonly releasedMinor?: number;
  readonly protectionRuleId?: string | null;
  /** Extra fields merged into the outbox payload. */
  readonly eventPayload?: JsonRecord;
}

export interface AdvanceResult {
  readonly order: OrderRow;
  readonly events: readonly OutboxInput[];
  readonly version: number;
}

/**
 * Moves an order to `to`, asserting the transition, writing the audit row and
 * the state, and returning the outbox event (if the state has one). The caller
 * runs inside `withOutbox` and forwards `events`.
 */
export async function advanceOrder(
  tx: TravelTx,
  input: AdvanceInput,
): Promise<AdvanceResult> {
  // Throws IllegalTransitionError → `illegal_transition` at the edge. This is
  // the guard that makes re-purchasing out of unknown_reconciling impossible.
  assertTransition(MACHINE, input.order.state, input.to);

  const fromVersion = await orderEventCount(tx, input.order.id);
  const toVersion = fromVersion + 1;

  await tx.travelOrderEvent.create({
    data: {
      orderId: input.order.id,
      fromState: input.order.state,
      toState: input.to,
      actor: input.actor.id,
      detail: toJson({ ...input.detail }),
    },
  });

  const data: {
    state: string;
    stateAt: Date;
    supplierRefs?: ReturnType<typeof toJson>;
    heldMinor?: bigint;
    chargedMinor?: bigint;
    releasedMinor?: bigint;
    protectionRuleId?: string | null;
  } = { state: input.to, stateAt: input.occurredAt };
  if (input.supplierRefs !== undefined) {
    data.supplierRefs = toJson({ ...input.supplierRefs });
  }
  if (input.heldMinor !== undefined) data.heldMinor = BigInt(input.heldMinor);
  if (input.chargedMinor !== undefined) data.chargedMinor = BigInt(input.chargedMinor);
  if (input.releasedMinor !== undefined) data.releasedMinor = BigInt(input.releasedMinor);
  if (input.protectionRuleId !== undefined) data.protectionRuleId = input.protectionRuleId;

  const updated = await tx.travelOrder.update({
    where: { id: input.order.id },
    data,
  });

  const eventName = ORDER_EVENT[input.to];
  const events: OutboxInput[] =
    eventName === undefined
      ? []
      : [
          {
            name: eventName,
            aggregateType: "travel_order",
            aggregateId: input.order.id,
            fromVersion,
            toVersion,
            actor: input.actor,
            actorType: input.actorType,
            cityId: input.cityId,
            idempotencyKey: `${eventName}:${input.order.id}:${toVersion}`,
            correlationId: input.correlationId ?? null,
            occurredAt: input.occurredAt,
            payload: {
              orderId: input.order.id,
              kind: input.order.kind,
              tripId: input.order.tripId,
              from: input.order.state,
              to: input.to,
              held: input.heldMinor ?? Number(input.order.heldMinor),
              charged: input.chargedMinor ?? Number(input.order.chargedMinor),
              released: input.releasedMinor ?? Number(input.order.releasedMinor),
              ...(input.eventPayload ?? {}),
            },
          },
        ];

  return { order: updated as unknown as OrderRow, events, version: toVersion };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

type LadderStepState = "done" | "active" | "pending" | "skipped";

interface LadderStep {
  readonly step: string;
  readonly state: LadderStepState;
  readonly at?: string;
  readonly detail?: string;
}

const FLIGHT_STEPS = [
  "payment_authorized",
  "submitted",
  "supplier_confirmed",
  "ticketed",
] as const;
const STAY_STEPS = ["payment_authorized", "submitted", "booked"] as const;

/** The index a state occupies on the ladder, and whether it is a failure/limbo state. */
function ladderIndex(kind: string, state: string): number {
  const confirmedIdx = kind === "flight" ? 2 : 2;
  switch (state) {
    case "payment_authorized":
      return 0;
    case "submitted":
    case "supplier_pending":
    case "unknown_reconciling":
      return 1;
    case "confirmed":
    case "disrupted":
      return confirmedIdx;
    case "ticketed":
    case "completed":
      return kind === "flight" ? 3 : 2;
    default:
      return -1;
  }
}

export function buildLadder(order: OrderRow): LadderStep[] {
  const steps = order.kind === "flight" ? FLIGHT_STEPS : STAY_STEPS;
  const current = ladderIndex(order.kind, order.state);
  const failed = order.state === "failed_released";
  const reconciling = order.state === "unknown_reconciling";
  const at = order.stateAt.toISOString();

  return steps.map((step, index): LadderStep => {
    if (failed) {
      return index === 0
        ? { step, state: "done" }
        : { step, state: "skipped", detail: "released — the booking was not taken" };
    }
    if (index < current) return { step, state: "done" };
    if (index === current) {
      if (reconciling) {
        return {
          step,
          state: "active",
          at,
          detail: "confirming with the supplier on our reference",
        };
      }
      return { step, state: "active", at };
    }
    return { step, state: "pending" };
  });
}

function jsonRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export interface OrderView {
  readonly id: string;
  readonly tripId: string | null;
  readonly kind: string;
  readonly state: string;
  readonly ladder: readonly LadderStep[];
  readonly supplierRefs: JsonRecord;
  readonly price: Money;
  readonly held: Money;
  readonly charged: Money;
  readonly released: Money;
  readonly payAtProperty: Money | null;
  readonly policy: JsonRecord;
  readonly protection: { readonly covered: boolean; readonly ruleId: string | null };
  readonly stateAt: string;
}

export function orderView(order: OrderRow): OrderView {
  return {
    id: order.id,
    tripId: order.tripId,
    kind: order.kind,
    state: order.state,
    ladder: buildLadder(order),
    supplierRefs: jsonRecord(order.supplierRefs),
    price: money(Number(order.priceMinor), order.currency),
    held: money(Number(order.heldMinor), order.currency),
    charged: money(Number(order.chargedMinor), order.currency),
    released: money(Number(order.releasedMinor), order.currency),
    payAtProperty:
      order.payAtPropertyMinor > 0n
        ? money(Number(order.payAtPropertyMinor), order.currency)
        : null,
    policy: jsonRecord(order.policy),
    protection: {
      covered: order.protectionRuleId !== null,
      ruleId: order.protectionRuleId,
    },
    stateAt: order.stateAt.toISOString(),
  };
}
