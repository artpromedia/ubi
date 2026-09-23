/**
 * Supplier webhook verification and parsing, one codec per adapter.
 *
 * A codec answers two questions, in this order and never the other way round:
 *
 *  1. Is this delivery authentic? (`verify` — over the RAW body bytes, with a
 *     constant-time comparison.) Nothing about an unverified body is trusted,
 *     including its event id.
 *  2. What does it say? (`parse` — into a normalized event.) Supplier events
 *     are TRIGGERS: Duffel v2 events carry only ids, and LiteAPI events echo a
 *     request/response pair. The ops layer never advances an order from the
 *     payload's claims; it asks the supplier for the order's current state by
 *     UBI's reference and converges to that, monotonically. That makes
 *     duplicates harmless and out-of-order delivery irrelevant.
 *
 * Schemes:
 *  - Duffel: `X-Duffel-Signature: t=<unix seconds>,v1=<hex>` where v1 is
 *    HMAC-SHA256(secret, `${t}.${rawBody}`), lower-case hex (Duffel guide
 *    "Receiving Webhooks"). The timestamp must be within the configured
 *    tolerance, so a captured delivery cannot be replayed later.
 *  - LiteAPI: the dashboard's "Authentication Token", sent verbatim as the
 *    `authorization` header. It is a static shared secret — LiteAPI signs
 *    nothing and sends no timestamp — so replay protection rests on event-id
 *    dedupe plus state-lookup processing; that limit is stated, not papered
 *    over.
 *  - fixture: the DEV/TEST HMAC-hex `X-Signature` over the body
 *    (./signature.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export interface WebhookVerification {
  readonly ok: boolean;
  readonly reason?: string;
}

export type SupplierEventAction =
  /** Look the order up by our reference and converge to what the supplier says. */
  | "converge"
  /** The supplier says a booking attempt failed; confirm by lookup, then fail it. */
  | "creation_failed"
  /** A cancellation (ours) was confirmed: the refund's supplier leg is done. */
  | "cancellation_confirmed"
  /** An airline changed the schedule: raise a disruption. */
  | "airline_change"
  /** Informational only (ping, payments, other verticals). */
  | "record";

export interface NormalizedSupplierEvent {
  /** The supplier's event id — the dedupe key. */
  readonly externalId: string;
  readonly eventType: string;
  /** The object the event is about (Duffel `idempotency_key`, a booking id). */
  readonly objectRef: string | null;
  readonly occurredAt: Date | null;
  /** True for a live-mode event, false for test/sandbox, null if unstated. */
  readonly liveMode: boolean | null;
  readonly ourRef: string | null;
  readonly supplierOrderRef: string | null;
  readonly supplierOfferRef: string | null;
  readonly action: SupplierEventAction;
}

function safeEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    // Compare against itself to keep timing independent of where they differ.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Duffel
// ---------------------------------------------------------------------------

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, lower-case hex (Duffel's scheme). */
export function computeDuffelSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifyDuffelSignature(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  now: Date,
  toleranceSec: number,
): WebhookVerification {
  if (secret.length === 0) {
    return { ok: false, reason: "webhook_secret_not_provisioned" };
  }
  if (header === null || header === undefined || header.length === 0) {
    return { ok: false, reason: "signature_missing" };
  }
  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      candidates.push(value.toLowerCase());
    }
  }
  if (
    timestamp === null ||
    !/^\d{1,12}$/.test(timestamp) ||
    candidates.length === 0
  ) {
    return { ok: false, reason: "signature_malformed" };
  }
  const skew = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (skew > toleranceSec) {
    return { ok: false, reason: "signature_timestamp_out_of_tolerance" };
  }
  const expected = computeDuffelSignature(secret, timestamp, rawBody);
  const matched = candidates.some((candidate) =>
    safeEqual(expected, candidate),
  );
  return matched ? { ok: true } : { ok: false, reason: "signature_invalid" };
}

const DuffelEvent = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    idempotency_key: z.string().nullable().optional(),
    live_mode: z.boolean().optional(),
    created_at: z.string().nullable().optional(),
    data: z
      .object({ object: z.record(z.unknown()).nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

function stringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  // Duffel writes both ISO 8601 and "2020-04-11 15:48:11.642000+00:00".
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function parseDuffelEvent(raw: unknown): NormalizedSupplierEvent {
  const event = DuffelEvent.parse(raw);
  const object = event.data?.object ?? null;
  const base = {
    externalId: event.id,
    eventType: event.type,
    objectRef: event.idempotency_key ?? stringField(object, "id"),
    occurredAt: parseDate(event.created_at),
    liveMode: event.live_mode ?? null,
    ourRef: null,
  };
  // Duffel's own example `order.created` event prints `data.object` empty and
  // carries the order id only as `idempotency_key` ("an identifier tied to the
  // triggering action", `ord_…`). Only an `ord_` id is taken from there.
  const idempotencyOrder =
    typeof event.idempotency_key === "string" &&
    /^ord_[A-Za-z0-9]+$/.test(event.idempotency_key)
      ? event.idempotency_key
      : null;
  switch (event.type) {
    case "order.created":
      return {
        ...base,
        supplierOrderRef: stringField(object, "id") ?? idempotencyOrder,
        supplierOfferRef: stringField(object, "offer_id"),
        action: "converge",
      };
    case "order.creation_failed":
      return {
        ...base,
        supplierOrderRef: null,
        supplierOfferRef: stringField(object, "offer_id"),
        action: "creation_failed",
      };
    case "air.order.changed":
      return {
        ...base,
        supplierOrderRef: stringField(object, "order_id"),
        supplierOfferRef: null,
        action: "converge",
      };
    case "order.airline_initiated_change_detected": {
      const id = stringField(object, "id");
      return {
        ...base,
        supplierOrderRef:
          id !== null && id.startsWith("ord_")
            ? id
            : stringField(object, "order_id"),
        supplierOfferRef: null,
        action: "airline_change",
      };
    }
    case "order_cancellation.confirmed":
      return {
        ...base,
        supplierOrderRef: stringField(object, "order_id"),
        supplierOfferRef: null,
        action: "cancellation_confirmed",
      };
    default:
      // ping.triggered, air.payment.*, airline credits, and other Duffel
      // verticals (stays.*, cars.*) — recorded, never applied to a flight.
      return {
        ...base,
        supplierOrderRef: null,
        supplierOfferRef: null,
        action: "record",
      };
  }
}

// ---------------------------------------------------------------------------
// LiteAPI
// ---------------------------------------------------------------------------

export function verifyLiteApiToken(
  expected: string,
  provided: string | null | undefined,
): WebhookVerification {
  if (expected.length === 0) {
    return { ok: false, reason: "webhook_secret_not_provisioned" };
  }
  if (provided === null || provided === undefined || provided.length === 0) {
    return { ok: false, reason: "signature_missing" };
  }
  // The dashboard token is sent verbatim; tolerate a "Bearer " prefix.
  const token = provided.startsWith("Bearer ") ? provided.slice(7) : provided;
  return safeEqual(expected, token)
    ? { ok: true }
    : { ok: false, reason: "signature_invalid" };
}

const LiteEvent = z
  .object({
    event_id: z.string().min(1),
    event_name: z.string().min(1),
    request: z.string().nullable().optional(),
    response: z.string().nullable().optional(),
    sandbox: z.union([z.boolean(), z.number()]).nullable().optional(),
  })
  .passthrough();

function jsonObject(
  text: string | null | undefined,
): Record<string, unknown> | null {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const LITE_CONVERGE = new Set([
  "booking.book",
  "booking.book.hotelConfirmationNumber",
  "booking.amendment",
  "booking.amendment.relocation",
  "booking.rebook.rfn",
  "booking.rebook.nrfn",
]);

export function parseLiteApiEvent(raw: unknown): NormalizedSupplierEvent {
  const event = LiteEvent.parse(raw);
  // `request` and `response` are stringified JSON (LiteAPI webhooks guide).
  const request = jsonObject(event.request);
  const response = jsonObject(event.response);
  const responseData =
    typeof response?.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : null;
  const bookingId =
    stringField(response, "bookingId") ??
    stringField(responseData, "bookingId") ??
    stringField(request, "bookingId");
  const clientReference =
    stringField(request, "clientReference") ??
    stringField(response, "clientReference") ??
    stringField(responseData, "clientReference");
  const sandbox = event.sandbox;
  let action: SupplierEventAction = "record";
  if (event.event_name.startsWith("flight.")) {
    // Flight events never reach a stay order (flights are never inferred
    // from the hotel supplier).
    action = "record";
  } else if (LITE_CONVERGE.has(event.event_name)) {
    action = "converge";
  } else if (event.event_name === "booking.book_error") {
    action = "creation_failed";
  } else if (
    event.event_name === "booking.cancel" ||
    event.event_name === "booking.refund"
  ) {
    action = "cancellation_confirmed";
  }
  return {
    externalId: event.event_id,
    eventType: event.event_name,
    objectRef: bookingId ?? clientReference,
    occurredAt: null,
    liveMode:
      sandbox === null || sandbox === undefined
        ? null
        : !(sandbox === true || sandbox === 1),
    ourRef: clientReference,
    supplierOrderRef: bookingId,
    supplierOfferRef: stringField(request, "offerId"),
    action,
  };
}
