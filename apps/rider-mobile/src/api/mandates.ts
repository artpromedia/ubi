import { api, type Money } from "@ubi/mobile-core";
export type AllowedAction =
  | "airport_pickup.reserve"
  | "flight.rebook_on_cancel"
  | "scheduled_ride.book"
  // Pick a driver's offer on my negotiated ride, within my limits (recheck
  // A03 / P02). A travel mandate never implies this authority.
  | "marketplace.ride.select";
/**
 * Keys whose `values` the server checks against a marketplace selection
 * (user-service mandates/schemas.ts TYPED_CONSTRAINT_KEYS). `time_window`
 * values are `HH:MM-HH:MM` in the city's local time.
 */
export type TypedConstraintKey =
  | "city"
  | "vehicle_class"
  | "time_window"
  | "pickup_area"
  | "dropoff_area"
  | "route";
export type Constraint = {
  key: string;
  /** Display copy; the server stores key, mode and values only. */
  label?: string;
  mode: "always_ask" | "ask" | "allow";
  /** Permitted values for a typed key (absent = no value list). */
  values?: string[];
};
export type MandateInput = {
  action: AllowedAction;
  title: string;
  passengers: "self_only" | "saved_passengers";
  categories: string[];
  providers?: string[];
  perRunCap: Money;
  periodCap: { amount: Money; runs: number; period: "month" };
  maxPriceVariance?: Money;
  expiresAt: string;
  constraints: Constraint[];
};
export type Mandate = MandateInput & {
  id: string;
  status: "active" | "paused" | "revoked" | "expired";
  usage: { amountUsed: Money; runsUsed: number; periodStart: string | null };
  lastRunAt?: string | null;
  /** Presentation extras; user-service's view does not carry them. */
  summary?: string;
  receiptsCount?: number;
};
export type MandateExecution = {
  id: string;
  mandateId: string;
  at: string;
  outcome: "executed" | "blocked";
  reasonCode?: string;
  grantId?: string;
  receiptRef?: string;
  resultRef?: string;
  amount?: Money;
  summary: string;
  title: string;
  detail?: string;
  allowance?: { used: Money; cap: Money; runsUsed: number; runs: number };
};

/**
 * user-service answers `{ success: true, data: { <key>: … } }`
 * (identity/http.ts `ok`); the value under `key` is what the screens use. A
 * bare value (the dev fixtures) passes through unchanged.
 */
function fromEnvelope<T>(value: unknown, key: string): T {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === "object"
  ) {
    return (value as { data: Record<string, unknown> }).data[key] as T;
  }
  return value as T;
}

const list = async (): Promise<Mandate[]> =>
  fromEnvelope<Mandate[]>(await api("GET", "/v1/mandates"), "mandates");

export const mandatesApi = {
  list,
  /** user-service serves the owner's list; one mandate is read from it. */
  get: async (id: string): Promise<Mandate> => {
    const found = (await list()).find((m) => m.id === id);
    if (!found) throw new Error("mandate_not_found");
    return found;
  },
  create: async (input: MandateInput, proof: string) =>
    fromEnvelope<Mandate>(
      await api("POST", "/v1/mandates", {
        ...input,
        assurance: { method: "pin", proof },
      }),
      "mandate",
    ),
  patch: async (
    id: string,
    op: "edit" | "pause" | "resume" | "revoke",
    changes?: Partial<MandateInput>,
    proof?: string,
  ) =>
    fromEnvelope<Mandate>(
      // user-service requires an Idempotency-Key on every mandate change.
      await api(
        "PATCH",
        "/v1/mandates/" + id,
        {
          op,
          changes,
          assurance: proof ? { method: "pin", proof } : undefined,
        },
        { idempotent: true },
      ),
      "mandate",
    ),
  executions: async (id: string) =>
    fromEnvelope<MandateExecution[]>(
      await api("GET", "/v1/mandates/" + id + "/executions"),
      "executions",
    ),
  execution: (executionId: string) =>
    api<MandateExecution>("GET", "/v1/mandates/executions/" + executionId),
};
