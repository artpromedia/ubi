import { type CityConfig, DENY_ALL } from "@ubi/contracts";
import { describe, expect, it } from "vitest";

import {
  joinNames,
  liveServices,
  rideFacts,
  servicesFrom,
} from "@/lib/availability-pure";

const flags = (on: string[]) =>
  Object.fromEntries(
    Object.keys(DENY_ALL).map((key) => [key, on.includes(key)]),
  );

describe("servicesFrom", () => {
  it("calls nothing live under DENY_ALL", () => {
    expect(liveServices(servicesFrom(DENY_ALL))).toEqual([]);
  });

  it("requires ride_request as well as move for rides", () => {
    expect(liveServices(servicesFrom(flags(["move"])))).toEqual([]);
    expect(liveServices(servicesFrom(flags(["move", "ride_request"])))).toEqual(
      ["move"],
    );
  });

  it("maps the launch-day flags to Move, Bites, Send and travel; Ask stays off", () => {
    const live = liveServices(
      servicesFrom(
        flags(["move", "ride_request", "bites", "send", "flights_booking"]),
      ),
    );
    expect(live).toEqual(["move", "bites", "send", "travel"]);
  });
});

describe("rideFacts", () => {
  const config: CityConfig = {
    cityId: "LOS",
    version: 1,
    currency: "NGN",
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
    vehicleClasses: ["go", "comfort", "xl"],
    fares: {},
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
      { id: "card", available: false, reason: "provider onboarding" },
      { id: "wallet", available: true },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 1,
        singleTransferMinor: 1,
        balanceCapMinor: null,
      },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: 0,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 20,
      checkInCutoffMin: 90,
      trafficBufferMin: 45,
      doors: { international_arrivals: "Arrivals Door C" },
    },
    taxes: { vat: 7.5 },
  };

  it("prints only the fields a card may show, never a fare", () => {
    const facts = rideFacts(config);
    expect(facts.classes).toBe("Go · Comfort · XL");
    expect(facts.payWith).toBe("Cash · UBI Wallet");
    expect(facts.pickup).toBe("PIN-verified · 5 min free waiting");
    expect(facts.airport).toBe("LOS · Arrivals Door C");
    expect(facts.emergency).toBe("112 from inside the trip screen");
    expect(facts.serviceFeePct).toBe(20);
    expect(JSON.stringify(facts)).not.toContain("Minor");
  });
});

describe("joinNames", () => {
  it("reads as prose", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Lagos"])).toBe("Lagos");
    expect(joinNames(["Lagos", "Abuja"])).toBe("Lagos and Abuja");
    expect(joinNames(["rides", "food", "packages"])).toBe(
      "rides, food and packages",
    );
  });
});

describe("city slugs", () => {
  it("builds the canonical path from the name and resolves slug or id", async () => {
    const { citySlug, cityPath, findCityRow } =
      await import("@/lib/availability-pure");
    const rows = [
      { id: "LOS", name: "Lagos" },
      { id: "PHC", name: "Port Harcourt" },
    ];
    expect(citySlug("Port Harcourt")).toBe("port-harcourt");
    expect(cityPath(rows[1]!)).toBe("/cities/port-harcourt");
    expect(findCityRow(rows, "lagos")?.id).toBe("LOS");
    expect(findCityRow(rows, "LOS")?.id).toBe("LOS");
    expect(findCityRow(rows, "port-harcourt")?.id).toBe("PHC");
    expect(findCityRow(rows, "xyz")).toBeUndefined();
    expect(findCityRow(rows, "")).toBeUndefined();
  });
});
