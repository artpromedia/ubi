/**
 * Fixtures for the mocked config-service and user-service. The shapes match
 * @ubi/contracts (CitySummarySchema, CityConfigSchema, the flag map) and the
 * user-service `{ success, data }` envelope, so the site parses them with the
 * same code it uses in production.
 */

export const LAUNCH_GROUP = "ng-launch-2026";

const city = (id, name, region, status, launchGroup = null) => ({
  id,
  name,
  country: "NG",
  region,
  timezone: "Africa/Lagos",
  status,
  active: status === "active",
  launchGroup,
});

export const PLANNED = [
  city("PHC", "Port Harcourt", "Rivers State", "planned"),
  city("IBA", "Ibadan", "Oyo State", "planned"),
  city("BNI", "Benin City", "Edo State", "planned"),
  city("ENU", "Enugu", "Enugu State", "planned"),
  city("QUO", "Uyo", "Akwa Ibom State", "planned"),
  city("CBQ", "Calabar", "Cross River State", "planned"),
  city("ABB", "Asaba", "Delta State", "planned"),
  city("ONI", "Onitsha", "Anambra State", "planned"),
];

export const rows = {
  launchDay: [
    city("LOS", "Lagos", "Lagos State", "active", LAUNCH_GROUP),
    city("ABV", "Abuja", "FCT", "active", LAUNCH_GROUP),
    ...PLANNED,
  ],
  today: [
    city("LOS", "Lagos", "Lagos State", "active", LAUNCH_GROUP),
    city("ABV", "Abuja", "FCT", "launching", LAUNCH_GROUP),
    ...PLANNED,
  ],
  preLaunch: [
    city("LOS", "Lagos", "Lagos State", "launching", LAUNCH_GROUP),
    city("ABV", "Abuja", "FCT", "launching", LAUNCH_GROUP),
    ...PLANNED,
  ],
};

const fare = (base, perKm, perMin, min) => ({
  baseMinor: base,
  perKmMinor: perKm,
  perMinMinor: perMin,
  bookingFeeMinor: 10_000,
  minFareMinor: min,
});

export function cityConfig(cityId, airportCode, doors) {
  return {
    cityId,
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    vehicleClasses: ["go", "comfort", "xl"],
    // Provisional fares: present because the contract requires them, and the
    // content lint proves none of them ever renders.
    fares: {
      go: fare(60_000, 18_000, 2_500, 120_000),
      comfort: fare(90_000, 24_000, 3_500, 180_000),
      xl: fare(140_000, 32_000, 4_500, 260_000),
    },
    waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
    cancelPolicy: {
      riderFeeAfterAssignMinor: 30_000,
      driverFeeMinor: 0,
      freeWindowSec: 120,
    },
    pinRequired: true,
    quoteTtlSec: 300,
    offerTtlSec: 12,
    matchingRings: [{ radiusMeters: 2_000, maxCandidates: 5 }],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "cash", available: true },
      { id: "card", available: true },
      { id: "bank_transfer", available: true },
      { id: "wallet", available: true },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: 15_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: [airportCode],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors,
    },
    taxes: { vat: 7.5 },
  };
}

export const configs = {
  LOS: cityConfig("LOS", "LOS", {
    international_arrivals: "Arrivals Door C",
    domestic_arrivals: "Domestic Arrivals Door 2",
    international_departures: "Departures Door D",
    domestic_departures: "Domestic Departures Door 1",
  }),
  ABV: cityConfig("ABV", "ABV", {
    international_arrivals: "International Arrivals Door 1",
    domestic_arrivals: "Domestic Arrivals Door 2",
  }),
};

export const FLAG_KEYS = [
  "move",
  "bites",
  "send",
  "travel",
  "stays",
  "journeys",
  "reservations",
  "fleet",
  "wallet_p2p",
  "wallet_nip",
  "tips",
  "scheduled_rides",
  "recording",
  "driver_online",
  "ride_request",
  "provider_payments",
  "ai_assistant",
  "ai_transactions",
  "ai_mandates",
  "flights_booking",
  "stays_booking",
  "rider_promotions",
  "driver_commission_rebates",
  "referrals",
  "ai_marketing",
];

export function flagMap(on) {
  const map = {};
  for (const key of FLAG_KEYS) map[key] = on.includes(key);
  return map;
}

export const SEED_FLAGS = ["move", "ride_request", "driver_online"];
export const LAUNCH_FLAGS = [
  ...SEED_FLAGS,
  "bites",
  "send",
  "flights_booking",
  "stays_booking",
];

export const requirements = {
  LOS: {
    cityId: "LOS",
    role: "driver",
    documents: [
      {
        type: "licence",
        title: "Driver's licence",
        detail: "Valid, in your name",
        required: true,
        owner: "driver",
      },
      {
        type: "lasdri",
        title: "LASDRI card",
        detail: "Lagos State Drivers' Institute",
        required: true,
        owner: "driver",
      },
      {
        type: "nin_identity",
        title: "Identity",
        detail: "NIN, plus a selfie check in the app",
        required: true,
        owner: "identity",
      },
      {
        type: "insurance",
        title: "Third-party insurance",
        detail: "Third-party insurance",
        required: true,
        owner: "vehicle",
      },
      {
        type: "roadworthiness",
        title: "Roadworthiness",
        detail: "Current roadworthiness certificate",
        required: true,
        owner: "vehicle",
      },
      {
        type: "vehicle_registration",
        title: "Registration",
        detail: "Registration in the name shown on the licence",
        required: true,
        owner: "vehicle",
      },
      {
        type: "background_check",
        title: "Background check",
        detail: "You consent in the app; UBI runs it",
        required: true,
        owner: "driver",
      },
    ],
  },
};

/** Named presets a test starts from; `overrides` are merged on top. */
export function preset(name) {
  switch (name) {
    case "launch_day":
      return {
        cities: rows.launchDay,
        citiesMode: "ok",
        configs,
        configMode: "ok",
        flags: { LOS: flagMap(LAUNCH_FLAGS), ABV: flagMap(LAUNCH_FLAGS) },
        flagsMode: "ok",
        flagsDelayMs: 0,
        requirementsMode: "ok",
      };
    case "today":
      return {
        cities: rows.today,
        citiesMode: "ok",
        configs,
        configMode: "ok",
        flags: { LOS: flagMap(SEED_FLAGS), ABV: flagMap([]) },
        flagsMode: "ok",
        flagsDelayMs: 0,
        requirementsMode: "ok",
      };
    case "pre_launch":
      return {
        cities: rows.preLaunch,
        citiesMode: "ok",
        configs,
        configMode: "ok",
        flags: { LOS: flagMap(SEED_FLAGS), ABV: flagMap([]) },
        flagsMode: "ok",
        flagsDelayMs: 0,
        requirementsMode: "ok",
      };
    default:
      throw new Error(`unknown preset ${name}`);
  }
}
