/**
 * The payment port.
 *
 * The double-entry ledger lives in payment-service and stays there (CLAUDE.md
 * #4). Travel never opens a second ledger and never stores a balance as truth:
 * it asks payment-service to authorize a hold per item, capture on confirmation,
 * release on failure and refund on cancellation, and records back only the
 * amounts payment-service reports (held / charged / released) as a derived
 * snapshot on the order.
 *
 * The interface is deliberately narrow — it carries intent (which order, which
 * traveller, how much, why) and the money is in minor units with an explicit
 * currency. FX is never guessed here: an order that settles in a different
 * currency carries an explicit `fxRate` from a supplier quote, and the amount
 * authorized is already in the charge currency.
 *
 * THE ENDPOINT. By default the adapter posts to payment-service's mounted
 * `/v1/finance/travel/{authorize,capture,release,refund}` (payment-service
 * src/finance/travel-routes.ts, contract contracts/openapi/finance-travel.yaml)
 * and reads `/v1/finance/travel/orders/{orderId}` for status. No environment
 * override is needed for that; `PAYMENT_TRAVEL_PATH` (src/wiring.ts) only
 * exists to point a non-standard deployment elsewhere. payment-service keys
 * each item on the order id (one order per cart item) and settles captures to
 * its dedicated `travel_clearing` account — never a marketplace commission
 * hold.
 *
 * AUTH. The endpoint is service-to-service: every call carries `X-Service-Key`
 * from INTERNAL_SERVICE_KEY, which must hold the SAME value payment-service
 * checks (its `internalServiceAuth` fails closed when either side is unset).
 * `X-User-ID`/`X-User-Role` name who this service acted for; payment-service
 * records them as context, not as authentication.
 *
 * AMBIGUITY. A call that times out or loses its connection may or may not have
 * happened on the payment side, so it is reported as unknown, never as "did
 * not happen". Every op is idempotent on the scoped key this service sends: a
 * retry with the SAME key answers the original posting, and `status()` reads
 * what payment-service actually recorded for an order.
 *
 * The HTTP adapter below is the real implementation. Tests substitute a fake;
 * nothing in `src/` ever does.
 */
import { z } from "zod";

import { ContractError, IDEMPOTENCY_HEADER, type Money } from "@ubi/contracts";

import { paymentLogger } from "../lib/logger";

export type PaymentOp = "authorize" | "capture" | "release" | "refund";

export interface PaymentRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly cityId: string;
  /** The ride/stay item being paid for, for the ledger's counterpart reference. */
  readonly reason: string;
  /** Scoped key; a replay must return the original posting, not post a second. */
  readonly idempotencyKey: string;
  readonly actor: { readonly id: string; readonly role: string };
}

export interface PaymentResult {
  /** payment-service's id for the hold / capture / release / refund. */
  readonly ref: string;
  /** The double-entry journal entry, when the op posted one. */
  readonly entryId: string | null;
  readonly amount: Money;
  /** True when payment-service returned a posting a previous attempt already made. */
  readonly replayed: boolean;
}

export interface PaymentPort {
  authorize(request: PaymentRequest): Promise<PaymentResult>;
  capture(request: PaymentRequest): Promise<PaymentResult>;
  release(request: PaymentRequest): Promise<PaymentResult>;
  refund(request: PaymentRequest): Promise<PaymentResult>;
}

const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().min(3).max(3),
});

const PaymentStatusSchema = z.object({
  item: z.object({
    itemId: z.string(),
    orderId: z.string(),
    state: z.enum([
      "authorized",
      "captured",
      "released",
      "partially_refunded",
      "refunded",
    ]),
    authorized: MoneySchema,
    captured: MoneySchema,
    refunded: MoneySchema,
    refundable: MoneySchema,
    captureEntryId: z.string().nullable(),
  }),
  ops: z.array(
    z.object({
      ref: z.string(),
      op: z.enum(["authorize", "capture", "release", "refund"]),
      clientKey: z.string(),
      amount: MoneySchema,
      entryId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

/** What payment-service has recorded for one order item, read back for reconciliation. */
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/** The HTTP adapter also reads status — the reconciliation path after an ambiguous call. */
export interface HttpPaymentPort extends PaymentPort {
  /**
   * The order item as payment-service holds it, with every op recorded
   * against it (and the key each arrived under). `null` means payment-service
   * has no authorization for the order at all.
   */
  status(orderId: string): Promise<PaymentStatus | null>;
}

interface PaymentHttpOptions {
  readonly baseUrl: string;
  readonly basePath?: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const RESPONSE_SHAPE_ERROR =
  "payment-service returned a response this service cannot read";

function parseResult(body: unknown, requested: Money): PaymentResult {
  if (typeof body !== "object" || body === null) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  const record = body as Record<string, unknown>;
  const ref = record.ref ?? record.id;
  if (typeof ref !== "string") {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  // Record back what payment-service says moved, not what was asked for; a
  // reply in another currency is a contract break, never re-denominated here.
  const reported = MoneySchema.safeParse(record.amount);
  if (reported.success && reported.data.currency !== requested.currency) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR, {
      requestedCurrency: requested.currency,
      reportedCurrency: reported.data.currency,
    });
  }
  return {
    ref,
    entryId: typeof record.entryId === "string" ? record.entryId : null,
    amount: reported.success ? reported.data : requested,
    replayed: record.replayed === true,
  };
}

async function errorCodeOf(response: Response): Promise<string | null> {
  const detail: unknown = await response.json().catch(() => undefined);
  return typeof detail === "object" &&
    detail !== null &&
    typeof (detail as { code?: unknown }).code === "string"
    ? (detail as { code: string }).code
    : null;
}

/**
 * Talks to payment-service over HTTP. Each op is idempotent on the scoped key
 * this service sends, so a retry after a network failure returns the original
 * posting rather than authorizing or capturing twice.
 */
export function createHttpPayment(
  options: PaymentHttpOptions,
): HttpPaymentPort {
  const doFetch = options.fetchImpl ?? fetch;
  const basePath = options.basePath ?? "/v1/finance/travel";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const root = `${options.baseUrl.replace(/\/+$/, "")}${basePath}`;

  function serviceHeaders(): Record<string, string> {
    return options.serviceKey === undefined
      ? {}
      : { "X-Service-Key": options.serviceKey };
  }

  async function call(
    op: PaymentOp,
    request: PaymentRequest,
  ): Promise<PaymentResult> {
    const url = `${root}/${op}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [IDEMPOTENCY_HEADER]: request.idempotencyKey,
      "X-City-ID": request.cityId,
      "X-User-ID": request.actor.id,
      "X-User-Role": request.actor.role,
      ...serviceHeaders(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await doFetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          orderId: request.orderId,
          userId: request.userId,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          reason: request.reason,
        }),
      });
      if (!response.ok) {
        const code = await errorCodeOf(response);
        paymentLogger.error(
          { status: response.status, code, op, orderId: request.orderId },
          "payment-service refused the posting",
        );
        throw new ContractError(
          "service_unavailable",
          `payment-service could not ${op} this order`,
          { status: response.status, paymentCode: code },
        );
      }
      return parseResult(await response.json(), request.amount);
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      paymentLogger.error(
        { err: error, op, orderId: request.orderId },
        "payment call failed; outcome unknown",
      );
      // The request may have been applied before the connection dropped or
      // the timer fired: say so, and point at the two safe ways forward.
      throw new ContractError(
        "service_unavailable",
        `payment-service did not answer; whether the ${op} happened is unknown — retry with the same idempotency key or read the order's payment status`,
        { op, orderId: request.orderId, outcome: "unknown" },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function status(orderId: string): Promise<PaymentStatus | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await doFetch(
        `${root}/orders/${encodeURIComponent(orderId)}`,
        { method: "GET", headers: serviceHeaders(), signal: controller.signal },
      );
      if (response.status === 404) {
        const code = await errorCodeOf(response);
        if (code === "not_found") {
          return null;
        }
      }
      if (!response.ok) {
        throw new ContractError(
          "service_unavailable",
          "payment-service could not report this order's payment status",
          { status: response.status },
        );
      }
      const parsed = PaymentStatusSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      paymentLogger.error(
        { err: error, orderId },
        "payment status read failed",
      );
      throw new ContractError(
        "service_unavailable",
        "payment-service is not reachable; the order's payment status is unknown",
        { orderId },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    authorize: async (request) => {
      const result = await call("authorize", request);
      return result;
    },
    capture: async (request) => {
      const result = await call("capture", request);
      return result;
    },
    release: async (request) => {
      const result = await call("release", request);
      return result;
    },
    refund: async (request) => {
      const result = await call("refund", request);
      return result;
    },
    status,
  };
}
