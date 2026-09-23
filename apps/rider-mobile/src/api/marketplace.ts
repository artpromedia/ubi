// Requester-side negotiated-fare marketplace (M08, boards R01–R11).
// Paths follow contracts/openapi/marketplace.yaml; DTO shapes come straight from
// @ubi/contracts/src/marketplace.ts. Money is server minor units, never computed here.
import { api, type Money } from "@ubi/mobile-core";
import {
  mpQuoteStopsParam,
  type MpAdvanceBooking,
  type MpAdvanceOffer,
  type MpAmendment,
  type MpAmendmentDecision,
  type MpAmendmentList,
  type MpAward,
  type MpCreateAdvanceRequest,
  type MpCreateRecurringTemplate,
  type MpCreateScheduledRequest,
  type MpOffer,
  type MpProposeAmendment,
  type MpPublishRequest,
  type MpQueueView,
  type MpQuoteEnvelope,
  type MpRecurringTemplate,
  type MpRequest,
  type MpScheduledRequest,
  type MpSelectBid,
  type MpService,
  type MpStopInput,
  type MpTrip,
} from "@ubi/contracts";

export type {
  MpAdvanceBooking,
  MpAdvanceOffer,
  MpAmendment,
  MpAmendmentList,
  MpAward,
  MpOffer,
  MpQueueView,
  MpQuoteEnvelope,
  MpRecurringTemplate,
  MpRequest,
  MpScheduledRequest,
  MpStopInput,
  MpTrip,
};

/**
 * POST /select 202 body per contracts/openapi/marketplace.yaml: the award is WRAPPED
 * ({ award, pickupPin? }), never the bare award. `pickupPin` is present ONLY when this
 * very call confirmed a current-slot ride award — it is revealed exactly once to the
 * owner and deliberately absent from idempotent replays and from every award GET, so
 * the caller must hold it the moment it arrives or it is gone for good. `booking` (A03)
 * is the advance booking an ADVANCE selection created — driver reserved, and whether the
 * rider's funding is secured yet; it never carries a PIN.
 */
export type MpSelectResponse = {
  award: MpAward;
  pickupPin?: string;
  booking?: MpAdvanceBooking;
};

export type MpQuoteQuery = {
  service: MpService;
  vehicleClass: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  weightKg?: number;
  /**
   * A02 ordered intermediate stops (rides only, marketplace_multi_stop). Sent as ONE
   * JSON-encoded `stops` query parameter built by the contract's own encoder, which
   * validates every stop first — a client can never send a stop id or a price.
   */
  stops?: MpStopInput[];
};

/** Series commands (POST /v1/mp/recurring-templates/{id}/{command}). */
export type MpSeriesCommand = "pause" | "resume" | "cancel";

/** POST /v1/mp/scheduled-requests/{id}/approve body (contracts MpApproveScheduledRequestSchema). */
export type MpApproveScheduled = {
  expectedVersion: number;
  maxFareMinor: Money;
  requestedFareMinor?: Money;
  paymentMethodId?: string;
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

/**
 * GET /v1/mp/requests/:id owner snapshot (request + private offers + award when selection
 * ran). `advanceOffers` (A03) lists offers on a FUTURE pickup window — present only on an
 * advance-booking request and never mixed into `offers`, so no advance offer can ever be
 * rendered as a live pickup.
 */
export type MpRequestSnapshot = {
  request: MpRequest;
  offers: MpOfferDto[];
  advanceOffers?: MpAdvanceOffer[];
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
  // An empty list is the plain route: the parameter is simply omitted.
  if (p.stops && p.stops.length > 0)
    pairs.push(["stops", mpQuoteStopsParam(p.stops)]);
  return pairs.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
};

const requestPath = (requestId: string) =>
  "/v1/mp/requests/" + encodeURIComponent(requestId);
const stopPath = (requestId: string, stopId: string, action: string) =>
  requestPath(requestId) +
  "/stops/" +
  encodeURIComponent(stopId) +
  "/" +
  action;
const amendmentPath = (requestId: string, amendmentId: string) =>
  requestPath(requestId) + "/amendments/" + encodeURIComponent(amendmentId);
const scheduledPath = (id: string) =>
  "/v1/mp/scheduled-requests/" + encodeURIComponent(id);
const bookingPath = (id: string) =>
  "/v1/mp/advance-bookings/" + encodeURIComponent(id);
const seriesPath = (id: string) =>
  "/v1/mp/recurring-templates/" + encodeURIComponent(id);
/** A caller-held key when the screen holds one (lib/idempotency.ts); api() mints one otherwise. */
const keyed = (idempotencyKey?: string) =>
  idempotencyKey ? { idempotencyKey } : {};

export const marketplaceApi = {
  quote: (p: MpQuoteQuery) =>
    api<MpQuoteEnvelope>("GET", "/v1/mp/quote?" + quoteQs(p)),
  publish: (body: MpPublishRequest) =>
    api<MpRequest>("POST", "/v1/mp/requests", body),
  request: (requestId: string) =>
    api<MpRequestSnapshot>("GET", "/v1/mp/requests/" + requestId),
  // Price- or ROUTE-affecting edit of an open request: a replacement quote for the same
  // endpoints with a different stop set is the pre-award route edit (every live offer is
  // invalidated and its hold released server-side). Pinned to expectedVersion.
  revise: (
    requestId: string,
    body: {
      requestedFareMinor: Money;
      quoteId?: string;
      expectedVersion: number;
    },
    idempotencyKey?: string,
  ) =>
    api<MpRequest>(
      "POST",
      "/v1/mp/requests/" + requestId + "/revise",
      body,
      keyed(idempotencyKey),
    ),
  cancel: (requestId: string, idempotencyKey?: string) =>
    api<MpRequest>(
      "POST",
      "/v1/mp/requests/" + requestId + "/cancel",
      undefined,
      keyed(idempotencyKey),
    ),
  select: (requestId: string, body: MpSelectBid, idempotencyKey?: string) =>
    api<MpSelectResponse>(
      "POST",
      "/v1/mp/requests/" + requestId + "/select",
      body,
      keyed(idempotencyKey),
    ),

  // ── A02: the executing trip, its stops and post-award amendments (rider) ──
  // Every POST changes trip state or money, so each carries a CALLER-HELD
  // Idempotency-Key: a retry after a dropped response replays the server's first
  // answer instead of acting twice. No body ever carries an amount — the server
  // prices every delta under the award's own pricing snapshot.
  trip: (requestId: string) =>
    api<MpTrip>("GET", requestPath(requestId) + "/trip"),
  amendments: (requestId: string) =>
    api<MpAmendmentList>("GET", requestPath(requestId) + "/amendments"),
  proposeAmendment: (
    requestId: string,
    body: MpProposeAmendment,
    idempotencyKey: string,
  ) =>
    api<MpAmendment>("POST", requestPath(requestId) + "/amendments", body, {
      idempotencyKey,
    }),
  approveAmendment: (
    requestId: string,
    amendmentId: string,
    body: MpAmendmentDecision,
    idempotencyKey: string,
  ) =>
    api<MpAmendment>(
      "POST",
      amendmentPath(requestId, amendmentId) + "/approve",
      body,
      { idempotencyKey },
    ),
  rejectAmendment: (
    requestId: string,
    amendmentId: string,
    body: MpAmendmentDecision,
    idempotencyKey: string,
  ) =>
    api<MpAmendment>(
      "POST",
      amendmentPath(requestId, amendmentId) + "/reject",
      body,
      { idempotencyKey },
    ),
  // The rider may drop any stop not yet left; skipping never lowers the agreed fare.
  skipStop: (
    requestId: string,
    stopId: string,
    reason: string | undefined,
    idempotencyKey: string,
  ) =>
    api<MpTrip>(
      "POST",
      stopPath(requestId, stopId, "skip"),
      reason ? { reason } : undefined,
      { idempotencyKey },
    ),
  // Extra paid waiting beyond the agreed cap, bound to the cap revision the rider saw.
  approveWaiting: (
    requestId: string,
    stopId: string,
    capRevision: number,
    idempotencyKey: string,
  ) =>
    api<MpTrip>(
      "POST",
      stopPath(requestId, stopId, "waiting-approval"),
      { capRevision },
      { idempotencyKey },
    ),
  // Safe early end of the journey: 200 with the adjusted trip, or 202 while the
  // adjustment's money outcome is still converging (poll the trip).
  terminate: (
    requestId: string,
    body: { reason?: string; expectedFareRevision: number },
    idempotencyKey: string,
  ) =>
    api<MpTrip>("POST", requestPath(requestId) + "/terminate", body, {
      idempotencyKey,
    }),

  // ── A03: Book for Later (scheduled requests, advance reservations, series) ──
  // Reads are never flag-gated server-side (switching a product off stops NEW sales
  // only); every create/command POST requires an Idempotency-Key.
  createScheduled: (body: MpCreateScheduledRequest, idempotencyKey: string) =>
    api<MpScheduledRequest>("POST", "/v1/mp/scheduled-requests", body, {
      idempotencyKey,
    }),
  scheduledList: () =>
    api<{ items?: MpScheduledRequest[] }>("GET", "/v1/mp/scheduled-requests"),
  scheduled: (id: string) => api<MpScheduledRequest>("GET", scheduledPath(id)),
  cancelScheduled: (id: string, idempotencyKey: string) =>
    api<MpScheduledRequest>("POST", scheduledPath(id) + "/cancel", undefined, {
      idempotencyKey,
    }),
  approveScheduled: (
    id: string,
    body: MpApproveScheduled,
    idempotencyKey: string,
  ) =>
    api<MpScheduledRequest>("POST", scheduledPath(id) + "/approve", body, {
      idempotencyKey,
    }),
  createAdvance: (body: MpCreateAdvanceRequest, idempotencyKey: string) =>
    api<MpRequest>("POST", "/v1/mp/advance-requests", body, {
      idempotencyKey,
    }),
  bookings: () =>
    api<{ items?: MpAdvanceBooking[] }>("GET", "/v1/mp/advance-bookings"),
  booking: (id: string) => api<MpAdvanceBooking>("GET", bookingPath(id)),
  cancelBooking: (id: string, idempotencyKey: string) =>
    api<MpAdvanceBooking>("POST", bookingPath(id) + "/cancel", undefined, {
      idempotencyKey,
    }),
  // The rider's explicit consent to re-publish a failed booking's trip: answers the NEW
  // advance request (no driver secured). No fare is sent — the original asked fare stands
  // and a refreshed minimum above it is refused for the rider to decide.
  rematchBooking: (id: string, idempotencyKey: string) =>
    api<MpRequest>("POST", bookingPath(id) + "/rematch", undefined, {
      idempotencyKey,
    }),
  createSeries: (body: MpCreateRecurringTemplate, idempotencyKey: string) =>
    api<MpRecurringTemplate>("POST", "/v1/mp/recurring-templates", body, {
      idempotencyKey,
    }),
  seriesList: () =>
    api<{ items?: MpRecurringTemplate[] }>("GET", "/v1/mp/recurring-templates"),
  series: (id: string) => api<MpRecurringTemplate>("GET", seriesPath(id)),
  seriesCommand: (
    id: string,
    command: MpSeriesCommand,
    expectedVersion: number,
    idempotencyKey: string,
  ) =>
    api<MpRecurringTemplate>(
      "POST",
      seriesPath(id) + "/" + command,
      { expectedVersion },
      { idempotencyKey },
    ),
  skipOccurrence: (id: string, localDate: string, idempotencyKey: string) =>
    api<MpScheduledRequest>(
      "POST",
      seriesPath(id) +
        "/occurrences/" +
        encodeURIComponent(localDate) +
        "/skip",
      undefined,
      { idempotencyKey },
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
