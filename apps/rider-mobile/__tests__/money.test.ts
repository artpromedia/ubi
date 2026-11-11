import { formatMinor, accessibleMoney, bpsToPercent } from "@ubi/mobile-core";
import { formatMoney, money } from "@ubi/contracts";

describe("@ubi/mobile-core money formatter (kobo -> NGN)", () => {
  it("formats whole naira with grouping and no kobo", () => {
    expect(formatMinor({ amountMinor: 150000, currency: "NGN" })).toBe(
      "₦1,500",
    );
    expect(formatMinor({ amountMinor: 123456700, currency: "NGN" })).toBe(
      "₦1,234,567",
    );
    expect(formatMinor({ amountMinor: 0, currency: "NGN" })).toBe("₦0");
  });

  it("shows kobo only when the minor part is non-zero", () => {
    expect(formatMinor({ amountMinor: 150050, currency: "NGN" })).toBe(
      "₦1,500.50",
    );
    expect(formatMinor({ amountMinor: 99, currency: "NGN" })).toBe("₦0.99");
  });

  it("renders an em dash for missing money", () => {
    expect(formatMinor(undefined)).toBe("—");
    expect(formatMinor(null)).toBe("—");
  });

  it("uses a true minus for negatives and an optional plus when signed", () => {
    expect(formatMinor({ amountMinor: -50000, currency: "NGN" })).toBe("−₦500");
    expect(
      formatMinor(
        { amountMinor: 50000, currency: "NGN" },
        {},
        { signed: true },
      ),
    ).toBe("+₦500");
  });

  it("announces an accessible amount with its currency name", () => {
    expect(accessibleMoney({ amountMinor: 150000, currency: "NGN" })).toBe(
      "1,500 naira",
    );
    expect(accessibleMoney(undefined)).toBe("amount unavailable");
  });

  it("formats basis points as a percentage", () => {
    expect(bpsToPercent(2000)).toBe("20%");
    expect(bpsToPercent(1550)).toBe("15.5%");
  });
});

describe("parity with @ubi/contracts formatMoney (the money source of truth)", () => {
  // mobile-core drops a whole-naira ".00"; contracts (fractionDigits=2) keeps it.
  // Normalise that one difference, then the grouped amount must be identical.
  const stripWholeKobo = (s: string) => s.replace(/\.00$/, "");
  const cases = [150000, 123456700, 150050, 99, 0];

  it.each(cases)("agrees on %d kobo", (minor) => {
    const core = formatMinor({ amountMinor: minor, currency: "NGN" });
    const contract = formatMoney(money(minor, "NGN"), {
      locale: "en-NG",
      fractionDigits: 2,
    });
    expect(stripWholeKobo(contract)).toBe(core);
  });

  it("parses a contract CityConfig fixture and derives display money format from currency + currencyFractionDigits", () => {
    const { parseCityConfig, moneyFormatFor } =
      require("@ubi/mobile-core") as typeof import("@ubi/mobile-core");
    const { CityConfigSchema } =
      require("@ubi/contracts") as typeof import("@ubi/contracts");
    const raw = CityConfigSchema.parse({
      cityId: "LOS",
      version: 1,
      currency: "NGN",
      currencyFractionDigits: 2,
      locale: "en-NG",
      timezone: "Africa/Lagos",
      emergencyNumber: "112",
      supportPhone: "+23417000824",
      vehicleClasses: ["go", "comfort", "xl"],
      fares: {
        go: {
          baseMinor: 60_000,
          perKmMinor: 18_000,
          perMinMinor: 2_500,
          bookingFeeMinor: 10_000,
          minFareMinor: 120_000,
        },
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
      paymentMethods: [{ id: "cash", available: true }],
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
        codes: ["LOS"],
        arrivalBufferMin: 20,
        checkInCutoffMin: 90,
        trafficBufferMin: 45,
        doors: { domestic_arrivals: "Door 2" },
      },
      taxes: { vat: 7.5 },
    });
    const parsed = parseCityConfig(raw);
    expect(parsed.supportPhone).toBe("+23417000824");
    const fmt = moneyFormatFor(parsed);
    expect(fmt.currencySymbol).toBe("₦");
    expect(fmt.currencyFractionDigits).toBe(2);
    expect(formatMinor({ amountMinor: 150_000, currency: "NGN" }, parsed)).toBe(
      "₦1,500",
    );
  });
});
