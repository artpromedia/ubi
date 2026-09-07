/**
 * The three PROVISIONAL value sets in the Lagos seed (per-class fares, KYC tier
 * limits, remittance cap) are not on the slice 01 board, so this file pins the
 * properties that make them defensible defaults rather than broken sentinels:
 * the config parses, the fares are monotonic across classes, the KYC ladder is
 * strictly increasing, and nothing is left at a zero/unset sentinel. When ops
 * or finance sign off on different numbers, these invariants must still hold.
 */
import { CityConfigSchema, type FareTable, fareTableFor } from "@ubi/contracts";
import { describe, expect, it } from "vitest";

import { lagosConfig } from "@/seed/lagos";

const config = lagosConfig(1);

/** Classes cheapest → most expensive, matching the board order. */
const CLASS_LADDER = ["go", "comfort", "xl"] as const;

/** null balanceCap means "no cap" — the top of the ladder, not an unset value. */
function balanceCapRank(minor: number | null): number {
  return minor === null ? Number.POSITIVE_INFINITY : minor;
}

describe("lagos provisional values", () => {
  it("parses against the shared CityConfig contract", () => {
    expect(CityConfigSchema.safeParse(config).success).toBe(true);
  });

  describe("fares are monotonic across classes", () => {
    const tables: FareTable[] = CLASS_LADDER.map((cls) => fareTableFor(config, cls));

    it("has a table for exactly the offered classes and no others", () => {
      expect([...config.vehicleClasses]).toEqual([...CLASS_LADDER]);
      expect(Object.keys(config.fares).sort()).toEqual([...CLASS_LADDER].sort());
    });

    it("increases base and perKm strictly with each class (comfort > go, xl > comfort)", () => {
      for (let i = 1; i < tables.length; i += 1) {
        const lower = tables[i - 1];
        const higher = tables[i];
        if (lower === undefined || higher === undefined) throw new Error("missing fare table");
        expect(higher.baseMinor).toBeGreaterThan(lower.baseMinor);
        expect(higher.perKmMinor).toBeGreaterThan(lower.perKmMinor);
      }
    });

    it("also increases perMin and minFare strictly with each class", () => {
      for (let i = 1; i < tables.length; i += 1) {
        const lower = tables[i - 1];
        const higher = tables[i];
        if (lower === undefined || higher === undefined) throw new Error("missing fare table");
        expect(higher.perMinMinor).toBeGreaterThan(lower.perMinMinor);
        expect(higher.minFareMinor).toBeGreaterThan(lower.minFareMinor);
      }
    });

    it("charges a flat, non-zero platform booking fee across classes", () => {
      const fees = new Set(tables.map((t) => t.bookingFeeMinor));
      expect(fees.size).toBe(1);
      for (const t of tables) expect(t.bookingFeeMinor).toBeGreaterThan(0);
    });

    it("leaves no fare field at a zero sentinel that would read as unset", () => {
      for (const t of tables) {
        expect(t.baseMinor).toBeGreaterThan(0);
        expect(t.perKmMinor).toBeGreaterThan(0);
        expect(t.perMinMinor).toBeGreaterThan(0);
        expect(t.minFareMinor).toBeGreaterThan(0);
      }
    });
  });

  describe("KYC tiers are a strictly increasing ladder", () => {
    const tiers = config.kycTiers;

    it("defines more than one tier", () => {
      expect(tiers.length).toBeGreaterThan(1);
    });

    it("increases dailyOut, singleTransfer and balanceCap strictly, tier over tier", () => {
      for (let i = 1; i < tiers.length; i += 1) {
        const lower = tiers[i - 1];
        const higher = tiers[i];
        if (lower === undefined || higher === undefined) throw new Error("missing kyc tier");
        expect(higher.dailyOutMinor).toBeGreaterThan(lower.dailyOutMinor);
        expect(higher.singleTransferMinor).toBeGreaterThan(lower.singleTransferMinor);
        expect(balanceCapRank(higher.balanceCapMinor)).toBeGreaterThan(
          balanceCapRank(lower.balanceCapMinor),
        );
      }
    });

    it("leaves no daily or single-transfer limit at a zero sentinel", () => {
      for (const tier of tiers) {
        expect(tier.dailyOutMinor).toBeGreaterThan(0);
        expect(tier.singleTransferMinor).toBeGreaterThan(0);
      }
    });

    it("only ever uncaps the balance on the final (highest) tier", () => {
      tiers.forEach((tier, index) => {
        if (index < tiers.length - 1) {
          expect(tier.balanceCapMinor).not.toBeNull();
          expect(tier.balanceCapMinor ?? 0).toBeGreaterThan(0);
        }
      });
    });

    it("starts a new wallet at the most restrictive tier (lowest dailyOut is first)", () => {
      const entry = tiers.reduce((lowest, candidate) =>
        candidate.dailyOutMinor < lowest.dailyOutMinor ? candidate : lowest,
      );
      expect(entry).toBe(tiers[0]);
    });
  });

  describe("remittance cap", () => {
    it("is a positive integer ceiling, not a zero/unset sentinel", () => {
      expect(Number.isInteger(config.remittanceCapMinor)).toBe(true);
      expect(config.remittanceCapMinor).toBeGreaterThan(0);
    });

    it("clears the highest single-trip minimum fare (a real weekly ceiling, not a stray small number)", () => {
      const maxMinFare = Math.max(
        ...CLASS_LADDER.map((cls) => fareTableFor(config, cls).minFareMinor),
      );
      expect(config.remittanceCapMinor).toBeGreaterThan(maxMinFare);
    });
  });
});
