/**
 * Proxy Routes
 *
 * Routes requests to downstream microservices.
 *
 * Identity is NOT reconstructed here. By the time a request reaches this file
 * the identity middleware has already deleted every client-supplied identity
 * header and installed the gateway's own, including the signed
 * `X-UBI-Identity` context. This file only decides which of them cross the
 * wire, and it copies them from the request object rather than rebuilding them,
 * so there is exactly one place that can mint an identity.
 *
 * WHERE a request goes — the service, and the exact downstream path — is
 * decided by proxy-map.ts (per-service base paths, pinned against the
 * services' route manifests by tests/route-contract.test.ts). This file only
 * performs the hop.
 *
 * See middleware/identity.ts for the canonical header contract.
 */
import { Hono, type Context } from "hono";

import {
  PROXY_RULES,
  downstreamPath,
  serviceBaseUrl,
  type ProxyRule,
} from "./proxy-map";
import { proxyLogger } from "../lib/logger.js";
import { IDENTITY_HEADER, REQUEST_ID_HEADER } from "../middleware/identity";

const proxyRoutes = new Hono();

/**
 * Request timeout in milliseconds, covering the WHOLE exchange: the timer runs
 * until the downstream body has been read, because the body is buffered
 * (`response.text()` below) before it is returned. That includes ask-service's
 * streamed message turn (text/event-stream): the client receives the turn's
 * events together once the turn ends, and a turn that outlasts this budget is
 * answered 504 GATEWAY_TIMEOUT. See docs/security/INTERNAL_IDENTITY.md
 * ("Gateway routing") for the operating note; streaming the body through is a
 * separate proxy change.
 */
const REQUEST_TIMEOUT = Number.parseInt(
  process.env.PROXY_TIMEOUT || "30000",
  10,
);

/**
 * Headers copied from the (already sanitized) inbound request.
 *
 * The identity entries are safe to copy precisely because the strip middleware
 * removed the client's versions and the identity middleware wrote the
 * gateway's. `x-internal-service` is deliberately absent: it is a bypass in
 * user-service and the gateway never speaks it.
 */
const HEADERS_TO_FORWARD: readonly string[] = [
  "content-type",
  "accept",
  "accept-language",
  "x-forwarded-for",
  "x-real-ip",
  "x-idempotency-key",
  "idempotency-key",
  // Signed by the telco over the raw body; user-service verifies it.
  "x-telco-signature",
  REQUEST_ID_HEADER,
  IDENTITY_HEADER,
  "x-auth-user-id",
  "x-auth-user-role",
  // The ride-service HMAC context, written by the identity middleware and
  // verified by services/ride-service/internal/handler/identity.go. Safe to
  // copy for the same reason as the rest: the strip middleware deleted any
  // client-supplied version before the gateway signed its own.
  "x-auth-city-id",
  "x-auth-issued-at",
  "x-auth-signature",
  "x-user-id",
  "x-user-role",
  "x-session-id",
  // Client-declared active city context. Not an identity claim (the reserved
  // x-ubi-city-id below carries the token's city), so the strip middleware
  // leaves it alone; payment-service reads it for the marketplace wallet
  // overview (GET /v1/wallet/mp/overview) city scoping.
  "x-city-id",
  "x-ubi-city-id",
  "x-ubi-tenant-id",
  "x-ubi-scopes",
  "x-ubi-modes",
];

const RESPONSE_HEADERS_TO_FORWARD: readonly string[] = [
  "content-type",
  REQUEST_ID_HEADER,
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

/**
 * Generic proxy handler.
 *
 * Forwards the request to the rule's service at the path the proxy map
 * decides (proxy-map.ts: the service's base path, never a blanket strip of
 * `/v1`), with the query string unchanged.
 */
const proxyToService = async (
  rule: ProxyRule,
  c: Context,
): Promise<Response> => {
  const serviceName = rule.service;
  const url = new URL(c.req.url);
  const targetUrl = `${serviceBaseUrl(serviceName)}${downstreamPath(rule, c.req.path)}${url.search}`;

  const forwardHeaders = new Headers();
  for (const header of HEADERS_TO_FORWARD) {
    const value = c.req.header(header);
    if (value !== undefined && value.length > 0) {
      forwardHeaders.set(header, value);
    }
  }

  if (!forwardHeaders.has(REQUEST_ID_HEADER)) {
    forwardHeaders.set(REQUEST_ID_HEADER, crypto.randomUUID());
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body:
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? c.req.raw.body
          : undefined,
      signal: controller.signal,
      duplex: "half",
    } as RequestInit);

    for (const header of RESPONSE_HEADERS_TO_FORWARD) {
      const value = response.headers.get(header);
      if (value !== null) {
        c.header(header, value);
      }
    }

    // Downstream services answer in JSON, but a 204 or an error page must not
    // become a gateway 500 — pass the body through as it came.
    const body = await response.text();
    if (body.length === 0) {
      return c.body(null, response.status as 204);
    }
    return c.body(body, response.status as 200);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return c.json(
        {
          success: false,
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "The request took too long to process",
          },
        },
        504,
      );
    }

    proxyLogger.error({ err: error, serviceName }, "Proxy error");

    return c.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: `Unable to reach ${serviceName}`,
        },
      },
      503,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

/** Builds a route callback: an async handler that awaits the proxy hop. */
const forward =
  (rule: ProxyRule) =>
  async (c: Context): Promise<Response> => {
    const response = await proxyToService(rule, c);
    return response;
  };

// ===========================================
// Route Definitions
// ===========================================

// Every rule, in the order proxy-map.ts lists them (Hono matches the first).
// The table — not this file — is what tests/route-contract.test.ts checks
// against the services' route manifests.
for (const rule of PROXY_RULES) {
  proxyRoutes.all(rule.pattern, forward(rule));
}

export { proxyRoutes };
