// Contract-true builders for the A02/A03 driver screen tests. Every builder runs its
// result through the @ubi/contracts schema (MpTripSchema, MpAmendmentSchema,
// MpAmendmentListSchema, MpAdvanceBookingSchema), so a fixture that drifts from the
// server contract fails the test instead of quietly passing against a wrong shape.
import {
  MpAdvanceBookingSchema,
  MpAmendmentListSchema,
  MpAmendmentSchema,
  MpTripSchema,
  type MpAdvanceBooking,
  type MpAmendment,
  type MpAmendmentList,
  type MpTrip,
} from "@ubi/contracts";
import { NGN, isoIn } from "./wire";

export type TripStop = MpTrip["stops"][number];
export type StopWaiting = NonNullable<TripStop["waiting"]>;

export const stop = (
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

export const trip = (over: Partial<MpTrip> = {}): MpTrip =>
  MpTripSchema.parse({
    requestId: "req_1",
    awardId: "awd_1",
    executionId: "ride_1",
    routeRevision: 1,
    fareRevision: 1,
    originalFareMinor: NGN(6000_00),
    agreedFareMinor: NGN(6000_00),
    committedAdjustments: [],
    capturedCommissionMinor: NGN(600_00),
    pickup: { label: "Lekki Phase 1", lat: 6.44, lng: 3.47 },
    dropoff: { label: "Victoria Island", lat: 6.43, lng: 3.42 },
    stops: [
      stop({ stopId: "stp_1", order: 1, label: "Ikoyi pharmacy" }),
      stop({
        stopId: "stp_2",
        order: 2,
        label: "Obalende",
        purpose: "drop_passenger",
      }),
    ],
    waitingTerms: {
      includedBasis: "stop_dwell",
      perMinMinor: NGN(50_00),
      maxAuthorizedMinor: NGN(1500_00),
      authorizedCapMinor: NGN(1500_00),
      capRevision: 1,
      committedMinor: NGN(0),
      excessiveAfterSec: 1200,
      geofenceMeters: 150,
    },
    version: 3,
    ...over,
  });

export const waitingAt = (over: Partial<StopWaiting> = {}): StopWaiting => ({
  waitedSec: 372,
  includedSec: 120,
  allowanceRemainingSec: 0,
  paidSec: 252,
  feeMinor: NGN(250_00),
  accruing: true,
  approvalRequired: false,
  excessive: false,
  settlement: "pending",
  ...over,
});

/** A rider-proposed route change adding one stop (+₦750, reserved), per the contract. */
export const amendment = (over: Partial<MpAmendment> = {}): MpAmendment =>
  MpAmendmentSchema.parse({
    amendmentId: "amd_1",
    requestId: "req_1",
    awardId: "awd_1",
    kind: "route",
    state: "awaiting_approvals_and_funding",
    proposedByRole: "rider",
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
    dropoff: { label: "Victoria Island", lat: 6.43, lng: 3.42 },
    priorFareMinor: NGN(6000_00),
    revisedFareMinor: NGN(6750_00),
    fareDeltaMinor: NGN(750_00),
    riderFundingDeltaMinor: NGN(750_00),
    riderFunding: "reserved",
    commissionDeltaMinor: NGN(75_00),
    driverNetDeltaMinor: NGN(675_00),
    addedDistanceMeters: 3100,
    addedDurationSec: 360,
    approvals: {
      rider: { approved: true, approvedAt: isoIn(-20_000) },
      driver: { approved: false },
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
    agreedFareMinor: NGN(6000_00),
    amendments,
    ...over,
  });

/** A confirmed advance booking as the DRIVER sees it (coarse areas, own money). */
export const booking = (
  over: Partial<MpAdvanceBooking> = {},
): MpAdvanceBooking => {
  const start = over.schedule?.windowStart ?? isoIn(26 * 3_600_000);
  const end =
    over.schedule?.windowEnd ??
    new Date(Date.parse(start) + 20 * 60_000).toISOString();
  return MpAdvanceBookingSchema.parse({
    bookingId: "bkg_1",
    requestId: "req_adv_1",
    awardId: "awd_adv_1",
    state: "confirmed",
    version: 2,
    viewer: "driver",
    driverReserved: true,
    fullySecured: true,
    statusLabel:
      "Driver reserved — awaiting the driver's reconfirmation before pickup",
    notices: [
      "Your 10% commission was captured once when you were selected. Starting this trip will not charge it again.",
    ],
    pickup: { label: "Lekki Phase 1", lat: 6.44, lng: 3.47 },
    dropoff: { label: "Yaba", lat: 6.51, lng: 3.37 },
    fareMinor: NGN(5600_00),
    commissionMinor: NGN(560_00),
    netMinor: NGN(5040_00),
    funding: {
      state: "secured",
      label: "Payment secured",
      dueAt: null,
      deadline: null,
    },
    reconfirmation: {
      opensAt: isoIn(-3_600_000),
      deadline: isoIn(12 * 3_600_000),
      reconfirmedAt: null,
    },
    activationAt: isoIn(25 * 3_600_000),
    activatedSlot: null,
    failure: null,
    rematchRequestId: null,
    // The market's reminder offsets (12 h and 1 h before the window opens).
    reminderOffsetsSec: [43_200, 3_600],
    // Always null on the driver view (a rider-only free-cancel deadline).
    freeCancellationDeadline: null,
    createdAt: isoIn(-86_400_000),
    updatedAt: isoIn(-3_600_000),
    ...over,
    schedule: {
      localDate: "2026-09-24",
      localTime: "07:30",
      timeZone: "Africa/Lagos",
      utcOffset: "+01:00",
      dstResolution: "exact",
      pickupAt: start,
      windowStart: start,
      windowEnd: end,
      windowMinutes: 20,
      label: "Thu 24 Sep 2026, 07:30 (UTC+01:00)",
      ...over.schedule,
    },
  });
};
