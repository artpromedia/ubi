/**
 * Gateway route contract (G1): every proxy rule must land on a route its
 * service actually serves.
 *
 * Round 4 found that the gateway stripped `/v1` for every service while
 * ride-service mounts everything under `/v1`, payment-service mounts
 * `/v1/wallet` + `/v1/finance/*` and delivery-service mounts `/api/v1` — so
 * `/v1/mp/quote`, `/v1/wallet/...` and the rider app's delivery custody calls
 * all 404'd downstream. The existing proxy tests could not see it: their fake
 * upstream answers 200 to any path.
 *
 * This file closes that gap with two independent checks per client path:
 *
 *  1. The REAL mapping (src/routes/proxy-map.ts `downstreamPath`) is checked
 *     against the route manifest the target service generates by walking its
 *     own production router (ride-service and delivery-service: chi.Walk;
 *     payment-service, travel-service and user-service: Hono's route
 *     table). Path parameters are normalised (`{id}` / `:id` match any one
 *     segment).
 *  2. The request goes through the REAL app (createApp: auth, identity, scope,
 *     proxy) with one recording upstream per service, and must arrive at the
 *     right service at exactly that path, query string intact.
 *
 * Every rule in PROXY_RULES must be covered by a REACHABLE case or declared
 * UNBACKED with a reason; an unbacked rule is asserted to still be unbacked, so
 * a service that starts serving the family forces the rule to be re-checked. A
 * new proxy rule, a mapping change, or a service route change that breaks
 * reachability therefore fails here (after the service's own manifest test has
 * forced its manifest to be regenerated).
 *
 * Services without a manifest yet (ask-service, food-service,
 * notification-service) are held to the exact downstream path only; their
 * expected paths were checked by hand against the services' route modules.
 *
 * Routes a service serves for suppliers or other services — never for a
 * client token (travel-service's supplier webhooks, payment-service's
 * internal business-budget API, user-service's grant and mandate-run
 * surface) — are pinned the other way round: present in the service's
 * manifest, and answered by the gateway's own 404 without reaching any
 * service (SERVICE_ONLY_ROUTES).
 *
 * The passenger trip link (src/routes/trip-access.ts) is the one family that
 * forwards WITHOUT a user token; its paths are pinned against ride-service's
 * manifest and through the real app with no Authorization at all
 * (PUBLIC_TRIP_ACCESS below; header hygiene and the rate limit are
 * tests/trip-access.test.ts).
 */
import "./env";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import {
  PROXY_RULES,
  SERVICES,
  downstreamPath,
  type ProxyRule,
  type ServiceName,
} from "../src/routes/proxy-map";
import { CONFIG_READ_ROUTES } from "../src/routes/config-read";
import {
  TRIP_ACCESS_ROUTES,
  resetTripAccessLimiter,
} from "../src/routes/trip-access";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

const REPO_ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// Service route manifests
// ---------------------------------------------------------------------------

type ManifestStyle = "chi" | "hono";

interface ManifestSource {
  readonly file: string;
  /** chi: `{param}`, a Route("/") leaf ends in `/`; hono: `:param`, strict. */
  readonly style: ManifestStyle;
  readonly regenerate: string;
}

const MANIFEST_SOURCES: Partial<Record<ServiceName, ManifestSource>> = {
  "ride-service": {
    file: "services/ride-service/internal/handler/routes.manifest",
    style: "chi",
    regenerate:
      "cd services/ride-service && UPDATE_ROUTE_MANIFEST=1 go test ./internal/handler/ -run TestRouteManifest",
  },
  "delivery-service": {
    file: "services/delivery-service/internal/handlers/routes.manifest",
    style: "chi",
    regenerate:
      "cd services/delivery-service && UPDATE_ROUTE_MANIFEST=1 go test ./internal/handlers/ -run TestRouteManifest",
  },
  "payment-service": {
    file: "services/payment-service/tests/routes.manifest",
    style: "hono",
    regenerate:
      "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/payment-service exec vitest run tests/routes-manifest.test.ts",
  },
  "travel-service": {
    file: "services/travel-service/tests/routes.manifest",
    style: "hono",
    regenerate:
      "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/travel-service exec vitest run tests/routes-manifest.test.ts",
  },
  "user-service": {
    file: "services/user-service/tests/routes.manifest",
    style: "hono",
    regenerate:
      "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/user-service exec vitest run tests/routes-manifest.test.ts",
  },
  "fleet-service": {
    file: "services/fleet-service/tests/routes.manifest",
    style: "hono",
    regenerate:
      "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/fleet-service exec vitest run tests/routes-manifest.test.ts",
  },
  "config-service": {
    file: "services/config-service/tests/routes.manifest",
    style: "hono",
    regenerate:
      "UPDATE_ROUTE_MANIFEST=1 pnpm --filter @ubi/config-service exec vitest run tests/unit/routes-manifest.test.ts",
  },
};

interface ManifestRoute {
  readonly method: string;
  readonly pattern: string;
}

interface Manifest {
  readonly source: ManifestSource;
  readonly routes: readonly ManifestRoute[];
}

function loadManifest(service: ServiceName): Manifest | undefined {
  const source = MANIFEST_SOURCES[service];
  if (source === undefined) return undefined;
  const text = readFileSync(path.join(REPO_ROOT, source.file), "utf8");
  const routes = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [method, pattern, ...rest] = line.split(/\s+/);
      if (method === undefined || pattern === undefined || rest.length > 0) {
        throw new Error(`${source.file}: malformed manifest line "${line}"`);
      }
      return { method, pattern };
    });
  return { source, routes };
}

function isParam(segment: string, style: ManifestStyle): boolean {
  return style === "chi"
    ? /^\{[^}]+\}$/.test(segment)
    : segment.startsWith(":");
}

/** Does one manifest pattern serve this concrete path? */
function patternServes(
  pattern: string,
  concrete: string,
  style: ManifestStyle,
): boolean {
  let want = pattern;
  let have = concrete;
  // chi serves a Route("/x", …) leaf registered as "/" at both /x and /x/;
  // any other chi pattern is served only at its exact path (no StripSlashes).
  if (style === "chi" && want.length > 1 && want.endsWith("/")) {
    want = want.slice(0, -1);
    if (have.length > 1 && have.endsWith("/")) have = have.slice(0, -1);
  }
  const wantSegments = want.split("/");
  const haveSegments = have.split("/");
  for (let i = 0; i < wantSegments.length; i += 1) {
    const segment = wantSegments[i] as string;
    if (segment === "*" && i === wantSegments.length - 1) return true;
    const actual = haveSegments[i];
    if (actual === undefined) return false;
    if (isParam(segment, style)) {
      if (actual.length === 0) return false;
      continue;
    }
    if (segment !== actual) return false;
  }
  return wantSegments.length === haveSegments.length;
}

/** Every manifest pattern that serves this method + concrete path. */
function servingPatterns(
  manifest: Manifest,
  method: string,
  concrete: string,
): string[] {
  return manifest.routes
    .filter(
      (route) =>
        (route.method === method || route.method === "ALL") &&
        patternServes(route.pattern, concrete, manifest.source.style),
    )
    .map((route) => route.pattern);
}

function manifestServes(
  manifest: Manifest,
  method: string,
  concrete: string,
): boolean {
  return servingPatterns(manifest, method, concrete).length > 0;
}

// ---------------------------------------------------------------------------
// The inventory: client paths per proxy rule
// ---------------------------------------------------------------------------

interface ReachableCase {
  /** The PROXY_RULES pattern this path must be routed by. */
  readonly rule: string;
  readonly method: string;
  /** The client-facing path, exactly as the app calls it (query included). */
  readonly path: string;
  /** The exact path the service must receive (query excluded). */
  readonly downstream: string;
  /** Who calls it. */
  readonly source: string;
}

const RIDER = "apps/rider-mobile";
const DRIVER = "apps/driver-mobile";
const WEB_TRAVEL = "apps/web-app src/components/travel/api.ts";
const ADMIN_OPS = "apps/admin-dashboard src/lib/growth-api.ts";
const TRAVEL_API = "contracts/openapi/travel-v2.yaml";
const BUSINESS = "packages/contracts/src/business-travel.ts (A06 part C)";
const FLEET =
  "packages/contracts/src/fleet.ts (A05) + contracts/openapi/fleet.yaml";

const REACHABLE: readonly ReachableCase[] = [
  // --- user-service: unversioned (/auth, /users, /devices, root routes) ---
  {
    rule: "/auth/*",
    method: "POST",
    path: "/v1/auth/login/otp",
    downstream: "/auth/login/otp",
    source: `${RIDER} src/api/auth.ts`,
  },
  {
    rule: "/auth/*",
    method: "POST",
    path: "/v1/auth/step-up/selfie",
    downstream: "/auth/step-up/selfie",
    source: "user-service src/routes/identity.ts",
  },
  {
    rule: "/users/*",
    method: "GET",
    path: "/v1/users/me",
    downstream: "/users/me",
    source: `${RIDER} + ${DRIVER} src/api/account.ts`,
  },
  {
    rule: "/users/*",
    method: "GET",
    path: "/v1/users/me/saved-places",
    downstream: "/users/me/saved-places",
    source: `${RIDER} src/api/account.ts`,
  },
  {
    rule: "/devices",
    method: "GET",
    path: "/v1/devices",
    downstream: "/devices",
    source: "user-service src/routes/devices.ts",
  },
  {
    rule: "/devices/*",
    method: "POST",
    path: "/v1/devices/enroll",
    downstream: "/devices/enroll",
    source: "user-service src/routes/devices.ts",
  },
  {
    rule: "/identity/*",
    method: "GET",
    path: "/v1/identity/cases",
    downstream: "/identity/cases",
    source: "user-service src/routes/identity.ts",
  },
  {
    rule: "/webhooks/telco/*",
    method: "POST",
    path: "/v1/webhooks/telco/sim-swap",
    downstream: "/webhooks/telco/sim-swap",
    source: "user-service src/routes/identity.ts",
  },
  {
    rule: "/drivers/me/documents",
    method: "GET",
    path: "/v1/drivers/me/documents",
    downstream: "/drivers/me/documents",
    source: "user-service src/routes/identity.ts",
  },
  {
    rule: "/drivers/me/eligibility",
    method: "GET",
    path: "/v1/drivers/me/eligibility",
    downstream: "/drivers/me/eligibility",
    source: "user-service src/routes/identity.ts",
  },
  {
    rule: "/mandates",
    method: "GET",
    path: "/v1/mandates",
    downstream: "/mandates",
    source: `${RIDER} src/api/mandates.ts`,
  },
  {
    rule: "/mandates/*",
    method: "GET",
    path: "/v1/mandates/mnd_1/executions",
    downstream: "/mandates/mnd_1/executions",
    source: `${RIDER} src/api/mandates.ts`,
  },
  // Business travel organizations (user-service src/routes/organizations.ts).
  {
    rule: "/organizations",
    method: "GET",
    path: "/v1/organizations",
    downstream: "/organizations",
    source: BUSINESS,
  },
  {
    rule: "/organizations",
    method: "POST",
    path: "/v1/organizations",
    downstream: "/organizations",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "GET",
    path: "/v1/organizations/org_1",
    downstream: "/organizations/org_1",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "PUT",
    path: "/v1/organizations/org_1/policy",
    downstream: "/organizations/org_1/policy",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "PUT",
    path: "/v1/organizations/org_1/billing",
    downstream: "/organizations/org_1/billing",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "GET",
    path: "/v1/organizations/org_1/members",
    downstream: "/organizations/org_1/members",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "PATCH",
    path: "/v1/organizations/org_1/members/mem_1",
    downstream: "/organizations/org_1/members/mem_1",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/org_1/members/mem_1/remove",
    downstream: "/organizations/org_1/members/mem_1/remove",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/org_1/invitations",
    downstream: "/organizations/org_1/invitations",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/org_1/invitations/inv_1/revoke",
    downstream: "/organizations/org_1/invitations/inv_1/revoke",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "GET",
    path: "/v1/organizations/invitations",
    downstream: "/organizations/invitations",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/invitations/inv_1/accept",
    downstream: "/organizations/invitations/inv_1/accept",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/invitations/inv_1/decline",
    downstream: "/organizations/invitations/inv_1/decline",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "GET",
    path: "/v1/organizations/org_1/cost-centres",
    downstream: "/organizations/org_1/cost-centres",
    source: BUSINESS,
  },
  {
    rule: "/organizations/*",
    method: "POST",
    path: "/v1/organizations/org_1/cost-centres/cc_1/archive",
    downstream: "/organizations/org_1/cost-centres/cc_1/archive",
    source: BUSINESS,
  },

  // --- fleet-service: mounts /v1/fleets, /v1/fleet-offers, /v1/drivers/me/* itself ---
  {
    rule: "/drivers/me/fleet-offers",
    method: "GET",
    path: "/v1/drivers/me/fleet-offers",
    downstream: "/v1/drivers/me/fleet-offers",
    source: FLEET,
  },
  {
    rule: "/drivers/me/fleet",
    method: "GET",
    path: "/v1/drivers/me/fleet",
    downstream: "/v1/drivers/me/fleet",
    source: FLEET,
  },
  {
    rule: "/drivers/me/fleet/*",
    method: "POST",
    path: "/v1/drivers/me/fleet/terminate",
    downstream: "/v1/drivers/me/fleet/terminate",
    source: FLEET,
  },
  {
    rule: "/drivers/me/schedule",
    method: "GET",
    path: "/v1/drivers/me/schedule?from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z",
    downstream: "/v1/drivers/me/schedule",
    source: FLEET,
  },
  {
    rule: "/drivers/me/availability",
    method: "PUT",
    path: "/v1/drivers/me/availability",
    downstream: "/v1/drivers/me/availability",
    source: FLEET,
  },
  {
    rule: "/drivers/me/availability:preview",
    method: "POST",
    path: "/v1/drivers/me/availability:preview",
    downstream: "/v1/drivers/me/availability:preview",
    source: FLEET,
  },
  {
    rule: "/drivers/me/conflicts/*",
    method: "GET",
    path: "/v1/drivers/me/conflicts/fcf_1",
    downstream: "/v1/drivers/me/conflicts/fcf_1",
    source: FLEET,
  },
  {
    rule: "/drivers/me/vehicle-issues",
    method: "POST",
    path: "/v1/drivers/me/vehicle-issues",
    downstream: "/v1/drivers/me/vehicle-issues",
    source: `${DRIVER} src/api/fleet.ts (C5 ReportVehicleIssue)`,
  },
  {
    rule: "/fleets",
    method: "GET",
    path: "/v1/fleets",
    downstream: "/v1/fleets",
    source: FLEET,
  },
  {
    rule: "/fleets",
    method: "POST",
    path: "/v1/fleets",
    downstream: "/v1/fleets",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "GET",
    path: "/v1/fleets/flt_1/calendar?zoom=week&rows=vehicles&layers=bookings",
    downstream: "/v1/fleets/flt_1/calendar",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "GET",
    path: "/v1/fleets/flt_1/vehicles/veh_1/availability",
    downstream: "/v1/fleets/flt_1/vehicles/veh_1/availability",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/maintenance:preview",
    downstream: "/v1/fleets/flt_1/maintenance:preview",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/maintenance",
    downstream: "/v1/fleets/flt_1/maintenance",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "PATCH",
    path: "/v1/fleets/flt_1/maintenance/mnt_1",
    downstream: "/v1/fleets/flt_1/maintenance/mnt_1",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/maintenance/mnt_1/cancel",
    downstream: "/v1/fleets/flt_1/maintenance/mnt_1/cancel",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/off-road",
    downstream: "/v1/fleets/flt_1/off-road",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "GET",
    path: "/v1/fleets/flt_1/conflicts?status=open",
    downstream: "/v1/fleets/flt_1/conflicts",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/conflicts/fcf_1/remind",
    downstream: "/v1/fleets/flt_1/conflicts/fcf_1/remind",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/assignments/propose",
    downstream: "/v1/fleets/flt_1/assignments/propose",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "POST",
    path: "/v1/fleets/flt_1/bookings/blk_1/vehicle-swaps",
    downstream: "/v1/fleets/flt_1/bookings/blk_1/vehicle-swaps",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "GET",
    path: "/v1/fleets/flt_1/utilisation",
    downstream: "/v1/fleets/flt_1/utilisation",
    source: FLEET,
  },
  {
    rule: "/fleets/*",
    method: "PUT",
    path: "/v1/fleets/flt_1/staff",
    downstream: "/v1/fleets/flt_1/staff",
    source: FLEET,
  },
  {
    rule: "/fleet-offers/*",
    method: "POST",
    path: "/v1/fleet-offers/fap_1/sign",
    downstream: "/v1/fleet-offers/fap_1/sign",
    source: FLEET,
  },
  {
    rule: "/fleet-offers/*",
    method: "POST",
    path: "/v1/fleet-offers/fap_1/decline",
    downstream: "/v1/fleet-offers/fap_1/decline",
    source: FLEET,
  },

  // --- ride-service: mounts /v1 itself ---
  {
    rule: "/rides/*",
    method: "GET",
    path: "/v1/rides/active",
    downstream: "/v1/rides/active",
    source: `${RIDER} + ${DRIVER} src/api/rides.ts`,
  },
  {
    rule: "/rides/*",
    method: "GET",
    path: "/v1/rides/rid_1",
    downstream: "/v1/rides/rid_1",
    source: `${RIDER} + ${DRIVER} src/api/rides.ts`,
  },
  {
    rule: "/rides/*",
    method: "POST",
    path: "/v1/rides",
    downstream: "/v1/rides",
    source: "ride-service POST /v1/rides",
  },
  {
    rule: "/rides/*",
    method: "POST",
    path: "/v1/rides/rid_1/cancel",
    downstream: "/v1/rides/rid_1/cancel",
    source: `${RIDER} src/api/rides.ts`,
  },
  {
    rule: "/rides/*",
    method: "POST",
    path: "/v1/rides/rid_1/verify-pin",
    downstream: "/v1/rides/rid_1/verify-pin",
    source: `${DRIVER} src/api/rides.ts`,
  },
  {
    rule: "/drivers/*",
    method: "GET",
    path: "/v1/drivers/me/status",
    downstream: "/v1/drivers/me/status",
    source: `${DRIVER} src/api/rides.ts`,
  },
  {
    rule: "/drivers/*",
    method: "POST",
    path: "/v1/drivers/me/status",
    downstream: "/v1/drivers/me/status",
    source: `${DRIVER} src/api/rides.ts`,
  },
  {
    rule: "/drivers/*",
    method: "POST",
    path: "/v1/drivers/me/locations",
    downstream: "/v1/drivers/me/locations",
    source: `${DRIVER} src/lib/location.ts`,
  },
  {
    rule: "/locations/*",
    method: "GET",
    path: "/v1/locations/autocomplete?input=lekki",
    downstream: "/v1/locations/autocomplete",
    source: "gateway PUBLIC_ROUTES",
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/quote?service=ride&cityId=LOS",
    downstream: "/v1/mp/quote",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests",
    downstream: "/v1/mp/requests",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/requests/mpr_1",
    downstream: "/v1/mp/requests/mpr_1",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests/mpr_1/revise",
    downstream: "/v1/mp/requests/mpr_1/revise",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests/mpr_1/cancel",
    downstream: "/v1/mp/requests/mpr_1/cancel",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests/mpr_1/select",
    downstream: "/v1/mp/requests/mpr_1/select",
    source: `${RIDER} OfferInboxScreen (award)`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/requests/mpr_1/award",
    downstream: "/v1/mp/requests/mpr_1/award",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/requests/mpr_1/queue",
    downstream: "/v1/mp/requests/mpr_1/queue",
    source: `${RIDER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/requests/mpr_1/trip",
    downstream: "/v1/mp/requests/mpr_1/trip",
    source: "contracts/openapi/marketplace.yaml",
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests/mpr_1/amendments",
    downstream: "/v1/mp/requests/mpr_1/amendments",
    source: "contracts/openapi/marketplace.yaml",
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/requests/mpr_1/stops/stp_1/arrive",
    downstream: "/v1/mp/requests/mpr_1/stops/stp_1/arrive",
    source: "contracts/openapi/marketplace.yaml",
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/requests/mpr_1/driver-view",
    downstream: "/v1/mp/requests/mpr_1/driver-view",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/feed?cursor=abc",
    downstream: "/v1/mp/feed",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/bids",
    downstream: "/v1/mp/bids",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/bids/bid_1/revise",
    downstream: "/v1/mp/bids/bid_1/revise",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/bids/bid_1/withdraw",
    downstream: "/v1/mp/bids/bid_1/withdraw",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/bids/mine",
    downstream: "/v1/mp/bids/mine",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/rate-profiles",
    downstream: "/v1/mp/rate-profiles",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "PUT",
    path: "/v1/mp/rate-profiles",
    downstream: "/v1/mp/rate-profiles",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/rate-profiles/preview",
    downstream: "/v1/mp/rate-profiles/preview",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/driver/parked",
    downstream: "/v1/mp/driver/parked",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/driver/jobs",
    downstream: "/v1/mp/driver/jobs",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "PATCH",
    path: "/v1/mp/driver/preferences",
    downstream: "/v1/mp/driver/preferences",
    source: `${DRIVER} src/api/marketplace.ts`,
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/driver/calendar",
    downstream: "/v1/mp/driver/calendar",
    source: "contracts/openapi/marketplace.yaml (A03)",
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/scheduled-requests",
    downstream: "/v1/mp/scheduled-requests",
    source: "contracts/openapi/marketplace.yaml (A03)",
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/advance-requests",
    downstream: "/v1/mp/advance-requests",
    source: "contracts/openapi/marketplace.yaml (A03)",
  },
  {
    rule: "/mp/*",
    method: "GET",
    path: "/v1/mp/advance-bookings",
    downstream: "/v1/mp/advance-bookings",
    source: "contracts/openapi/marketplace.yaml (A03)",
  },
  {
    rule: "/mp/*",
    method: "POST",
    path: "/v1/mp/recurring-templates/tpl_1/pause",
    downstream: "/v1/mp/recurring-templates/tpl_1/pause",
    source: "contracts/openapi/marketplace.yaml (A03)",
  },
  {
    rule: "/admin/mp/*",
    method: "GET",
    path: "/v1/admin/mp/requests",
    downstream: "/v1/admin/mp/requests",
    source: "apps/admin-dashboard marketplace board",
  },
  {
    rule: "/admin/mp/*",
    method: "GET",
    path: "/v1/admin/mp/requests/mpr_1/timeline",
    downstream: "/v1/admin/mp/requests/mpr_1/timeline",
    source: "apps/admin-dashboard marketplace board",
  },
  {
    rule: "/admin/mp/*",
    method: "POST",
    path: "/v1/admin/mp/standing-actions/act_1/decide",
    downstream: "/v1/admin/mp/standing-actions/act_1/decide",
    source: "apps/admin-dashboard standing actions",
  },

  // --- ask-service: mounts /v1/ask itself ---
  {
    rule: "/ask/*",
    method: "POST",
    path: "/v1/ask/threads",
    downstream: "/v1/ask/threads",
    source: `${RIDER} src/api/ask.ts`,
  },
  {
    rule: "/ask/*",
    method: "POST",
    path: "/v1/ask/threads/thr_1/messages",
    downstream: "/v1/ask/threads/thr_1/messages",
    source: `${RIDER} src/api/ask.ts (streamed turn)`,
  },
  {
    rule: "/ask/*",
    method: "POST",
    path: "/v1/ask/reviews/rvw_1/confirm",
    downstream: "/v1/ask/reviews/rvw_1/confirm",
    source: `${RIDER} src/api/ask.ts`,
  },
  {
    rule: "/ask/*",
    method: "POST",
    path: "/v1/ask/mp/quotes",
    downstream: "/v1/ask/mp/quotes",
    source: `${RIDER} src/api/ask.ts`,
  },

  // --- food-service: unversioned /restaurants and /menus ---
  {
    rule: "/restaurants/*",
    method: "GET",
    path: "/v1/restaurants/rst_1/menu",
    downstream: "/restaurants/rst_1/menu",
    source: "food-service src/routes/restaurants.ts",
  },
  {
    rule: "/menus/*",
    method: "GET",
    path: "/v1/menus/categories/rst_1",
    downstream: "/menus/categories/rst_1",
    source: "food-service src/routes/menus.ts",
  },

  // --- delivery-service: /api/v1, edge namespace /delivery removed ---
  {
    rule: "/delivery/*",
    method: "GET",
    path: "/v1/delivery/deliveries/dlv_1/custody",
    downstream: "/api/v1/deliveries/dlv_1/custody",
    source: `${RIDER} src/api/marketplace.ts deliveryReturnState`,
  },
  {
    rule: "/delivery/*",
    method: "POST",
    path: "/v1/delivery/deliveries/dlv_1/custody/return/consent",
    downstream: "/api/v1/deliveries/dlv_1/custody/return/consent",
    source: `${RIDER} src/api/marketplace.ts deliveryReturnConsent`,
  },
  {
    rule: "/delivery/*",
    method: "POST",
    path: "/v1/delivery/deliveries/dlv_1/custody/proof-uploads",
    downstream: "/api/v1/deliveries/dlv_1/custody/proof-uploads",
    source: "docs/marketplace/DELIVERY_CUSTODY.md (driver proof upload)",
  },
  {
    rule: "/delivery/*",
    method: "POST",
    path: "/v1/delivery/deliveries/dlv_1/custody/pickup-proof",
    downstream: "/api/v1/deliveries/dlv_1/custody/pickup-proof",
    source: "contracts/openapi/marketplace.yaml",
  },
  {
    rule: "/delivery/*",
    method: "GET",
    path: "/v1/delivery/deliveries/dlv_1/custody/proofs/prf_1/url",
    downstream: "/api/v1/deliveries/dlv_1/custody/proofs/prf_1/url",
    source: "docs/marketplace/DELIVERY_CUSTODY.md (proof view)",
  },
  {
    rule: "/delivery/*",
    method: "POST",
    path: "/v1/delivery/quotes",
    downstream: "/api/v1/quotes",
    source: "delivery-service POST /api/v1/quotes",
  },

  // --- payment-service: mounts /v1/wallet and /v1/finance itself ---
  {
    rule: "/wallet/*",
    method: "GET",
    path: "/v1/wallet",
    downstream: "/v1/wallet",
    source: `${RIDER} src/api/wallet.ts`,
  },
  {
    rule: "/wallet/*",
    method: "GET",
    path: "/v1/wallet/statements?from=2026-09-01",
    downstream: "/v1/wallet/statements",
    source: `${RIDER} src/api/wallet.ts`,
  },
  {
    rule: "/wallet/*",
    method: "GET",
    path: "/v1/wallet/mp/overview?cityId=LOS",
    downstream: "/v1/wallet/mp/overview",
    source: `${DRIVER} src/api/marketplace.ts walletOverview`,
  },
  {
    rule: "/wallet/*",
    method: "POST",
    path: "/v1/wallet/transfers",
    downstream: "/v1/wallet/transfers",
    source: "contracts/openapi/wallet-p2p.yaml",
  },
  {
    rule: "/wallet/*",
    method: "POST",
    path: "/v1/wallet/topups",
    downstream: "/v1/wallet/topups",
    source: "payment-service src/routes/wallet-v1.ts",
  },
  // Business travel money (payment-service src/business/routes.ts, the
  // signed-context client router — never /v1/finance/business).
  {
    rule: "/business/*",
    method: "GET",
    path: "/v1/business/organizations/org_1/funding",
    downstream: "/v1/business/organizations/org_1/funding",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "POST",
    path: "/v1/business/organizations/org_1/topups",
    downstream: "/v1/business/organizations/org_1/topups",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "GET",
    path: "/v1/business/organizations/org_1/budgets?period=2026-09",
    downstream: "/v1/business/organizations/org_1/budgets",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "POST",
    path: "/v1/business/organizations/org_1/budgets/allocations",
    downstream: "/v1/business/organizations/org_1/budgets/allocations",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "POST",
    path: "/v1/business/organizations/org_1/budgets/returns",
    downstream: "/v1/business/organizations/org_1/budgets/returns",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "GET",
    path: "/v1/business/organizations/org_1/bookings?period=2026-09",
    downstream: "/v1/business/organizations/org_1/bookings",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "GET",
    path: "/v1/business/bookings/mine",
    downstream: "/v1/business/bookings/mine",
    source: BUSINESS,
  },
  {
    rule: "/business/*",
    method: "GET",
    path: "/v1/business/organizations/org_1/statements/2026-09?format=csv",
    downstream: "/v1/business/organizations/org_1/statements/2026-09",
    source: BUSINESS,
  },

  // --- notification-service: /api/v1/notifications ---
  {
    rule: "/notifications/*",
    method: "GET",
    path: "/v1/notifications",
    downstream: "/api/v1/notifications",
    source: "notification-service src/routes/in-app.ts",
  },

  // --- travel-service: mounts /v1/travel, /v1/reservations, /v1/ops/travel ---
  {
    rule: "/travel/flights/*",
    method: "POST",
    path: "/v1/travel/flights/searches",
    downstream: "/v1/travel/flights/searches",
    source: `${RIDER} src/api/travel.ts searchFlights, ${WEB_TRAVEL} useFlightSearch`,
  },
  {
    rule: "/travel/flights/*",
    method: "GET",
    path: "/v1/travel/flights/searches/srch_1",
    downstream: "/v1/travel/flights/searches/srch_1",
    source: `${RIDER} src/api/travel.ts refreshFlights`,
  },
  {
    rule: "/travel/stays/*",
    method: "POST",
    path: "/v1/travel/stays/searches",
    downstream: "/v1/travel/stays/searches",
    source: TRAVEL_API,
  },
  {
    rule: "/travel/stays/*",
    method: "GET",
    path: "/v1/travel/stays/prop_1/rates?searchId=srch_1",
    downstream: "/v1/travel/stays/prop_1/rates",
    source: `${RIDER} src/api/travel.ts rates`,
  },
  {
    rule: "/travel/carts/*",
    method: "POST",
    path: "/v1/travel/carts",
    downstream: "/v1/travel/carts",
    source: `${RIDER} src/api/travel.ts createCart`,
  },
  {
    rule: "/travel/carts/*",
    method: "PUT",
    path: "/v1/travel/carts/cart_1/passengers",
    downstream: "/v1/travel/carts/cart_1/passengers",
    source: `${RIDER} src/api/travel.ts putPassengers`,
  },
  {
    rule: "/travel/carts/*",
    method: "POST",
    path: "/v1/travel/carts/cart_1/checkout",
    downstream: "/v1/travel/carts/cart_1/checkout",
    source: `${RIDER} src/api/travel.ts checkout`,
  },
  {
    rule: "/travel/orders/*",
    method: "GET",
    path: "/v1/travel/orders/ord_1",
    downstream: "/v1/travel/orders/ord_1",
    source: `${RIDER} src/api/travel.ts order`,
  },
  {
    rule: "/travel/orders/*",
    method: "GET",
    path: "/v1/travel/orders/ord_1/cancellation-quote",
    downstream: "/v1/travel/orders/ord_1/cancellation-quote",
    source: "travel-service src/routes/travel.ts",
  },
  {
    rule: "/travel/orders/*",
    method: "POST",
    path: "/v1/travel/orders/ord_1/cancel",
    downstream: "/v1/travel/orders/ord_1/cancel",
    source: `${RIDER} src/api/travel.ts requestRefund`,
  },
  {
    rule: "/travel/orders/*",
    method: "GET",
    path: "/v1/travel/orders/ord_1/disruption",
    downstream: "/v1/travel/orders/ord_1/disruption",
    source: `${RIDER} src/api/travel.ts disruption`,
  },
  {
    rule: "/travel/orders/*",
    method: "POST",
    path: "/v1/travel/orders/ord_1/switch",
    downstream: "/v1/travel/orders/ord_1/switch",
    source: `${RIDER} src/api/travel.ts switchTo`,
  },
  {
    rule: "/travel/refunds/*",
    method: "GET",
    path: "/v1/travel/refunds/rfd_1",
    downstream: "/v1/travel/refunds/rfd_1",
    source: `${RIDER} src/api/travel.ts refund`,
  },
  {
    rule: "/travel/trips/*",
    method: "GET",
    path: "/v1/travel/trips/trp_1",
    downstream: "/v1/travel/trips/trp_1",
    source: `${RIDER} src/api/travel.ts trip, ${WEB_TRAVEL} useTrip`,
  },
  {
    rule: "/travel/trips/*",
    method: "GET",
    path: "/v1/travel/trips/trp_1/linked",
    downstream: "/v1/travel/trips/trp_1/linked",
    source: `${RIDER} src/api/travel.ts linked`,
  },
  {
    rule: "/reservations/*",
    method: "GET",
    path: "/v1/reservations?linkedOrderId=ord_1",
    downstream: "/v1/reservations",
    source: TRAVEL_API,
  },
  {
    rule: "/reservations/*",
    method: "POST",
    path: "/v1/reservations",
    downstream: "/v1/reservations",
    source: `${RIDER} src/api/travel.ts reserve, ${TRAVEL_API}`,
  },
  {
    rule: "/reservations/*",
    method: "GET",
    path: "/v1/reservations/trf_1",
    downstream: "/v1/reservations/trf_1",
    source: TRAVEL_API,
  },
  {
    rule: "/reservations/*",
    method: "POST",
    path: "/v1/reservations/trf_1/decision",
    downstream: "/v1/reservations/trf_1/decision",
    source: TRAVEL_API,
  },
  {
    rule: "/reservations/*",
    method: "POST",
    path: "/v1/reservations/trf_1/cancel",
    downstream: "/v1/reservations/trf_1/cancel",
    source: TRAVEL_API,
  },
  {
    rule: "/ops/travel/*",
    method: "GET",
    path: "/v1/ops/travel/exceptions",
    downstream: "/v1/ops/travel/exceptions",
    source: `${ADMIN_OPS} travelExceptions`,
  },
  {
    rule: "/ops/travel/*",
    method: "POST",
    path: "/v1/ops/travel/exceptions/ord_1/actions",
    downstream: "/v1/ops/travel/exceptions/ord_1/actions",
    source: `${ADMIN_OPS} travelAction`,
  },
  {
    rule: "/ops/travel/*",
    method: "GET",
    path: "/v1/ops/travel/providers/health",
    downstream: "/v1/ops/travel/providers/health",
    source: `${ADMIN_OPS} providerHealth`,
  },
  {
    rule: "/ops/travel/*",
    method: "POST",
    path: "/v1/ops/travel/flight-status",
    downstream: "/v1/ops/travel/flight-status",
    source: TRAVEL_API,
  },
  {
    rule: "/ops/travel/*",
    method: "GET",
    path: "/v1/ops/travel/commercial-rates?supplierId=sup_1",
    downstream: "/v1/ops/travel/commercial-rates",
    source: "contracts/openapi/growth-ops.yaml (commercial rates)",
  },
  {
    rule: "/ops/travel/*",
    method: "POST",
    path: "/v1/ops/travel/orders/ord_1/settlement",
    downstream: "/v1/ops/travel/orders/ord_1/settlement",
    source: "travel-service src/routes/ops.ts (settlement recon)",
  },
];

interface UnbackedRule {
  readonly rule: string;
  readonly method: string;
  readonly path: string;
  readonly downstream: string;
  readonly reason: string;
}

/**
 * Rules that forward to a service which serves nothing under the family. The
 * service answers its own 404; each is re-checked below so it cannot quietly
 * become (or stop being) reachable without this list changing.
 */
const UNBACKED: readonly UnbackedRule[] = [
  {
    rule: "/drivers/me/documents/*",
    method: "GET",
    path: "/v1/drivers/me/documents/doc_1",
    downstream: "/drivers/me/documents/doc_1",
    reason:
      "ownership guard: keeps the driver-documents subtree on user-service (never ride-service's /drivers); user-service serves only the collection route today",
  },
  {
    rule: "/pricing/*",
    method: "POST",
    path: "/v1/pricing/estimate",
    downstream: "/v1/pricing/estimate",
    reason:
      "ride-service serves no /v1/pricing; its quote is POST /v1/quotes, which no gateway rule exposes",
  },
  {
    rule: "/food/*",
    method: "GET",
    path: "/v1/food/orders",
    downstream: "/food/orders",
    reason:
      "food-service mounts no /food (it serves /restaurants, /menus, /orders and /v1/bites|merchants|carts|orders)",
  },
  {
    rule: "/packages/*",
    method: "POST",
    path: "/v1/packages",
    downstream: "/api/v1/packages",
    reason: "delivery-service serves no /packages",
  },
  {
    rule: "/payments/*",
    method: "POST",
    path: "/v1/payments/initiate",
    downstream: "/v1/payments/initiate",
    reason:
      "payment-service quarantined the old /payments surface (QUARANTINE.md)",
  },
  {
    rule: "/wallets/*",
    method: "GET",
    path: "/v1/wallets/balance",
    downstream: "/v1/wallets/balance",
    reason:
      "payment-service quarantined the old /wallets surface; the live wallet is /v1/wallet",
  },
  {
    rule: "/transactions/*",
    method: "GET",
    path: "/v1/transactions",
    downstream: "/v1/transactions",
    reason: "payment-service serves no /transactions",
  },
  {
    rule: "/analytics/*",
    method: "GET",
    path: "/v1/analytics/summary",
    downstream: "/analytics/summary",
    reason: "no analytics service exists in this repository",
  },
  {
    rule: "/reports/*",
    method: "GET",
    path: "/v1/reports/daily",
    downstream: "/reports/daily",
    reason: "no analytics service exists in this repository",
  },
  {
    rule: "/ceerion/*",
    method: "GET",
    path: "/v1/ceerion/offers",
    downstream: "/ceerion/offers",
    reason: "no CEERION service exists in this repository",
  },
  {
    rule: "/vehicles/*",
    method: "GET",
    path: "/v1/vehicles/veh_1",
    downstream: "/vehicles/veh_1",
    reason: "no CEERION service exists in this repository",
  },
  {
    rule: "/financing/*",
    method: "GET",
    path: "/v1/financing/plans",
    downstream: "/financing/plans",
    reason: "no CEERION service exists in this repository",
  },
];

/** Service directories for the rules whose service is not in this repo. */
const ABSENT_SERVICE_DIRS: Partial<Record<ServiceName, string>> = {
  "analytics-service": "services/analytics-service",
  "ceerion-service": "services/ceerion-service",
};

/**
 * A client path that a REACHABLE rule forwards correctly but that the service
 * does not serve — a client/service mismatch, not a gateway mapping one. For a
 * service with a manifest each is asserted to still be unserved, so fixing it
 * flips this test and the path moves to REACHABLE; for one without a manifest
 * only the mapping is pinned (the gap was checked by hand against the
 * service's route module).
 */
const KNOWN_CLIENT_GAPS: readonly (ReachableCase & {
  readonly gap: string;
  /**
   * A parameter route of the service that ALSO matches the path, and answers
   * not_found for it (e.g. `/:transferId` capturing `/suggest`). The check
   * then requires that route to be the ONLY one serving the path.
   */
  readonly capturedBy?: string;
})[] = [
  {
    rule: "/wallet/*",
    method: "POST",
    path: "/v1/wallet/mp/topups",
    downstream: "/v1/wallet/mp/topups",
    source: `${DRIVER} src/api/marketplace.ts topup`,
    gap: "payment-service serves POST /v1/wallet/topups, not /v1/wallet/mp/topups",
  },
  {
    rule: "/mandates/*",
    method: "GET",
    path: "/v1/mandates/executions/exe_1",
    downstream: "/mandates/executions/exe_1",
    source: `${RIDER} src/api/mandates.ts execution (MandateReceiptScreen)`,
    gap: "user-service serves GET /mandates/:id/executions (the list), not GET /mandates/executions/:executionId",
  },
  {
    rule: "/travel/carts/*",
    method: "GET",
    path: "/v1/travel/carts/cart_1",
    downstream: "/v1/travel/carts/cart_1",
    source: `${RIDER} src/api/travel.ts cart`,
    gap: "travel-service serves no GET /v1/travel/carts/:id; the cart view comes back from POST /v1/travel/carts and PUT /v1/travel/carts/:id/passengers",
  },
  {
    rule: "/reservations/*",
    method: "GET",
    path: "/v1/reservations/suggest?linkedOrderId=ord_1&direction=arrival_pickup",
    downstream: "/v1/reservations/suggest",
    source: `${RIDER} src/api/travel.ts reservationSuggestion`,
    gap: "travel-service serves no pickup suggestion; GET /v1/reservations/:transferId captures the path and answers not_found for transfer id 'suggest'",
    capturedBy: "/v1/reservations/:transferId",
  },
];

/**
 * Families real clients call that NO gateway rule proxies: the gateway itself
 * answers 404. Adding a rule for one (with its scope rules and a manifest or
 * exact-path case above) moves it out of this list.
 */
const UNPROXIED_CLIENT_CALLS: readonly {
  readonly method: string;
  readonly path: string;
  readonly servedBy: string;
  readonly source: string;
}[] = [
  {
    method: "GET",
    path: "/v1/benefits",
    servedBy: "growth-service /v1/benefits",
    source: `${RIDER} src/api/benefits.ts`,
  },
  {
    method: "GET",
    path: "/v1/referrals",
    servedBy: "growth-service /v1/referrals",
    source: `${RIDER} src/api/benefits.ts`,
  },
  {
    method: "POST",
    path: "/v1/attribution/claim",
    servedBy: "growth-service /v1/attribution",
    source: `${RIDER} src/api/benefits.ts`,
  },
  {
    method: "GET",
    path: "/v1/driver/incentives",
    servedBy: "growth-service /v1/driver",
    source: `${DRIVER} src/api/incentives.ts`,
  },
  {
    method: "GET",
    path: "/v1/kyc/requirements?cityId=LOS&role=driver",
    servedBy: "user-service /v1/kyc/requirements",
    source: "apps/marketing-site src/lib/requirements.ts",
  },
  {
    method: "GET",
    path: "/v1/flags",
    servedBy: "config-service /v1/flags",
    source: "apps/admin-dashboard",
  },
  // The admin policy page's config writes and history. config-service
  // authorizes them on the gateway's verified x-user-role, but only the two
  // reads in src/routes/config-read.ts are routed until the admin config
  // path is cleared (docs/launch/GAP_REGISTER.md).
  {
    method: "PUT",
    path: "/v1/flags/marketplace_rides",
    servedBy: "config-service /v1/flags/:key",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "POST",
    path: "/v1/config/change-requests",
    servedBy: "config-service /v1/config/change-requests",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "GET",
    path: "/v1/config/cities/LOS/history",
    servedBy: "config-service /v1/config/cities/:cityId/history",
    source: "apps/admin-dashboard src/lib/marketplace-api.ts",
  },
  {
    method: "GET",
    path: "/v1/growth/campaigns",
    servedBy: "growth-service /v1/growth",
    source: "apps/admin-dashboard",
  },
  {
    method: "GET",
    path: "/v1/ops/ai/metrics",
    servedBy: "ask-service /v1/ops/ai",
    source: "apps/admin-dashboard",
  },
  {
    method: "POST",
    path: "/v1/ai/marketing/threads/thr_1/messages",
    servedBy: "growth-service /v1/ai/marketing",
    source: "apps/admin-dashboard src/lib/growth-api.ts assistant",
  },
];

/**
 * Routes a service serves for suppliers or other services — NEVER for a
 * client token — that no gateway rule may forward. Each must exist in the
 * service's manifest (so the check cannot pass vacuously) and must answer the
 * gateway's own 404 without reaching any service.
 */
const SERVICE_ONLY_ROUTES: readonly {
  readonly service: ServiceName;
  readonly method: string;
  /** The gateway path a client would try. */
  readonly path: string;
  /** The service's own path, when it is not `path` (an unversioned service). */
  readonly servicePath?: string;
  readonly reason: string;
}[] = [
  {
    service: "travel-service",
    method: "POST",
    path: "/v1/travel/webhooks/sup_duffel",
    reason:
      "supplier callbacks (Duffel, LiteAPI) are verified by each supplier's own signature over the raw body and are delivered to travel-service directly, never through the client gateway",
  },
  {
    service: "travel-service",
    method: "POST",
    path: "/v1/travel/webhooks/sup_liteapi",
    reason: "as above (LiteAPI's authorization token)",
  },
  {
    service: "payment-service",
    method: "POST",
    path: "/v1/finance/business/reserve",
    reason:
      "the internal business-budget API ride-service calls by service key (internalServiceAuth); a client may never reserve, commit or release organization budget directly",
  },
  {
    service: "payment-service",
    method: "POST",
    path: "/v1/finance/business/commit",
    reason: "as above",
  },
  {
    service: "payment-service",
    method: "POST",
    path: "/v1/finance/business/release",
    reason: "as above",
  },
  {
    service: "payment-service",
    method: "POST",
    path: "/v1/finance/business/policy-check",
    reason: "as above",
  },
  {
    service: "payment-service",
    method: "GET",
    path: "/v1/finance/business/reservations/bkr_1",
    reason: "as above (reconciliation status)",
  },
  {
    service: "user-service",
    method: "POST",
    path: "/v1/internal/grants",
    servicePath: "/internal/grants",
    reason:
      "ask-service mints single-use action grants here by service key (AI_GRANTS_SERVICE_KEY); a client token must never mint its own authority",
  },
  {
    service: "user-service",
    method: "POST",
    path: "/v1/internal/mandates/mnd_1/run",
    servicePath: "/internal/mandates/mnd_1/run",
    reason: "as above (a mandate run is service-initiated)",
  },
  {
    service: "fleet-service",
    method: "GET",
    path: "/v1/internal/fleet/drivers/drv_1/vehicle-at",
    servicePath: "/internal/fleet/drivers/drv_1/vehicle-at",
    reason:
      "internal contract A route 8: ride-service reads a fleet driver's signed vehicle by service key (FLEET_SERVICE_KEY); a client token must never read another driver's assignment",
  },
  {
    service: "fleet-service",
    method: "GET",
    path: "/v1/internal/fleet/vehicles/veh_1",
    servicePath: "/internal/fleet/vehicles/veh_1",
    reason: "internal contract A route 9 (swap revalidation), as above",
  },
  {
    service: "fleet-service",
    method: "GET",
    path: "/v1/internal/fleet/settlement-inputs",
    servicePath: "/internal/fleet/settlement-inputs",
    reason:
      "internal contract B: payment-service reads signed remittance terms and hours by service key (FLEET_PAYMENT_SERVICE_KEY); never a client route",
  },
];

/**
 * The passenger trip link (src/routes/trip-access.ts): public — no bearer
 * token — and forwarded to ride-service at the same path. Each must be in
 * ride-service's manifest and arrive there through the real app.
 */
const PUBLIC_TRIP_ACCESS = TRIP_ACCESS_ROUTES.map((route) => ({
  method: route.method,
  path: route.path,
  downstream: route.path,
  source: "ride-service internal/handler/marketplace_guest.go (A06 part B)",
}));

// ---------------------------------------------------------------------------
// Harness: one recording upstream per service, through the real app
// ---------------------------------------------------------------------------

const SERVICE_NAMES = Object.keys(SERVICES) as ServiceName[];
const upstreams = new Map<ServiceName, Upstream>();
const app = createApp("test");
let ipCounter = 0;

beforeAll(async () => {
  for (const service of SERVICE_NAMES) {
    const upstream = await startUpstream();
    upstreams.set(service, upstream);
    process.env[SERVICES[service].env] = upstream.url;
  }
});

afterAll(async () => {
  for (const upstream of upstreams.values()) {
    await upstream.close();
  }
});

beforeEach(() => {
  for (const upstream of upstreams.values()) upstream.received.length = 0;
  setIdentityStateStore(openRiskStore);
  resetTripAccessLimiter();
});

function ruleFor(pattern: string): ProxyRule {
  const rule = PROXY_RULES.find((candidate) => candidate.pattern === pattern);
  if (rule === undefined) {
    throw new Error(`no proxy rule "${pattern}" in src/routes/proxy-map.ts`);
  }
  return rule;
}

function pathOnly(clientPath: string): string {
  const query = clientPath.indexOf("?");
  return query === -1 ? clientPath : clientPath.slice(0, query);
}

function queryOf(clientPath: string): string {
  const query = clientPath.indexOf("?");
  return query === -1 ? "" : clientPath.slice(query);
}

/**
 * Sends one request through the whole gateway as an admin (every scope, full
 * mode, so no scope rule stands between the request and the proxy) and
 * reports which service received it, at which path.
 */
async function sendThroughGateway(
  method: string,
  clientPath: string,
  options: { readonly anonymous?: boolean } = {},
): Promise<{
  status: number;
  code: string | undefined;
  arrivals: { service: ServiceName; url: string; method: string }[];
}> {
  ipCounter += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.77.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
  };
  if (options.anonymous === true) {
    // The passenger trip link: no bearer token, only the link's own.
    headers["x-trip-access-token"] = "uta_route_contract_token";
    headers["idempotency-key"] = "idem-route-contract-01";
  } else {
    const token = await clientToken({
      sub: "usr_route_contract",
      role: "admin",
      cityId: "LOS",
    });
    headers.authorization = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    (init as { body?: string }).body = "{}";
  }
  const response = await app.fetch(
    new Request(`http://gateway.test${clientPath}`, init),
  );
  const text = await response.text();
  let code: string | undefined;
  try {
    code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
  } catch {
    code = undefined;
  }
  const arrivals: { service: ServiceName; url: string; method: string }[] = [];
  for (const [service, upstream] of upstreams) {
    for (const received of upstream.received) {
      arrivals.push({ service, url: received.url, method: received.method });
    }
  }
  return { status: response.status, code, arrivals };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe("the proxy inventory covers every rule", () => {
  it("has a reachable case or an unbacked declaration for every PROXY_RULES entry", () => {
    const covered = new Set<string>([
      ...REACHABLE.map((testCase) => testCase.rule),
      ...UNBACKED.map((entry) => entry.rule),
    ]);
    const uncovered = PROXY_RULES.map((rule) => rule.pattern).filter(
      (pattern) => !covered.has(pattern),
    );
    expect(
      uncovered,
      "a proxy rule with no client path proving it reaches a real route — add a REACHABLE case (checked against the service's manifest) or an UNBACKED entry with a reason",
    ).toEqual([]);
  });

  it("forwards no service-only route: each exists in its manifest and no rule pattern reaches it", () => {
    for (const entry of SERVICE_ONLY_ROUTES) {
      const manifest = loadManifest(entry.service);
      expect(manifest, `${entry.service} publishes a manifest`).toBeDefined();
      if (manifest === undefined) continue;
      const servicePath = entry.servicePath ?? entry.path;
      expect(
        manifestServes(manifest, entry.method, servicePath),
        `${entry.service} no longer serves ${entry.method} ${servicePath}: update SERVICE_ONLY_ROUTES`,
      ).toBe(true);
    }
  });

  it("declares no case for a rule that does not exist, and no rule twice", () => {
    for (const entry of [...REACHABLE, ...UNBACKED, ...KNOWN_CLIENT_GAPS]) {
      expect(() => ruleFor(entry.rule)).not.toThrow();
    }
    const unbacked = UNBACKED.map((entry) => entry.rule);
    expect(new Set(unbacked).size).toBe(unbacked.length);
    const reachableRules = new Set(REACHABLE.map((testCase) => testCase.rule));
    expect(unbacked.filter((rule) => reachableRules.has(rule))).toEqual([]);
    const patterns = PROXY_RULES.map((rule) => rule.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("reads a non-empty manifest for every service that publishes one", () => {
    for (const service of Object.keys(MANIFEST_SOURCES) as ServiceName[]) {
      const manifest = loadManifest(service);
      expect(manifest?.routes.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("proves the round-4 blanket /v1 strip reached nothing on the manifest services", () => {
    // The regression this file exists for, in executable form: the old
    // mapping (`path.replace(/^\/v1/, "")` for every service) lands on no
    // route at all for any client path of ride-, delivery- or payment-service.
    // user-service mounts unversioned routes, where that strip IS the right
    // mapping, so it is not part of this check.
    const checked: string[] = [];
    for (const testCase of REACHABLE) {
      const service = ruleFor(testCase.rule).service;
      if (SERVICES[service].basePath === "") continue;
      const manifest = loadManifest(service);
      if (manifest === undefined) continue;
      const legacy = pathOnly(testCase.path).replace(/^\/v1/, "");
      expect(
        manifestServes(manifest, testCase.method, legacy),
        `${testCase.method} ${legacy}`,
      ).toBe(false);
      checked.push(testCase.path);
    }
    expect(checked.length).toBeGreaterThan(40);
  });
});

describe("every client path reaches a route its service serves", () => {
  it.each(
    REACHABLE.map((testCase) => [testCase.method, testCase.path, testCase]),
  )("%s %s", async (_method, _path, testCase) => {
    const rule = ruleFor(testCase.rule);
    const mapped = downstreamPath(rule, pathOnly(testCase.path));

    // 1. The mapping function, against the exact expectation.
    expect(mapped, `${testCase.source}`).toBe(testCase.downstream);

    // 2. The mapped route exists in the service's own router.
    const manifest = loadManifest(rule.service);
    if (manifest !== undefined) {
      expect(
        manifestServes(manifest, testCase.method, mapped),
        `rule ${rule.pattern} maps ${testCase.method} ${testCase.path} (${testCase.source}) to ${rule.service} ${testCase.method} ${mapped}, which ${manifest.source.file} does not serve. Fix the mapping in src/routes/proxy-map.ts (never the client path); if the service route moved, regenerate its manifest (${manifest.source.regenerate}) first.`,
      ).toBe(true);
    }

    // 3. Through the real app: routed to that service, at that path.
    const result = await sendThroughGateway(testCase.method, testCase.path);
    expect(result.status).toBe(200);
    expect(result.arrivals).toEqual([
      {
        service: rule.service,
        url: `${testCase.downstream}${queryOf(testCase.path)}`,
        method: testCase.method,
      },
    ]);
  });
});

describe("the passenger trip link reaches ride-service without a user token", () => {
  it.each(
    PUBLIC_TRIP_ACCESS.map((testCase) => [
      testCase.method,
      testCase.path,
      testCase,
    ]),
  )("%s %s", async (_method, _path, testCase) => {
    const manifest = loadManifest("ride-service");
    expect(manifest).toBeDefined();
    if (manifest === undefined) return;
    expect(
      manifestServes(manifest, testCase.method, testCase.downstream),
      `${testCase.method} ${testCase.path} (${testCase.source}) is not in ${manifest.source.file}: regenerate it (${manifest.source.regenerate}) or fix src/routes/trip-access.ts`,
    ).toBe(true);

    const result = await sendThroughGateway(testCase.method, testCase.path, {
      anonymous: true,
    });
    expect(result.status).toBe(200);
    expect(result.arrivals).toEqual([
      {
        service: "ride-service",
        url: testCase.downstream,
        method: testCase.method,
      },
    ]);
  });

  it("keeps every other /v1/mp path behind a bearer token", async () => {
    for (const [method, clientPath] of [
      ["GET", "/v1/mp/trip-access/"],
      ["PUT", "/v1/mp/trip-access"],
      ["POST", "/v1/mp/trip-access"],
      ["GET", "/v1/mp/trip-access/decline"],
      ["GET", "/v1/mp/trip-access/pin/x"],
      ["GET", "/v1/mp/trip-accessx"],
      ["GET", "/v1/mp/requests/mpr_1"],
    ] as const) {
      const result = await sendThroughGateway(method, clientPath, {
        anonymous: true,
      });
      expect(result.status, `${method} ${clientPath}`).toBe(401);
      expect(result.arrivals, `${method} ${clientPath}`).toEqual([]);
    }
  });
});

/**
 * The read-only config family (src/routes/config-read.ts): GET-only exact
 * paths, the one config-service surface a client token reaches. Each case
 * must land on a route in config-service's manifest, and each admin route it
 * withholds must exist there too, so the 404s above cannot pass vacuously.
 */
const CONFIG_READS: readonly {
  readonly pattern: string;
  readonly path: string;
  readonly downstream: string;
  readonly source: string;
}[] = [
  {
    pattern: "/config/flags",
    path: "/v1/config/flags?cityId=LOS",
    downstream: "/v1/flags",
    source: "packages/mobile-core src/flags.ts",
  },
  {
    pattern: "/config/cities/:cityId{[A-Za-z0-9_-]+}",
    path: "/v1/config/cities/LOS",
    downstream: "/v1/config/cities/LOS",
    source: "packages/mobile-core src/config.ts",
  },
];

const CONFIG_WITHHELD: readonly { method: string; path: string }[] = [
  { method: "PUT", path: "/v1/flags/marketplace_rides" },
  { method: "GET", path: "/v1/config/cities" },
  { method: "POST", path: "/v1/config/cities/status" },
  { method: "GET", path: "/v1/config/cities/LOS/history" },
  { method: "POST", path: "/v1/config/change-requests" },
  { method: "POST", path: "/v1/config/change-requests/cr_1/approve" },
];

describe("the read-only config family reaches config-service", () => {
  it("has a case for every config read route", () => {
    expect(CONFIG_READS.map((testCase) => testCase.pattern).sort()).toEqual(
      CONFIG_READ_ROUTES.map((route) => route.pattern).sort(),
    );
  });

  it.each(CONFIG_READS.map((testCase) => [testCase.path, testCase]))(
    "GET %s",
    async (_path, testCase) => {
      const manifest = loadManifest("config-service");
      expect(manifest).toBeDefined();
      if (manifest === undefined) return;
      expect(
        manifestServes(manifest, "GET", testCase.downstream),
        `GET ${testCase.path} (${testCase.source}) maps to config-service GET ${testCase.downstream}, which ${manifest.source.file} does not serve: regenerate it (${manifest.source.regenerate}) or fix src/routes/config-read.ts`,
      ).toBe(true);

      const result = await sendThroughGateway("GET", testCase.path);
      expect(result.status).toBe(200);
      expect(result.arrivals).toEqual([
        {
          service: "config-service",
          url: `${testCase.downstream}${queryOf(testCase.path)}`,
          method: "GET",
        },
      ]);
    },
  );

  it.each(CONFIG_WITHHELD.map((entry) => [entry.method, entry.path]))(
    "withholds %s %s, which config-service serves",
    async (method, clientPath) => {
      const manifest = loadManifest("config-service");
      expect(manifest).toBeDefined();
      if (manifest === undefined) return;
      expect(manifestServes(manifest, method, clientPath)).toBe(true);

      const result = await sendThroughGateway(method, clientPath);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.arrivals).toEqual([]);
    },
  );
});

describe("unbacked rules stay honest", () => {
  it.each(UNBACKED.map((entry) => [entry.rule, entry]))(
    "%s",
    async (_pattern, entry) => {
      const rule = ruleFor(entry.rule);
      const mapped = downstreamPath(rule, pathOnly(entry.path));
      expect(mapped).toBe(entry.downstream);

      const manifest = loadManifest(rule.service);
      if (manifest !== undefined) {
        expect(
          manifestServes(manifest, entry.method, mapped),
          `${rule.service} now serves ${entry.method} ${mapped}: rule ${rule.pattern} is reachable — move it from UNBACKED to REACHABLE (was: ${entry.reason})`,
        ).toBe(false);
      }
      const absentDir = ABSENT_SERVICE_DIRS[rule.service];
      if (absentDir !== undefined) {
        expect(
          existsSync(path.join(REPO_ROOT, absentDir)),
          `${absentDir} now exists: give ${rule.service} a correct basePath and move ${rule.pattern} to REACHABLE`,
        ).toBe(false);
      }

      // Behaviour is unchanged: the rule still forwards, and the service
      // answers for itself.
      const result = await sendThroughGateway(entry.method, entry.path);
      expect(result.arrivals).toEqual([
        { service: rule.service, url: entry.downstream, method: entry.method },
      ]);
    },
  );
});

describe("known client/service mismatches stay visible", () => {
  it.each(KNOWN_CLIENT_GAPS.map((gap) => [gap.method, gap.path, gap]))(
    "%s %s",
    (_method, _path, gap) => {
      const rule = ruleFor(gap.rule);
      const mapped = downstreamPath(rule, pathOnly(gap.path));
      expect(mapped).toBe(gap.downstream);
      const manifest = loadManifest(rule.service);
      if (manifest !== undefined) {
        expect(
          servingPatterns(manifest, gap.method, mapped),
          `${rule.service} now serves ${gap.method} ${mapped} — move ${gap.path} to REACHABLE (was: ${gap.gap})`,
        ).toEqual(gap.capturedBy === undefined ? [] : [gap.capturedBy]);
      }
    },
  );
});

describe("service-only routes are never reachable through the gateway", () => {
  it.each(
    SERVICE_ONLY_ROUTES.map((entry) => [entry.method, entry.path, entry]),
  )(
    "%s %s answers the gateway's own 404",
    async (method, clientPath, entry) => {
      const result = await sendThroughGateway(method, clientPath);
      expect(
        result.status,
        `${clientPath} reached a proxy rule — ${entry.reason}`,
      ).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.arrivals).toEqual([]);
    },
  );
});

describe("client families no gateway rule proxies", () => {
  it.each(UNPROXIED_CLIENT_CALLS.map((call) => [call.method, call.path, call]))(
    "%s %s answers the gateway's own 404",
    async (method, clientPath, call) => {
      const result = await sendThroughGateway(method, clientPath);
      expect(
        result.status,
        `${clientPath} (${call.source}) is now proxied — move it to REACHABLE with its service (${call.servedBy})`,
      ).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.arrivals).toEqual([]);
    },
  );
});

describe("downstreamPath", () => {
  it("removes the version prefix and an edge namespace only at a segment boundary", () => {
    const delivery = ruleFor("/delivery/*");
    expect(downstreamPath(delivery, "/v1/delivery")).toBe("/api/v1");
    expect(downstreamPath(delivery, "/v1/delivery/")).toBe("/api/v1/");
    expect(downstreamPath(delivery, "/v1/deliveryx/a")).toBe(
      "/api/v1/deliveryx/a",
    );
    const users = ruleFor("/users/*");
    expect(downstreamPath(users, "/v1/users")).toBe("/users");
    expect(downstreamPath(users, "/v1")).toBe("/");
    expect(downstreamPath(users, "/v1x/users")).toBe("/v1x/users");
  });

  it("keeps the version for services that mount it and strips it for those that do not", () => {
    expect(downstreamPath(ruleFor("/mp/*"), "/v1/mp/quote")).toBe(
      "/v1/mp/quote",
    );
    expect(downstreamPath(ruleFor("/wallet/*"), "/v1/wallet/mp/overview")).toBe(
      "/v1/wallet/mp/overview",
    );
    expect(downstreamPath(ruleFor("/ask/*"), "/v1/ask/threads")).toBe(
      "/v1/ask/threads",
    );
    expect(downstreamPath(ruleFor("/auth/*"), "/v1/auth/refresh")).toBe(
      "/auth/refresh",
    );
    expect(
      downstreamPath(ruleFor("/notifications/*"), "/v1/notifications/n_1/read"),
    ).toBe("/api/v1/notifications/n_1/read");
    expect(
      downstreamPath(ruleFor("/travel/trips/*"), "/v1/travel/trips/trp_1"),
    ).toBe("/v1/travel/trips/trp_1");
    expect(
      downstreamPath(ruleFor("/ops/travel/*"), "/v1/ops/travel/exceptions"),
    ).toBe("/v1/ops/travel/exceptions");
  });
});

describe("manifest matching", () => {
  it("normalises chi and hono parameters and chi's Route leaf slash", () => {
    expect(
      patternServes("/v1/rides/{rideId}/cancel", "/v1/rides/r1/cancel", "chi"),
    ).toBe(true);
    expect(patternServes("/v1/rides/", "/v1/rides", "chi")).toBe(true);
    expect(patternServes("/v1/rides/{rideId}", "/v1/rides/", "chi")).toBe(
      false,
    );
    expect(patternServes("/v1/rides/{rideId}", "/v1/rides/r1/x", "chi")).toBe(
      false,
    );
    // Only a Route leaf ("/"-terminated) tolerates the trailing slash.
    expect(patternServes("/v1/rides/active", "/v1/rides/active/", "chi")).toBe(
      false,
    );
    expect(patternServes("/v1/mp/requests/", "/v1/mp/requests/", "chi")).toBe(
      true,
    );
    expect(
      patternServes(
        "/v1/wallet/mp/holds/:id/capture",
        "/v1/wallet/mp/holds/h1/capture",
        "hono",
      ),
    ).toBe(true);
    expect(patternServes("/v1/wallet", "/v1/wallet/", "hono")).toBe(false);
    expect(patternServes("/files/*", "/files/a/b", "chi")).toBe(true);
    expect(patternServes("/mp/quote", "/v1/mp/quote", "chi")).toBe(false);
  });
});
