/** Pure mapping-helper tests for the marketplace facade (no network). */
import { describe, expect, it } from "vitest";

import {
  ageLine,
  boundsFields,
  canPublishPolicy,
  envelopeLine,
  eventTone,
  monitorStats,
  outcomeTone,
  pctRate,
  redactedExport,
  toMonitorRow,
  toMonitorState,
  toTimelineEvents,
  type CityConfigView,
  type MarketplacePolicy,
  type MpRequestRow,
} from "../marketplace-api";

const policy: MarketplacePolicy = {
  policyVersion: 3,
  commissionBps: 1000,
  commissionRounding: "half_up",
  fareBounds: {
    "ride:go": {
      absoluteFloorMinor: 120_000,
      costFloorMinor: 90_000,
      floorBpsOfSuggested: 6_000,
      ceilingBpsOfSuggested: 15_000,
    },
    "delivery:moto": {
      absoluteFloorMinor: 80_000,
      costFloorMinor: 60_000,
      floorBpsOfSuggested: 6_000,
      ceilingBpsOfSuggested: 15_000,
    },
  },
  searchEnvelope: {
    initialRadiusMeters: 2_000,
    maxRadiusMeters: 6_000,
    initialPickupEtaSec: 360,
    maxPickupEtaSec: 900,
    expandAfterSec: 45,
    minOffersBeforeExpand: 3,
    expansionSteps: 3,
  },
  stationary: {
    minDwellSec: 90,
    maxSpeedMps: 1.5,
    maxLocationAgeSec: 30,
    maxAccuracyMeters: 50,
    motionCloseSec: 20,
  },
  finishingTrip: {
    maxRemainingSec: 480,
    completionBufferSec: 120,
    uncertaintyBufferSec: 60,
    corridorMaxBearingDeltaDeg: 45,
  },
  bids: {
    bidExpirySec: 120,
    requestExpirySec: 600,
    revisionCooldownSec: 15,
    maxLiveBidsPerDriver: 3,
    maxOpenRequestsPerRequester: 2,
  },
  queue: { pickupWindowToleranceSec: 300 },
  rateProfileBounds: {
    go: { maxPerKmMinor: 50_000, maxMinimumTripFareMinor: 200_000 },
  },
};
const configured: CityConfigView = {
  cityId: "lagos",
  version: 7,
  currency: "NGN",
  currencyFractionDigits: 2,
  marketplace: policy,
};

describe("toMonitorState", () => {
  it("maps live states and hides terminal ones", () => {
    expect(toMonitorState("open")).toBe("open");
    expect(toMonitorState("no_offers")).toBe("no_bids");
    expect(toMonitorState("award_pending")).toBe("award_pending");
    expect(toMonitorState("awarded")).toBe("awarded");
    expect(toMonitorState("execution")).toBe("awarded");
    expect(toMonitorState("cancelled")).toBeNull();
    expect(toMonitorState("expired")).toBeNull();
    expect(toMonitorState("draft")).toBeNull();
  });
});

describe("toMonitorRow", () => {
  const row: MpRequestRow = {
    requestId: "req_001",
    state: "open",
    service: "ride",
    cityId: "lagos",
    askedMinor: { amountMinor: 250_000, currency: "NGN" },
    bids: 3,
    reach: 17,
    envelope: { step: 1, radiusMeters: 2_000, pickupEtaSec: 360 },
  };

  it("formats money in minor units and the envelope line", () => {
    const mapped = toMonitorRow(row);
    expect(mapped).not.toBeNull();
    expect(mapped?.asked).toBe("₦2,500");
    expect(mapped?.envelope).toBe("2.0 km · 6 min · step 1");
    expect(mapped?.reach).toBe("17");
  });

  it("drops terminal states and dashes missing fields", () => {
    expect(toMonitorRow({ ...row, state: "cancelled" })).toBeNull();
    const bare = toMonitorRow({
      requestId: "r",
      state: "open",
      service: "ride",
      cityId: "lagos",
    });
    expect(bare?.asked).toBe("—");
    expect(bare?.reach).toBe("—");
    expect(bare?.envelope).toBe("—");
    expect(bare?.bids).toBe(0);
  });
});

describe("monitorStats", () => {
  it("counts states and warns on no-bid requests", () => {
    const rows = [
      {
        requestId: "a",
        route: "",
        service: "",
        asked: "",
        bids: 0,
        reach: "",
        envelope: "",
        state: "open" as const,
      },
      {
        requestId: "b",
        route: "",
        service: "",
        asked: "",
        bids: 0,
        reach: "",
        envelope: "",
        state: "no_bids" as const,
      },
      {
        requestId: "c",
        route: "",
        service: "",
        asked: "",
        bids: 1,
        reach: "",
        envelope: "",
        state: "awarded" as const,
      },
    ];
    const stats = monitorStats(rows);
    expect(stats[0]).toMatchObject({
      label: "Open requests",
      value: "2",
      tone: "warn",
    });
    expect(stats[3]).toMatchObject({ value: "3" });
  });
});

describe("timeline mapping", () => {
  it("tones events by type and keeps them append-only in order", () => {
    expect(eventTone("mp.award.confirmed")).toBe("ok");
    expect(eventTone("mp.bid.expired")).toBe("warn");
    expect(eventTone("mp.request.published")).toBe("info");
    const view = toTimelineEvents({
      requestId: "req_001",
      policyVersion: 3,
      events: [
        {
          at: "2026-09-20T10:02:11Z",
          type: "mp.request.published",
          detail: "v1",
        },
        {
          at: "2026-09-20T10:07:19Z",
          type: "mp.award.confirmed",
          detail: "won",
        },
      ],
    });
    expect(view.map((e) => e.at)).toEqual(["10:02:11", "10:07:19"]);
    expect(view[1]?.tone).toBe("ok");
  });
});

describe("policy fields — fail closed", () => {
  it("renders configured bounds per service:vehicleClass pair", () => {
    const { fields, error } = boundsFields(configured);
    expect(error).toBeNull();
    expect(fields.map((f) => f.label)).toEqual(["ride:go", "delivery:moto"]);
    expect(fields[0]?.value).toContain("₦1,200");
    expect(fields.every((f) => f.invalid !== true)).toBe(true);
    expect(canPublishPolicy(configured)).toBe(true);
  });

  it("marks a missing marketplace block invalid and blocks publish", () => {
    const bare: CityConfigView = {
      cityId: "kano",
      version: 1,
      currency: "NGN",
      currencyFractionDigits: 2,
    };
    const { fields, error } = boundsFields(bare);
    expect(fields[0]?.invalid).toBe(true);
    expect(error).toContain("fails closed");
    expect(canPublishPolicy(bare)).toBe(false);
    expect(canPublishPolicy(undefined)).toBe(false);
  });

  it("marks an unconfigured floor invalid and blocks publish", () => {
    const broken: CityConfigView = {
      ...configured,
      marketplace: {
        ...policy,
        fareBounds: {
          "ride:go": {
            absoluteFloorMinor: 0,
            costFloorMinor: 0,
            floorBpsOfSuggested: 0,
            ceilingBpsOfSuggested: 15_000,
          },
        },
      },
    };
    const { fields, error } = boundsFields(broken);
    expect(fields[0]?.invalid).toBe(true);
    expect(fields[0]?.value).toBe("Floor unconfigured");
    expect(error).toContain("publish is blocked");
    expect(canPublishPolicy(broken)).toBe(false);
  });

  it("blocks publish on an empty fareBounds record", () => {
    const empty: CityConfigView = {
      ...configured,
      marketplace: { ...policy, fareBounds: {} },
    };
    expect(canPublishPolicy(empty)).toBe(false);
  });
});

describe("envelopeLine", () => {
  it("renders km, minutes and step", () => {
    expect(
      envelopeLine({ step: 2, radiusMeters: 3_500, pickupEtaSec: 540 }),
    ).toBe("3.5 km · 9 min · step 2");
    expect(envelopeLine(undefined)).toBe("—");
  });
});

describe("ageLine (C08)", () => {
  it("renders seconds, minutes, hours and days at the right breakpoints", () => {
    expect(ageLine(45)).toBe("45s");
    expect(ageLine(125)).toBe("2m 5s");
    expect(ageLine(3_725)).toBe("1h 02m");
    expect(ageLine(90_000)).toBe("1d");
  });
});

describe("outcomeTone (C08)", () => {
  it("maps committed-family outcomes to committed", () => {
    expect(outcomeTone("resolved")).toBe("committed");
    expect(outcomeTone("active")).toBe("committed");
    expect(outcomeTone("committed")).toBe("committed");
  });
  it("maps in-flight outcomes to proposed", () => {
    expect(outcomeTone("deferred")).toBe("proposed");
    expect(outcomeTone("pending_approval")).toBe("proposed");
    expect(outcomeTone("appealed")).toBe("proposed");
  });
  it("maps refusal outcomes to failed", () => {
    expect(outcomeTone("rejected")).toBe("failed");
    expect(outcomeTone("appeal_denied")).toBe("failed");
  });
  it("maps unavailable straight through and everything else to view", () => {
    expect(outcomeTone("unavailable")).toBe("unavailable");
    expect(outcomeTone("something_new")).toBe("view");
  });
});

describe("pctRate (C08)", () => {
  it("formats a fraction as a percentage", () => {
    expect(pctRate(0.5)).toBe("50%");
    expect(pctRate(0)).toBe("0%");
    expect(pctRate(1)).toBe("100%");
  });
});

describe("redactedExport (C08)", () => {
  it("redacts pin/token/secret-shaped keys and keeps everything else", () => {
    const json = redactedExport({
      requestId: "req-1",
      driverPin: "1234",
      accessToken: "abc",
      clientSecret: "xyz",
      ciphertext: "binary",
      nonce: "n",
      amountMinor: 500,
    });
    const parsed = JSON.parse(json);
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.amountMinor).toBe(500);
    expect(parsed.driverPin).toBe("[redacted]");
    expect(parsed.accessToken).toBe("[redacted]");
    expect(parsed.clientSecret).toBe("[redacted]");
    expect(parsed.ciphertext).toBe("[redacted]");
    expect(parsed.nonce).toBe("[redacted]");
  });
});
