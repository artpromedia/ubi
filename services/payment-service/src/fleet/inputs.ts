/**
 * INTERNAL CONTRACT B — fleet-service → payment-service settlement inputs.
 *
 * payment-service is the CONSUMER; fleet-service serves it. The wire shape is
 * the exact text both sides test against (packages/contracts/src/fleet.ts
 * `SettlementInputsResponseSchema`, mirrored here so this service does not
 * depend on a module the contracts barrel does not export yet):
 *
 *   GET /internal/fleet/settlement-inputs?weekStart=YYYY-MM-DD&cityId=…
 *   X-Service-Key: FLEET_PAYMENT_SERVICE_KEY
 *   → 200 { weekStart, weekEnd, zone, items: [{ assignmentId, fleetId,
 *       driverId, vehicleId, termsVersion,
 *       terms: { type: "weekly_fixed" | "percent_of_net",
 *                amountMinor: number | null, currency,
 *                percent: number | null,
 *                shortfall: { policy: "carry_forward", maxWeeks } },
 *       shiftHoursInWeek, plannedMaintenanceHoursInWeek,
 *       unplannedOffRoadHoursInWeek, activeFrom, activeTo: string | null }] }
 *
 * Hours are decimal hours (2 dp) fleet-service computes from SIGNED shift
 * intervals intersected with the week and with maintenance blocks (planned =
 * planned_service | inspection | repair; unplanned = off-road). Terms are the
 * version SIGNED for that week.
 *
 * FAIL CLOSED, every way: no base URL, or a key shorter than 32 characters,
 * refuses before any request is sent; a transport failure, a non-2xx answer
 * or a body that is not exactly the contract refuses with
 * `service_unavailable` — and nothing settles on inputs that did not verify.
 * The key is presented in `X-Service-Key`; fleet-service compares it in
 * constant time.
 */
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { addDays, isIsoDate, isLinkId, isMonday } from "./model";

export const SETTLEMENT_INPUTS_PATH = "/internal/fleet/settlement-inputs";
export const FLEET_SERVICE_KEY_HEADER = "X-Service-Key";

/** The shared secret's floor (contract B: ≥ 32 characters). */
export const MIN_FLEET_KEY_LENGTH = 32;

const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIsoDate, "not a real calendar date");
const Timestamp = z.string().datetime({ offset: true });
const Currency = z.string().regex(/^[A-Z]{3}$/);

export const SettlementInputItemSchema = z.object({
  assignmentId: z.string().min(1),
  fleetId: z.string().min(1),
  driverId: z.string().min(1),
  vehicleId: z.string().min(1),
  termsVersion: z.number().int().positive(),
  terms: z.object({
    type: z.enum(["weekly_fixed", "percent_of_net"]),
    amountMinor: z.number().int().positive().nullable(),
    currency: Currency,
    percent: z.number().positive().max(100).nullable(),
    shortfall: z.object({
      policy: z.literal("carry_forward"),
      maxWeeks: z.number().int().positive(),
    }),
  }),
  shiftHoursInWeek: z.number().nonnegative(),
  plannedMaintenanceHoursInWeek: z.number().nonnegative(),
  unplannedOffRoadHoursInWeek: z.number().nonnegative(),
  activeFrom: Timestamp,
  activeTo: Timestamp.nullable(),
});
export type SettlementInputItem = z.infer<typeof SettlementInputItemSchema>;

export const SettlementInputsResponseSchema = z.object({
  weekStart: LocalDate,
  weekEnd: LocalDate,
  zone: z.string().min(1),
  items: z.array(SettlementInputItemSchema),
});
export type SettlementInputs = z.infer<typeof SettlementInputsResponseSchema>;

/** What the settlement run asks of fleet-service. Injected, so tests can wire a real double. */
export interface SettlementInputsClient {
  fetchInputs(cityId: string, weekStart: string): Promise<SettlementInputs>;
}

function unavailable(
  reason: string,
  details: Readonly<Record<string, unknown>> = {},
): ContractError {
  return new ContractError(
    "service_unavailable",
    "fleet settlement inputs are unavailable; nothing was settled — retry",
    { reason, ...details },
  );
}

/**
 * The answer's envelope must be the week that was asked for, in the city's
 * zone: a mismatch would settle the wrong week, so it refuses the whole
 * answer. Per-item rules (ids, currency, terms shape) are checked item by
 * item in the settlement, so one bad row refuses that row only.
 */
export function assertInputsEnvelope(
  inputs: SettlementInputs,
  expected: { readonly weekStart: string; readonly timezone: string },
): void {
  if (inputs.weekStart !== expected.weekStart) {
    throw unavailable("fleet_inputs_wrong_week", {
      asked: expected.weekStart,
      answered: inputs.weekStart,
    });
  }
  if (inputs.weekEnd !== addDays(expected.weekStart, 6)) {
    throw unavailable("fleet_inputs_wrong_week_end", {
      weekStart: inputs.weekStart,
      weekEnd: inputs.weekEnd,
    });
  }
  if (inputs.zone !== expected.timezone) {
    throw unavailable("fleet_inputs_zone_mismatch", {
      zone: inputs.zone,
      cityTimezone: expected.timezone,
    });
  }
  const seen = new Set<string>();
  for (const item of inputs.items) {
    if (seen.has(item.assignmentId)) {
      throw unavailable("fleet_inputs_duplicate_assignment", {
        assignmentId: item.assignmentId,
      });
    }
    seen.add(item.assignmentId);
  }
}

/** Parses an answer against the contract; anything else is refused. */
export function parseInputs(body: unknown): SettlementInputs {
  const parsed = SettlementInputsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw unavailable("fleet_inputs_invalid", {
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export interface HttpInputsConfig {
  readonly baseUrl: string;
  readonly serviceKey: string;
  readonly timeoutMs?: number;
}

/**
 * The configuration from the environment: `FLEET_SERVICE_URL` and
 * `FLEET_PAYMENT_SERVICE_KEY`. Read per call, never cached, so a rotated key
 * applies without a restart. Missing or too short ⇒ refuse (fail closed).
 */
export function inputsConfigFromEnv(): HttpInputsConfig {
  const baseUrl = process.env.FLEET_SERVICE_URL;
  const serviceKey = process.env.FLEET_PAYMENT_SERVICE_KEY;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw unavailable("fleet_inputs_unconfigured", {
      missing: "FLEET_SERVICE_URL",
    });
  }
  if (serviceKey === undefined || serviceKey.length < MIN_FLEET_KEY_LENGTH) {
    throw unavailable("fleet_inputs_unconfigured", {
      missing: "FLEET_PAYMENT_SERVICE_KEY",
      minLength: MIN_FLEET_KEY_LENGTH,
    });
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), serviceKey };
}

/** The HTTP consumer of contract B. */
export function httpSettlementInputsClient(
  configOf: () => HttpInputsConfig = inputsConfigFromEnv,
): SettlementInputsClient {
  return {
    async fetchInputs(cityId, weekStart) {
      if (!isMonday(weekStart)) {
        throw new ContractError(
          "validation_failed",
          "a settlement week is named by its Monday, YYYY-MM-DD",
          { weekStart },
        );
      }
      const config = configOf();
      if (config.serviceKey.length < MIN_FLEET_KEY_LENGTH) {
        throw unavailable("fleet_inputs_unconfigured", {
          missing: "FLEET_PAYMENT_SERVICE_KEY",
          minLength: MIN_FLEET_KEY_LENGTH,
        });
      }
      const query = new URLSearchParams({ weekStart, cityId });
      let response: Response;
      try {
        response = await fetch(
          `${config.baseUrl}${SETTLEMENT_INPUTS_PATH}?${query.toString()}`,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              [FLEET_SERVICE_KEY_HEADER]: config.serviceKey,
            },
            // Never follow a redirect: fetch would re-send the service key
            // to wherever it points. A redirect is an unreachable answer.
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
          },
        );
      } catch {
        throw unavailable("fleet_inputs_unreachable");
      }
      if (!response.ok) {
        throw unavailable("fleet_inputs_refused", { status: response.status });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw unavailable("fleet_inputs_invalid");
      }
      return parseInputs(body);
    },
  };
}

/** Why one item cannot be settled as sent; null when it can. */
export function itemProblem(
  item: SettlementInputItem,
  currency: string,
): { readonly reason: string; readonly message: string } | null {
  for (const [field, value] of [
    ["assignmentId", item.assignmentId],
    ["fleetId", item.fleetId],
    ["driverId", item.driverId],
  ] as const) {
    if (!isLinkId(value)) {
      return {
        reason: "invalid_identifier",
        message: `${field} must be 1-128 letters, digits, '_', '.' or '-'`,
      };
    }
  }
  const { terms } = item;
  if (terms.currency !== currency) {
    return {
      reason: "currency_mismatch",
      message: "the terms' currency is not the city's currency",
    };
  }
  if (terms.type === "weekly_fixed") {
    if (terms.amountMinor === null || terms.percent !== null) {
      return {
        reason: "terms_invalid",
        message: "weekly_fixed terms carry amountMinor and no percent",
      };
    }
  } else if (terms.percent === null || terms.amountMinor !== null) {
    return {
      reason: "terms_invalid",
      message: "percent_of_net terms carry percent and no amountMinor",
    };
  }
  if (terms.percent !== null && !isTwoDecimals(terms.percent)) {
    return {
      reason: "terms_invalid",
      message: "a remittance percent has at most two decimal places",
    };
  }
  for (const hours of [
    item.shiftHoursInWeek,
    item.plannedMaintenanceHoursInWeek,
    item.unplannedOffRoadHoursInWeek,
  ]) {
    // A week is at most 169 hours long (the DST fall-back week).
    if (!isTwoDecimals(hours) || hours > 169) {
      return {
        reason: "hours_invalid",
        message: "hours are decimal hours with at most two decimal places",
      };
    }
  }
  if (
    item.activeTo !== null &&
    Date.parse(item.activeTo) <= Date.parse(item.activeFrom)
  ) {
    return {
      reason: "active_window_invalid",
      message: "activeTo must be after activeFrom",
    };
  }
  return null;
}

function isTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
