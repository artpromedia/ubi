/**
 * The travel port — flight/stay search, offer resolution, booking status and the
 * transactional booking step run inside an execution.
 *
 * Two rules from the handoff shape this interface:
 *  - Adapter capability is the only source of promises (rule #23): an offer
 *    carries its own price age, warnings and terms; the assistant never adds a
 *    guarantee the offer did not make.
 *  - No atomicity across suppliers (rule #25): `book` is per-item and returns
 *    that item's own state, so a partial outcome stays partial.
 *
 * Search volume is capped by the caller (rule #18). Ownership on `bookingStatus`
 * is enforced by travel-service against the forwarded actor; a foreign order id
 * returns `null`.
 *
 * WHO THE CALL IS MADE AS. travel-service believes one caller identity: the
 * gateway-signed `x-ubi-identity` context, required in production
 * (services/travel-service/src/middleware/auth.ts). This port therefore
 * RELAYS the context the user's own request arrived with — the one ask's
 * `gatewayAuth` verified and put in the request's identity relay scope
 * (lib/identity-relay.ts) — together with the city mirrors the gateway writes
 * from its claim and the request id. It never sends a plain `X-User-ID` /
 * `X-User-Role` in production, never presents the service key as a user, and
 * never takes an identity from a tool argument (tools only ever pass the
 * gateway-derived Actor and resource ids). Before round 7 it sent exactly
 * those plain headers plus `X-Service-Key`, which production travel-service
 * refuses (401), so every assistant travel call failed there.
 *
 *   - A relay for a different user than the Actor is refused here.
 *   - No relay (work outside a request, e.g. a background sweep) is refused
 *     here in production, before anything is sent. Outside production the
 *     documented unsigned development mode still sends the plain mirrors.
 *   - A relayed context past its 120 s lifetime is refused by travel-service
 *     (401), reported here as `unauthorized` — never as an outage, never
 *     retried under another identity.
 *
 * BACKGROUND READS. `executionOrderStatus` is the one call made with NO user
 * behind it: the service-key surface travel-service exposes for exactly this
 * (GET /internal/ask/grants/:grantId/orders/:orderId,
 * services/travel-service/src/routes/internal-ask.ts). It is addressed by the
 * order and grant ids on ask's persisted execution record, carries no
 * identity, and checks the owner travel-service reads from the order against
 * the actor on that record.
 */
import { ContractError } from "@ubi/contracts";

import {
  currentIdentityRelay,
  signedRelayHeaders,
} from "../lib/identity-relay";
import { toolLogger } from "../lib/logger";
import { isProductionEnvironment } from "../lib/ride-context";

import type { Actor } from "../ops/types";

export type TravelKind = "flight" | "stay";

export interface TravelOffer {
  readonly offerRef: string;
  readonly kind: TravelKind;
  readonly title: string;
  readonly subtitle: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly quotedAt: string;
  readonly warnings: readonly string[];
}

export interface ResolvedOffer {
  readonly offerRef: string;
  readonly kind: TravelKind;
  readonly title: string;
  readonly detail: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly termsVersion: string;
  readonly terms: readonly { text: string; tone: string }[];
}

export interface BookingStatusResult {
  readonly orderId: string;
  readonly state: string;
  readonly supplierRef: string | null;
}

/** One booked item's outcome. A partial failure is its own released state. */
export interface BookedItem {
  readonly kind: TravelKind;
  readonly state: string;
  readonly orderId: string | null;
  readonly supplierRef: string | null;
  readonly chargedMinor: number | null;
  readonly releasedMinor: number | null;
  readonly detail: string | null;
}

export interface FlightSearchInput {
  readonly origin: string;
  readonly destination: string;
  readonly departDate: string;
  readonly passengers: number;
}

export interface StaySearchInput {
  readonly city: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly guests: number;
}

export interface BookInput {
  readonly grantId: string;
  readonly offerRef: string;
  readonly idempotencyKey: string;
}

/**
 * What a background status read is addressed by — all of it from ask's own
 * persisted execution record, none of it from a caller or a model.
 */
export interface ExecutionOrderRef {
  readonly orderId: string;
  /** The grant the execution booked the order under. */
  readonly grantId: string;
  /** The execution's actor: the order must belong to this user. */
  readonly actorId: string;
}

export interface TravelPort {
  searchFlights(
    actor: Actor,
    input: FlightSearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]>;
  searchStays(
    actor: Actor,
    input: StaySearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]>;
  resolveOffer(actor: Actor, offerRef: string): Promise<ResolvedOffer | null>;
  bookingStatus(
    actor: Actor,
    orderId: string,
  ): Promise<BookingStatusResult | null>;
  book(actor: Actor, input: BookInput): Promise<BookedItem>;
  /**
   * The state of one order an execution booked, read with NO user request
   * behind it (a background sweep). `null` when travel-service has no such
   * order under that grant, or it belongs to someone other than the
   * execution's actor.
   */
  executionOrderStatus(
    ref: ExecutionOrderRef,
  ): Promise<BookingStatusResult | null>;
}

interface TravelHttpOptions {
  readonly baseUrl: string;
  /**
   * The key for travel-service's background-read surface
   * (TRAVEL_ASK_SERVICE_KEY there). Used ONLY by `executionOrderStatus`;
   * request-scoped calls relay the user's gateway context instead.
   */
  readonly internalServiceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** travel-service's order view carries `supplierRefs`; the assistant shows one. */
const SUPPLIER_REF_KEYS = ["pnr", "orderRef", "bookingRef"] as const;

function supplierRefOf(refs: unknown): string | null {
  if (refs === null || typeof refs !== "object" || Array.isArray(refs)) {
    return null;
  }
  const record = refs as Record<string, unknown>;
  for (const key of SUPPLIER_REF_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * travel-service's `GET /v1/travel/orders/:id` (OrderView: `id`, `state`,
 * `supplierRefs`) and the background read (`orderId`, `state`,
 * `supplierRefs`), as the one shape the assistant uses.
 */
function bookingStatusOf(body: Record<string, unknown>): BookingStatusResult {
  const orderId =
    typeof body.orderId === "string"
      ? body.orderId
      : typeof body.id === "string"
        ? body.id
        : "";
  const state = typeof body.state === "string" ? body.state : "unknown";
  const supplierRef =
    typeof body.supplierRef === "string"
      ? body.supplierRef
      : supplierRefOf(body.supplierRefs);
  return { orderId, state, supplierRef };
}

function identityRefused(): ContractError {
  return new ContractError(
    "unauthorized",
    "the travel service did not accept this request's identity; please ask again",
  );
}

export function createHttpTravelPort(options: TravelHttpOptions): TravelPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  /**
   * The identity headers for one request-scoped call, from the current
   * request's relay (lib/identity-relay.ts). Throws — before anything is
   * sent — when there is no relay in production, or the relay is for a
   * different user than the Actor the ops layer is acting for.
   */
  function identityHeaders(actor: Actor): Record<string, string> {
    const relay = currentIdentityRelay();
    if (relay !== undefined && relay.userId !== actor.id) {
      throw new ContractError(
        "forbidden",
        "the assistant can only act as the signed-in user",
        { reason: "relay_actor_mismatch" },
      );
    }
    if (relay?.kind === "signed") {
      return signedRelayHeaders(relay);
    }
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      // Fail closed: production travel-service believes only the gateway's
      // signed context, and nothing here may stand in for it.
      throw new ContractError(
        "unauthorized",
        "no verified caller identity to present to the travel service",
        { reason: "no_identity_relay" },
      );
    }
    // The documented unsigned development mode (no gateway in front).
    const headers: Record<string, string> = {
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    };
    if (relay?.cityId !== undefined && relay.cityId !== null) {
      headers["X-City-ID"] = relay.cityId;
    }
    if (relay?.requestId !== undefined && relay.requestId !== null) {
      headers["X-Request-ID"] = relay.requestId;
    }
    return headers;
  }

  async function send(
    path: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(
    path: string,
    method: "GET" | "POST",
    actor: Actor,
    body?: unknown,
  ): Promise<Response> {
    const response = await send(path, method, identityHeaders(actor), body);
    if (response.status === 401) {
      // Expired (past the context's 120 s), or otherwise not accepted: the
      // user asks again; nothing is retried under another identity.
      throw identityRefused();
    }
    return response;
  }

  function unavailable(): never {
    throw new ContractError(
      "service_unavailable",
      "travel search is not available right now",
    );
  }

  return {
    async searchFlights(actor, input, limit): Promise<readonly TravelOffer[]> {
      try {
        const response = await call(
          "/v1/travel/flights/search",
          "POST",
          actor,
          {
            ...input,
            limit,
          },
        );
        if (!response.ok) {
          unavailable();
        }
        const rows = (await response.json()) as { offers?: TravelOffer[] };
        return (rows.offers ?? []).slice(0, limit);
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "flight search failed");
        unavailable();
      }
    },
    async searchStays(actor, input, limit): Promise<readonly TravelOffer[]> {
      try {
        const response = await call("/v1/travel/stays/search", "POST", actor, {
          ...input,
          limit,
        });
        if (!response.ok) {
          unavailable();
        }
        const rows = (await response.json()) as { offers?: TravelOffer[] };
        return (rows.offers ?? []).slice(0, limit);
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "stay search failed");
        unavailable();
      }
    },
    async resolveOffer(actor, offerRef): Promise<ResolvedOffer | null> {
      try {
        const response = await call(
          `/v1/travel/offers/${encodeURIComponent(offerRef)}`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          unavailable();
        }
        return (await response.json()) as ResolvedOffer;
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "offer resolve failed");
        unavailable();
      }
    },
    async bookingStatus(actor, orderId): Promise<BookingStatusResult | null> {
      try {
        const response = await call(
          `/v1/travel/orders/${encodeURIComponent(orderId)}`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          unavailable();
        }
        return bookingStatusOf(
          (await response.json()) as Record<string, unknown>,
        );
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "booking status failed");
        unavailable();
      }
    },
    async book(actor, input): Promise<BookedItem> {
      try {
        const response = await call("/v1/travel/orders", "POST", actor, input);
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "the booking could not be submitted",
          );
        }
        return (await response.json()) as BookedItem;
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "book call failed");
        throw new ContractError(
          "service_unavailable",
          "the booking could not be submitted",
        );
      }
    },
    async executionOrderStatus(ref): Promise<BookingStatusResult | null> {
      const key = options.internalServiceKey;
      if (key === undefined || key.length === 0) {
        // Never an unauthenticated request, and never a user identity
        // borrowed for a read no user asked for.
        throw new ContractError(
          "service_unavailable",
          "background travel reads are not configured",
        );
      }
      try {
        // The service key and nothing else: no relay, no user mirror, no city.
        const response = await send(
          `/internal/ask/grants/${encodeURIComponent(ref.grantId)}/orders/${encodeURIComponent(ref.orderId)}`,
          "GET",
          { "X-Service-Key": key },
        );
        if (response.status === 404) {
          return null;
        }
        if (response.status === 401) {
          throw new ContractError(
            "unauthorized",
            "the travel service refused the background read's service key",
          );
        }
        if (!response.ok) {
          unavailable();
        }
        const body = (await response.json()) as Record<string, unknown>;
        // travel-service names the owner from the order itself; it must be
        // the actor ask recorded on the execution.
        if (body.ownerId !== ref.actorId) {
          toolLogger.warn(
            { orderId: ref.orderId },
            "a background travel read returned an order owned by someone else; ignoring it",
          );
          return null;
        }
        return bookingStatusOf(body);
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "background booking status failed");
        unavailable();
      }
    },
  };
}
