/**
 * The remittance arithmetic (A05; decisions doc Q2 / Q8): integer, floored,
 * and the only place it lives. These are the pure functions the settlement
 * (tests/fleet/settlement.test.ts) posts through.
 */
import { describe, expect, it } from "vitest";

import { resolveCommissionFunding } from "../../src/fleet/commission-funding";
import {
  allocateOutstanding,
  centiHours,
  percentBps,
  percentOfNetMinor,
  proRataRemittanceMinor,
} from "../../src/fleet/math";
import {
  addDays,
  isMonday,
  originOfOwedRef,
  carryOwedRef,
  weeksBetween,
} from "../../src/fleet/model";
import { lastCompletedWeekStart } from "../../src/fleet/sweep";

describe("Q2 pro-rata for weekly_fixed terms", () => {
  it("reduces the remittance by the planned-maintenance share of the signed shift hours", () => {
    // The contract example: ₦25 000.00, 60 signed hours, 12 planned → 48/60.
    expect(
      proRataRemittanceMinor(2_500_000, centiHours(60), centiHours(12)),
    ).toBe(2_000_000);
  });

  it("floors the fraction: the fleet never gets more than the exact share", () => {
    // 1 000 001 × 400 / 700 = 571 429.14… → 571 429 (the 0.14 stays with the driver).
    expect(proRataRemittanceMinor(1_000_001, 700, 300)).toBe(571_429);
    // 2 dp hours: 37.5 signed, 12.25 planned → 2 500 000 × 2525 / 3750 = 1 683 333.33…
    expect(
      proRataRemittanceMinor(2_500_000, centiHours(37.5), centiHours(12.25)),
    ).toBe(1_683_333);
  });

  it("owes nothing in a zero-shift week and nothing in a full-maintenance week", () => {
    expect(proRataRemittanceMinor(2_500_000, 0, 0)).toBe(0);
    expect(proRataRemittanceMinor(2_500_000, 4_000, 4_000)).toBe(0);
    // Planned beyond the shift (never negative).
    expect(proRataRemittanceMinor(2_500_000, 4_000, 5_000)).toBe(0);
  });

  it("owes the full amount when nothing planned was lost", () => {
    expect(proRataRemittanceMinor(2_500_000, 6_000, 0)).toBe(2_500_000);
  });

  it("over a mid-week supersession, owes each version only its share of the week's signed shift", () => {
    // Standing alone the basis is the item's own shift: exactly Q2.
    expect(proRataRemittanceMinor(2_500_000, 3_600, 0, 3_600)).toBe(2_500_000);
    // Mon–Wed of an 84-hour signed week (36 h) under the old version…
    expect(proRataRemittanceMinor(2_500_000, 3_600, 0, 8_400)).toBe(1_071_428);
    // …and Thu–Sun (48 h, 6 of them planned) under the new one.
    expect(proRataRemittanceMinor(3_000_000, 4_800, 600, 8_400)).toBe(
      1_500_000,
    );
    // A basis that leaves this item's own shift out is refused.
    expect(() => proRataRemittanceMinor(2_500_000, 3_600, 0, 3_000)).toThrow();
  });

  it("refuses hours with more than two decimals and negative inputs", () => {
    expect(() => centiHours(1.005)).toThrow(/two decimal places/);
    expect(() => centiHours(-1)).toThrow();
    expect(() => proRataRemittanceMinor(-1, 100, 0)).toThrow();
    expect(() => proRataRemittanceMinor(1.5, 100, 0)).toThrow();
  });
});

describe("percent_of_net", () => {
  it("applies basis points to a positive net, floored, and nothing to a non-positive one", () => {
    expect(percentBps(25.5)).toBe(2_550);
    expect(percentOfNetMinor(720_000, 2_550)).toBe(183_600);
    expect(percentOfNetMinor(999, 3_333)).toBe(332); // 332.9667 → 332
    expect(percentOfNetMinor(0, 2_000)).toBe(0);
    expect(percentOfNetMinor(-50_000, 2_000)).toBe(0);
  });

  it("refuses a percent outside (0, 100] or with more than two decimals", () => {
    expect(() => percentBps(0)).toThrow();
    expect(() => percentBps(100.01)).toThrow();
    expect(() => percentBps(12.345)).toThrow();
  });
});

describe("carry-forward allocation", () => {
  const claims = [
    { origin: "2026-08-03", amountMinor: 700_000 },
    { origin: "2026-08-10", amountMinor: 1_000_000 },
    { origin: "2026-08-17", amountMinor: 1_000_000 },
  ];

  it("pays the oldest first, so what remains sits on the newest claims", () => {
    const after = allocateOutstanding(claims, 1_200_000);
    expect(Object.fromEntries(after)).toEqual({
      "2026-08-03": 0,
      "2026-08-10": 200_000,
      "2026-08-17": 1_000_000,
    });
  });

  it("clears everything when the remainder is zero", () => {
    const after = allocateOutstanding(claims, 0);
    expect([...after.values()].every((value) => value === 0)).toBe(true);
  });

  it("nets credits first and keeps an unrefunded credit on the newest credit origin", () => {
    const withCredit = [
      { origin: "2026-08-10", amountMinor: -300_000 },
      { origin: "2026-08-17", amountMinor: 100_000 },
    ];
    expect(
      Object.fromEntries(allocateOutstanding(withCredit, -50_000)),
    ).toEqual({
      "2026-08-10": -50_000,
      "2026-08-17": 0,
    });
  });

  it("refuses a remainder the claims cannot hold", () => {
    expect(() => allocateOutstanding(claims, 5_000_000)).toThrow();
  });
});

describe("settlement weeks", () => {
  it("names a week by its Monday and counts whole weeks", () => {
    expect(isMonday("2026-09-21")).toBe(true);
    expect(isMonday("2026-09-22")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
    expect(addDays("2026-09-21", 6)).toBe("2026-09-27");
    expect(weeksBetween("2026-08-03", "2026-08-17")).toBe(2);
    expect(weeksBetween("2026-08-17", "2026-08-03")).toBe(-2);
  });

  it("finds the last week that has fully ended in the city's zone", () => {
    // Wednesday 23 Sep 2026 → the week of 14 Sep ended on the 21st.
    expect(
      lastCompletedWeekStart(new Date("2026-09-23T12:00:00Z"), "Africa/Lagos"),
    ).toBe("2026-09-14");
    // 00:30 Monday in Lagos is still Sunday in UTC: the week of the 14th has ended.
    expect(
      lastCompletedWeekStart(new Date("2026-09-20T23:30:00Z"), "Africa/Lagos"),
    ).toBe("2026-09-14");
    // 23:00 Sunday in Lagos: the week of the 14th is still running.
    expect(
      lastCompletedWeekStart(new Date("2026-09-20T22:00:00Z"), "Africa/Lagos"),
    ).toBe("2026-09-07");
  });

  it("parses only the pair's own owed refs", () => {
    const ref = carryOwedRef("flt_a", "drv_b", "2026-08-03");
    expect(originOfOwedRef("flt_a", "drv_b", ref)).toBe("2026-08-03");
    expect(originOfOwedRef("flt_a", "drv_c", ref)).toBeNull();
    expect(
      originOfOwedRef(
        "flt_a",
        "drv_b",
        "fleet_carry:flt_a:drv_b:fleet:2026-08-03",
      ),
    ).toBeNull();
  });
});

describe("commission funding (A05 item 3)", () => {
  it("defaults to the driver's wallet as the ONE funder", () => {
    expect(resolveCommissionFunding("drv_1")).toEqual({
      source: "driver_wallet",
      funder: { ownerType: "user", ownerId: "drv_1" },
      sponsorFleetId: null,
    });
    expect(
      resolveCommissionFunding("drv_1", { source: "driver_wallet" }).source,
    ).toBe("driver_wallet");
  });

  it("refuses fleet sponsorship explicitly while no budgeted arrangement exists", () => {
    let caught: unknown;
    try {
      resolveCommissionFunding("drv_1", {
        source: "fleet_sponsorship",
        fleetId: "flt_1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "feature_disabled",
      details: { reason: "fleet_sponsorship_unavailable", fleetId: "flt_1" },
    });
  });
});
