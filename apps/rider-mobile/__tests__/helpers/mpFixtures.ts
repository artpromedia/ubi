// Contract-true builders for the rider's A02/A03 screen tests. Every builder runs its
// result through the @ubi/contracts schema (MpQuoteEnvelopeSchema, MpRequestSchema,
// MpTripSchema, MpAmendmentSchema, MpScheduledRequestSchema, MpAdvanceBookingSchema,
// MpRecurringTemplateSchema, …), so a fixture that drifts from the server contract fails
// the test instead of quietly passing against a wrong shape. These are test inputs to
// the screens under test — the acceptance evidence is what the screens send and render.
import {
  MpAdvanceBookingSchema,
  MpAdvanceOfferSchema,
  MpAmendmentListSchema,
  MpAmendmentSchema,
  MpQuoteEnvelopeSchema,
  MpRecurringTemplateSchema,
  MpRequestSchema,
  MpScheduledRequestSchema,
  MpTripSchema,
  type MpAdvanceBooking,
  type MpAdvanceOffer,
  type MpAmendment,
  type MpAmendmentList,
  type MpQuoteEnvelope,
  type MpRecurringTemplate,
  type MpRequest,
  type MpScheduledRequest,
  type MpTrip,
} from "@ubi/contracts";
import { NGN, isoIn } from "./wire";

export const PICKUP = { label: "Lekki Phase 1", lat: 6.4478, lng: 3.4723 };
export const DROPOFF = { label: "Victoria Island", lat: 6.4281, lng: 3.4216 };

const driver = (name: string) => ({
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  rating: "4.9",
  completedTrips: 1204,
  vehicle: "Toyota Corolla · grey",
  plateMasked: "LAG · 42· ··",
  profileStatus: "verified" as const,
});

export const schedule = (over: Record<string, unknown> = {}) => {
  const start = (over.windowStart as string) ?? isoIn(26 * 3_600_000);
  return {
    localDate: "2026-09-25",
    localTime: "07:30",
    timeZone: "Africa/Lagos",
    utcOffset: "+01:00",
    dstResolution: "exact",
    pickupAt: start,
    windowStart: start,
    windowEnd: new Date(Date.parse(start) + 20 * 60_000).toISOString(),
    windowMinutes: 20,
    label: "Thu 25 Sep 2026, 07:30 (UTC+01:00)",
    ...over,
  };
};

export const quote = (over: Partial<MpQuoteEnvelope> = {}): MpQuoteEnvelope =>
  MpQuoteEnvelopeSchema.parse({
    quoteId: "q_route_1",
    service: "ride",
    vehicleClass: "standard",
    cityId: "LOS",
    currency: "NGN",
    suggestedFareMinor: NGN(6_000_00),
    minimumFareMinor: NGN(5_200_00),
    maximumFareMinor: NGN(9_000_00),
    expiresAt: isoIn(5 * 60_000),
    pricingVersion: "px_2026_09_1",
    policyVersion: 3,
    breakdown: [
      { label: "Base", amountMinor: NGN(700_00) },
      { label: "Distance", amountMinor: NGN(4_100_00) },
      { label: "Stop waiting", amountMinor: NGN(1_200_00) },
    ],
    routedDistanceMeters: 18_400,
    routedDurationSec: 3_120,
    stops: [
      {
        stopId: "stp_a",
        order: 1,
        label: "Ikoyi pharmacy",
        lat: 6.452,
        lng: 3.435,
        purpose: "errand",
        dwellSec: 300,
      },
    ],
    stopsDwellSec: 300,
    routeFingerprint: "rf_1",
    ...over,
  });

export const request = (over: Partial<MpRequest> = {}): MpRequest =>
  MpRequestSchema.parse({
    requestId: "req_1",
    state: "open",
    revision: 2,
    version: 4,
    service: "ride",
    vehicleClass: "standard",
    cityId: "LOS",
    currency: "NGN",
    requesterId: "u_rider_1",
    quoteId: "q_old",
    requestedFareMinor: NGN(6_500_00),
    suggestedFareMinor: NGN(6_000_00),
    minimumFareMinor: NGN(5_200_00),
    maximumFareMinor: NGN(9_000_00),
    pickup: PICKUP,
    dropoff: DROPOFF,
    delivery: null,
    searchEnvelope: { step: 0, radiusMeters: 3000, pickupEtaSec: 600 },
    policyVersion: 3,
    pricingVersion: "px_2026_09_1",
    expiresAt: isoIn(150_000),
    createdAt: isoIn(-60_000),
    closeReason: null,
    stops: [
      {
        stopId: "stp_a",
        order: 1,
        label: "Ikoyi pharmacy",
        lat: 6.452,
        lng: 3.435,
        purpose: "errand",
        dwellSec: 300,
      },
    ],
    routeRevision: 1,
    routeFingerprint: "rf_1",
    ...over,
  });

export const liveOffer = (bidId: string, withdrawn = false) => ({
  bidId,
  bidVersion: 1,
  requestRevision: 2,
  amountMinor: NGN(6_500_00),
  kind: "immediate",
  driver: driver("Emeka Okafor"),
  pickupLabel: "Pickup in 4 min",
  pickupWindow: null,
  expiresAt: isoIn(90_000),
  withdrawn,
  whyRecommended: null,
});

export type TripStop = MpTrip["stops"][number];
export const tripStop = (
  over: Partial<TripStop> & { stopId: string; order: number },
): TripStop =>
  ({
    state: "pending",
    label: "Stop " + over.order,
    purpose: "errand",
    lat: 6.45 + over.order / 100,
    lng: 3.43,
    dwellSec: 120,
    arrivalDisputed: false,
    ...over,
  }) as TripStop;

/** The RIDER's trip view: no capturedCommissionMinor. */
export const trip = (over: Partial<MpTrip> = {}): MpTrip =>
  MpTripSchema.parse({
    requestId: "req_1",
    awardId: "awd_1",
    executionId: "ride_1",
    routeRevision: 1,
    fareRevision: 1,
    originalFareMinor: NGN(6_000_00),
    agreedFareMinor: NGN(6_000_00),
    committedAdjustments: [],
    pickup: PICKUP,
    dropoff: DROPOFF,
    stops: [
      tripStop({ stopId: "stp_1", order: 1, label: "Ikoyi pharmacy" }),
      tripStop({
        stopId: "stp_2",
        order: 2,
        label: "Obalende",
        purpose: "drop_passenger",
      }),
    ],
    waitingTerms: {
      includedBasis: "stop_dwell",
      perMinMinor: NGN(50_00),
      maxAuthorizedMinor: NGN(1_500_00),
      authorizedCapMinor: NGN(1_500_00),
      capRevision: 1,
      committedMinor: NGN(0),
      excessiveAfterSec: 1200,
      geofenceMeters: 150,
    },
    version: 3,
    ...over,
  });

/** A DRIVER-proposed route change adding one stop (+₦750, reserved), rider's view. */
export const amendment = (over: Partial<MpAmendment> = {}): MpAmendment =>
  MpAmendmentSchema.parse({
    amendmentId: "amd_1",
    requestId: "req_1",
    awardId: "awd_1",
    kind: "route",
    state: "awaiting_approvals_and_funding",
    proposedByRole: "driver",
    baseRouteRevision: 1,
    baseFareRevision: 1,
    routeRevision: 2,
    fareRevision: 2,
    stops: [
      {
        stopId: "stp_1",
        order: 1,
        label: "Ikoyi pharmacy",
        lat: 6.46,
        lng: 3.43,
        purpose: "errand",
        dwellSec: 120,
      },
      {
        stopId: "stp_new",
        order: 2,
        label: "Falomo mall",
        lat: 6.44,
        lng: 3.43,
        purpose: "errand",
        dwellSec: 300,
      },
      {
        stopId: "stp_2",
        order: 3,
        label: "Obalende",
        lat: 6.47,
        lng: 3.43,
        purpose: "drop_passenger",
        dwellSec: 120,
      },
    ],
    dropoff: DROPOFF,
    priorFareMinor: NGN(6_000_00),
    revisedFareMinor: NGN(6_750_00),
    fareDeltaMinor: NGN(750_00),
    riderFundingDeltaMinor: NGN(750_00),
    riderFunding: "reserved",
    addedDistanceMeters: 3100,
    addedDurationSec: 360,
    approvals: {
      rider: { approved: false },
      driver: { approved: true, approvedAt: isoIn(-20_000) },
    },
    expiresAt: isoIn(90_000),
    createdAt: isoIn(-30_000),
    ...over,
  });

export const amendmentList = (
  amendments: MpAmendment[],
  over: Partial<MpAmendmentList> = {},
): MpAmendmentList =>
  MpAmendmentListSchema.parse({
    requestId: "req_1",
    routeRevision: 1,
    fareRevision: 1,
    agreedFareMinor: NGN(6_000_00),
    amendments,
    ...over,
  });

export const scheduled = (
  over: Partial<MpScheduledRequest> = {},
): MpScheduledRequest =>
  MpScheduledRequestSchema.parse({
    scheduledRequestId: "sr_1",
    product: "scheduled_request",
    state: "scheduled_unassigned",
    version: 3,
    driverSecured: false,
    statusLabel: "Scheduled — no driver secured yet",
    notice:
      "We will send your request to drivers at Thu 25 Sep, 06:50. No driver is secured until you choose an offer.",
    service: "ride",
    vehicleClass: "standard",
    cityId: "LOS",
    currency: "NGN",
    pickup: PICKUP,
    dropoff: DROPOFF,
    schedule: schedule(),
    publishAt: isoIn(25 * 3_600_000),
    requestedFareMinor: NGN(6_000_00),
    maxFareMinor: NGN(9_000_00),
    paymentMethodId: "pm_wallet",
    requestId: null,
    requestState: null,
    templateId: null,
    occurrenceDate: null,
    approval: null,
    closeReason: null,
    createdAt: isoIn(-60_000),
    updatedAt: isoIn(-60_000),
    ...over,
  });

export const advanceOffer = (
  bidId: string,
  name: string,
  over: Partial<MpAdvanceOffer> = {},
): MpAdvanceOffer =>
  MpAdvanceOfferSchema.parse({
    bidId,
    bidVersion: 2,
    requestRevision: 1,
    amountMinor: NGN(5_600_00),
    kind: "advance_booking",
    driver: driver(name),
    pickupLabel: "Booked window Thu 25 Sep, 07:30–07:50",
    pickupWindow: null,
    expiresAt: isoIn(30 * 60_000),
    withdrawn: false,
    whyRecommended: null,
    totalMinor: NGN(5_600_00),
    totalLabel: "You pay ₦5,600",
    ...over,
  });

/** An advance booking as the RIDER sees it (driver card, no commission/net). */
export const booking = (
  over: Partial<MpAdvanceBooking> = {},
): MpAdvanceBooking =>
  MpAdvanceBookingSchema.parse({
    bookingId: "bkg_1",
    requestId: "req_adv_1",
    awardId: "awd_adv_1",
    state: "confirmed",
    version: 2,
    viewer: "rider",
    driverReserved: true,
    fullySecured: true,
    statusLabel:
      "Driver reserved — awaiting the driver's reconfirmation before pickup",
    notices: [
      "UBI does not guarantee pickup: if your driver cannot attend we tell you and you choose what happens next.",
    ],
    schedule: schedule(),
    pickup: PICKUP,
    dropoff: { label: "Yaba", lat: 6.51, lng: 3.37 },
    fareMinor: NGN(5_600_00),
    driver: driver("Chidi Obi"),
    funding: {
      state: "secured",
      label: "Payment secured",
      dueAt: null,
      deadline: null,
    },
    reconfirmation: {
      opensAt: isoIn(20 * 3_600_000),
      deadline: isoIn(24 * 3_600_000),
      reconfirmedAt: null,
    },
    activationAt: isoIn(25 * 3_600_000),
    activatedSlot: null,
    failure: null,
    rematchRequestId: null,
    createdAt: isoIn(-86_400_000),
    updatedAt: isoIn(-3_600_000),
    ...over,
  });

export const series = (
  over: Partial<MpRecurringTemplate> = {},
): MpRecurringTemplate =>
  MpRecurringTemplateSchema.parse({
    templateId: "tpl_1",
    state: "active",
    version: 5,
    product: "scheduled_request",
    daysOfWeek: ["mon", "wed", "fri"],
    localTime: "07:30",
    timeZone: "Africa/Lagos",
    startsOn: "2026-09-28",
    endsOn: null,
    windowMinutes: 20,
    requestedFareMinor: NGN(6_000_00),
    maxFareMinor: NGN(9_000_00),
    paymentMethodId: "pm_wallet",
    service: "ride",
    vehicleClass: "standard",
    pickup: PICKUP,
    dropoff: DROPOFF,
    generatedThrough: "2026-10-02",
    seriesNote:
      "Each trip in this series is booked and secured separately — one trip having a driver never confirms the others.",
    occurrences: [
      scheduled({
        scheduledRequestId: "sr_mon",
        templateId: "tpl_1",
        occurrenceDate: "2026-09-28",
        state: "published",
        requestId: "req_mon",
        requestState: "awarded",
        driverSecured: true,
        statusLabel: "Driver secured",
        schedule: schedule({
          localDate: "2026-09-28",
          label: "Mon 28 Sep, 07:30",
        }),
      }),
      scheduled({
        scheduledRequestId: "sr_wed",
        templateId: "tpl_1",
        occurrenceDate: "2026-09-30",
        schedule: schedule({
          localDate: "2026-09-30",
          label: "Wed 30 Sep, 07:30",
        }),
      }),
      scheduled({
        scheduledRequestId: "sr_fri",
        templateId: "tpl_1",
        occurrenceDate: "2026-10-02",
        state: "skipped",
        statusLabel: "Skipped",
        schedule: schedule({
          localDate: "2026-10-02",
          label: "Fri 2 Oct, 07:30",
        }),
      }),
    ],
    createdAt: isoIn(-86_400_000),
    updatedAt: isoIn(-3_600_000),
    ...over,
  });
