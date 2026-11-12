/**
 * Notification Copy Deck Coverage & Privacy Tests (`CC-C05` / `P1-06`).
 *
 * Verifies:
 *   1. Every event in the D3 copy deck (`docs/design/NOTIFICATIONS_AND_OPS_BRIEF.md` §1.3)
 *      has a spec in `NOTIFICATION_SPECS` and defines copy rules for every
 *      required audience role.
 *   2. Every `fleet.conflict.opened` conflict type produces distinct,
 *      role-appropriate copy for `driver` vs `fleet_owner`/`fleet_manager`,
 *      and `document_expiring` + `vehicle_service_requested` never notify the
 *      driver.
 *   3. `vehicle.document.expiring` produces distinct lead-time copy for
 *      `thresholdDays` (`30`, `14`, `7`, `1`) and `booking_after_expiry`, with
 *      SMS fallback only on `1` day or `booking_after_expiry`.
 *   4. No copy output or hint payload ever leaks another person's PII or
 *      money figures.
 *   5. Negative control: removing any event or role from a copy of
 *      `NOTIFICATION_SPECS` causes `validateCopyDeckCoverage` to fail.
 */
import { describe, expect, it } from "vitest";

import { addressedRoles, buildHintData } from "./audience.js";
import {
  COPY_DECK_REQUIREMENTS,
  NOTIFICATION_SPECS,
  validateCopyDeckCoverage,
} from "./specs.js";

import type { NotificationSpec } from "./audience.js";
import type { EventEnvelope } from "@ubi/contracts";

function makeEnvelope(
  name: string,
  payload: Record<string, unknown>,
): EventEnvelope {
  return {
    id: "evt_deck_1",
    name,
    version: 1,
    occurredAt: "2026-10-01T10:00:00.000Z",
    actor: { type: "system", id: "fleet-service" },
    subject: { type: "fleet_conflict", id: "fcf_1" },
    idempotencyKey: `deck:${name}`,
    fromVersion: null,
    toVersion: 1,
    cityId: "LOS",
    payload: {
      fleetId: "flt_1",
      driverId: "drv_1",
      requesterId: "rdr_1",
      senderId: "snd_1",
      vehicleId: "veh_1",
      fareMinor: 420_000,
      commissionMinor: 42_000,
      passengerFirstName: "Chinedu",
      passengerPhone: "+2348091234567",
      ...payload,
    },
  };
}

describe("D3 notification copy deck coverage (P1-06)", () => {
  it("passes full copy-deck coverage validation for NOTIFICATION_SPECS", () => {
    const result = validateCopyDeckCoverage(NOTIFICATION_SPECS);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("negative control: deleting any required event or role from NOTIFICATION_SPECS fails coverage validation", () => {
    for (const [eventName, roles] of Object.entries(COPY_DECK_REQUIREMENTS)) {
      const withoutEvent = { ...NOTIFICATION_SPECS };
      delete withoutEvent[eventName];
      const missingEventResult = validateCopyDeckCoverage(withoutEvent);
      expect(missingEventResult.ok).toBe(false);
      expect(missingEventResult.missing).toContain(
        `${eventName} (missing spec)`,
      );

      for (const role of roles) {
        const spec = NOTIFICATION_SPECS[eventName]!;
        const mutatedCopy = { ...spec.copy };
        delete mutatedCopy[role];
        const mutatedSpecs: Record<string, NotificationSpec> = {
          ...NOTIFICATION_SPECS,
          [eventName]: {
            ...spec,
            copy: mutatedCopy,
          },
        };
        const missingRoleResult = validateCopyDeckCoverage(mutatedSpecs);
        expect(missingRoleResult.ok).toBe(false);
        expect(missingRoleResult.missing).toContain(`${eventName}:${role}`);
      }
    }
  });

  it("produces conflict-specific copy across all 7 conflict types without leaking PII or money", () => {
    const spec = NOTIFICATION_SPECS["fleet.conflict.opened"]!;

    const actionableTypes = [
      {
        type: "unplanned_off_road",
        driverSnippet: "reported off-road",
        fleetSnippet: "off-road vehicle overlaps",
      },
      {
        type: "maintenance_overlaps_booking",
        driverSnippet: "Planned maintenance overlaps",
        fleetSnippet: "maintenance block overlaps",
      },
      {
        type: "document_expires_in_booking",
        driverSnippet: "expires before your reserved job",
        fleetSnippet: "expires before an upcoming booking",
      },
      {
        type: "time_off_overlaps_booking",
        driverSnippet: "time-off window overlaps",
        fleetSnippet: "driver is resolving a conflict",
      },
      {
        type: "termination_bookings",
        driverSnippet: "arrangement ends before",
        fleetSnippet: "notice period ends before",
      },
    ] as const;

    for (const entry of actionableTypes) {
      const env = makeEnvelope("fleet.conflict.opened", { type: entry.type });
      const roles = addressedRoles(env, spec);
      const driverCopy = roles.find((r) => r.role === "driver")?.copy;
      const ownerCopy = roles.find((r) => r.role === "fleet_owner")?.copy;
      const managerCopy = roles.find((r) => r.role === "fleet_manager")?.copy;

      expect(driverCopy?.body).toContain(entry.driverSnippet);
      expect(ownerCopy?.body).toContain(entry.fleetSnippet);
      expect(managerCopy?.body).toContain(entry.fleetSnippet);

      const serialized = JSON.stringify({
        roles,
        hint: buildHintData(env),
      });
      expect(serialized).not.toContain("420000");
      expect(serialized).not.toContain("42000");
      expect(serialized).not.toContain("Chinedu");
      expect(serialized).not.toContain("+2348091234567");
    }

    // Fleet-only conflict types never address the driver:
    for (const fleetOnlyType of [
      "document_expiring",
      "vehicle_service_requested",
    ] as const) {
      const env = makeEnvelope("fleet.conflict.opened", {
        type: fleetOnlyType,
      });
      const roles = addressedRoles(env, spec);
      expect(roles.find((r) => r.role === "driver")).toBeUndefined();
      expect(roles.find((r) => r.role === "fleet_owner")).toBeDefined();
      expect(roles.find((r) => r.role === "fleet_manager")).toBeDefined();
    }
  });

  it("renders lead-time and booking-overlap variants for vehicle.document.expiring", () => {
    const spec = NOTIFICATION_SPECS["vehicle.document.expiring"]!;

    for (const [days, expectedPhrase, expectSms] of [
      [30, "in 30 days", false],
      [14, "in 14 days", false],
      [7, "in 7 days", false],
      [1, "in 1 day", true],
    ] as const) {
      const env = makeEnvelope("vehicle.document.expiring", {
        reason: "threshold",
        thresholdDays: days,
      });
      const roles = addressedRoles(env, spec);
      expect(roles.map((r) => r.role)).toEqual([
        "fleet_owner",
        "fleet_manager",
      ]);
      expect(roles[0]?.copy.body).toContain(expectedPhrase);
      const sms =
        typeof spec.smsFallback === "function"
          ? spec.smsFallback(env)
          : Boolean(spec.smsFallback);
      expect(sms).toBe(expectSms);
    }

    const bookingOverlapEnv = makeEnvelope("vehicle.document.expiring", {
      reason: "booking_after_expiry",
    });
    const overlapRoles = addressedRoles(bookingOverlapEnv, spec);
    expect(overlapRoles[0]?.copy.body).toContain(
      "expires before an upcoming booking",
    );
    const overlapSms =
      typeof spec.smsFallback === "function"
        ? spec.smsFallback(bookingOverlapEnv)
        : Boolean(spec.smsFallback);
    expect(overlapSms).toBe(true);
  });
});
