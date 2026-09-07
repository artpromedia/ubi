/**
 * The payment port.
 *
 * The double-entry ledger and the pre-authorization holds live in
 * payment-service and stay there (CLAUDE.md #4). Bites never posts a journal
 * line itself and never captures money on its own authority: it asks
 * payment-service to place a hold when an order is created, to release that hold
 * when the order is rejected, to capture it when the food is delivered, and to
 * post a refund to the customer's wallet when an issue is made good.
 *
 * The interface is deliberately narrow and carries intent — which order, which
 * customer, how much, why — with a scoped idempotency key so a retry after a
 * network failure returns the original result rather than holding, releasing or
 * refunding twice. The HTTP adapter below is the real implementation; tests
 * substitute a fake, and nothing in `src/` ever does.
 */
import { ContractError, IDEMPOTENCY_HEADER, type Money } from "@ubi/contracts";

import { paymentLogger } from "./lib/logger.js";

import type { Actor } from "./lib/types.js";

export interface AuthorizeRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly paymentMethodId: string;
  readonly cityId: string;
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export interface Authorization {
  /** The payment-service intent id; stored on the order, never captured yet. */
  readonly paymentIntentId: string;
}

export interface ReleaseRequest {
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly reason: string;
  readonly cityId: string;
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export interface CaptureRequest {
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly amount: Money;
  readonly cityId: string;
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export interface RefundRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly reason: string;
  readonly cityId: string;
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export interface RefundResult {
  /** The journal entry payment-service posted for the refund. */
  readonly entryId: string;
  readonly replayed: boolean;
}

export interface PaymentPort {
  /** Place a pre-authorization hold. Returns the intent id; nothing is captured. */
  authorize(request: AuthorizeRequest): Promise<Authorization>;
  /** Release a hold with no capture and no transfer (order rejected). */
  releaseAuth(request: ReleaseRequest): Promise<void>;
  /** Capture a previously placed hold (food delivered). */
  capture(request: CaptureRequest): Promise<void>;
  /** Post a refund to the customer's wallet as a balanced journal entry. */
  refundToWallet(request: RefundRequest): Promise<RefundResult>;
}

interface PaymentHttpOptions {
  readonly baseUrl: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

function headersFor(
  idempotencyKey: string,
  cityId: string,
  actor: Actor,
  serviceKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [IDEMPOTENCY_HEADER]: idempotencyKey,
    "X-City-ID": cityId,
    "X-User-ID": actor.id,
    "X-User-Role": actor.role,
  };
  if (serviceKey !== undefined) {
    headers["X-Service-Key"] = serviceKey;
  }
  return headers;
}

/**
 * Talks to payment-service over HTTP. Each endpoint is idempotent on the scoped
 * key this module sends; a failure is surfaced with the payment-service error
 * code preserved so a caller sees "the payment method is unavailable", not
 * "something failed".
 */
export function createHttpPayments(options: PaymentHttpOptions): PaymentPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(
    path: string,
    idempotencyKey: string,
    cityId: string,
    actor: Actor,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: headersFor(idempotencyKey, cityId, actor, options.serviceKey),
        signal: controller.signal,
        body: JSON.stringify(body),
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
          { status: response.status, code, path },
          "payment-service refused the request",
        );
        throw new ContractError(
          "service_unavailable",
          "the payment service could not complete the request",
          { status: response.status, paymentCode: code },
        );
      }
      return (await response.json().catch(() => ({}))) as unknown;
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      paymentLogger.error({ err: error, path }, "payment-service call failed");
      throw new ContractError(
        "service_unavailable",
        "the payment service is not reachable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function stringField(body: unknown, field: string): string {
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>)[field] === "string"
    ) {
      return (body as Record<string, string>)[field] as string;
    }
    throw new ContractError(
      "service_unavailable",
      "the payment service returned a response this module cannot read",
      { field },
    );
  }

  return {
    async authorize(request: AuthorizeRequest): Promise<Authorization> {
      const body = await call(
        "/v1/payments/authorizations",
        request.idempotencyKey,
        request.cityId,
        request.actor,
        {
          orderId: request.orderId,
          userId: request.userId,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          paymentMethodId: request.paymentMethodId,
          capture: false,
        },
      );
      return { paymentIntentId: stringField(body, "paymentIntentId") };
    },

    async releaseAuth(request: ReleaseRequest): Promise<void> {
      await call(
        `/v1/payments/authorizations/${request.paymentIntentId}/release`,
        request.idempotencyKey,
        request.cityId,
        request.actor,
        { orderId: request.orderId, reason: request.reason },
      );
    },

    async capture(request: CaptureRequest): Promise<void> {
      await call(
        `/v1/payments/authorizations/${request.paymentIntentId}/capture`,
        request.idempotencyKey,
        request.cityId,
        request.actor,
        {
          orderId: request.orderId,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
        },
      );
    },

    async refundToWallet(request: RefundRequest): Promise<RefundResult> {
      const body = await call(
        "/v1/payments/refunds",
        request.idempotencyKey,
        request.cityId,
        request.actor,
        {
          orderId: request.orderId,
          userId: request.userId,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          reason: request.reason,
        },
      );
      return {
        entryId: stringField(body, "entryId"),
        replayed:
          typeof body === "object" &&
          body !== null &&
          (body as { replayed?: unknown }).replayed === true,
      };
    },
  };
}
