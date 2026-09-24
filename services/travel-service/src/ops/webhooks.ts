/**
 * Supplier webhooks (slice NEW-02 — "Webhooks verified + deduped; outbox").
 *
 * Four guarantees:
 *  1. Verified: each supplier's own scheme over the RAW body, constant-time —
 *     Duffel's timestamped `X-Duffel-Signature` (with a replay window),
 *     LiteAPI's shared `authorization` token, the fixture's HMAC
 *     (../adapters/webhook-codecs.ts). A failed delivery is recorded with
 *     `signature_ok = false` under an id of OUR OWN (`rejected:…`) — never
 *     under the event id its unverified body claims, so a forged body can
 *     never occupy, and thereby suppress, a real event's dedupe slot — and it
 *     never advances anything.
 *  2. Deduped by the supplier's event id: the unique (supplier_id,
 *     external_id) index makes a duplicate delivery a no-op (CLAUDE.md #2).
 *     A live event whose processing did not complete (the supplier lookup
 *     failed, or processing threw) gives its slot back and answers 503, so
 *     the supplier's redelivery is processed rather than dropped.
 *  3. Converged, not trusted: a live supplier's event is a trigger. The order
 *     is looked up at the supplier by UBI's own reference and moved to what the
 *     supplier says now, monotonically (./converge.ts) — so events arriving
 *     out of order, late or twice all land on the same end state, and money
 *     moves through the one payment key scheme with status convergence.
 *  4. Scoped: an event only ever touches orders of the supplier it came from,
 *     and a test-mode event never touches a production order.
 *
 * The fixture adapter keeps its explicit envelope (the DEV/TEST harness drives
 * outcomes through it), processed through the same monotonic helpers.
 */
import { canTransition, ContractError, money } from "@ubi/contracts";

import { convergeOrder, escalate, hintFor, refsOf } from "./converge";
import { createDisruption, type AlternativeInput } from "./disruptions";
import { toJson } from "./json";
import { advanceOrder, type OrderRow } from "./ladder";
import { withOutbox } from "./outbox";
import { settlePayment } from "./payment-settle";
import { advanceRefund } from "./refunds";
import {
  adapterFor,
  contextFor,
  loadSupplier,
  type LoadedSupplier,
} from "./suppliers";
import { isProductionEnv, resolveSecret } from "../adapters/http-supplier";
import { NON_PRODUCTION_ADAPTERS } from "../adapters/registry";
import { verifySignature } from "../adapters/signature";
import {
  parseDuffelEvent,
  parseLiteApiEvent,
  verifyDuffelSignature,
  verifyLiteApiToken,
  type NormalizedSupplierEvent,
  type WebhookVerification,
} from "../adapters/webhook-codecs";
import { generateId } from "../lib/ids";
import { webhookLogger } from "../lib/logger";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { LookupResult } from "../adapters/types";

const SYSTEM_ACTOR: Actor = { id: "system", role: "system" };

/** The fixture's explicit DEV/TEST envelope. */
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

/** Header lookup, case-insensitive. */
export type HeaderReader = (name: string) => string | null;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * A raw delivery from the route: verified and parsed by the supplier row's
 * adapter, then deduped and processed.
 */
export async function receiveSupplierWebhook(
  deps: TravelDeps,
  input: {
    readonly supplierId: string;
    readonly rawBody: string;
    readonly header: HeaderReader;
    /** `X-City-ID`, required only by the fixture envelope. */
    readonly cityId: string | null;
    readonly parseEnvelope: (raw: unknown) => WebhookEnvelope;
  },
): Promise<WebhookOutcome> {
  const supplier = await loadSupplier(deps.db, input.supplierId);
  if (supplier.adapter === "duffel" || supplier.adapter === "nuitee") {
    return receiveLiveWebhook(deps, supplier, input.rawBody, input.header);
  }
  if (input.cityId === null || input.cityId.length === 0) {
    throw new ContractError(
      "city_unsupported",
      "the webhook does not name a city",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    throw new ContractError(
      "validation_failed",
      "the webhook body is not JSON",
    );
  }
  return receiveWebhook(deps, {
    supplierId: input.supplierId,
    cityId: input.cityId,
    rawBody: input.rawBody,
    signature: input.header("X-Signature"),
    envelope: input.parseEnvelope(parsed),
  });
}

/** The fixture envelope path (also the DEV/TEST harness entry point). */
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
  // The fixture envelope drives outcomes directly and never resolves an
  // adapter, so the registry's production refusal would not reach it: refuse
  // here too — a test-only supplier never moves an order in production.
  if (NON_PRODUCTION_ADAPTERS.has(supplier.adapter) && isProductionEnv()) {
    throw new ContractError(
      "service_unavailable",
      "this supplier uses a test-only adapter, which production never serves",
      { supplierId: supplier.id, adapter: supplier.adapter },
    );
  }
  const secret =
    typeof supplier.config.webhookSecret === "string"
      ? supplier.config.webhookSecret
      : "";
  const verification: WebhookVerification =
    secret.length > 0 && verifySignature(secret, input.rawBody, input.signature)
      ? { ok: true }
      : { ok: false, reason: "signature_invalid" };

  if (!verification.ok) {
    return reject(
      deps,
      supplier,
      input.rawBody,
      input.cityId,
      verification.reason ?? "signature_invalid",
      input.envelope.type,
    );
  }

  const recorded = await recordVerified(
    deps,
    supplier,
    input.rawBody,
    input.cityId,
    {
      externalId: input.envelope.externalId,
      eventType: input.envelope.type,
      objectRef: input.envelope.orderRef ?? null,
      occurredAt: null,
    },
  );
  if (recorded === "duplicate") {
    return { result: "duplicate" };
  }
  const action = await processEnvelope(
    deps,
    supplier,
    input.cityId,
    input.envelope,
  );
  await finish(deps, recorded, action);
  return { result: "processed", action };
}

async function receiveLiveWebhook(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  rawBody: string,
  header: HeaderReader,
): Promise<WebhookOutcome> {
  const config = supplier.config;
  const secret =
    resolveSecret(
      typeof config.webhookSecretRef === "string"
        ? config.webhookSecretRef
        : undefined,
    ) ?? "";
  const verification =
    supplier.adapter === "duffel"
      ? verifyDuffelSignature(
          secret,
          rawBody,
          header("X-Duffel-Signature"),
          deps.now(),
          webhookTolerance(config.webhookToleranceSec),
        )
      : verifyLiteApiToken(secret, header("authorization"));
  if (!verification.ok) {
    return reject(
      deps,
      supplier,
      rawBody,
      null,
      verification.reason ?? "signature_invalid",
      null,
    );
  }

  let event: NormalizedSupplierEvent;
  try {
    const raw: unknown = JSON.parse(rawBody);
    event =
      supplier.adapter === "duffel"
        ? parseDuffelEvent(raw)
        : parseLiteApiEvent(raw);
  } catch {
    await reject(deps, supplier, rawBody, null, "unparseable", null);
    throw new ContractError(
      "validation_failed",
      "the webhook body is not a supplier event this service can read",
    );
  }

  // A test-mode event never touches a production order (and vice versa).
  const modeMismatch =
    event.liveMode !== null && event.liveMode !== isProductionEnv();

  const order = modeMismatch ? null : await resolveOrder(deps, supplier, event);
  const cityId = order?.cityId ?? null;

  const recorded = await recordVerified(deps, supplier, rawBody, cityId, {
    externalId: event.externalId,
    eventType: event.eventType,
    objectRef: event.objectRef,
    occurredAt: event.occurredAt,
  });
  if (recorded === "duplicate") {
    return { result: "duplicate" };
  }
  let action: string;
  try {
    action = modeMismatch
      ? "mode_mismatch"
      : await processLive(deps, supplier, event, order);
  } catch (error) {
    await releaseSlot(
      deps,
      recorded,
      event.externalId,
      "processing_failed",
    ).catch((releaseError: unknown) => {
      webhookLogger.error(
        { err: releaseError, supplierId: supplier.id },
        "could not free the dedupe slot of a webhook whose processing failed",
      );
    });
    throw error;
  }
  if (action === "lookup_failed") {
    // The supplier could not be asked what is true now. Both suppliers
    // redeliver on a non-2xx answer (Duffel for 72 h, LiteAPI with backoff),
    // so the event keeps no dedupe slot and the redelivery is processed —
    // rather than being swallowed as a "duplicate" of a trigger that did
    // nothing, leaving the order for a manual reconcile.
    await releaseSlot(deps, recorded, event.externalId, action);
    throw new ContractError(
      "service_unavailable",
      "the supplier could not be asked about this event yet; redeliver it",
      { supplierId: supplier.id, eventType: event.eventType, retryable: true },
    );
  }
  await finish(deps, recorded, action);
  return { result: "processed", action };
}

/**
 * Frees a verified event's dedupe slot after processing did not complete: the
 * row stays (renamed `retry:<event id>:<own id>`, with its outcome) for ops,
 * and the supplier's redelivery of the same event id is processed afresh.
 * Safe because live processing is lookup-driven and monotonic.
 */
async function releaseSlot(
  deps: TravelDeps,
  recorded: Recorded,
  externalId: string,
  outcome: string,
): Promise<void> {
  await deps.db.travelWebhook.update({
    where: { id: recorded.webhookId },
    data: {
      externalId: `retry:${externalId}:${generateId("twh")}`,
      processedAt: deps.now(),
      outcome,
    },
  });
}

// ---------------------------------------------------------------------------
// Recording and dedupe
// ---------------------------------------------------------------------------

interface Recorded {
  readonly webhookId: string;
}

async function reject(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  rawBody: string,
  cityId: string | null,
  reason: string,
  eventType: string | null,
): Promise<WebhookOutcome> {
  const rejectedId = `rejected:${generateId("twh")}`;
  webhookLogger.warn(
    { supplierId: supplier.id, reason },
    "webhook verification failed; recorded, not processed",
  );
  await deps.db.travelWebhook.create({
    data: {
      id: generateId("twh"),
      supplierId: supplier.id,
      externalId: rejectedId,
      signatureOk: false,
      payload: toJson(safeJson(rawBody)),
      eventType,
      outcome: reason,
    },
  });
  await publishWebhookEvent(
    deps,
    "travel.webhook.rejected",
    supplier.id,
    rejectedId,
    eventType ?? "unverified",
    cityId,
    false,
  );
  return { result: "rejected", reason };
}

async function recordVerified(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  rawBody: string,
  cityId: string | null,
  meta: {
    readonly externalId: string;
    readonly eventType: string;
    readonly objectRef: string | null;
    readonly occurredAt: Date | null;
  },
): Promise<Recorded | "duplicate"> {
  // Fast-path dedupe; the unique (supplier_id, external_id) index is the
  // race-safe backstop below.
  const seen = await deps.db.travelWebhook.findUnique({
    where: {
      supplierId_externalId: {
        supplierId: supplier.id,
        externalId: meta.externalId,
      },
    },
  });
  if (seen !== null) {
    await publishWebhookEvent(
      deps,
      "travel.webhook.duplicate",
      supplier.id,
      meta.externalId,
      meta.eventType,
      cityId,
      true,
    );
    return "duplicate";
  }
  const webhookId = generateId("twh");
  try {
    await deps.db.travelWebhook.create({
      data: {
        id: webhookId,
        supplierId: supplier.id,
        externalId: meta.externalId,
        signatureOk: true,
        payload: toJson(safeJson(rawBody)),
        eventType: meta.eventType,
        objectRef: meta.objectRef,
        occurredAt: meta.occurredAt,
      },
    });
  } catch (error) {
    if (isUnique(error)) {
      await publishWebhookEvent(
        deps,
        "travel.webhook.duplicate",
        supplier.id,
        meta.externalId,
        meta.eventType,
        cityId,
        true,
      );
      return "duplicate";
    }
    throw error;
  }
  await publishWebhookEvent(
    deps,
    "travel.webhook.received",
    supplier.id,
    meta.externalId,
    meta.eventType,
    cityId,
    true,
  );
  return { webhookId };
}

async function finish(
  deps: TravelDeps,
  recorded: Recorded,
  action: string,
): Promise<void> {
  await deps.db.travelWebhook.update({
    where: { id: recorded.webhookId },
    data: { processedAt: deps.now(), outcome: action },
  });
}

// ---------------------------------------------------------------------------
// Live suppliers: resolve, look up, converge
// ---------------------------------------------------------------------------

async function resolveOrder(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  event: NormalizedSupplierEvent,
): Promise<OrderRow | null> {
  if (event.ourRef !== null) {
    const order = await deps.db.travelOrder.findUnique({
      where: { id: event.ourRef },
    });
    if (order !== null && order.supplierId === supplier.id) {
      return order as unknown as OrderRow;
    }
  }
  if (event.supplierOrderRef !== null) {
    const key = supplier.adapter === "duffel" ? "orderRef" : "bookingRef";
    const order = await deps.db.travelOrder.findFirst({
      where: {
        supplierId: supplier.id,
        supplierRefs: { path: [key], equals: event.supplierOrderRef },
      },
    });
    if (order !== null) {
      return order as unknown as OrderRow;
    }
  }
  if (event.supplierOfferRef !== null) {
    const order = await deps.db.travelOrder.findFirst({
      where: {
        supplierId: supplier.id,
        supplierOfferRef: event.supplierOfferRef,
      },
      orderBy: { createdAt: "desc" },
    });
    if (order !== null) {
      return order as unknown as OrderRow;
    }
  }
  return null;
}

async function supplierLookup(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  order: OrderRow,
  event: NormalizedSupplierEvent,
): Promise<LookupResult> {
  const adapter = adapterFor(supplier);
  const hint = hintFor(order);
  // An event may carry the supplier order id before UBI has recorded it.
  const refs =
    event.supplierOrderRef === null
      ? hint.supplierRefs
      : {
          ...hint.supplierRefs,
          ...(supplier.adapter === "duffel"
            ? { orderRef: event.supplierOrderRef }
            : { bookingRef: event.supplierOrderRef }),
        };
  const lookup = await adapter.reconcile(
    contextFor(supplier, deps.now),
    order.id,
    { ...hint, supplierRefs: refs },
  );
  return lookup;
}

async function processLive(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  event: NormalizedSupplierEvent,
  order: OrderRow | null,
): Promise<string> {
  if (event.action === "record") {
    return "recorded";
  }
  if (order === null) {
    return "order_not_found";
  }
  const cityId = order.cityId ?? null;

  if (
    event.action === "cancellation_confirmed" &&
    order.state === "cancelled"
  ) {
    return advanceLatestRefund(deps, order.id, cityId, "supplier_confirmed");
  }

  if (event.action === "airline_change") {
    if (order.state !== "confirmed" && order.state !== "ticketed") {
      return "not_disruptable";
    }
    await createDisruption(deps, {
      actor: SYSTEM_ACTOR,
      cityId: cityId ?? "",
      orderId: order.id,
      cause: "schedule_change",
      source: "supplier_webhook",
      // No funded rule is known from the supplier signal: the traveller sees
      // the airline's options and a refund path, never a free UBI switch.
      covered: false,
      ruleId: null,
      fundedBy: null,
      capMinor: null,
      alternatives: [],
      airlineOptions: [],
      refundPath: null,
      correlationId: null,
    });
    return "disruption_recorded";
  }

  // converge / creation_failed / cancellation_confirmed on a live order:
  // ask the supplier what is true now.
  let lookup: LookupResult;
  try {
    lookup = await supplierLookup(deps, supplier, order, event);
  } catch (error) {
    webhookLogger.warn(
      { err: error, orderId: order.id, eventType: event.eventType },
      "supplier lookup after a webhook failed; the order is left for reconcile",
    );
    return "lookup_failed";
  }

  if (
    event.action === "creation_failed" &&
    !lookup.found &&
    (lookup.state === "unknown" || lookup.state === "pending")
  ) {
    // The supplier's own definitive statement that the attempt produced no
    // booking, and it shows us none.
    lookup = { ...lookup, state: "failed" };
  }
  if (lookup.state === "pending" || lookup.state === "unknown") {
    return "unresolved";
  }
  const outcome = await convergeOrder(deps, {
    order,
    lookup,
    actor: SYSTEM_ACTOR,
    actorType: "system",
    cityId,
    via: "webhook",
    correlationId: null,
  });
  return outcome.action;
}

// ---------------------------------------------------------------------------
// Fixture envelope processing (explicit outcomes, same monotonic helpers)
// ---------------------------------------------------------------------------

// eslint-disable-next-line require-await -- every branch delegates to an async helper; kept async for its Promise<string> contract
async function processEnvelope(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  switch (envelope.type) {
    case "booking_confirmed":
      return confirmOrder(deps, supplier, cityId, envelope, false);
    case "ticket_issued":
      return confirmOrder(deps, supplier, cityId, envelope, true);
    case "booking_failed":
      return failOrder(deps, supplier, cityId, envelope);
    case "refund_supplier_confirmed":
      return advanceRefundByOrder(
        deps,
        supplier,
        cityId,
        envelope,
        "supplier_confirmed",
      );
    case "refund_pending":
      return advanceRefundByOrder(
        deps,
        supplier,
        cityId,
        envelope,
        "supplier_refund_pending",
      );
    case "refund_paid":
      return advanceRefundByOrder(
        deps,
        supplier,
        cityId,
        envelope,
        "refunded_to_wallet",
      );
    case "disruption":
      return raiseDisruption(deps, supplier, cityId, envelope);
    default:
      webhookLogger.info(
        { type: envelope.type },
        "unhandled webhook type; recorded only",
      );
      return "recorded";
  }
}

async function loadOrderByRef(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  ref: string | undefined,
): Promise<OrderRow | null> {
  if (ref === undefined) {
    return null;
  }
  const order = await deps.db.travelOrder.findUnique({ where: { id: ref } });
  // An event only ever touches its own supplier's orders.
  if (order === null || order.supplierId !== supplier.id) {
    return null;
  }
  return order as unknown as OrderRow;
}

async function confirmOrder(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  cityId: string,
  envelope: WebhookEnvelope,
  ticketed: boolean,
): Promise<string> {
  const order = await loadOrderByRef(deps, supplier, envelope.orderRef);
  if (order === null) {
    return "order_not_found";
  }
  const refs = refsOf(envelope.supplierRefs ?? {});
  const outcome = await convergeOrder(deps, {
    order,
    lookup: {
      found: true,
      state: ticketed ? "ticketed" : "confirmed",
      supplierRefs: refs,
      documentsIssued: ticketed,
    },
    actor: SYSTEM_ACTOR,
    actorType: "system",
    cityId: order.cityId ?? cityId,
    via: "webhook",
    correlationId: null,
  });
  if (
    outcome.action === "escalated" ||
    outcome.action === "supplier_conflict"
  ) {
    return outcome.action;
  }
  if (ticketed && order.kind === "flight") {
    return "ticketed";
  }
  return "confirmed";
}

async function failOrder(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  const order = await loadOrderByRef(deps, supplier, envelope.orderRef);
  if (order === null) {
    return "order_not_found";
  }
  if (!canTransition("travelOrder", order.state, "failed_released")) {
    if (order.state === "confirmed" || order.state === "ticketed") {
      // A late "failed" after a confirmation: stale for a monotonic ladder,
      // but a contradiction ops should see.
      await escalate(
        deps,
        order,
        SYSTEM_ACTOR,
        "late_failure_after_confirmation",
      );
    }
    return "already_resolved";
  }
  const release = await settlePayment(deps, "release", {
    orderId: order.id,
    userId: order.userId,
    amount: money(Number(order.priceMinor), order.currency),
    cityId: order.cityId ?? cityId,
    reason: "travel webhook release",
    actor: SYSTEM_ACTOR,
  });
  await withOutbox(deps.db, async (tx) => {
    const advance = await advanceOrder(tx, {
      order,
      to: "failed_released",
      actor: SYSTEM_ACTOR,
      actorType: "system",
      cityId: order.cityId ?? cityId,
      detail: { via: "webhook", releaseRef: release.ref },
      occurredAt: deps.now(),
      releasedMinor: release.amount.amountMinor,
    });
    return { result: advance.order, events: advance.events };
  });
  return "failed_released";
}

async function advanceLatestRefund(
  deps: TravelDeps,
  orderId: string,
  cityId: string | null,
  to: "supplier_confirmed" | "supplier_refund_pending" | "refunded_to_wallet",
): Promise<string> {
  const refund = await deps.db.travelRefund.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
  });
  if (refund === null) {
    return "refund_not_found";
  }
  if (!canTransition("travelRefund", refund.stage, to)) {
    return "already_at_stage";
  }
  await advanceRefund(deps, {
    refundId: refund.id,
    to,
    actor: SYSTEM_ACTOR,
    cityId: cityId ?? "",
    correlationId: null,
  });
  return `refund_${to}`;
}

async function advanceRefundByOrder(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  cityId: string,
  envelope: WebhookEnvelope,
  to: "supplier_confirmed" | "supplier_refund_pending" | "refunded_to_wallet",
): Promise<string> {
  const order = await loadOrderByRef(deps, supplier, envelope.orderRef);
  if (order === null) {
    return "order_not_found";
  }
  const refund = await deps.db.travelRefund.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: "desc" },
  });
  if (refund === null) {
    return "refund_not_found";
  }
  if (!canTransition("travelRefund", refund.stage, to)) {
    return "already_at_stage";
  }
  await advanceRefund(deps, {
    refundId: refund.id,
    to,
    actor: SYSTEM_ACTOR,
    cityId: order.cityId ?? cityId,
    correlationId: null,
    ...(typeof envelope.supplierRefs?.supplierRef === "string"
      ? { supplierRef: envelope.supplierRefs.supplierRef }
      : {}),
  });
  return `refund_${to}`;
}

async function raiseDisruption(
  deps: TravelDeps,
  supplier: LoadedSupplier,
  cityId: string,
  envelope: WebhookEnvelope,
): Promise<string> {
  const order = await loadOrderByRef(deps, supplier, envelope.orderRef);
  if (order === null || envelope.disruption === undefined) {
    return "order_not_found";
  }
  const d = envelope.disruption;
  await createDisruption(deps, {
    actor: SYSTEM_ACTOR,
    cityId: order.cityId ?? cityId,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function publishWebhookEvent(
  deps: TravelDeps,
  name:
    | "travel.webhook.received"
    | "travel.webhook.duplicate"
    | "travel.webhook.rejected",
  supplierId: string,
  externalId: string,
  type: string,
  cityId: string | null,
  signatureOk: boolean,
): Promise<void> {
  // eslint-disable-next-line require-await -- withOutbox's work callback is async by contract; this one only describes rows
  await withOutbox(deps.db, async () => ({
    result: undefined,
    events: [
      {
        name,
        aggregateType: "travel_webhook",
        aggregateId: `${supplierId}:${externalId}`,
        fromVersion: null,
        toVersion: 1,
        actor: SYSTEM_ACTOR,
        actorType: "system",
        cityId,
        idempotencyKey: `${name}:${supplierId}:${externalId}:${generateId("k")}`,
        occurredAt: deps.now(),
        payload: {
          supplier: supplierId,
          ref: externalId,
          type,
          signatureOk,
        },
      },
    ],
  }));
}

/**
 * The signed-webhook timestamp window, within the bounds the Duffel row schema
 * allows (30 s – 1 h). An out-of-range config value never widens the replay
 * window; it falls back to the 300 s default.
 */
function webhookTolerance(configured: unknown): number {
  return typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured >= 30 &&
    configured <= 3_600
    ? configured
    : 300;
}

function safeJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return { unparseable: true };
  }
}

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
