/**
 * The seed must be impossible to run against production, and the Lagos config
 * it carries must hold the board numbers exactly.
 */
import {
  CityConfigSchema,
  ContractError,
  fareTableFor,
  paymentMethodAvailable,
} from "@ubi/contracts";
import { describe, expect, it } from "vitest";

import { assertSeedAllowed, lagosConfig, seedLagos } from "@/seed/lagos";

describe("seed guards", () => {
  it("refuses to run in production even with the opt-in set", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        CONFIG_SEED_ENABLED: "true",
      }),
    ).toThrow(ContractError);
  });

  it("refuses to run without the explicit opt-in", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).toThrow(
      ContractError,
    );
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "test", CONFIG_SEED_ENABLED: "false" }),
    ).toThrow(ContractError);
  });

  it("allows an explicitly opted-in non-production run", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "test", CONFIG_SEED_ENABLED: "true" }),
    ).not.toThrow();
  });

  it("rejects a production seed before touching the database", async () => {
    await expect(
      seedLagos({ NODE_ENV: "production", CONFIG_SEED_ENABLED: "true" }),
    ).rejects.toBeInstanceOf(ContractError);
  });
});

describe("lagos config", () => {
  const config = lagosConfig(1);

  it("parses against the shared CityConfig contract", () => {
    expect(CityConfigSchema.safeParse(config).success).toBe(true);
  });

  it("carries the board numbers", () => {
    expect(config.currency).toBe("NGN");
    expect(config.currencyFractionDigits).toBe(2);
    expect(config.emergencyNumber).toBe("112");
    expect(config.vehicleClasses).toEqual(["go", "comfort", "xl"]);
    expect(config.waitPolicy).toEqual({ freeSec: 300, perMinMinor: 5_000 });
    expect(config.cancelPolicy.riderFeeAfterAssignMinor).toBe(30_000);
    expect(config.cancelPolicy.driverFeeMinor).toBe(0);
    expect(config.pinRequired).toBe(true);
    expect(config.quoteTtlSec).toBe(300);
    expect(config.offerTtlSec).toBe(12);
    expect(config.serviceFeePct).toBe(20);
    expect(config.timezone).toBe("Africa/Lagos");
  });

  it("has no moto class in Lagos", () => {
    expect(config.vehicleClasses).not.toContain("moto");
    expect(config.fares["moto"]).toBeUndefined();
    expect(() => fareTableFor(config, "moto")).toThrow();
  });

  it("has a fare table for every offered class", () => {
    for (const vehicleClass of config.vehicleClasses) {
      const table = fareTableFor(config, vehicleClass);
      expect(table.minFareMinor).toBeGreaterThan(0);
    }
  });

  it("offers cash, card, bank transfer and wallet", () => {
    for (const method of ["cash", "card", "bank_transfer", "wallet"]) {
      expect(paymentMethodAvailable(config, method)).toBe(true);
    }
    expect(paymentMethodAvailable(config, "mpesa")).toBe(false);
  });

  it("stamps the version it was asked for", () => {
    expect(lagosConfig(7).version).toBe(7);
  });
});
