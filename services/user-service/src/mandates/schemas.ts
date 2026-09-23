/**
 * Request shapes for the mandate surface, mirroring contracts/openapi/mandates.yaml.
 *
 * The action allow-list is a hard boundary (CLAUDE.md #18-19): only ride/travel
 * standing authorisations are mandate-able. P2P transfers, account
 * administration and campaign actions are NOT — they are refused with 422 and
 * routed to their conventional flow elsewhere.
 */
import { z } from "zod";

import { MoneySchema } from "@ubi/contracts";

export const MANDATE_ACTIONS = [
  "airport_pickup.reserve",
  "flight.rebook_on_cancel",
  "scheduled_ride.book",
  // Marketplace (recheck A03 / P02): NEW members, appended — never a
  // reinterpretation of the travel actions above. A travel mandate grants no
  // marketplace authority; only these authorise an unattended marketplace
  // selection (ask-service ops/mandate-scope.ts), one service each.
  "marketplace.ride.select",
  "marketplace.delivery.select",
] as const;
export type MandateAction = (typeof MANDATE_ACTIONS)[number];

const MANDATE_ACTION_SET: ReadonlySet<string> = new Set(MANDATE_ACTIONS);

export function isMandateAction(action: string): action is MandateAction {
  return MANDATE_ACTION_SET.has(action);
}

/**
 * The actions an external trigger may RUN through `/internal/mandates/:id/run`
 * (the travel runner). Marketplace mandates are executed only by ask-service's
 * selection, against a live offer, so a run of one is refused.
 */
export const RUNNABLE_MANDATE_ACTIONS = [
  "airport_pickup.reserve",
  "flight.rebook_on_cancel",
  "scheduled_ride.book",
] as const satisfies readonly MandateAction[];

const RUNNABLE_ACTION_SET: ReadonlySet<string> = new Set(
  RUNNABLE_MANDATE_ACTIONS,
);

export function isRunnableMandateAction(action: string): boolean {
  return RUNNABLE_ACTION_SET.has(action);
}

export const CONSTRAINT_MODES = ["always_ask", "ask", "allow"] as const;

/**
 * Constraint keys whose `values` the server can check against a marketplace
 * selection (ask-service ops/mandate-scope.ts). `time_window` values are
 * `HH:MM-HH:MM` in the city's local time (a window may wrap midnight); the
 * others are opaque ids. Any other key is a free-form condition, as before.
 */
export const TYPED_CONSTRAINT_KEYS = [
  "city",
  "vehicle_class",
  "time_window",
  "pickup_area",
  "dropoff_area",
  "route",
] as const;

export const TIME_WINDOW_PATTERN =
  /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const CapMoneySchema = MoneySchema.extend({
  amountMinor: z.number().int().min(1),
});

const ConstraintSchema = z.object({
  key: z.string().min(1).max(80),
  mode: z.enum(CONSTRAINT_MODES),
  /** Permitted values for a typed key (additive; absent = no value list). */
  values: z.array(z.string().min(1).max(80)).min(1).max(20).optional(),
});

export const PeriodCapSchema = z.object({
  amount: CapMoneySchema,
  runs: z.number().int().min(1),
  period: z.literal("month"),
});

/**
 * The full editable shape of a mandate. `action` is validated against the
 * allow-list in the handler (not the schema) so a well-formed but forbidden
 * action returns a clear 422 rather than an opaque enum error.
 */
export const MandateInputSchema = z.object({
  action: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  passengers: z.enum(["self_only", "saved_passengers"]),
  categories: z.array(z.string().min(1).max(60)).min(1),
  providers: z.array(z.string().min(1).max(120)).optional(),
  perRunCap: CapMoneySchema,
  periodCap: PeriodCapSchema,
  maxPriceVariance: MoneySchema.extend({
    amountMinor: z.number().int().min(0),
  }).optional(),
  expiresAt: z.string().datetime({ offset: true }),
  constraints: z.array(ConstraintSchema),
});
export type MandateInput = z.infer<typeof MandateInputSchema>;

/** Edit and revoke require assurance; pause and resume do not (contract). */
export const AssuranceSchema = z.object({
  method: z.enum(["pin", "biometric"]),
  proof: z.string().min(1).max(4096),
});
export type Assurance = z.infer<typeof AssuranceSchema>;

export const MandatePatchSchema = z.object({
  op: z.enum(["edit", "pause", "resume", "revoke"]),
  changes: MandateInputSchema.optional(),
  assurance: AssuranceSchema.optional(),
});
export type MandatePatch = z.infer<typeof MandatePatchSchema>;

/**
 * A single mandate run, posted by the mandate runner / travel-service when an
 * external event (a flight cancellation, an inbound flight landing) fires.
 * `price` is the amount to authorise for this run; `conditions` are the
 * constraint keys observed to hold, so the server can decide whether a
 * configured `ask` means "stop and ask the human".
 */
export const MandateRunSchema = z.object({
  triggerRef: z.string().min(1).max(200),
  price: MoneySchema.extend({ amountMinor: z.number().int().min(0) }),
  referenceMinor: z.number().int().min(0).optional(),
  provider: z.string().min(1).max(120).optional(),
  resourceRef: z.string().min(1).max(200),
  termsVersion: z.string().min(1).max(60),
  conditions: z.array(z.string().min(1).max(80)).optional(),
  grantExpiresAt: z.string().datetime({ offset: true }).optional(),
  triggeredBy: z.string().min(1).max(120).optional(),
});
export type MandateRunInput = z.infer<typeof MandateRunSchema>;
