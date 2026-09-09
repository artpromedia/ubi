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
 * The HTTP adapter below is the real implementation. Tests substitute a fake;
 * nothing in `src/` ever does.
 */
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

interface PaymentHttpOptions {
  readonly baseUrl: string;
  readonly basePath?: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const RESPONSE_SHAPE_ERROR =
  "payment-service returned a response this service cannot read";

function parseResult(body: unknown, amount: Money): PaymentResult {
  if (typeof body !== "object" || body === null) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  const record = body as Record<string, unknown>;
  const ref = record.ref ?? record.id;
  if (typeof ref !== "string") {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  return {
    ref,
    entryId: typeof record.entryId === "string" ? record.entryId : null,
    amount,
    replayed: record.replayed === true,
  };
}

/**
 * Talks to payment-service over HTTP. Each op is idempotent on the scoped key
 * this service sends, so a retry after a network failure returns the original
 * posting rather than authorizing or capturing twice.
 */
export function createHttpPayment(options: PaymentHttpOptions): PaymentPort {
  const doFetch = options.fetchImpl ?? fetch;
  const basePath = options.basePath ?? "/v1/finance/travel";
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(op: PaymentOp, request: PaymentRequest): Promise<PaymentResult> {
    const url = `${options.baseUrl.replace(/\/+$/, "")}${basePath}/${op}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [IDEMPOTENCY_HEADER]: request.idempotencyKey,
      "X-City-ID": request.cityId,
      "X-User-ID": request.actor.id,
      "X-User-Role": request.actor.role,
    };
    if (options.serviceKey !== undefined) {
      headers["X-Service-Key"] = options.serviceKey;
    }

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
        const detail: unknown = await response.json().catch(() => undefined);
        const code =
          typeof detail === "object" &&
          detail !== null &&
          typeof (detail as { code?: unknown }).code === "string"
            ? (detail as { code: string }).code
            : null;
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
      paymentLogger.error({ err: error, op, orderId: request.orderId }, "payment call failed");
      throw new ContractError(
        "service_unavailable",
        `payment-service is not reachable; the ${op} did not happen`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    authorize: (request) => call("authorize", request),
    capture: (request) => call("capture", request),
    release: (request) => call("release", request),
    refund: (request) => call("refund", request),
  };
}
