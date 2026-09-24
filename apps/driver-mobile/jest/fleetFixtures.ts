// Contract-true builders for the A05 fleet driver screen tests. Every builder runs its
// result through the @ubi/contracts schema (DriverScheduleSchema, DriverOfferListSchema,
// DriverConflictViewSchema, AvailabilityPreviewViewSchema, AvailabilitySavedViewSchema,
// DriverArrangementListSchema, SignOfferViewSchema, MpAdvanceBookingSchema), so a
// fixture that drifts from the server contract fails the test instead of quietly
// passing against a wrong shape. All data is invented.
import {
  AvailabilityPreviewViewSchema,
  AvailabilitySavedViewSchema,
  DriverArrangementListSchema,
  DriverConflictViewSchema,
  DriverOfferListSchema,
  DriverOfferViewSchema,
  DriverScheduleSchema,
  MpAdvanceBookingSchema,
  SignOfferViewSchema,
  type MpAdvanceBooking,
} from "@ubi/contracts";
import type { z } from "zod";
import type { VehicleIssueView } from "../src/api/fleet";
import { NGN } from "./wire";

type Schedule = z.infer<typeof DriverScheduleSchema>;
type Offer = z.infer<typeof DriverOfferViewSchema>;
type Conflict = z.infer<typeof DriverConflictViewSchema>;
type Preview = z.infer<typeof AvailabilityPreviewViewSchema>;
type Saved = z.infer<typeof AvailabilitySavedViewSchema>;
type Arrangements = z.infer<typeof DriverArrangementListSchema>;

export const ZONE = "Africa/Lagos";

/** Wed 30 Sep 2026 in Lagos (UTC+1): 06:00 local = 05:00Z. */
export const schedule = (over: Partial<Schedule> = {}): Schedule =>
  DriverScheduleSchema.parse({
    zone: ZONE,
    asOf: "2026-09-30T07:12:00.000Z",
    from: "2026-09-30T00:00:00.000Z",
    to: "2026-10-07T00:00:00.000Z",
    items: [
      {
        itemId: "dav_1@1759208400000",
        kind: "availability",
        startsAt: "2026-09-30T05:00:00.000Z",
        endsAt: "2026-09-30T17:00:00.000Z",
        label: "Available · set by you",
        vehicleId: null,
        bookingId: null,
        risk: null,
        decisionDeadline: null,
        conflictId: null,
      },
      {
        itemId: "asg_1@1759208400000",
        kind: "shift",
        startsAt: "2026-09-30T05:00:00.000Z",
        endsAt: "2026-09-30T17:00:00.000Z",
        label: "Example Fleet · LAG-118-AB · Day",
        vehicleId: "11111111-1111-4111-8111-111111111111",
        bookingId: null,
        risk: null,
        decisionDeadline: null,
        conflictId: null,
      },
      {
        itemId: "mnt_1",
        kind: "maintenance",
        startsAt: "2026-09-30T09:00:00.000Z",
        endsAt: "2026-09-30T14:00:00.000Z",
        label: "Vehicle LAG-118-AB in service",
        vehicleId: "11111111-1111-4111-8111-111111111111",
        bookingId: null,
        risk: null,
        decisionDeadline: null,
        conflictId: null,
      },
      {
        itemId: "bkg_1",
        kind: "booking",
        startsAt: "2026-09-30T10:20:00.000Z",
        endsAt: "2026-09-30T12:00:00.000Z",
        label: "Wed 30 Sep · 11:20–11:35 · Confirmed",
        vehicleId: null,
        bookingId: "bkg_1",
        risk: "at_risk",
        decisionDeadline: "2026-09-30T08:20:00.000Z",
        conflictId: "fcf_1",
      },
    ],
    alerts: [
      {
        conflictId: "fcf_1",
        type: "maintenance_overlaps_booking",
        deadlineAt: "2026-09-30T08:20:00.000Z",
      },
    ],
    ...over,
  });

export const emptySchedule = () => schedule({ items: [], alerts: [] });

export const offer = (over: Partial<Offer> = {}): Offer =>
  DriverOfferViewSchema.parse({
    offerId: "fpr_1",
    fleet: { fleetId: "flt_1", name: "Example Fleet" },
    vehicle: {
      vehicleId: "22222222-2222-4222-8222-222222222222",
      plate: "LAG-744-MM",
      make: "Toyota",
      model: "Corolla",
      classes: ["comfort"],
      capacity: 4,
    },
    shift: { kind: "night", start: "18:00", end: "06:00" },
    validFrom: "2026-10-01",
    validTo: null,
    termsVersion: 2,
    terms: {
      type: "weekly_fixed",
      amountMinor: 4_000_000,
      currency: "NGN",
      percent: null,
      shortfall: { policy: "carry_forward", maxWeeks: 4 },
      fuelBy: "driver",
      servicingBy: "fleet",
    },
    current: {
      assignmentId: "asg_1",
      vehicleId: "11111111-1111-4111-8111-111111111111",
      shift: { kind: "day", start: "06:00", end: "18:00" },
      termsVersion: 1,
      terms: {
        type: "weekly_fixed",
        amountMinor: 3_500_000,
        currency: "NGN",
        percent: null,
        shortfall: { policy: "carry_forward", maxWeeks: 4 },
        fuelBy: "driver",
        servicingBy: "fleet",
      },
    },
    diff: [
      { field: "vehicle", material: true },
      { field: "shift", material: true },
      { field: "remittance", material: true },
    ],
    check: { clashesWithBookings: false, clashesWithTimeOff: false },
    status: "pending_signature",
    expiresAt: "2026-10-01T09:02:00.000Z",
    historicEarnings: null,
    historicEarningsReason:
      "UBI has no per-vehicle earnings history for this vehicle yet.",
    ...over,
  });

export const offers = (list: Offer[] = [offer()]) =>
  DriverOfferListSchema.parse({ offers: list });

export const signed = () =>
  SignOfferViewSchema.parse({
    offerId: "fpr_1",
    status: "signed",
    arrangement: {
      assignmentId: "asg_2",
      fleetId: "flt_1",
      vehicleId: "22222222-2222-4222-8222-222222222222",
      driverId: "drv_1",
      driverDisplayName: "Kemi B.",
      shift: { kind: "night", start: "18:00", end: "06:00" },
      validFrom: "2026-10-01",
      validTo: null,
      termsVersion: 2,
      terms: offer().terms,
      signedAt: "2026-09-30T07:30:00.000Z",
      status: "active",
    },
    signature: {
      signedAt: "2026-09-30T07:30:00.000Z",
      termsVersion: 2,
      termsHash: "a".repeat(64),
      verification: {
        method: "wallet_pin",
        verifiedBy: "user-service",
        reference: "user-service:/auth/pin/verify:req_1",
      },
    },
  });

export const conflict = (over: Partial<Conflict> = {}): Conflict =>
  DriverConflictViewSchema.parse({
    conflictId: "fcf_1",
    type: "maintenance_overlaps_booking",
    severity: "critical",
    status: "open",
    deadlineAt: "2026-09-30T08:20:00.000Z",
    bookingId: "bkg_1",
    vehicleId: "11111111-1111-4111-8111-111111111111",
    options: [
      {
        id: "keep_on_swapped_vehicle",
        enabled: false,
        reason:
          "No eligible vehicle: none with the same class and capacity and valid documents.",
        outcome: null,
        next: null,
      },
      {
        id: "ask_fleet_to_move",
        enabled: true,
        reason: null,
        outcome: null,
        next: null,
      },
      {
        id: "withdraw",
        enabled: true,
        reason: null,
        outcome: {
          commissionReturned: NGN(560_00),
          fundingReleased: true,
          rematch: "decided_by_marketplace",
          penalty: "none",
        },
        next: {
          method: "POST",
          path: "/v1/mp/advance-bookings/bkg_1/withdraw",
        },
      },
    ],
    ...over,
  });

/** The driver's own marketplace booking behind the conflict (driver view). */
export const booking = (
  over: Partial<MpAdvanceBooking> = {},
): MpAdvanceBooking =>
  MpAdvanceBookingSchema.parse({
    bookingId: "bkg_1",
    requestId: "req_1",
    awardId: "awd_1",
    state: "confirmed",
    version: 3,
    viewer: "driver",
    driverReserved: true,
    fullySecured: true,
    statusLabel: "Confirmed",
    notices: ["No pickup is guaranteed until the trip starts."],
    schedule: {
      localDate: "2026-09-30",
      localTime: "11:20",
      timeZone: "Africa/Lagos",
      utcOffset: "+01:00",
      dstResolution: "exact",
      pickupAt: "2026-09-30T10:20:00.000Z",
      windowStart: "2026-09-30T10:20:00.000Z",
      windowEnd: "2026-09-30T10:35:00.000Z",
      windowMinutes: 15,
      label: "11:20–11:35",
    },
    pickup: { label: "Lekki Phase 1", lat: 6.44, lng: 3.47 },
    dropoff: { label: "Victoria Island", lat: 6.43, lng: 3.42 },
    fareMinor: NGN(5600_00),
    commissionMinor: NGN(560_00),
    netMinor: NGN(5040_00),
    funding: {
      state: "secured",
      label: "Secured",
      dueAt: null,
      deadline: null,
    },
    reconfirmation: {
      opensAt: "2026-09-30T08:20:00.000Z",
      deadline: "2026-09-30T09:20:00.000Z",
      reconfirmedAt: null,
    },
    activationAt: "2026-09-30T10:05:00.000Z",
    activatedSlot: null,
    failure: null,
    rematchRequestId: null,
    risk: {
      state: "at_risk",
      decisionDeadline: "2026-09-30T08:20:00.000Z",
      reasons: ["vehicle_conflict"],
      message: "LAG-118-AB is in service 10:00–15:00.",
    },
    vehicleSwap: null,
    reminderOffsetsSec: [],
    freeCancellationDeadline: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...over,
  });

export const withdrawn = (rematchAvailable: boolean) =>
  booking({
    state: "failed",
    version: 4,
    statusLabel: "Withdrawn",
    risk: null,
    failure: {
      reason: "driver_withdrew",
      message: "You withdrew from this booking.",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
      rematchAvailable,
    },
  });

export const preview = (over: Partial<Preview> = {}): Preview =>
  AvailabilityPreviewViewSchema.parse({
    previewToken: "apv_1",
    zone: ZONE,
    checkedAt: "2026-09-30T07:12:00.000Z",
    horizonEndsAt: "2026-11-29T07:12:00.000Z",
    affects: [
      {
        kind: "shift",
        assignmentId: "asg_1",
        effect: "hours_reduced",
        lostHours: 11,
      },
      {
        kind: "booking",
        bookingId: "bkg_2",
        effect: "conflicts",
        startsAt: "2026-10-01T07:00:00.000Z",
        endsAt: "2026-10-01T08:30:00.000Z",
        outcome: {
          commissionReturned: NGN(520_00),
          fundingReleased: true,
          rematch: "decided_by_marketplace",
          penalty: "none",
        },
        options: ["trim_time_off", "withdraw_booking"],
      },
    ],
    ...over,
  });

export const saved = (over: Partial<Saved> = {}): Saved =>
  AvailabilitySavedViewSchema.parse({
    status: "saved_with_withdrawals",
    setVersion: 1,
    windows: [
      {
        windowId: "dav_9",
        kind: "time_off",
        startsAt: "2026-10-01T06:00:00.000Z",
        endsAt: "2026-10-01T22:00:00.000Z",
        rrule: null,
      },
    ],
    withdrawals: [
      {
        bookingId: "bkg_2",
        conflictId: "fcf_9",
        outcome: {
          commissionReturned: NGN(520_00),
          fundingReleased: true,
          rematch: "decided_by_marketplace",
          penalty: "none",
        },
        next: {
          method: "POST",
          path: "/v1/mp/advance-bookings/bkg_2/withdraw",
        },
      },
    ],
    ...over,
  });

export const arrangements = (
  list: Partial<Arrangements["arrangements"][number]>[] = [{}],
): Arrangements =>
  DriverArrangementListSchema.parse({
    arrangements: list.map((over, i) => ({
      assignmentId: "asg_" + (i + 1),
      fleetId: "flt_1",
      vehicleId: "11111111-1111-4111-8111-11111111111" + (i + 1),
      driverId: "drv_1",
      driverDisplayName: "Kemi B.",
      shift: { kind: "day", start: "06:00", end: "18:00" },
      validFrom: "2026-09-28",
      validTo: null,
      termsVersion: 1,
      terms: offer().current?.terms,
      signedAt: "2026-09-27T10:00:00.000Z",
      status: "active",
      fleetName: "Example Fleet",
      noticeEndsOn: null,
      ...over,
    })),
    weekSplit: {
      available: false,
      reason: "This week's split is settled by payment-service.",
      source: "payment-service",
    },
  });

export const issue = (
  over: Partial<VehicleIssueView> = {},
): VehicleIssueView => ({
  issueId: "vis_1",
  severity: "cannot_drive",
  vehicleId: "11111111-1111-4111-8111-111111111111",
  reportedAt: "2026-09-30T07:40:00.000Z",
  fleetAlerted: true,
  block: {
    blockId: "mnt_9",
    kind: "unplanned_off_road",
    status: "active",
    startsAt: "2026-09-30T07:40:00.000Z",
    endsAt: null,
  },
  decisions: [{ conflictId: "fcf_7", deadlineAt: "2026-09-30T08:20:00.000Z" }],
  remittanceEffect: "signed_terms_shortfall_rule",
  ...over,
});

export const PARKED_ACK = {
  state: "parked_confirmed",
  availabilityEpoch: 9,
  confirmedAt: "2026-09-30T07:10:00.000Z",
  expiresAt: "2026-09-30T07:20:00.000Z",
  ttlSeconds: 600,
};
