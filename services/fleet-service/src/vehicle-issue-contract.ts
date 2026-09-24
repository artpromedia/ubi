/**
 * The driver's vehicle-problem report (handoff C5 ReportVehicleIssue; FL-11;
 * docs/design/FLEET_CALENDAR_DECISIONS.md Q5 and Q8):
 *
 *   POST /v1/drivers/me/vehicle-issues   Idempotency-Key   gateway scope fleet:driver
 *
 * Kept here, next to its only server, until the lead folds it into
 * packages/contracts/src/fleet.ts (with FLEET_RESPONSE_SCHEMAS and the
 * privacy walk) — the same one-line switch as src/contract.ts. It depends on
 * nothing but zod.
 *
 * The response carries ids, codes and times only: the block the report put on
 * the vehicle (cannot_drive), and the reporting driver's OWN booking decisions
 * it opened. Another driver's bookings on the same vehicle never appear, and
 * no field names a rider, a place, a fare or a driver's net.
 */
import { z } from "zod";

const Timestamp = z.string().datetime({ offset: true });

export const VEHICLE_ISSUE_SEVERITIES = [
  "cannot_drive",
  "service_soon",
] as const;
export type VehicleIssueSeverity = (typeof VEHICLE_ISSUE_SEVERITIES)[number];

/**
 * How the report counts toward the driver's remittance. A breakdown is NOT
 * pro-rated (decisions Q8): its hours follow the signed terms' shortfall /
 * carry-forward rule. A service request changes nothing.
 */
export const VEHICLE_ISSUE_REMITTANCE_EFFECTS = [
  "signed_terms_shortfall_rule",
  "none",
] as const;

export const ReportVehicleIssueSchema = z
  .object({
    vehicleId: z.string().min(1),
    severity: z.enum(VEHICLE_ISSUE_SEVERITIES),
    /** Shown to the fleet on the off-road block; never put in an event. */
    note: z.string().trim().max(280).optional(),
  })
  .strict();
export type ReportVehicleIssue = z.infer<typeof ReportVehicleIssueSchema>;

export const VehicleIssueViewSchema = z.object({
  issueId: z.string(),
  severity: z.enum(VEHICLE_ISSUE_SEVERITIES),
  vehicleId: z.string(),
  reportedAt: Timestamp,
  /** The fleet was alerted in the same unit of work (`fleet.alert`). */
  fleetAlerted: z.literal(true),
  /** cannot_drive: the ACTIVE unplanned_off_road block. service_soon: null. */
  block: z
    .object({
      blockId: z.string(),
      kind: z.literal("unplanned_off_road"),
      status: z.enum(["active", "completed"]),
      startsAt: Timestamp,
      /** Null until the fleet marks the vehicle back on the road. */
      endsAt: Timestamp.nullable(),
    })
    .nullable(),
  /** The reporting driver's own bookings now at risk, with the server's deadline. */
  decisions: z.array(
    z.object({ conflictId: z.string(), deadlineAt: Timestamp.nullable() }),
  ),
  remittanceEffect: z.enum(VEHICLE_ISSUE_REMITTANCE_EFFECTS),
});
export type VehicleIssueView = z.infer<typeof VehicleIssueViewSchema>;
