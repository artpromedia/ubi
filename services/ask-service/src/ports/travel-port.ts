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
 */
import { ContractError } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

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
}

interface TravelHttpOptions {
  readonly baseUrl: string;
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpTravelPort(options: TravelHttpOptions): TravelPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  function headers(actor: Actor): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    };
    if (options.serviceKey !== undefined) {
      h["X-Service-Key"] = options.serviceKey;
    }
    return h;
  }

  async function call(
    path: string,
    method: "GET" | "POST",
    actor: Actor,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: headers(actor),
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
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
        const response = await call("/v1/travel/flights/search", "POST", actor, {
          ...input,
          limit,
        });
        if (!response.ok) {
          unavailable();
        }
        const rows = (await response.json()) as { offers?: TravelOffer[] };
        return (rows.offers ?? []).slice(0, limit);
      } catch (error) {
        if (error instanceof ContractError) throw error;
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
        if (error instanceof ContractError) throw error;
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
        if (error instanceof ContractError) throw error;
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
        return (await response.json()) as BookingStatusResult;
      } catch (error) {
        if (error instanceof ContractError) throw error;
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
        if (error instanceof ContractError) throw error;
        toolLogger.error({ err: error }, "book call failed");
        throw new ContractError(
          "service_unavailable",
          "the booking could not be submitted",
        );
      }
    },
  };
}
