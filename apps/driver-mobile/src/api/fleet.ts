// The driver's side of the fleet vertical (A05, handoff C1–C5) against fleet-service
// THROUGH the gateway. Paths follow contracts/openapi/fleet.yaml; DTO shapes are the
// zod schemas in @ubi/contracts (packages/contracts/src/fleet.ts), inferred here so a
// screen can never drift from the server contract. Every route is behind the city's
// deny-by-default `fleet` flag (404 feature_disabled when off) and needs the
// gateway's `fleet:driver` scope.
//
// Money arrives as server Money objects and is rendered verbatim (MoneyText). The one
// reshaping is `remittanceOf`: a signed terms snapshot carries its weekly amount and
// currency as two sibling fields, which it pairs into the Money object MoneyText
// takes — no arithmetic, no rounding, no default currency.
//
// Every state-changing call takes a CALLER-HELD Idempotency-Key (lib/idempotency.ts)
// so a retry after a dropped response replays the server's first answer.
import { api, type Money } from "@ubi/mobile-core";
import type { z } from "zod";
import type {
  AssignmentTermsSchema,
  AvailabilityPreviewViewSchema,
  AvailabilitySavedViewSchema,
  DeclineOfferViewSchema,
  DriverArrangementListSchema,
  DriverConflictViewSchema,
  DriverOfferListSchema,
  DriverOfferViewSchema,
  DriverScheduleSchema,
  SignOfferViewSchema,
} from "@ubi/contracts";

export type FleetSchedule = z.infer<typeof DriverScheduleSchema>;
export type FleetScheduleItem = FleetSchedule["items"][number];
export type FleetOffer = z.infer<typeof DriverOfferViewSchema>;
export type FleetOfferList = z.infer<typeof DriverOfferListSchema>;
export type FleetTerms = z.infer<typeof AssignmentTermsSchema>;
export type FleetSignedOffer = z.infer<typeof SignOfferViewSchema>;
export type FleetDeclinedOffer = z.infer<typeof DeclineOfferViewSchema>;
export type FleetArrangementList = z.infer<typeof DriverArrangementListSchema>;
export type FleetArrangement = FleetArrangementList["arrangements"][number];
export type FleetConflict = z.infer<typeof DriverConflictViewSchema>;
export type FleetConflictOption = FleetConflict["options"][number];
export type FleetAvailabilityPreview = z.infer<
  typeof AvailabilityPreviewViewSchema
>;
export type FleetAvailabilitySaved = z.infer<
  typeof AvailabilitySavedViewSchema
>;

/** A driver-authored window (contracts AvailabilityWindowInputSchema). */
export type FleetWindowInput = {
  kind: "available" | "time_off";
  startsAt: string;
  endsAt: string;
  rrule?: string;
};

export type VehicleIssueSeverity = "cannot_drive" | "service_soon";

/**
 * `POST /v1/drivers/me/vehicle-issues` answer. Mirrors
 * services/fleet-service/src/vehicle-issue-contract.ts until the lead folds that
 * schema into @ubi/contracts (then this becomes a z.infer like the rest).
 */
export type VehicleIssueView = {
  issueId: string;
  severity: VehicleIssueSeverity;
  vehicleId: string;
  reportedAt: string;
  fleetAlerted: true;
  block: {
    blockId: string;
    kind: "unplanned_off_road";
    status: "active" | "completed";
    startsAt: string;
    endsAt: string | null;
  } | null;
  /** The reporting driver's own bookings now at risk, with the server's deadline. */
  decisions: { conflictId: string; deadlineAt: string | null }[];
  remittanceEffect: "signed_terms_shortfall_rule" | "none";
};

/** The weekly_fixed remittance as a Money object (pairing server fields only). */
export const remittanceOf = (terms: FleetTerms): Money | null =>
  terms.type === "weekly_fixed" && terms.amountMinor !== null
    ? { amountMinor: terms.amountMinor, currency: terms.currency }
    : null;

const enc = encodeURIComponent;

export const fleetApi = {
  // C1 — one server-composed agenda (fleet-owned data + the driver's own bookings).
  schedule: () => api<FleetSchedule>("GET", "/v1/drivers/me/schedule"),
  // The same agenda over an explicit range (the server allows at most 31 days). C4
  // reads further ahead than C1's default week to find time off saved earlier.
  scheduleBetween: (from: string, to: string) =>
    api<FleetSchedule>(
      "GET",
      "/v1/drivers/me/schedule?from=" + enc(from) + "&to=" + enc(to),
    ),
  // C2 — pending proposals with the terms diff and UBI's check.
  offers: () => api<FleetOfferList>("GET", "/v1/drivers/me/fleet-offers"),
  // The PIN goes to fleet-service once, which relays it to user-service's wallet-PIN
  // check; it is never stored, logged or part of the idempotency fingerprint.
  signOffer: (offerId: string, pin: string, idempotencyKey: string) =>
    api<FleetSignedOffer>(
      "POST",
      "/v1/fleet-offers/" + enc(offerId) + "/sign",
      { pin },
      { idempotencyKey },
    ),
  // Declining takes no reason at all (no penalty, the fleet sees "declined" only).
  declineOffer: (offerId: string, idempotencyKey: string) =>
    api<FleetDeclinedOffer>(
      "POST",
      "/v1/fleet-offers/" + enc(offerId) + "/decline",
      undefined,
      { idempotencyKey },
    ),
  arrangements: () => api<FleetArrangementList>("GET", "/v1/drivers/me/fleet"),
  // C3 — the driver's own conflict with its options and server-explained outcomes.
  conflict: (conflictId: string) =>
    api<FleetConflict>("GET", "/v1/drivers/me/conflicts/" + enc(conflictId)),
  // C4 — a read (what the change WOULD do); api() still stamps a key on every POST,
  // which the preview route ignores.
  previewAvailability: (windows: FleetWindowInput[]) =>
    api<FleetAvailabilityPreview>(
      "POST",
      "/v1/drivers/me/availability:preview",
      { windows },
    ),
  saveAvailability: (
    body: {
      windows: FleetWindowInput[];
      withdrawals: string[];
      previewToken: string;
    },
    idempotencyKey: string,
  ) =>
    api<FleetAvailabilitySaved>("PUT", "/v1/drivers/me/availability", body, {
      idempotent: true,
      idempotencyKey,
    }),
  // C5 — the assigned driver reports a breakdown or a service need.
  reportVehicleIssue: (
    body: { vehicleId: string; severity: VehicleIssueSeverity; note?: string },
    idempotencyKey: string,
  ) =>
    api<VehicleIssueView>("POST", "/v1/drivers/me/vehicle-issues", body, {
      idempotencyKey,
    }),
};
