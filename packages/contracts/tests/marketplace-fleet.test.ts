import { describe, expect, it } from "vitest";
import {
  ZodArray,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodUnion,
  type ZodTypeAny,
} from "zod";

import { EVENT_NAMES, SUBJECT_TYPES, isKnownEventName } from "../src/events";
import {
  FLEET_FORBIDDEN_FIELD_PATTERNS,
  FLEET_RESPONSE_SCHEMAS,
  FleetMoneySchema,
  MoneyAvailableSchema,
} from "../src/fleet";
import { DENY_ALL, FLAG_KEYS, isEnabled } from "../src/flags";
import {
  FLEET_INTERNAL_ERROR_CODES,
  FLEET_INTERNAL_KEY_MIN_LENGTH,
  MP_OCCUPIED_BLOCK_FIELDS,
  MpAdvanceReservationPolicySchema,
  MpBookingFailureSchema,
  MpBookingPendingChangeSchema,
  MpFleetVehicleAtSchema,
  MpFleetVehicleSchema,
  MpOccupiedBlockSchema,
  MpOffRoadRecordedSchema,
  MpSwapIneligibleSchema,
} from "../src/marketplace";
import { MACHINES, canTransition } from "../src/state-machines";

const block = {
  blockId: "blk_1",
  driverId: "drv_1",
  vehicleId: "veh_1",
  startsAt: "2026-10-01T05:50:00Z",
  endsAt: "2026-10-01T06:40:00Z",
  kind: "booked",
  risk: "at_risk",
  decisionDeadline: "2026-10-01T05:00:00Z",
};

describe("fleet calendar: the opaque OccupiedBlock (FL-6, Q1)", () => {
  it("accepts exactly the listed fields", () => {
    expect(MpOccupiedBlockSchema.parse(block)).toEqual(block);
    expect(Object.keys(MpOccupiedBlockSchema.shape).sort()).toEqual(
      [...MP_OCCUPIED_BLOCK_FIELDS].sort(),
    );
    expect(
      MpOccupiedBlockSchema.safeParse({ ...block, vehicleId: null }).success,
    ).toBe(true);
  });

  it.each([
    ["riderId", "usr_1"],
    ["pickup", { label: "Ikoyi" }],
    ["zone", "Ikoyi"],
    ["fareMinor", { amountMinor: 560000, currency: "NGN" }],
    ["requestId", "req_1"],
    ["bookingId", "bkg_1"],
    ["riderName", null],
  ])("refuses a %s field, even as null", (key, value) => {
    expect(
      MpOccupiedBlockSchema.safeParse({ ...block, [key]: value }).success,
    ).toBe(false);
  });

  it("carries the server's risk only as ok/at_risk", () => {
    expect(
      MpOccupiedBlockSchema.safeParse({ ...block, risk: "lapsed" }).success,
    ).toBe(false);
  });

  it("answers off-road with blocks and deadlines only", () => {
    expect(
      MpOffRoadRecordedSchema.safeParse({
        occupancyId: "occ_1",
        atRiskBookings: [
          { blockId: "blk_1", decisionDeadline: "2026-10-01T05:00:00Z" },
        ],
      }).success,
    ).toBe(true);
    expect(
      MpOffRoadRecordedSchema.safeParse({
        occupancyId: "occ_1",
        atRiskBookings: [
          {
            blockId: "blk_1",
            decisionDeadline: "2026-10-01T05:00:00Z",
            riderId: "usr_1",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("fleet calendar: internal contract A", () => {
  it("names its error codes and a 32-character minimum key", () => {
    expect([...FLEET_INTERNAL_ERROR_CODES]).toEqual([
      "occupancy_conflict",
      "idempotency_conflict",
      "swap_ineligible",
    ]);
    expect(FLEET_INTERNAL_KEY_MIN_LENGTH).toBe(32);
    expect(
      MpSwapIneligibleSchema.safeParse({
        code: "swap_ineligible",
        message: "no",
        details: { reasons: ["class_not_eligible", "documents_expired"] },
      }).success,
    ).toBe(true);
    expect(
      MpSwapIneligibleSchema.safeParse({
        code: "swap_ineligible",
        message: "no",
        details: { reasons: [] },
      }).success,
    ).toBe(false);
  });

  it("holds fleet-service's routes 8 and 9 to exact shapes", () => {
    expect(
      MpFleetVehicleAtSchema.safeParse({
        vehicleId: null,
        assignmentId: null,
        vehicleClass: null,
        capacity: null,
      }).success,
    ).toBe(true);
    expect(
      MpFleetVehicleAtSchema.safeParse({
        vehicleId: "veh_1",
        assignmentId: "asg_1",
        vehicleClass: "go",
        capacity: 4,
        plate: "LAG-118-AB",
      }).success,
    ).toBe(false);
    const vehicle = {
      vehicleId: "veh_1",
      fleetId: "flt_1",
      classes: ["go"],
      capacity: 4,
      documents: { insuranceExpiry: "2027-01-31", inspectionExpiry: null },
    };
    expect(MpFleetVehicleSchema.safeParse(vehicle).success).toBe(true);
    expect(
      MpFleetVehicleSchema.safeParse({
        ...vehicle,
        documents: { ...vehicle.documents, insuranceExpiry: "soon" },
      }).success,
    ).toBe(false);
  });
});

describe("fleet calendar: what the booking's parties see", () => {
  it("D1: a vehicle change is same driver, fare unchanged, by consent", () => {
    const change = {
      changeId: "swp_1",
      kind: "vehicle_swap",
      sameDriver: true,
      from: { label: "Go · 4 seats", classes: ["go"], capacity: 4 },
      to: { label: "Comfort · 4 seats", classes: ["comfort"], capacity: 4 },
      fareMinor: { amountMinor: 560000, currency: "NGN" },
      fareUnchanged: true,
      expiresAt: "2026-10-01T05:00:00Z",
      notice: "Nothing changes unless you confirm, and cancelling is free.",
    };
    expect(MpBookingPendingChangeSchema.safeParse(change).success).toBe(true);
    expect(
      MpBookingPendingChangeSchema.safeParse({
        ...change,
        fareUnchanged: false,
      }).success,
    ).toBe(false);
    expect(
      MpBookingPendingChangeSchema.safeParse({ ...change, sameDriver: false })
        .success,
    ).toBe(false);
  });

  it("D2: a lapsed risk fails as risk_unresolved; driverLost is optional", () => {
    const failure = {
      reason: "risk_unresolved",
      message: "Your driver can't make this trip.",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
      rematchAvailable: false,
    };
    expect(MpBookingFailureSchema.safeParse(failure).success).toBe(true);
    expect(
      MpBookingFailureSchema.safeParse({ ...failure, driverLost: true })
        .success,
    ).toBe(true);
  });

  it("allows riskResolutionLeadSec above minLeadSec within [activationLeadSec, bookingHorizonSec)", () => {
    const policy = {
      bookingHorizonSec: 604_800,
      minLeadSec: 10_800,
      offerWindowSec: 3_600,
      bidExpirySec: 3_600,
      defaultWindowSec: 600,
      minWindowSec: 300,
      maxWindowSec: 1_800,
      fundingHorizonSec: 172_800,
      fundingDeadlineSec: 7_200,
      reconfirmOpensSec: 7_200,
      reconfirmDeadlineSec: 2_700,
      activationLeadSec: 1_800,
      preBufferSec: 600,
      postBufferSec: 600,
      reminderOffsetsSec: [43_200, 3_600],
      maxOpenPerRequester: 5,
    };
    expect(MpAdvanceReservationPolicySchema.safeParse(policy).success).toBe(
      true,
    );
    expect(
      MpAdvanceReservationPolicySchema.safeParse({
        ...policy,
        riskResolutionLeadSec: 1_800,
      }).success,
    ).toBe(true);
    expect(
      MpAdvanceReservationPolicySchema.safeParse({
        ...policy,
        riskResolutionLeadSec: 10_800 + 900,
      }).success,
    ).toBe(true);
    expect(
      MpAdvanceReservationPolicySchema.safeParse({
        ...policy,
        riskResolutionLeadSec: 1_799,
      }).success,
    ).toBe(false);
    expect(
      MpAdvanceReservationPolicySchema.safeParse({
        ...policy,
        riskResolutionLeadSec: 604_800,
      }).success,
    ).toBe(false);
    expect(
      MpAdvanceReservationPolicySchema.safeParse({
        ...policy,
        riskResolutionLeadSec: 0,
      }).success,
    ).toBe(false);
  });
});

describe("fleet calendar: catalog, flags and machines", () => {
  it("registers ride-service's fleet-calendar events and subjects", () => {
    for (const name of [
      "mp.advance_booking.risk_changed",
      "mp.advance_booking.rematch_declined",
      "mp.vehicle_swap.proposed",
      "mp.vehicle_swap.driver_accepted",
      "mp.vehicle_swap.driver_declined",
      "mp.vehicle_swap.revalidation_failed",
      "mp.vehicle_swap.rider_consent_requested",
      "mp.vehicle_swap.applied",
      "mp.vehicle_swap.rider_declined",
      "mp.vehicle_swap.expired",
      "mp.vehicle_swap.cancelled",
      "vehicle_occupancy.recorded",
      "vehicle_occupancy.released",
      "vehicle_occupancy.moved",
      "vehicle_occupancy.offroad_use_flagged",
    ]) {
      expect(isKnownEventName(name), name).toBe(true);
    }
    for (const subject of ["mp_vehicle_swap", "vehicle_occupancy"]) {
      expect(SUBJECT_TYPES).toContain(subject);
    }
  });

  it("registers exactly the fleet-service events the lead passes on", () => {
    const fleetService = [
      "fleet.conflict.opened",
      "fleet.conflict.resolved",
      "fleet.conflict.lapsed",
      "maintenance.status.changed",
      "assignment.proposal.status.changed",
      "vehicle.document.expiring",
      "fleet.offroad.reported",
    ];
    for (const name of fleetService) {
      expect(isKnownEventName(name), name).toBe(true);
    }
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("keeps the fleet calendar and vehicle swaps deny-by-default", () => {
    for (const key of ["fleet", "marketplace_booking_vehicle_swaps"] as const) {
      expect(FLAG_KEYS).toContain(key);
      expect(isEnabled(undefined, key)).toBe(false);
      expect(isEnabled(DENY_ALL, key)).toBe(false);
    }
  });

  it("only resolves a swap through driver, server and rider", () => {
    expect(MACHINES.mpVehicleSwap.initial).toBe("proposed");
    expect(canTransition("mpVehicleSwap", "proposed", "applied")).toBe(false);
    expect(
      canTransition(
        "mpVehicleSwap",
        "driver_accepted",
        "rider_consent_pending",
      ),
    ).toBe(false);
    expect(
      canTransition("mpVehicleSwap", "rider_consent_pending", "applied"),
    ).toBe(true);
    expect(canTransition("mpBookingRisk", "ok", "lapsed")).toBe(false);
    expect(canTransition("mpBookingRisk", "at_risk", "lapsed")).toBe(true);
    expect(canTransition("mpVehicleOccupancy", "released", "active")).toBe(
      false,
    );
  });
});

function keysOf(schema: ZodTypeAny, path: string, out: string[]): void {
  if (schema instanceof ZodObject) {
    for (const [key, child] of Object.entries(
      schema.shape as Record<string, ZodTypeAny>,
    )) {
      out.push(`${path}.${key}`);
      keysOf(child, `${path}.${key}`, out);
    }
  } else if (schema instanceof ZodArray) {
    keysOf(schema.element as ZodTypeAny, `${path}[]`, out);
  } else if (
    schema instanceof ZodNullable ||
    schema instanceof ZodOptional ||
    schema instanceof ZodDefault
  ) {
    keysOf(schema._def.innerType as ZodTypeAny, path, out);
  } else if (
    schema instanceof ZodUnion ||
    schema instanceof ZodDiscriminatedUnion
  ) {
    for (const option of schema.options as ZodTypeAny[]) {
      keysOf(option, path, out);
    }
  } else if (schema instanceof ZodEffects) {
    keysOf(schema._def.schema as ZodTypeAny, path, out);
  } else if (schema instanceof ZodRecord) {
    keysOf(schema._def.valueType as ZodTypeAny, `${path}{}`, out);
  }
}

describe("fleet money & privacy walk (Q7, DEC-9 = A)", () => {
  it("accepts available:false and available:true with the four Q7 fields + asOf + excludes, and rejects driverNet", () => {
    expect(
      FleetMoneySchema.safeParse({
        available: false,
        reason: "payment-service unavailable",
        source: "payment-service remittance settlement (internal contract B)",
      }).success,
    ).toBe(true);

    const available = {
      available: true as const,
      asOf: "2026-10-05T08:00:00.000Z",
      excludes: ["cash_fares", "tips"] as const,
      weekStart: "2026-09-28",
      weekEnd: "2026-10-04",
      weekGross: { amountMinor: 18_450_000, currency: "NGN" },
      ubiCommission: { amountMinor: 1_845_000, currency: "NGN" },
      fleetRemittance: { amountMinor: 4_500_000, currency: "NGN" },
      remittanceStatus: "Settled",
      remittance: {
        due: { amountMinor: 4_500_000, currency: "NGN" },
        collected: { amountMinor: 4_500_000, currency: "NGN" },
        shortfall: { amountMinor: 0, currency: "NGN" },
        carried: { amountMinor: 0, currency: "NGN" },
        refunded: { amountMinor: 0, currency: "NGN" },
      },
    };
    expect(FleetMoneySchema.safeParse(available).success).toBe(true);
    expect(
      FleetMoneySchema.safeParse({
        ...available,
        driverNet: { amountMinor: 12_105_000, currency: "NGN" },
      }).success,
    ).toBe(false);
  });

  it("walks every FLEET_RESPONSE_SCHEMAS entry and rejects any driverNet or perTrip field (negative control)", () => {
    const violations: string[] = [];
    for (const [name, schema] of Object.entries(FLEET_RESPONSE_SCHEMAS)) {
      const keys: string[] = [];
      keysOf(schema as ZodTypeAny, name, keys);
      expect(keys.length, name).toBeGreaterThan(0);
      for (const key of keys) {
        const leaf =
          key
            .split(".")
            .pop()
            ?.replace(/[[\]{}]/g, "") ?? "";
        if (
          FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(leaf))
        ) {
          violations.push(key);
        }
      }
    }
    expect(violations).toEqual([]);

    // Negative control: adding driverNet or perTripSplit to MoneyAvailableSchema fails the walk.
    const probeSchema = MoneyAvailableSchema.extend({
      driverNet: MoneyAvailableSchema.shape.weekGross,
      perTripSplit: MoneyAvailableSchema.shape.weekGross,
    });
    const probeKeys: string[] = [];
    keysOf(probeSchema, "MoneyAvailableProbe", probeKeys);
    const probeViolations = probeKeys.filter((key) => {
      const leaf =
        key
          .split(".")
          .pop()
          ?.replace(/[[\]{}]/g, "") ?? "";
      return FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) =>
        pattern.test(leaf),
      );
    });
    expect(probeViolations).toEqual([
      "MoneyAvailableProbe.driverNet",
      "MoneyAvailableProbe.perTripSplit",
    ]);
  });
});
