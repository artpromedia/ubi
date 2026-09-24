/**
 * The ride port — travel-service's client onto ride-service's Book for Later
 * marketplace (contracts/openapi/marketplace.yaml, served by ride-service under
 * /v1/mp). An airport transfer is a marketplace RIDE, so it goes through the
 * SAME endpoints and authz a rider's own app uses: travel-service acts AS the
 * traveller (role `rider`, the transfer's city), with the signed internal
 * identity ride-service's middleware verifies (../lib/ride-context.ts). It
 * never carries an elevated privilege and never touches a balance, a
 * commission, a bid or a driver directly.
 *
 * Which calls do what:
 *   - `quote`                   READ, non-binding: the server's fare envelope
 *                               and routed duration for the leg.
 *   - `createScheduledRequest`  ACTION, spends nothing: stores a scheduled
 *                               request ride-service publishes near pickup.
 *                               No driver is secured by it.
 *   - `getScheduledRequest`     READ: its state, and the published request's.
 *   - `cancelScheduledRequest`  ACTION: cancels an unpublished intent (free).
 *   - `approveScheduledRequest` ACTION: the traveller's renewed approval of a
 *                               new maximum when refreshed terms exceed theirs.
 *   - `cancelRequest`           ACTION: cancels a published request under the
 *                               ride's own rules (free while open; ride-service
 *                               decides what an awarded one allows).
 * The award itself — the only binding, money-moving step — is the traveller's
 * own selection in the ride app. This port has no way to make it.
 *
 * Every response is parsed against the contract schema ride-service serves
 * (@ubi/contracts marketplace.ts) before anything reads it. Money is exactly
 * what the server sent; a malformed answer is `RideUnavailableError`, never a
 * guessed amount.
 *
 * Failure semantics the orchestrator relies on:
 *   - `RideRefusal` — ride-service answered with a canonical 4xx code. It is
 *     definitive: ride-service stores an idempotent result only on success, so
 *     a refusal means nothing was created under that key.
 *   - `RideUnavailableError` — no definite answer (transport, timeout, 5xx, a
 *     refused delegation, an unreadable body). The outcome is UNKNOWN; the
 *     caller retries later under the SAME key and body, never a new one.
 */
import { z } from "zod";

import {
  ContractError,
  ERROR_CODES,
  MpQuoteEnvelopeSchema,
  MpScheduledRequestSchema,
  type ErrorCode,
  type Money,
  type MpCreateScheduledRequest,
  type MpQuoteEnvelope,
  type MpScheduledRequest,
} from "@ubi/contracts";

import { logger } from "../lib/logger";
import { riderIdentityHeaders, type RidePrincipal } from "../lib/ride-context";

export interface RidePlace {
  readonly lat: number;
  readonly lng: number;
}

export interface RideQuoteInput {
  readonly vehicleClass: string;
  readonly pickup: RidePlace;
  readonly dropoff: RidePlace;
}

export interface ApproveScheduledInput {
  readonly expectedVersion: number;
  readonly maxFareMinor: Money;
}

export interface RideRequestState {
  readonly requestId: string;
  readonly state: string;
}

export interface RidePort {
  quote(
    principal: RidePrincipal,
    input: RideQuoteInput,
  ): Promise<MpQuoteEnvelope>;
  createScheduledRequest(
    principal: RidePrincipal,
    body: MpCreateScheduledRequest,
    idempotencyKey: string,
  ): Promise<MpScheduledRequest>;
  /** `null` when ride-service has no such scheduled request for the traveller. */
  getScheduledRequest(
    principal: RidePrincipal,
    scheduledRequestId: string,
  ): Promise<MpScheduledRequest | null>;
  cancelScheduledRequest(
    principal: RidePrincipal,
    scheduledRequestId: string,
    idempotencyKey: string,
  ): Promise<MpScheduledRequest>;
  approveScheduledRequest(
    principal: RidePrincipal,
    scheduledRequestId: string,
    input: ApproveScheduledInput,
    idempotencyKey: string,
  ): Promise<MpScheduledRequest>;
  cancelRequest(
    principal: RidePrincipal,
    requestId: string,
    idempotencyKey: string,
  ): Promise<RideRequestState>;
}

/** ride-service answered with a canonical refusal: definitive, nothing created. */
export class RideRefusal extends ContractError {
  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> | undefined,
    /** The HTTP status ride-service answered with. */
    readonly upstreamStatus: number,
  ) {
    super(code, message, details);
    this.name = "RideRefusal";
  }
}

/** No definite answer from ride-service: the outcome is unknown, retry later. */
export class RideUnavailableError extends ContractError {
  constructor(
    message: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ) {
    super("service_unavailable", message, {
      reason,
      outcome: "unknown",
      ...extra,
    });
    this.name = "RideUnavailableError";
  }
}

export interface RideHttpOptions {
  readonly baseUrl: string;
  /** RIDE_INTERNAL_CONTEXT_SECRET key list; first signs. Empty: dev only. */
  readonly signingKeys: readonly string[];
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** The signing clock; injectable so a test can pin a wire vector. */
  readonly now?: () => Date;
}

const CANONICAL_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/** Codes that say "not now", never "no": retried, not treated as a refusal. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "rate_limited",
  "service_unavailable",
  "internal_error",
  "config_unavailable",
]);

const RequestStateWire = z
  .object({ requestId: z.string().min(1), state: z.string().min(1) })
  .passthrough();

function parseWire<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RideUnavailableError(
      `ride-service returned an unreadable ${what}`,
      "malformed_ride_response",
      {
        what,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
    );
  }
  return parsed.data;
}

async function refusalFrom(
  response: Response,
  fallbackMessage: string,
): Promise<ContractError> {
  let body: { code?: unknown; message?: unknown; details?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // an unreadable error body is no answer at all
  }
  if (response.status === 401 || body.code === "unauthorized") {
    // ride-service refused the DELEGATED identity (unsigned, expired, wrong
    // key): a travel ↔ ride misconfiguration, never the traveller's session.
    logger.error(
      { status: response.status },
      "ride-service refused travel-service's delegated identity",
    );
    return new RideUnavailableError(
      "the ride marketplace is not available right now",
      "delegation_refused",
      { status: response.status },
    );
  }
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 429 &&
    typeof body.code === "string" &&
    CANONICAL_CODES.has(body.code) &&
    !TRANSIENT_CODES.has(body.code)
  ) {
    return new RideRefusal(
      body.code as ErrorCode,
      typeof body.message === "string" ? body.message : fallbackMessage,
      typeof body.details === "object" && body.details !== null
        ? (body.details as Record<string, unknown>)
        : undefined,
      response.status,
    );
  }
  return new RideUnavailableError(fallbackMessage, "ride_upstream_error", {
    status: response.status,
  });
}

export function createHttpRidePort(options: RideHttpOptions): RidePort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());
  const signingKeys = [...options.signingKeys];

  async function call(
    path: string,
    method: "GET" | "POST",
    principal: RidePrincipal,
    idempotencyKey?: string,
    body?: unknown,
  ): Promise<Response> {
    // Signed per call, at send time: ride-service bounds the timestamp's age,
    // so a retry is a fresh signature, never a replayed one.
    const identity = riderIdentityHeaders(signingKeys, principal, now());
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(idempotencyKey === undefined
            ? {}
            : { "idempotency-key": idempotencyKey }),
          // Identity last: nothing else can shadow it.
          ...identity,
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new RideUnavailableError(
        aborted
          ? "ride-service did not answer in time"
          : "ride-service could not be reached",
        aborted ? "ride_timeout" : "ride_unreachable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(response: Response, what: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new RideUnavailableError(
        `ride-service returned an unreadable ${what}`,
        "malformed_ride_response",
        { what },
      );
    }
  }

  const scheduledPath = (id: string): string =>
    `/v1/mp/scheduled-requests/${encodeURIComponent(id)}`;

  return {
    async quote(principal, input) {
      const query = new URLSearchParams({
        service: "ride",
        vehicleClass: input.vehicleClass,
        pickupLat: String(input.pickup.lat),
        pickupLng: String(input.pickup.lng),
        dropoffLat: String(input.dropoff.lat),
        dropoffLng: String(input.dropoff.lng),
      });
      const response = await call(
        `/v1/mp/quote?${query.toString()}`,
        "GET",
        principal,
      );
      if (!response.ok) {
        throw await refusalFrom(response, "a ride quote is not available");
      }
      return parseWire(
        MpQuoteEnvelopeSchema,
        await json(response, "quote"),
        "quote",
      );
    },

    async createScheduledRequest(principal, body, idempotencyKey) {
      const response = await call(
        "/v1/mp/scheduled-requests",
        "POST",
        principal,
        idempotencyKey,
        body,
      );
      if (!response.ok) {
        throw await refusalFrom(response, "the ride could not be scheduled");
      }
      return parseWire(
        MpScheduledRequestSchema,
        await json(response, "scheduled request"),
        "scheduled request",
      );
    },

    async getScheduledRequest(principal, scheduledRequestId) {
      const response = await call(
        scheduledPath(scheduledRequestId),
        "GET",
        principal,
      );
      if (response.status === 404) {
        // Only ride-service's own canonical `not_found` means "no such
        // scheduled request for this traveller". A bare 404 (a route that is
        // not mounted, a misrouted base URL) is no answer at all: treating it
        // as "missing" would fail a transfer whose ride may still be live.
        const refusal = await refusalFrom(
          response,
          "the scheduled ride could not be read",
        );
        if (refusal instanceof RideRefusal && refusal.code === "not_found") {
          return null;
        }
        throw refusal instanceof RideRefusal
          ? new RideUnavailableError(
              "the scheduled ride could not be read",
              "ride_upstream_error",
              { status: 404, rideCode: refusal.code },
            )
          : refusal;
      }
      if (!response.ok) {
        throw await refusalFrom(
          response,
          "the scheduled ride could not be read",
        );
      }
      return parseWire(
        MpScheduledRequestSchema,
        await json(response, "scheduled request"),
        "scheduled request",
      );
    },

    async cancelScheduledRequest(
      principal,
      scheduledRequestId,
      idempotencyKey,
    ) {
      const response = await call(
        `${scheduledPath(scheduledRequestId)}/cancel`,
        "POST",
        principal,
        idempotencyKey,
      );
      if (!response.ok) {
        throw await refusalFrom(
          response,
          "the scheduled ride could not be cancelled",
        );
      }
      return parseWire(
        MpScheduledRequestSchema,
        await json(response, "scheduled request"),
        "scheduled request",
      );
    },

    async approveScheduledRequest(
      principal,
      scheduledRequestId,
      input,
      idempotencyKey,
    ) {
      const response = await call(
        `${scheduledPath(scheduledRequestId)}/approve`,
        "POST",
        principal,
        idempotencyKey,
        {
          expectedVersion: input.expectedVersion,
          maxFareMinor: input.maxFareMinor,
        },
      );
      if (!response.ok) {
        throw await refusalFrom(
          response,
          "the new limit could not be approved",
        );
      }
      return parseWire(
        MpScheduledRequestSchema,
        await json(response, "scheduled request"),
        "scheduled request",
      );
    },

    async cancelRequest(principal, requestId, idempotencyKey) {
      const response = await call(
        `/v1/mp/requests/${encodeURIComponent(requestId)}/cancel`,
        "POST",
        principal,
        idempotencyKey,
      );
      if (!response.ok) {
        throw await refusalFrom(
          response,
          "the ride request could not be cancelled",
        );
      }
      return parseWire(
        RequestStateWire,
        await json(response, "request"),
        "request",
      );
    },
  };
}
