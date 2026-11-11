/**
 * payment-service, as fleet-service reaches it for weekly money & remittance
 * visibility (CC-A02, P1-09, DEC-9 = A, Q7).
 *
 * Every call presents `FLEET_PAYMENT_SERVICE_KEY` as `X-Service-Key` to
 * `POST /v1/finance/fleet/internal/week-money`.
 *
 * PRIVACY AT THE BOUNDARY (Q7, DEC-9 = A):
 *   - Response bodies are validated against `FleetWeekMoneyResponseSchema` and
 *     walked against `FLEET_FORBIDDEN_FIELD_PATTERNS` so any forbidden key
 *     (`driverNet`, `net`, `perTrip`, etc.) is rejected and never reaches a
 *     fleet surface.
 *   - When payment-service is unreachable, unconfigured, or times out, the port
 *     degrades gracefully to `null` so `vehicleView` and `overview` return
 *     `MONEY_UNAVAILABLE` (`available: false`) rather than failing operational
 *     reads.
 */
import {
  FLEET_FORBIDDEN_FIELD_PATTERNS,
  FLEET_WEEK_MONEY_PATH,
  FleetWeekMoneyResponseSchema,
  type FleetMoney,
  type FleetMoneySummary,
  type FleetWeekMoneyRequest,
  type FleetWeekMoneyResponse,
} from "../contract";
import { logger } from "../lib/logger";
import {
  FLEET_PAYMENT_SERVICE_KEY_ENV,
  SERVICE_KEY_HEADER,
  usableKey,
} from "../lib/service-key";

const paymentLogger = logger.child({ component: "payment-port" });

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_CACHE_TTL_MS = 5_000;

export interface PaymentPort {
  weekMoney(
    input: FleetWeekMoneyRequest,
  ): Promise<FleetWeekMoneyResponse | null>;
}

export function paymentServiceKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return usableKey(env, FLEET_PAYMENT_SERVICE_KEY_ENV);
}

function findForbiddenField(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let idx = 0; idx < value.length; idx += 1) {
      const hit = findForbiddenField(value[idx], `${path}[${idx}]`);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        return `${path}.${key}`;
      }
      const hit = findForbiddenField(child, `${path}.${key}`);
      if (hit !== null) {
        return hit;
      }
    }
  }
  return null;
}

function cacheKeyOf(input: FleetWeekMoneyRequest): string {
  const vehicles = [...(input.vehicleIds ?? [])].sort().join(",");
  const assignments = [...(input.assignments ?? [])]
    .map(
      (item) =>
        `${item.assignmentId}:${item.driverId}:${item.vehicleId}:${item.activeFrom}:${item.activeTo ?? ""}`,
    )
    .sort()
    .join(";");
  return `${input.fleetId}|${input.cityId}|${input.weekStart}|${vehicles}|${assignments}`;
}

export function summaryToFleetMoney(
  summary: FleetMoneySummary | undefined,
  meta: Pick<
    FleetWeekMoneyResponse,
    "asOf" | "excludes" | "weekStart" | "weekEnd"
  >,
  fallback: FleetMoney,
): FleetMoney {
  if (summary === undefined) {
    return fallback;
  }
  return {
    available: true,
    asOf: meta.asOf,
    excludes: meta.excludes,
    weekStart: meta.weekStart,
    weekEnd: meta.weekEnd,
    weekGross: summary.weekGross,
    ubiCommission: summary.ubiCommission,
    fleetRemittance: summary.fleetRemittance,
    remittanceStatus: summary.remittanceStatus,
    remittance: summary.remittance,
  };
}

export function createHttpPaymentPort(options: {
  readonly baseUrl: string;
  readonly serviceKey: string | undefined;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}): PaymentPort {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchFn = options.fetchImpl ?? fetch;
  const nowFn = options.now ?? Date.now;
  const cache = new Map<
    string,
    { readonly expiresAt: number; readonly value: FleetWeekMoneyResponse }
  >();

  return {
    async weekMoney(
      input: FleetWeekMoneyRequest,
    ): Promise<FleetWeekMoneyResponse | null> {
      if (options.serviceKey === undefined || baseUrl.length === 0) {
        return null;
      }
      const key = cacheKeyOf(input);
      const now = nowFn();
      const hit = cache.get(key);
      if (hit !== undefined && hit.expiresAt > now) {
        return hit.value;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(`${baseUrl}${FLEET_WEEK_MONEY_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            [SERVICE_KEY_HEADER]: options.serviceKey,
          },
          body: JSON.stringify(input),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          paymentLogger.warn(
            {
              status: response.status,
              fleetId: input.fleetId,
              weekStart: input.weekStart,
            },
            "payment-service week-money returned non-200; falling back to MONEY_UNAVAILABLE",
          );
          return null;
        }
        const raw: unknown = await response.json();
        const forbidden = findForbiddenField(raw);
        if (forbidden !== null) {
          paymentLogger.error(
            { forbidden, fleetId: input.fleetId },
            "payment-service week-money contained forbidden field; refusing payload",
          );
          return null;
        }
        const parsed = FleetWeekMoneyResponseSchema.safeParse(raw);
        if (!parsed.success) {
          paymentLogger.warn(
            {
              fleetId: input.fleetId,
              issues: parsed.error.issues.map((issue) => issue.path.join(".")),
            },
            "payment-service week-money failed contract validation; falling back to MONEY_UNAVAILABLE",
          );
          return null;
        }
        if (cacheTtlMs > 0) {
          cache.set(key, {
            expiresAt: now + cacheTtlMs,
            value: parsed.data,
          });
        }
        return parsed.data;
      } catch (error) {
        paymentLogger.warn(
          {
            err: error,
            fleetId: input.fleetId,
            weekStart: input.weekStart,
          },
          "payment-service week-money unreachable; falling back to MONEY_UNAVAILABLE",
        );
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
