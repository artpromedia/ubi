/**
 * Proxy map — which downstream service owns a gateway path, and the exact path
 * the request arrives at there.
 *
 * The gateway mounts `/v1`. The services do NOT agree on where they mount the
 * same API, so the downstream path is decided per service (and, where the edge
 * carries a routing namespace the service does not, per rule):
 *
 *   service              mounts                          /v1/<x> arrives as
 *   user-service         /auth, /users, /devices, …      /<x>
 *   ride-service         /v1/rides, /v1/mp, …            /v1/<x>
 *   ask-service          /v1/ask                         /v1/<x>
 *   payment-service      /v1/wallet, /v1/finance/*       /v1/<x>
 *   delivery-service     /api/v1/deliveries, …           /api/v1/<x>, with the
 *                                                        edge's /delivery
 *                                                        namespace removed
 *   notification-service /api/v1/notifications, …        /api/v1/<x>
 *   food-service         /restaurants, /menus, …         /<x>
 *   travel-service       /v1/travel, /v1/reservations,   /v1/<x>
 *                        /v1/ops/travel
 *
 * Before this table the gateway stripped `/v1` for every service, so
 * `/v1/mp/quote` reached ride-service as `/mp/quote` and `/v1/delivery/…` as
 * `/delivery/…` — both 404s nothing in CI could see, because the gateway tests'
 * fake upstream accepted any path. tests/route-contract.test.ts now maps
 * representative client paths through THIS table and the real app, and checks
 * the result against the route manifests the services generate from their own
 * routers (ride-service, delivery-service, payment-service and travel-service
 * today), so a rule or a service route that stops lining up fails CI.
 *
 * Only paths are decided here. Which headers cross, and the identity they
 * carry, are decided by middleware/identity.ts and routes/proxy.ts and are the
 * same for every rule.
 */

/** The version prefix the gateway mounts (app.ts). */
export const GATEWAY_VERSION_PREFIX = "/v1";

export interface ServiceTarget {
  /** Env var carrying the service's base URL. */
  readonly env: string;
  /** Local-development default when the env var is unset. */
  readonly fallback: string;
  /**
   * Where the service mounts what the gateway serves under `/v1`: `""` for a
   * service with unversioned routes, `/v1` for one that carries the version
   * itself, `/api/v1` for the Go delivery service and notification-service.
   */
  readonly basePath: string;
}

/**
 * Service registry — resolved per request rather than at import, so a
 * redeploy that changes a service URL does not need the gateway rebuilt.
 */
export const SERVICES = {
  "user-service": {
    env: "USER_SERVICE_URL",
    fallback: "http://localhost:4001",
    basePath: "",
  },
  "ride-service": {
    env: "RIDE_SERVICE_URL",
    fallback: "http://localhost:4002",
    basePath: "/v1",
  },
  "food-service": {
    env: "FOOD_SERVICE_URL",
    fallback: "http://localhost:4003",
    basePath: "",
  },
  "delivery-service": {
    env: "DELIVERY_SERVICE_URL",
    fallback: "http://localhost:4004",
    basePath: "/api/v1",
  },
  "payment-service": {
    env: "PAYMENT_SERVICE_URL",
    fallback: "http://localhost:4005",
    basePath: "/v1",
  },
  "notification-service": {
    env: "NOTIFICATION_SERVICE_URL",
    fallback: "http://localhost:4006",
    basePath: "/api/v1",
  },
  // No analytics or CEERION service exists in this repository; the rules
  // below keep their historical unversioned mapping until one does.
  "analytics-service": {
    env: "ANALYTICS_SERVICE_URL",
    fallback: "http://localhost:4007",
    basePath: "",
  },
  "ceerion-service": {
    env: "CEERION_SERVICE_URL",
    fallback: "http://localhost:4008",
    basePath: "",
  },
  "ask-service": {
    env: "ASK_SERVICE_URL",
    fallback: "http://localhost:4013",
    basePath: "/v1",
  },
  "travel-service": {
    env: "TRAVEL_SERVICE_URL",
    fallback: "http://localhost:4012",
    basePath: "/v1",
  },
} as const satisfies Record<string, ServiceTarget>;

export type ServiceName = keyof typeof SERVICES;

export interface ProxyRule {
  /** Hono pattern under the gateway's `/v1` mount. */
  readonly pattern: string;
  readonly service: ServiceName;
  /**
   * An edge-only routing segment that names the service at the gateway but is
   * not part of the service's own routes: `/v1/delivery/deliveries/:id` is
   * delivery-service's `/api/v1/deliveries/:id`.
   */
  readonly edgeNamespace?: string;
}

/**
 * Every proxy rule, in registration order (Hono matches the first). Client
 * paths are fixed — the apps already call them — so a mismatch is fixed by the
 * service's `basePath` or a rule's `edgeNamespace`, never by moving a client.
 *
 * Rules marked UNBACKED forward to a service that serves nothing under that
 * family today; the service answers its own 404. They are kept so existing
 * callers see that answer rather than a gateway one, and the contract test
 * pins each as unbacked so a service that starts serving the family forces the
 * rule to be re-checked.
 */
export const PROXY_RULES: readonly ProxyRule[] = [
  // User Service
  { pattern: "/auth/*", service: "user-service" },
  { pattern: "/users/*", service: "user-service" },

  // Identity (slice 03) — device enrolment, step-up, documents, review cases.
  // These are registered BEFORE /drivers/* so driver documents reach the
  // user-service rather than the ride-service.
  { pattern: "/devices", service: "user-service" },
  { pattern: "/devices/*", service: "user-service" },
  { pattern: "/identity/*", service: "user-service" },
  { pattern: "/webhooks/telco/*", service: "user-service" },
  { pattern: "/drivers/me/documents", service: "user-service" },
  { pattern: "/drivers/me/documents/*", service: "user-service" },
  { pattern: "/drivers/me/eligibility", service: "user-service" },

  // Ride Service — mounts everything under /v1 itself.
  { pattern: "/rides/*", service: "ride-service" },
  { pattern: "/drivers/*", service: "ride-service" },
  // UNBACKED: ride-service serves no /v1/pricing (its quote is POST /v1/quotes).
  { pattern: "/pricing/*", service: "ride-service" },
  { pattern: "/locations/*", service: "ride-service" },

  // Marketplace (negotiated-fare) routes — the marketplace engine lives in the
  // ride-service. The wallet-side marketplace endpoints (/wallet/mp/*) are
  // served by payment-service and flow through the /wallet/* rule below.
  { pattern: "/mp/*", service: "ride-service" },
  { pattern: "/admin/mp/*", service: "ride-service" },

  // Ask UBI (ask-service) — threads, the streamed turn, reviews, confirmations,
  // executions and the AI marketplace stages. Identity reaches it as for every
  // proxy: the signed x-ubi-identity context plus the x-auth-city-id /
  // x-ubi-city-id city claims, all written by the identity middleware after the
  // strip, never copied from the client. ask-service verifies the context and,
  // in production, refuses a request without it.
  { pattern: "/ask/*", service: "ask-service" },

  // Mandates (standing authorisations) live in user-service, which mounts
  // `/mandates` and verifies the same signed context.
  { pattern: "/mandates", service: "user-service" },
  { pattern: "/mandates/*", service: "user-service" },

  // Travel (travel-service) — mounts /v1/travel, /v1/reservations and
  // /v1/ops/travel itself. travel-service reads the caller, role and city
  // ONLY from the signed x-ubi-identity context in production (a declared
  // x-city-id that disagrees with the token's city is refused there).
  //
  // The /v1/travel client families are listed one by one ON PURPOSE:
  // travel-service also serves POST /v1/travel/webhooks/:supplierId, which
  // suppliers (Duffel, LiteAPI) call DIRECTLY on travel-service with their
  // own signatures over the raw body. It is not a client route, a blanket
  // /travel/* rule would have exposed it to every token holder, and no rule
  // here forwards it — tests/route-contract.test.ts pins that it answers the
  // gateway's own 404.
  { pattern: "/travel/flights/*", service: "travel-service" },
  { pattern: "/travel/stays/*", service: "travel-service" },
  { pattern: "/travel/carts/*", service: "travel-service" },
  { pattern: "/travel/orders/*", service: "travel-service" },
  { pattern: "/travel/refunds/*", service: "travel-service" },
  { pattern: "/travel/trips/*", service: "travel-service" },
  // Airport transfers: intents linked to a flight order that travel-service
  // turns into Book for Later scheduled ride requests on ride-service.
  { pattern: "/reservations/*", service: "travel-service" },
  // The travel-ops exception console (apps/admin-dashboard). Only this
  // /v1/ops family is proxied; /v1/ops/ai (ask-service) is not.
  { pattern: "/ops/travel/*", service: "travel-service" },

  // Food Service
  // UNBACKED: food-service mounts no /food (it serves /restaurants, /menus,
  // /orders and the /v1 bites routes).
  { pattern: "/food/*", service: "food-service" },
  { pattern: "/restaurants/*", service: "food-service" },
  { pattern: "/menus/*", service: "food-service" },

  // Delivery Service — mounts /api/v1; the edge's /delivery segment only names
  // the service, so /v1/delivery/deliveries/:id/custody reaches
  // /api/v1/deliveries/:id/custody (the rider app's custody timeline).
  {
    pattern: "/delivery/*",
    service: "delivery-service",
    edgeNamespace: "/delivery",
  },
  // UNBACKED: delivery-service serves no /packages.
  { pattern: "/packages/*", service: "delivery-service" },

  // Payment Service — mounts /v1/wallet and /v1/finance/* itself.
  // UNBACKED: /payments, /wallets and /transactions are quarantined or were
  // never mounted (payment-service QUARANTINE.md); the live wallet is /wallet.
  { pattern: "/payments/*", service: "payment-service" },
  { pattern: "/wallets/*", service: "payment-service" },
  { pattern: "/wallet/*", service: "payment-service" },
  { pattern: "/transactions/*", service: "payment-service" },

  // Notification Service — mounts /api/v1/notifications.
  { pattern: "/notifications/*", service: "notification-service" },

  // UNBACKED (no such service in this repository): analytics and CEERION.
  { pattern: "/analytics/*", service: "analytics-service" },
  { pattern: "/reports/*", service: "analytics-service" },
  { pattern: "/ceerion/*", service: "ceerion-service" },
  { pattern: "/vehicles/*", service: "ceerion-service" },
  { pattern: "/financing/*", service: "ceerion-service" },
];

/** The service's base URL, from its env var or the local default. */
export function serviceBaseUrl(service: ServiceName): string {
  const entry: ServiceTarget = SERVICES[service];
  const configured = process.env[entry.env];
  return configured !== undefined && configured.length > 0
    ? configured
    : entry.fallback;
}

/**
 * The path a gateway request arrives at downstream: the gateway's `/v1` and
 * the rule's edge namespace (if any) come off, the service's base path goes
 * on. Both are removed only at a segment boundary, so `/v1/deliveryx` is never
 * read as the `/delivery` namespace.
 */
export function downstreamPath(rule: ProxyRule, gatewayPath: string): string {
  let rest = gatewayPath;
  if (
    rest === GATEWAY_VERSION_PREFIX ||
    rest.startsWith(`${GATEWAY_VERSION_PREFIX}/`)
  ) {
    rest = rest.slice(GATEWAY_VERSION_PREFIX.length);
  }
  const namespace = rule.edgeNamespace;
  if (
    namespace !== undefined &&
    (rest === namespace || rest.startsWith(`${namespace}/`))
  ) {
    rest = rest.slice(namespace.length);
  }
  const path = `${SERVICES[rule.service].basePath}${rest}`;
  return path.length === 0 ? "/" : path;
}
