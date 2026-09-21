// Requester-side negotiated-fare marketplace (M08, boards R01–R11).
// Paths follow contracts/openapi/marketplace.yaml; DTO shapes come straight from
// @ubi/contracts/src/marketplace.ts. Money is server minor units, never computed here.
import { api, type Money } from "@ubi/mobile-core";
import type {
  MpAward,
  MpOffer,
  MpPublishRequest,
  MpQueueView,
  MpQuoteEnvelope,
  MpRequest,
  MpSelectBid,
  MpService,
} from "@ubi/contracts";

export type { MpAward, MpOffer, MpQueueView, MpQuoteEnvelope, MpRequest };

/**
 * POST /select 202 body per contracts/openapi/marketplace.yaml: the award is WRAPPED
 * ({ award, pickupPin? }), never the bare award. `pickupPin` is present ONLY when this
 * very call confirmed a current-slot ride award — it is revealed exactly once to the
 * owner and deliberately absent from idempotent replays and from every award GET, so
 * the caller must hold it the moment it arrives or it is gone for good.
 */
export type MpSelectResponse = { award: MpAward; pickupPin?: string };

export type MpQuoteQuery = {
  service: MpService;
  vehicleClass: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  weightKg?: number;
};

/**
 * Rider offer view. `bookingFeeMinor`, `totalMinor` and `deltaLabel` are PROPOSED
 * contract additions the R05 board requires (total-you-pay and the "+₦200" delta are
 * server-computed/phrased — clients never do money arithmetic). Until
 * packages/contracts MpOfferSchema + contracts/openapi/marketplace.yaml carry them,
 * only fixtures serve them; see followups.
 */
export type MpOfferDto = MpOffer & {
  bookingFeeMinor?: Money;
  totalMinor?: Money;
  deltaLabel?: string | null;
};

/** GET /v1/mp/requests/:id owner snapshot (request + private offers + award when selection ran). */
export type MpRequestSnapshot = {
  request: MpRequest;
  offers: MpOfferDto[];
  award?: MpAward;
  seq: number;
};

/**
 * R10 queued-job tracker view. NOW REAL (G07): served by ride-service at
 * GET /v1/mp/requests/:id/queue and defined by @ubi/contracts MpQueueViewSchema
 * (re-exported above). The container reads a subset (driverFirstName, steps,
 * fareMinor, windowLabel, eta, delayed); the projection also carries the
 * authorized/versioned fields (version, asOf, status, promotion, driver,
 * pickupWindow, actions) for optimistic refresh and stale-ETA detection.
 */

/**
 * R11b recipient-unreachable resolution view.
 *
 * REAL as of C07 for the `GET` and the `approve_return`/`hold_at_point`
 * actions: delivery-service's custody timeline
 * (`GET /v1/delivery/deliveries/:id/custody`,
 * `POST .../custody/return/consent`, contracts/openapi/marketplace.yaml) is
 * a real, DB-backed, tested endpoint — see
 * docs/marketplace/DELIVERY_CUSTODY.md. This screen's own DTO shape
 * (`state`/`situation`/`returnFeeMinor`/`custody` ladder) predates that
 * endpoint and does not match its response 1:1, so `mapCustodyToReturnView`
 * below translates one into the other; the screen/container are unchanged.
 *
 * `retry_recipient` STAYS GATED: delivery-service has no standalone
 * "mark retrying" transition — a retry only exists as part of posting an
 * actual delivery proof (`POST .../custody/delivery-proof`), which this
 * screen does not capture (no camera/proof-capture UI here — out of scope
 * per this feature's "do not rebuild RN screens" boundary). Calling it hits
 * the real server, which refuses cleanly with a validation error; the
 * container's existing `onError` path renders that as the recoverable error
 * banner it already has, never a crash.
 */
export type MpDeliveryReturnState = {
  state: "unreachable" | "retrying" | "return_approved" | "held_at_point";
  situation: string;
  returnFeeMinor: Money;
  custody: {
    label: string;
    detail?: string;
    state: "done" | "active" | "pending" | "skipped";
  }[];
};
export type MpDeliveryReturnAction =
  | "approve_return"
  | "retry_recipient"
  | "hold_at_point";

/** delivery-service's real custody timeline shape (GetCustodyTimeline). */
type CustodyTimeline = {
  deliveryId: string;
  state: string;
  version: number;
  openReturn: {
    returnId: string;
    chargeStatus: "not_required" | "unsupported";
    consentState: "pending" | "consented" | "rejected" | "expired";
    consentExpiresAt: string;
    feeMinor: number;
    currency: string;
  } | null;
  events: {
    fromState?: string;
    toState: string;
    actorType: string;
    reason?: string;
    createdAt: string;
  }[];
};

const CUSTODY_LADDER_LABEL: Record<string, string> = {
  courier_assigned: "Courier assigned",
  picked_up: "Picked up",
  in_transit: "On the way",
  delivery_attempted: "Delivery attempted",
  recipient_unreachable: "Recipient unreachable",
  return_proposed: "Return proposed",
  return_consented: "Return approved",
  returning: "Returning to you",
  return_to_sender: "Returned to you",
  held_at_point: "Held at pickup point",
  collected: "Collected",
  delivery_retry: "Retrying delivery",
  delivered: "Delivered",
};

/**
 * Translates the real custody timeline into this screen's pre-existing DTO.
 * Exported for testing; not itself a network call.
 */
export function mapCustodyToReturnView(
  t: CustodyTimeline,
): MpDeliveryReturnState {
  const coarse: MpDeliveryReturnState["state"] =
    t.state === "delivery_retry"
      ? "retrying"
      : t.state === "return_consented" ||
          t.state === "returning" ||
          t.state === "return_to_sender"
        ? "return_approved"
        : t.state === "held_at_point" || t.state === "collected"
          ? "held_at_point"
          : "unreachable";
  const situation =
    t.openReturn?.chargeStatus === "unsupported"
      ? "This return proposes a fee we cannot yet collect. It will be held at a pickup point instead."
      : "We could not reach the recipient. Choose how to resolve this delivery.";
  return {
    state: coarse,
    situation,
    returnFeeMinor: {
      amountMinor: t.openReturn?.feeMinor ?? 0,
      currency: t.openReturn?.currency || "NGN",
    },
    custody: t.events.map((e) => ({
      label: CUSTODY_LADDER_LABEL[e.toState] ?? e.toState,
      detail: e.reason,
      state: e.toState === t.state ? "active" : "done",
    })),
  };
}

// RN's URLSearchParams is only partially implemented; build the query by hand.
const quoteQs = (p: MpQuoteQuery) => {
  const pairs: [string, string][] = [
    ["service", p.service],
    ["vehicleClass", p.vehicleClass],
    ["pickupLat", String(p.pickupLat)],
    ["pickupLng", String(p.pickupLng)],
    ["dropoffLat", String(p.dropoffLat)],
    ["dropoffLng", String(p.dropoffLng)],
  ];
  if (p.weightKg !== undefined) pairs.push(["weightKg", String(p.weightKg)]);
  return pairs.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
};

export const marketplaceApi = {
  quote: (p: MpQuoteQuery) =>
    api<MpQuoteEnvelope>("GET", "/v1/mp/quote?" + quoteQs(p)),
  publish: (body: MpPublishRequest) =>
    api<MpRequest>("POST", "/v1/mp/requests", body),
  request: (requestId: string) =>
    api<MpRequestSnapshot>("GET", "/v1/mp/requests/" + requestId),
  revise: (
    requestId: string,
    body: {
      requestedFareMinor: Money;
      quoteId?: string;
      expectedVersion: number;
    },
  ) => api<MpRequest>("POST", "/v1/mp/requests/" + requestId + "/revise", body),
  cancel: (requestId: string) =>
    api<MpRequest>("POST", "/v1/mp/requests/" + requestId + "/cancel"),
  select: (requestId: string, body: MpSelectBid) =>
    api<MpSelectResponse>(
      "POST",
      "/v1/mp/requests/" + requestId + "/select",
      body,
    ),
  award: (requestId: string) =>
    api<MpAward>("GET", "/v1/mp/requests/" + requestId + "/award"),
  // Rider queue projection (R10 / G07) — real ride-service endpoint.
  queue: (requestId: string) =>
    api<MpQueueView>("GET", "/v1/mp/requests/" + requestId + "/queue"),
  // Delivery custody/returns (C07, G08). REAL delivery-service endpoints —
  // see contracts/openapi/marketplace.yaml and
  // docs/marketplace/DELIVERY_CUSTODY.md. The gateway proxies `/v1/delivery/*`
  // to delivery-service, which mounts these at `/api/v1/deliveries/:id/
  // custody/*`; see the C07 report for a separate, pre-existing gateway
  // path-stripping mismatch this inherits (unrelated to this feature, out of
  // its writable scope to fix — every other delivery-service route has the
  // same gap).
  deliveryReturnState: (deliveryId: string) =>
    api<CustodyTimeline>(
      "GET",
      "/v1/delivery/deliveries/" + deliveryId + "/custody",
    ).then(mapCustodyToReturnView),
  // "retry_recipient" is NOT implemented server-side (see the type doc
  // above): delivery-service has no standalone "mark retrying" transition,
  // only a retry bundled with an actual delivery-proof capture this screen
  // does not perform. The call still reaches the real server, which refuses
  // it with a validation error the container's existing onError path
  // displays — never faked as a success.
  deliveryReturnConsent: (deliveryId: string, action: MpDeliveryReturnAction) =>
    api<CustodyTimeline>(
      "POST",
      "/v1/delivery/deliveries/" + deliveryId + "/custody/return/consent",
      {
        action:
          action === "approve_return"
            ? "consent"
            : action === "hold_at_point"
              ? "reject"
              : action,
      },
    ).then(mapCustodyToReturnView),
};
