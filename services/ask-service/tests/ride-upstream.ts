/**
 * A real HTTP listener standing in for ride-service's marketplace routes, plus
 * builders for the JSON ride-service actually serves (internal/marketplace/
 * views.go: Money is `{ amountMinor, currency }`, optional pointers serialize as
 * `null`, timestamps are RFC 3339 with nanoseconds).
 *
 * The marketplace port under test talks to it over a socket with the real
 * `fetch`, so what the assertions see is what went on the wire — header names
 * as sent, the idempotency key, the body. The listener records every request and
 * answers with whatever the test scripts; it makes no authorization decision of
 * its own (the real verifier is exercised by ride-service's Go tests against the
 * same vectors, see tests/ride-context-vectors.ts).
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface UpstreamReply {
  readonly status: number;
  /** Serialized as JSON unless `raw` is given. */
  readonly body?: unknown;
  readonly raw?: string;
  /** Hold the answer this long (to exercise the caller's timeout). */
  readonly delayMs?: number;
}

export interface RideUpstream {
  readonly url: string;
  readonly received: ReceivedRequest[];
  reply: (request: ReceivedRequest) => UpstreamReply;
  close(): Promise<void>;
}

function flattenHeaders(message: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return headers;
}

export async function startRideUpstream(): Promise<RideUpstream> {
  const received: ReceivedRequest[] = [];
  let reply: (request: ReceivedRequest) => UpstreamReply = () => ({
    status: 404,
    body: { code: "not_found", message: "no" },
  });

  const server: Server = createServer((message, response) => {
    const chunks: Buffer[] = [];
    message.on("data", (chunk: Buffer) => chunks.push(chunk));
    message.on("end", () => {
      const request: ReceivedRequest = {
        method: message.method ?? "GET",
        path: message.url ?? "/",
        headers: flattenHeaders(message),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(request);
      const answer = reply(request);
      const send = (): void => {
        if (response.destroyed) {
          return;
        }
        response.writeHead(answer.status, {
          "content-type": "application/json",
        });
        response.end(
          answer.raw ??
            (answer.body === undefined ? "" : JSON.stringify(answer.body)),
        );
      };
      if (answer.delayMs !== undefined) {
        setTimeout(send, answer.delayMs);
      } else {
        send();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the upstream did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    get reply() {
      return reply;
    },
    set reply(next) {
      reply = next;
    },
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/**
 * Recomputes the HMAC over what was actually received, with node:crypto
 * directly (not the code under test): true when the request's own identity
 * headers are the ones its signature covers.
 */
export function signatureCoversHeaders(
  request: ReceivedRequest,
  secret: string,
): boolean {
  const payload = [
    "ubi.internal.v1",
    request.headers["x-auth-user-id"] ?? "",
    request.headers["x-auth-user-role"] ?? "",
    request.headers["x-auth-city-id"] ?? "",
    request.headers["x-auth-issued-at"] ?? "",
  ].join("|");
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return request.headers["x-auth-signature"] === expected;
}

// ---------------------------------------------------------------------------
// ride-service wire shapes (views.go)
// ---------------------------------------------------------------------------

export interface WireMoney {
  readonly amountMinor: number;
  readonly currency: string;
}

export function wireMoney(amountMinor: number, currency = "NGN"): WireMoney {
  return { amountMinor, currency };
}

/** Go's time.Time JSON: RFC 3339 with nanoseconds. */
export function goTime(offsetMs: number): string {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace(/\.(\d{3})Z$/, ".$1456789Z");
}

type Json = Record<string, unknown>;

export function goQuote(overrides: Json = {}): Json {
  return {
    quoteId: randomUUID(),
    service: "ride",
    vehicleClass: "go",
    cityId: "LOS",
    currency: "NGN",
    suggestedFareMinor: wireMoney(200_000),
    minimumFareMinor: wireMoney(150_000),
    maximumFareMinor: wireMoney(400_000),
    expiresAt: goTime(120_000),
    pricingVersion: "pv-2026-09",
    policyVersion: 3,
    breakdown: [{ label: "Base fare", amountMinor: wireMoney(200_000) }],
    routedDistanceMeters: 5400,
    routedDurationSec: 900,
    ...overrides,
  };
}

export function goRequest(overrides: Json & { requesterId: string }): Json {
  return {
    requestId: randomUUID(),
    state: "open",
    revision: 1,
    version: 1,
    service: "ride",
    vehicleClass: "go",
    cityId: "LOS",
    currency: "NGN",
    quoteId: randomUUID(),
    requestedFareMinor: wireMoney(200_000),
    suggestedFareMinor: wireMoney(200_000),
    minimumFareMinor: wireMoney(150_000),
    maximumFareMinor: wireMoney(400_000),
    pickup: { label: "Ikeja", lat: 6.6, lng: 3.35 },
    dropoff: { label: "Yaba", lat: 6.51, lng: 3.38 },
    delivery: null,
    searchEnvelope: { step: 0, radiusMeters: 1500, pickupEtaSec: 300 },
    policyVersion: 3,
    pricingVersion: "pv-2026-09",
    expiresAt: goTime(120_000),
    createdAt: goTime(-5_000),
    closeReason: null,
    ...overrides,
  };
}

export function goOffer(overrides: Json = {}): Json {
  return {
    bidId: randomUUID(),
    bidVersion: 1,
    requestRevision: 1,
    amountMinor: wireMoney(250_000),
    kind: "immediate",
    driver: {
      displayName: "Ada O.",
      initials: "AO",
      rating: "4.9",
      completedTrips: 812,
      vehicle: "Toyota Corolla",
      plateMasked: "•••34",
      profileStatus: "verified",
    },
    pickupLabel: "Pickup in 4 min · 1.2 km away",
    pickupWindow: null,
    expiresAt: goTime(60_000),
    withdrawn: false,
    whyRecommended: null,
    ...overrides,
  };
}

export function goAward(
  overrides: Json & { requestId: string; bidId: string; requesterId: string },
): Json {
  return {
    awardId: randomUUID(),
    state: "pending",
    requestVersion: 2,
    bidVersion: 1,
    driverId: randomUUID(),
    fareMinor: wireMoney(250_000),
    commissionMinor: wireMoney(25_000),
    slot: "current",
    createdAt: goTime(0),
    resolvedAt: null,
    ...overrides,
  };
}

export function goSnapshot(request: Json, offers: readonly Json[]): Json {
  return { request, offers, seq: request.version ?? 1 };
}
