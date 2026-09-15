/**
 * The launch-pair guard is a pure function, and the seed registry must hold
 * the launch plan exactly: two launch cities in one group, eight planned rows.
 */
import { CityConfigSchema, ContractError } from "@ubi/contracts";
import { describe, expect, it } from "vitest";

import { abujaConfig } from "@/seed/abuja";
import {
  ABUJA_CITY,
  LAGOS_CITY,
  NG_LAUNCH_GROUP,
  PLANNED_CITIES,
  SEED_CITIES,
} from "@/seed/cities";
import { lagosConfig } from "@/seed/lagos";
import { assertLaunchGroupsComplete } from "@/services/cities.service";

const LOS = { id: "LOS", launchGroup: "ng" } as const;
const ABV = { id: "ABV", launchGroup: "ng" } as const;

describe("launch-pair guard", () => {
  it("refuses to activate one launch city while the other is not active", () => {
    expect(() =>
      assertLaunchGroupsComplete(
        [
          { ...LOS, status: "active" },
          { ...ABV, status: "launching" },
        ],
        ["LOS"],
      ),
    ).toThrow(ContractError);
    try {
      assertLaunchGroupsComplete(
        [
          { ...LOS, status: "active" },
          { ...ABV, status: "launching" },
        ],
        ["LOS"],
      );
    } catch (error) {
      expect((error as ContractError).code).toBe("launch_pair_incomplete");
      expect((error as ContractError).status).toBe(409);
      expect((error as ContractError).details).toEqual({
        launchGroup: "ng",
        activating: ["LOS"],
        missing: ["ABV"],
      });
    }
  });

  it("lets both launch cities go live in one change", () => {
    expect(() =>
      assertLaunchGroupsComplete(
        [
          { ...LOS, status: "active" },
          { ...ABV, status: "active" },
        ],
        ["LOS", "ABV"],
      ),
    ).not.toThrow();
  });

  it("lets a launch city join a group that is already live", () => {
    expect(() =>
      assertLaunchGroupsComplete(
        [
          { ...LOS, status: "active" },
          { ...ABV, status: "active" },
        ],
        ["ABV"],
      ),
    ).not.toThrow();
  });

  it("never blocks leaving active: one launch city can be paused for an incident", () => {
    expect(() =>
      assertLaunchGroupsComplete(
        [
          { ...LOS, status: "paused" },
          { ...ABV, status: "active" },
        ],
        [],
      ),
    ).not.toThrow();
  });

  it("ignores cities outside any launch group", () => {
    expect(() =>
      assertLaunchGroupsComplete(
        [
          { id: "PHC", launchGroup: null, status: "active" },
          { ...LOS, status: "launching" },
          { ...ABV, status: "launching" },
        ],
        ["PHC"],
      ),
    ).not.toThrow();
  });
});

describe("city registry", () => {
  it("holds two launch cities in one launch group, both launching until launch day", () => {
    expect(LAGOS_CITY.status).toBe("launching");
    expect(ABUJA_CITY.status).toBe("launching");
    expect(LAGOS_CITY.launchGroup).toBe(NG_LAUNCH_GROUP);
    expect(ABUJA_CITY.launchGroup).toBe(NG_LAUNCH_GROUP);
    expect(ABUJA_CITY.region).toBe("FCT");
    expect(ABUJA_CITY.timezone).toBe("Africa/Lagos");
  });

  it("names the eight planned cities as planned rows without a launch group", () => {
    expect(PLANNED_CITIES.map((c) => c.name)).toEqual([
      "Port Harcourt",
      "Ibadan",
      "Benin City",
      "Enugu",
      "Uyo",
      "Calabar",
      "Asaba",
      "Onitsha",
    ]);
    expect(PLANNED_CITIES.every((c) => c.status === "planned")).toBe(true);
    expect(PLANNED_CITIES.every((c) => c.launchGroup === null)).toBe(true);
    expect(new Set(SEED_CITIES.map((c) => c.id)).size).toBe(SEED_CITIES.length);
  });
});

describe("abuja config", () => {
  const abuja = abujaConfig(1);
  const lagos = lagosConfig(1);

  it("parses against the shared CityConfig contract", () => {
    expect(CityConfigSchema.safeParse(abuja).success).toBe(true);
    expect(abuja.cityId).toBe("ABV");
  });

  it("mirrors Lagos on every required field", () => {
    for (const key of [
      "currency",
      "currencyFractionDigits",
      "locale",
      "timezone",
      "emergencyNumber",
      "vehicleClasses",
      "paymentMethods",
      "waitPolicy",
      "cancelPolicy",
      "pinRequired",
      "quoteTtlSec",
      "offerTtlSec",
      "serviceFeePct",
      "kycTiers",
      "taxes",
    ] as const) {
      expect(abuja[key]).toEqual(lagos[key]);
    }
    expect(abuja.currency).toBe("NGN");
    expect(abuja.emergencyNumber).toBe("112");
    expect(abuja.vehicleClasses).toEqual(["go", "comfort", "xl"]);
  });

  it("names Nnamdi Azikiwe (ABV) with its doors", () => {
    expect(abuja.airport.codes).toEqual(["ABV"]);
    expect(Object.keys(abuja.airport.doors).sort()).toEqual([
      "domestic_arrivals",
      "domestic_departures",
      "international_arrivals",
      "international_departures",
    ]);
  });
});
