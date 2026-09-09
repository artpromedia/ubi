/**
 * The refund tracker (machine `travelRefund`).
 *
 * requested → supplier_confirmed → supplier_refund_pending → refunded_to_wallet,
 * or requested → rejected. Money only moves at the last hop: when the refund
 * reaches `refunded_to_wallet` the payment port posts the credit to the wallet,
 * and the ledger entry id is recorded on the refund. Every hop asserts the
 * contract machine, so a refund can never skip a stage or pay out twice.
 */
import {
  assertTransition,
  ContractError,
  money,
  type Money,
  type TravelRefundState,
} from "@ubi/contracts";

import { deterministicId } from "../lib/ids";
import { withOutbox } from "./outbox";
import { actorTypeFor, isOpsRole } from "./roles";

import type { TravelDeps } from "./context";
import type { OutboxInput } from "./outbox";
import type { Actor, JsonRecord } from "./types";

const MACHINE = "travelRefund" as const;

const REFUND_EVENT: Readonly<Record<TravelRefundState, string>> = {
  requested: "travel.refund.requested",
  supplier_confirmed: "travel.refund.supplier_confirmed",
  supplier_refund_pending: "travel.refund.supplier_refund_pending",
  refunded_to_wallet: "travel.refund.refunded_to_wallet",
  rejected: "travel.refund.rejected",
};

interface RefundRow {
  id: string;
  orderId: string;
  amountMinor: bigint;
  currency: string;
  penaltyMinor: bigint;
  stage: string;
  expectedBy: Date | null;
  supplierRef: string | null;
  ledgerEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundView {
  readonly id: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly stage: string;
  readonly penalty: Money;
  readonly expectedBy: string | null;
  readonly steps: readonly { label: string; state: string; at: string }[];
}

const STAGE_ORDER: readonly TravelRefundState[] = [
  "requested",
  "supplier_confirmed",
  "supplier_refund_pending",
  "refunded_to_wallet",
];

export function refundView(row: RefundRow): RefundView {
  const reached = STAGE_ORDER.indexOf(row.stage as TravelRefundState);
  const steps = STAGE_ORDER.map((stage, index) => ({
    label: stage,
    state:
      row.stage === "rejected"
        ? index === 0
          ? "done"
          : "skipped"
        : index < reached
          ? "done"
          : index === reached
            ? "active"
            : "pending",
    at: row.updatedAt.toISOString(),
  }));
  return {
    id: row.id,
    orderId: row.orderId,
    amount: money(Number(row.amountMinor), row.currency),
    stage: row.stage,
    penalty: money(Number(row.penaltyMinor), row.currency),
    expectedBy: row.expectedBy?.toISOString().slice(0, 10) ?? null,
    steps,
  };
}

export interface CreateRefundInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly penalty: Money;
  readonly scopedKey: string;
  readonly correlationId: string | null;
  readonly reason: string;
}

/**
 * Opens a refund in `requested`. Deterministic id from the scoped key, so the
 * cancel that created it is idempotent — a replay returns the same refund.
 * Runs inside the caller's transaction (it takes the same order transition).
 */
export function buildRefundRequest(
  input: CreateRefundInput,
  occurredAt: Date,
): {
  readonly refundId: string;
  readonly create: JsonRecord;
  readonly event: OutboxInput;
} {
  const refundId = deterministicId("trf", `${input.scopedKey}:refund`);
  const create: JsonRecord = {
    id: refundId,
    orderId: input.orderId,
    amountMinor: input.amount.amountMinor,
    currency: input.amount.currency,
    penaltyMinor: input.penalty.amountMinor,
    stage: "requested",
  };
  const event: OutboxInput = {
    name: "travel.refund.requested",
    aggregateType: "travel_refund",
    aggregateId: refundId,
    fromVersion: null,
    toVersion: 1,
    actor: input.actor,
    actorType: actorTypeFor(input.actor.role),
    cityId: input.cityId,
    idempotencyKey: `travel.refund.requested:${refundId}`,
    correlationId: input.correlationId,
    occurredAt,
    payload: {
      refundId,
      orderId: input.orderId,
      amount: input.amount.amountMinor,
      penalty: input.penalty.amountMinor,
      reason: input.reason,
    },
  };
  return { refundId, create, event };
}

export async function getRefund(
  deps: TravelDeps,
  actor: Actor,
  refundId: string,
): Promise<RefundView> {
  const row = await deps.db.travelRefund.findUnique({ where: { id: refundId } });
  if (row === null) {
    throw new ContractError("not_found", "no such refund", { refundId });
  }
  const order = await deps.db.travelOrder.findUnique({ where: { id: row.orderId } });
  if (order === null) {
    throw new ContractError("not_found", "no such refund", { refundId });
  }
  if (order.userId !== actor.id && !isOpsRole(actor.role)) {
    throw new ContractError("not_found", "no such refund", { refundId });
  }
  return refundView(row);
}

/**
 * Advances a refund one hop. When it reaches `refunded_to_wallet` the payment
 * port posts the credit and the ledger entry is recorded. Used by the webhook
 * processor and by ops "chase_refund".
 */
export async function advanceRefund(
  deps: TravelDeps,
  input: {
    readonly refundId: string;
    readonly to: TravelRefundState;
    readonly actor: Actor;
    readonly cityId: string;
    readonly correlationId: string | null;
    readonly supplierRef?: string;
  },
): Promise<RefundView> {
  const row = await deps.db.travelRefund.findUnique({ where: { id: input.refundId } });
  if (row === null) {
    throw new ContractError("not_found", "no such refund", { refundId: input.refundId });
  }
  assertTransition(MACHINE, row.stage, input.to);

  let ledgerEntryId: string | null = row.ledgerEntryId;
  if (input.to === "refunded_to_wallet") {
    const posted = await deps.payment.refund({
      orderId: row.orderId,
      userId: (await requireOrderUser(deps, row.orderId)),
      amount: money(Number(row.amountMinor), row.currency),
      cityId: input.cityId,
      reason: `travel refund ${row.id}`,
      idempotencyKey: `travel.refund:${row.id}:payout`,
      actor: input.actor,
    });
    ledgerEntryId = posted.entryId ?? posted.ref;
  }

  const eventName = REFUND_EVENT[input.to];
  const occurredAt = deps.now();
  return withOutbox(deps.db, async (tx) => {
    const updated = await tx.travelRefund.update({
      where: { id: input.refundId },
      data: {
        stage: input.to,
        supplierRef: input.supplierRef ?? row.supplierRef,
        ledgerEntryId,
      },
    });
    return {
      result: refundView(updated),
      events: [
        {
          name: eventName,
          aggregateType: "travel_refund",
          aggregateId: input.refundId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType: actorTypeFor(input.actor.role),
          cityId: input.cityId,
          idempotencyKey: `${eventName}:${input.refundId}:${input.to}`,
          correlationId: input.correlationId,
          occurredAt,
          payload: {
            refundId: input.refundId,
            orderId: row.orderId,
            stage: input.to,
            amount: Number(row.amountMinor),
            penalty: Number(row.penaltyMinor),
          },
        },
      ],
    };
  });
}

async function requireOrderUser(deps: TravelDeps, orderId: string): Promise<string> {
  const order = await deps.db.travelOrder.findUnique({
    where: { id: orderId },
    select: { userId: true },
  });
  if (order === null) {
    throw new ContractError("not_found", "no such order", { orderId });
  }
  return order.userId;
}
