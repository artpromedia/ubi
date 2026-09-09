/**
 * Supplier webhooks (slice NEW-02 — "Webhooks verified + deduped; outbox").
 *
 * Three guarantees:
 *  1. Verified: the HMAC over the raw body must match the supplier's shared
 *     secret; a bad signature is recorded with `signature_ok = false` and never
 *     advances an order.
 *  2. Deduped: the unique (supplier_id, external_id) index makes a duplicate
 *     delivery a no-op — the second arrival collides and is recorded as a
 *     duplicate, changing nothing (CLAUDE.md #2 idempotency).
 *  3. Idempotent processing: the state change it drives goes through the same
 *     `assertTransition` guard as everything else, and a callback that arrives
 *     after the state has already moved is skipped rather than erroring.
 */
import { canTransition, money } from "@ubi/contracts";

import { generateId } from "../lib/ids";
import { webhookLogger } from "../lib/logger";
import { verifySignature } from "../adapters/signature";
import { advanceRefund } from "./refunds";
import { createDisruption, type AlternativeInput } from "./disruptions";
import { advanceOrder, type OrderRow } from "./ladder";
import { withOutbox } from "./outbox";
import { toJson } from "./json";
import { loadSupplier } from "./suppliers";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const SYSTEM_ACTOR: Actor = { id: "system", role: "system" };

export interface WebhookEnvelope {
  readonly externalId: string;
  readonly type: string;
  readonly orderRef?: string;
  readonly supplierRefs?: JsonRecord;
  readonly documentsIssued?: boolean;
  readonly invoicedMinor?: number;
  readonly disruption?: {
    readonly cause: "airline_cancelled" | "schedule_change" | "delay_major";
    readonly covered: boolean;
    readonly ruleId?: string;
    readonly fundedBy?: string;
    readonly capMinor?: number;
    readonly alternatives?: readonly AlternativeInput[];
    readonly airlineOptions?: readonly AlternativeInput[];
  };
}

export type WebhookOutcome =
  | { readonly result: "rejected"; readonly reason: string }
  | { readonly result: "duplicate" }
  | { readonly result: "processed"; readonly action: string };

export async function receiveWebhook(
  deps: TravelDeps,
  input: {
    readonly supplierId: string;
    readonly cityId: string;
    readonly rawBody: string;
    readonly signature: string | null;
    readonly envelope: WebhookEnvelope;
  },
): Promise<WebhookOutcome> {
  const supplier = await loadSupplier(deps.db, input.supplierId);
  const secret =
    typeof supplier.config.webhookSecret === "string"
      ? supplier.config.webhookSecret
      : "";
  const signatureOk = secret.length > 0 && verifySignature(secret, input.rawBody, input.signature);

  // Fast-path dedupe: a callback we have already recorded is a no-op. The unique
  // (supplier_id, external_id) index below is the race-safe backstop.
  const seen = await deps.db.travelWebhook.findUnique({
    where: {
      supplierId_externalId: {
        supplierId: input.supplierId,
        externalId: input.envelope.externalId,
      },
    },
  });
  if (seen !== null) {
    await publishWebhookEvent(deps, "travel.webhook.duplicate", input, signatureOk);
    return { result: "duplicate" };
  }

  const webhookId = generateId("twh");
  // Insert first: the unique (supplier_id, external_id) index is the dedupe.
  try {
    await deps.db.travelWebhook.create({
      data: {
        id: webhookId,
        supplierId: input.supplierId,
        externalId: input.envelope.externalId,
        signatureOk,
        payload: toJson(JSON.parse(input.rawBody)),
      },
    });
  } catch (error) {
    if (isUnique(error)) {
      await publishWebhookEvent(deps, "travel.webhook.duplicate", input, signatureOk);
      return { result: "duplicate" };
    }
    throw error;
  }

  if (!signatureOk) {
    webhookLogger.warn(
      { supplierId: input.supplierId, externalId: input.envelope.externalId },
      "webhook signature rejected",
    );
    await publishWebhookEvent(deps, "travel.webhook.rejected", input, signatureOk);
    return { result: "rejected", reason: "signature_invalid" };
  }

  await publishWebhookEvent(deps, "travel.webhook.received", input, signatureOk);
  const action = await process(deps, input.cityId, input.envelope);
  await deps.db.travelWebhook.update({
    where: { id: webhookId },
    data: { processedAt: deps.now() },
  });
  return { result: "processed", action };
}

async function process(
  deps: TravelDeps,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  switch (envelope.type) {
    case "booking_confirmed":
      return confirmOrder(deps, cityId, envelope, false);
    case "ticket_issued":
      return confirmOrder(deps, cityId, envelope, true);
    case "booking_failed":
      return failOrder(deps, cityId, envelope);
    case "refund_supplier_confirmed":
      return advanceRefundByOrder(deps, cityId, envelope, "supplier_confirmed");
    case "refund_pending":
      return advanceRefundByOrder(deps, cityId, envelope, "supplier_refund_pending");
    case "refund_paid":
      return advanceRefundByOrder(deps, cityId, envelope, "refunded_to_wallet");
    case "disruption":
      return raiseDisruption(deps, cityId, envelope);
    default:
      webhookLogger.info({ type: envelope.type }, "unhandled webhook type; recorded only");
      return "recorded";
  }
}

async function loadOrderByRef(deps: TravelDeps, ref: string | undefined) {
  if (ref === undefined) return null;
  return deps.db.travelOrder.findUnique({ where: { id: ref } });
}

async function confirmOrder(
  deps: TravelDeps,
  cityId: string,
  envelope: WebhookEnvelope,
  ticketed: boolean,
): Promise<string> {
  const order = await loadOrderByRef(deps, envelope.orderRef);
  if (order === null) return "order_not_found";
  const refs = (envelope.supplierRefs ?? {}) as JsonRecord;

  // supplier_pending → confirmed (capture the still-open hold).
  if (canTransition("travelOrder", order.state, "confirmed")) {
    const capture = await deps.payment.capture({
      orderId: order.id,
      userId: order.userId,
      amount: money(Number(order.priceMinor), order.currency),
      cityId,
      reason: "travel webhook capture",
      idempotencyKey: `${order.id}:cap`,
      actor: SYSTEM_ACTOR,
    });
    await withOutbox(deps.db, async (tx) => {
      const advance = await advanceOrder(tx, {
        order: order as unknown as OrderRow,
        to: "confirmed",
        actor: SYSTEM_ACTOR,
        actorType: "system",
        cityId,
        detail: { via: "webhook", captureRef: capture.ref },
        occurredAt: deps.now(),
        supplierRefs: refs,
        chargedMinor: capture.amount.amountMinor,
      });
      return { result: advance.order, events: advance.events };
    });
  }

  if (ticketed && order.kind === "flight") {
    const fresh = await deps.db.travelOrder.findUnique({ where: { id: order.id } });
    if (fresh !== null && canTransition("travelOrder", fresh.state, "ticketed")) {
      await withOutbox(deps.db, async (tx) => {
        const advance = await advanceOrder(tx, {
          order: fresh as unknown as OrderRow,
          to: "ticketed",
          actor: SYSTEM_ACTOR,
          actorType: "system",
          cityId,
          detail: { via: "webhook" },
          occurredAt: deps.now(),
          supplierRefs: refs,
        });
        return { result: advance.order, events: advance.events };
      });
      const tickets = Array.isArray(refs.ticketNumbers) ? refs.ticketNumbers : [];
      let index = 0;
      for (const number of tickets) {
        if (typeof number !== "string") continue;
        await deps.db.travelDocument.create({
          data: {
            id: generateId("tdoc"),
            orderId: order.id,
            kind: "eticket",
            number,
            passengerIndex: index,
            issuedAt: deps.now(),
          },
        });
        index += 1;
      }
    }
    return "ticketed";
  }
  return "confirmed";
}

async function failOrder(
  deps: TravelDeps,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  const order = await loadOrderByRef(deps, envelope.orderRef);
  if (order === null) return "order_not_found";
  if (!canTransition("travelOrder", order.state, "failed_released")) {
    return "already_resolved";
  }
  const release = await deps.payment.release({
    orderId: order.id,
    userId: order.userId,
    amount: money(Number(order.priceMinor), order.currency),
    cityId,
    reason: "travel webhook release",
    idempotencyKey: `${order.id}:rel`,
    actor: SYSTEM_ACTOR,
  });
  await withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order: order as unknown as OrderRow,
      to: "failed_released",
      actor: SYSTEM_ACTOR,
      actorType: "system",
      cityId,
      detail: { via: "webhook", releaseRef: release.ref },
      occurredAt: deps.now(),
      releasedMinor: release.amount.amountMinor,
    });
    return { result: advance.order, events: advance.events };
  });
  return "failed_released";
}

async function advanceRefundByOrder(
  deps: TravelDeps,
  cityId: string,
  envelope: WebhookEnvelope,
  to: "supplier_confirmed" | "supplier_refund_pending" | "refunded_to_wallet",
): Promise<string> {
  const order = await loadOrderByRef(deps, envelope.orderRef);
  if (order === null) return "order_not_found";
  const refund = await deps.db.travelRefund.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: "desc" },
  });
  if (refund === null) return "refund_not_found";
  if (!canTransition("travelRefund", refund.stage, to)) {
    return "already_at_stage";
  }
  await advanceRefund(deps, {
    refundId: refund.id,
    to,
    actor: SYSTEM_ACTOR,
    cityId,
    correlationId: null,
    ...(typeof envelope.supplierRefs?.supplierRef === "string"
      ? { supplierRef: envelope.supplierRefs.supplierRef }
      : {}),
  });
  return `refund_${to}`;
}

async function raiseDisruption(
  deps: TravelDeps,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  const order = await loadOrderByRef(deps, envelope.orderRef);
  if (order === null || envelope.disruption === undefined) return "order_not_found";
  const d = envelope.disruption;
  await createDisruption(deps, {
    actor: SYSTEM_ACTOR,
    cityId,
    orderId: order.id,
    cause: d.cause,
    source: "supplier_webhook",
    covered: d.covered,
    ruleId: d.ruleId ?? null,
    fundedBy: d.fundedBy ?? null,
    capMinor: d.capMinor ?? null,
    alternatives: d.alternatives ?? [],
    airlineOptions: d.airlineOptions ?? [],
    refundPath: null,
    correlationId: null,
  });
  return "disruption_recorded";
}

async function publishWebhookEvent(
  deps: TravelDeps,
  name: "travel.webhook.received" | "travel.webhook.duplicate" | "travel.webhook.rejected",
  input: {
    readonly supplierId: string;
    readonly cityId: string;
    readonly envelope: WebhookEnvelope;
  },
  signatureOk: boolean,
): Promise<void> {
  await withOutbox(deps.db, async () => ({
    result: undefined,
    events: [
      {
        name,
        aggregateType: "travel_webhook",
        aggregateId: `${input.supplierId}:${input.envelope.externalId}`,
        fromVersion: null,
        toVersion: 1,
        actor: SYSTEM_ACTOR,
        actorType: "system",
        cityId: input.cityId,
        idempotencyKey: `${name}:${input.supplierId}:${input.envelope.externalId}:${generateId("k")}`,
        occurredAt: deps.now(),
        payload: {
          supplier: input.supplierId,
          ref: input.envelope.externalId,
          type: input.envelope.type,
          signatureOk,
        },
      },
    ],
  }));
}

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
