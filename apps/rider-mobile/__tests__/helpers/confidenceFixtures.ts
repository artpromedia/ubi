// Contract-true builders for the rider-confidence screens (A06 A–D, A04.3, receipts) and the
// airport transfer. Every builder parses its result through the @ubi/contracts schema, so a
// fixture that drifts from the server contract fails the test instead of passing on a wrong
// shape. These are INPUTS to the screens under test; the acceptance evidence is what the
// screens send on the wire and render.
import {
  MpFavouriteDriverSchema,
  MpOfferSchema,
  MpReceiptSchema,
  MpRequestPassengerSchema,
  MpServiceNeedsCatalogSchema,
  OrgCostCentreViewSchema,
  OrganizationViewSchema,
  type MpFavouriteDriver,
  type MpOffer,
  type MpReceipt,
  type MpRequestPassenger,
  type MpServiceNeedsCatalog,
  type OrgCostCentreView,
  type OrganizationView,
} from "@ubi/contracts";
import type { AirportTransfer } from "../../src/api/travel";
import { NGN, isoIn } from "./wire";

export const DRIVER_ID = "3f1c9a52-8d4e-4b7a-9c21-5e6f7a8b9c0d";
export const DRIVER_ID_2 = "7a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d";

const legacyDriver = (name: string, verified: boolean) => ({
  displayName: verified ? name : "Driver 4F2A",
  initials: verified ? name.slice(0, 2).toUpperCase() : "D",
  rating: verified ? "4.80" : "–",
  completedTrips: verified ? 212 : 0,
  vehicle: "standard",
  plateMasked: verified ? "LAG ·· 42A" : "—",
  profileStatus: verified ? ("verified" as const) : ("unavailable" as const),
});

const reliabilityAvailable = {
  status: "available" as const,
  definition:
    "Of the marketplace rides this driver was awarded in the last 90 days that ended, the share they completed and the share they cancelled themselves.",
  windowDays: 90,
  minimumSample: 10,
  sampleSize: 40,
  completedJobs: 39,
  driverCancellations: 1,
  completionRateBps: 9750,
  driverCancellationRateBps: 250,
  label:
    "Completed 39 of 40 marketplace rides in 90 days · 2.5% cancelled by the driver",
  computedAt: isoIn(-60_000),
};

const reliabilityThin = {
  ...reliabilityAvailable,
  status: "insufficient_history" as const,
  sampleSize: 3,
  completedJobs: 3,
  driverCancellations: 0,
  completionRateBps: null,
  driverCancellationRateBps: null,
  label: "Not enough history yet",
};

/** A live offer carrying the full A06 comparison, from a VERIFIED driver card. */
export const verifiedOffer = (
  bidId: string,
  name: string,
  over: Partial<MpOffer> = {},
): MpOffer =>
  MpOfferSchema.parse({
    bidId,
    bidVersion: 1,
    requestRevision: 2,
    amountMinor: NGN(6_500_00),
    kind: "immediate",
    driver: legacyDriver(name, true),
    pickupLabel: "Pickup in 4 min",
    pickupWindow: null,
    expiresAt: isoIn(90_000),
    withdrawn: false,
    whyRecommended: null,
    bookingFeeMinor: NGN(0),
    totalMinor: NGN(6_500_00),
    deltaLabel: null,
    totalLabel: "You pay ₦6,500",
    totalNote:
      "This is the total you pay for this offer. No booking or service fee is added on top.",
    pickupEstimate: {
      seconds: 240,
      basis: "routed_leg",
      label: "Estimated pickup in ~4 min",
      estimatedAt: isoIn(-30_000),
      estimate: true,
    },
    vehicle: {
      class: "standard",
      capacitySeats: null,
      capacityNote: "Seat capacity is not published for this vehicle class.",
      bodyType: "sedan",
      make: "Toyota",
      model: "Corolla",
      colour: "Grey",
      plateMasked: "LAG ·· 42A",
      verified: true,
    },
    driverProfile: {
      status: "verified",
      label: "Verified by UBI",
      displayName: name,
      initials: name.slice(0, 2).toUpperCase(),
      photoRef: null,
      photoVerified: null,
      verifiedAt: "2026-03-01",
      rating: { average: 4.8, count: 212 },
      ratingLabel: "4.80 from 212 ratings",
      completedTrips: 212,
      memberSince: "2024-05",
      accessibility: "unavailable",
    },
    reliability: reliabilityAvailable,
    serviceFit: {
      score: 1,
      maxScore: 2,
      matched: [
        { code: "verified_details", label: "Driver details verified by UBI" },
      ],
      unmet: [{ code: "saved_driver", label: "Not a driver you saved" }],
      definition:
        "One point per criterion: driver details verified by UBI, a driver you saved, and each preference you stated that the driver's verified vehicle meets.",
    },
    badges: [],
    ...over,
  });

/** An offer whose driver card could NOT be resolved: every card field null, no rating. */
export const unverifiedOffer = (
  bidId: string,
  over: Partial<MpOffer> = {},
): MpOffer =>
  MpOfferSchema.parse({
    ...verifiedOffer(bidId, "unused"),
    driver: legacyDriver("unused", false),
    amountMinor: NGN(6_200_00),
    totalMinor: NGN(6_200_00),
    totalLabel: "You pay ₦6,200",
    vehicle: {
      class: "standard",
      capacitySeats: null,
      capacityNote: "Seat capacity is not published for this vehicle class.",
      bodyType: null,
      make: null,
      model: null,
      colour: null,
      plateMasked: null,
      verified: false,
    },
    driverProfile: {
      status: "unavailable",
      label: "Driver details unavailable",
      displayName: null,
      initials: null,
      photoRef: null,
      photoVerified: null,
      verifiedAt: null,
      rating: null,
      ratingLabel: "Rating unavailable",
      completedTrips: null,
      memberSince: null,
      accessibility: "unavailable",
    },
    reliability: reliabilityThin,
    pickupEstimate: {
      seconds: null,
      basis: "unavailable",
      label: "Pickup estimate unavailable",
      estimatedAt: null,
      estimate: true,
    },
    ...over,
  });

export const offerOrder = (
  sort: "offered" | "price" | "pickup" | "service_fit",
) => {
  const options = [
    {
      key: "offered",
      label: "In the order drivers offered",
      tieBreak: "none — earliest offer first",
    },
    {
      key: "price",
      label: "Lowest total first",
      tieBreak: "then earliest estimated pickup, then earliest offer",
    },
    {
      key: "pickup",
      label: "Earliest estimated pickup first",
      tieBreak:
        "offers without an estimate last; then lowest total, then earliest offer",
    },
    {
      key: "service_fit",
      label: "Best service fit first",
      tieBreak:
        "then lowest total, then earliest estimated pickup, then earliest offer",
    },
  ] as const;
  const chosen = options.find((o) => o.key === sort)!;
  return {
    sort,
    label: chosen.label,
    tieBreak: chosen.tieBreak,
    options: [...options],
    note: "No offer is sponsored and none is chosen for you: you pick the winner.",
  };
};

export const favourite = (
  driverId: string,
  name: string,
  over: Partial<MpFavouriteDriver> = {},
): MpFavouriteDriver =>
  MpFavouriteDriverSchema.parse({
    driverId,
    cityId: "LOS",
    state: "active",
    savedAt: isoIn(-7 * 86_400_000),
    driver: legacyDriver(name, true),
    driverProfile: verifiedOffer("bid_x", name).driverProfile,
    canRequest: true,
    canRequestLabel: "Can be asked first",
    ...over,
  });

export const serviceNeedsCatalog = (
  over: Partial<MpServiceNeedsCatalog> = {},
): MpServiceNeedsCatalog =>
  MpServiceNeedsCatalogSchema.parse({
    cityId: "LOS",
    service: "ride",
    vehicleClass: "standard",
    requirements: [
      {
        code: "extra_luggage_capacity",
        title: "Extra luggage capacity",
        availability: "verified",
        detail: "Drivers with a verified large vehicle can offer.",
      },
      {
        code: "wheelchair_accessible_vehicle",
        title: "Wheelchair-accessible vehicle",
        availability: "unavailable",
        detail: "No verified wheelchair-accessible vehicle in this market yet.",
      },
    ],
    preferences: [
      {
        code: "electric_vehicle",
        title: "Electric vehicle",
        effect: "ranking_only",
        detail: "Offers from a verified electric vehicle rank higher.",
      },
    ],
    fallback:
      "Nothing was published. You can publish without the requirement, add it as a preference where one fits, or contact support to arrange the trip.",
    disclosure:
      "UBI matches requirements only to vehicles it has verified. Preferences never exclude a driver.",
    ...over,
  });

export const requestPassenger = (
  over: Partial<MpRequestPassenger> = {},
): MpRequestPassenger =>
  MpRequestPassengerSchema.parse({
    firstName: "Ngozi",
    lastName: "Eze",
    phone: "+2348030000001",
    payerRole: "requester",
    attestation: "You confirmed Ngozi is an adult who agreed to be booked for.",
    attestedAt: isoIn(-120_000),
    accessStatus: "active",
    accessSentAt: isoIn(-110_000),
    accessExpiresAt: isoIn(3 * 3_600_000),
    declinedAt: null,
    ...over,
  });

export const organization = (
  over: Partial<OrganizationView> = {},
): OrganizationView =>
  OrganizationViewSchema.parse({
    id: "org_acme",
    name: "Acme Logistics",
    cityId: "LOS",
    currency: "NGN",
    status: "active",
    policy: {
      tripCap: NGN(20_000_00),
      allowedServices: ["ride"],
      allowedClasses: ["go", "comfort"],
      version: 3,
    },
    billing: null,
    myRole: "booker",
    version: 3,
    createdAt: isoIn(-30 * 86_400_000),
    ...over,
  });

export const costCentre = (
  id: string,
  code: string,
  name: string,
): OrgCostCentreView =>
  OrgCostCentreViewSchema.parse({
    costCentreId: id,
    organizationId: "org_acme",
    code,
    name,
    status: "active",
  });

/** A COMPLETED ride's rider receipt with one committed route change (lines sum to the total). */
export const riderReceipt = (over: Partial<MpReceipt> = {}): MpReceipt =>
  MpReceiptSchema.parse({
    receiptId: "rcp_1",
    viewer: "rider",
    requestId: "req_1",
    awardId: "awd_1",
    executionId: "ride_1",
    currency: "NGN",
    lines: [
      { code: "agreed_fare", label: "Agreed fare", amountMinor: NGN(6_000_00) },
      {
        code: "route_change",
        label: "Agreed route change",
        amountMinor: NGN(750_00),
        amendmentId: "amd_1",
        committedAt: isoIn(-600_000),
      },
    ],
    totalMinor: NGN(6_750_00),
    taxes: {
      basis: "included",
      lines: [
        {
          code: "vat",
          rateBps: 750,
          label: "VAT 7.5%",
          amountMinor: NGN(470_93),
        },
      ],
      note: "Taxes are included in the total at the market’s configured rates — nothing is added on top.",
    },
    payment: { method: "wallet", label: "UBI Wallet" },
    trip: {
      service: "ride",
      vehicleClass: "standard",
      pickup: "Lekki Phase 1",
      dropoff: "Victoria Island",
      stopCount: 2,
      stopsVisited: 1,
      stopsSkipped: 1,
      routedDistanceMeters: 18_400,
      startedAt: isoIn(-3_600_000),
      completedAt: isoIn(-600_000),
      terminatedEarly: false,
      driver: legacyDriver("Emeka Okafor", true),
    },
    settlement: {
      status: "posted",
      settledAt: isoIn(-500_000),
      note: "Your payment was settled once for this trip.",
    },
    reconciliation: {
      originalFareMinor: NGN(6_000_00),
      adjustmentsMinor: NGN(750_00),
      totalMinor: NGN(6_750_00),
      settledFareMinor: NGN(6_750_00),
      rule: "Total = agreed fare + committed adjustments = the settled fare.",
    },
    format: "json",
    issuedAt: isoIn(-400_000),
    ...over,
  });

/** travel-v2.yaml AirportTransfer (travel-service transferView). */
export const transfer = (
  over: Partial<AirportTransfer> = {},
): AirportTransfer => ({
  transferId: "atr_1",
  linkedOrderId: "ord_flt_1",
  direction: "arrival_pickup",
  legIndex: 0,
  flightNumber: "P47133",
  airportCode: "LOS",
  status: "pending_unassigned",
  driverSecured: false,
  statusLabel: "Pending — no driver yet",
  notice:
    "No driver yet. We ask UBI rides to schedule this ride as your trip gets close, and drivers see it near the pickup time.",
  pickup: { lat: 6.5774, lng: 3.3211, label: "LOS airport — Door 3" },
  dropoff: { lat: 6.4281, lng: 3.4216, label: "Victoria Island" },
  pickupWindow: {
    start: isoIn(26 * 3_600_000),
    end: isoIn(26.5 * 3_600_000),
    timeZone: "Africa/Lagos",
    label: "Thu 25 Sep, 07:40 – 08:10",
  },
  arriveBy: null,
  flight: {
    departAt: isoIn(24 * 3_600_000),
    arriveAt: isoIn(25.5 * 3_600_000),
    status: "scheduled",
  },
  vehicleClass: "comfort",
  approvedMaxFareMinor: NGN(15_000_00),
  paymentMethodId: "wallet",
  policyVersion: "airport-transfer.v1",
  ride: null,
  retimedCount: 0,
  actionRequired: null,
  outcome: null,
  terms: [
    "This airport ride is a separate booking from your flight, with its own status, payment and receipt.",
  ],
  createdAt: isoIn(-60_000),
  updatedAt: isoIn(-60_000),
  ...over,
});
