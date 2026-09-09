/**
 * The ride port — live ride quotes, status and reservations.
 *
 * Ownership is enforced by ride-service, addressed as the caller: this adapter
 * forwards the actor from the gateway context as `X-User-ID`, never anything a
 * tool argument or the model supplied. A status lookup for a trip the caller
 * does not own comes back as `null` (not found), so the assistant cannot read
 * another person's trip by guessing an id (rule #18).
 *
 * Prices are the server's, quoted live with an age. The assistant renders them;
 * it never computes a fare (CLAUDE.md #1).
 */
import type { Actor } from "../ops/types";

export interface RideQuote {
  readonly quoteId: string;
  readonly vehicleClass: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly etaMinutes: number | null;
}

export interface RideStatusResult {
  readonly tripId: string;
  readonly state: string;
  readonly driverEtaMinutes: number | null;
}

export interface RideQuoteInput {
  readonly pickupRef: string;
  readonly dropoffRef: string;
  readonly vehicleClass?: string;
}

export interface RidePort {
  quote(actor: Actor, input: RideQuoteInput): Promise<RideQuote>;
  status(actor: Actor, tripId: string): Promise<RideStatusResult | null>;
}

import { ContractError } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

interface RideHttpOptions {
  readonly baseUrl: string;
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

function actorHeaders(
  actor: Actor,
  serviceKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-ID": actor.id,
    "X-User-Role": actor.role,
  };
  if (serviceKey !== undefined) {
    headers["X-Service-Key"] = serviceKey;
  }
  return headers;
}

export function createHttpRidePort(options: RideHttpOptions): RidePort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");

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
        headers: actorHeaders(actor, options.serviceKey),
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async quote(actor: Actor, input: RideQuoteInput): Promise<RideQuote> {
      try {
        const response = await call("/v1/rides/quotes", "POST", actor, input);
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "a live ride price is not available right now",
          );
        }
        return (await response.json()) as RideQuote;
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "ride quote call failed");
        throw new ContractError(
          "service_unavailable",
          "a live ride price is not available right now",
        );
      }
    },
    async status(
      actor: Actor,
      tripId: string,
    ): Promise<RideStatusResult | null> {
      try {
        const response = await call(
          `/v1/rides/${encodeURIComponent(tripId)}`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "ride status is not available right now",
          );
        }
        return (await response.json()) as RideStatusResult;
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "ride status call failed");
        throw new ContractError(
          "service_unavailable",
          "ride status is not available right now",
        );
      }
    },
  };
}
