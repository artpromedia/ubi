/**
 * ride-service, as fleet-service reaches it: INTERNAL CONTRACT A routes 1-7
 * (packages/contracts/src/fleet.ts CONTRACT_A_ROUTES).
 *
 * Every call presents FLEET_RIDE_SERVICE_KEY as `X-Service-Key`. There is no
 * fallback that pretends to work: an unreachable ride-service, a 5xx or a
 * body outside the contract is `RideUnavailableError`, which the routes answer
 * as 503 without advancing any fleet state past what ride-service confirmed.
 *
 * PRIVACY AT THE BOUNDARY. A booking reaches fleet-service only as an
 * `OccupiedBlock` — and it leaves this port only as one: every block is
 * PROJECTED onto exactly the eight contract fields before anything else sees
 * it, so a ride-side regression that added a rider, location or fare field
 * could never reach a fleet response. The extra keys' NAMES (never values)
 * are logged as a contract warning.
 */
import { z } from "zod";

import {
  OCCUPIED_BLOCK_FIELDS,
  OccupiedBlockSchema,
  RideMaintenancePreviewResponseSchema,
  RideOccupancyCreatedSchema,
  RideOffRoadResponseSchema,
  RideVehicleSwapResponseSchema,
  type OccupiedBlock,
  type PlannedMaintenanceKind,
} from "../contract";
import { rideLogger } from "../lib/logger";
import {
  FLEET_RIDE_SERVICE_KEY_ENV,
  SERVICE_KEY_HEADER,
  usableKey,
} from "../lib/service-key";

export class RideUnavailableError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "RideUnavailableError";
  }
}

export interface MaintenanceWindowInput {
  readonly vehicleId: string;
  readonly kind: PlannedMaintenanceKind;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface MaintenancePreviewResult {
  readonly feasible: boolean;
  readonly affectedBlocks: readonly OccupiedBlock[];
  readonly nextFeasibleWindow: { startsAt: string; endsAt: string } | null;
}

export type OccupancyCreateResult =
  | { readonly kind: "created"; readonly occupancyId: string }
  | {
      readonly kind: "conflict";
      readonly affectedBlocks: readonly OccupiedBlock[];
    };

export interface OffRoadResult {
  readonly occupancyId: string;
  readonly atRiskBookings: readonly {
    blockId: string;
    decisionDeadline: string;
  }[];
}

export type SwapResult =
  | { readonly kind: "proposed"; readonly swapId: string }
  | { readonly kind: "ineligible"; readonly reasons: readonly string[] };

/**
 * A driver's own advance booking (contract A route 6), narrowed to what the
 * driver's schedule and time-off preview use. The full entry is
 * MpAdvanceBookingSchema's driver view; only these fields are read.
 */
export const DriverBookingSchema = z.object({
  bookingId: z.string().min(1),
  state: z.string().min(1),
  statusLabel: z.string().min(1),
  schedule: z.object({
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    label: z.string().min(1),
  }),
  commissionMinor: z
    .object({ amountMinor: z.number().int(), currency: z.string() })
    .optional(),
});
export type DriverBooking = z.infer<typeof DriverBookingSchema>;

export interface RidePort {
  previewMaintenance(
    input: MaintenanceWindowInput,
  ): Promise<MaintenancePreviewResult>;
  createMaintenanceOccupancy(
    input: MaintenanceWindowInput & { readonly blockId: string },
    idempotencyKey: string,
  ): Promise<OccupancyCreateResult>;
  releaseOccupancy(blockId: string, idempotencyKey: string): Promise<void>;
  reportOffRoad(
    input: {
      readonly blockId: string;
      readonly vehicleId: string;
      readonly startsAt: string;
      readonly expectedEndsAt: string | null;
    },
    idempotencyKey: string,
  ): Promise<OffRoadResult>;
  occupiedBlocks(query: {
    readonly vehicleIds: readonly string[];
    readonly driverIds: readonly string[];
    readonly from: string;
    readonly to: string;
  }): Promise<OccupiedBlock[]>;
  driverCalendar(
    driverId: string,
    from: string,
    to: string,
  ): Promise<DriverBooking[]>;
  requestVehicleSwap(
    blockId: string,
    input: {
      readonly toVehicleId: string;
      readonly requestedByStaffId: string;
    },
    idempotencyKey: string,
  ): Promise<SwapResult>;
}

const ACTIVE_BOOKING_STATES: ReadonlySet<string> = new Set([
  "held",
  "payment_pending",
  "confirmed",
  "reconfirmed",
  "activated",
]);

/** Whether a route-6 entry is a live commitment the driver still holds. */
export function isLiveBooking(booking: DriverBooking): boolean {
  return ACTIVE_BOOKING_STATES.has(booking.state);
}

/**
 * Exactly the contract fields of one block, validated. Anything else the
 * other side sent is dropped here and its key names logged.
 */
export function projectOccupiedBlock(raw: unknown): OccupiedBlock {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RideUnavailableError(
      "blocks",
      "an occupied block is not an object",
    );
  }
  const source = raw as Record<string, unknown>;
  const extra = Object.keys(source).filter(
    (key) => !(OCCUPIED_BLOCK_FIELDS as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    rideLogger.warn(
      { extraKeys: extra },
      "contract A: ride-service sent fields outside OccupiedBlock; dropped before use",
    );
  }
  const picked: Record<string, unknown> = {};
  for (const field of OCCUPIED_BLOCK_FIELDS) {
    picked[field] = source[field];
  }
  const parsed = OccupiedBlockSchema.safeParse(picked);
  if (!parsed.success) {
    throw new RideUnavailableError(
      "blocks",
      "ride-service answered an occupied block outside contract A",
    );
  }
  return parsed.data;
}

function projectBlocks(raw: unknown): OccupiedBlock[] {
  if (!Array.isArray(raw)) {
    throw new RideUnavailableError("blocks", "affected blocks are not a list");
  }
  return raw.map((entry) => projectOccupiedBlock(entry));
}

export interface HttpRidePortOptions {
  readonly baseUrl: string;
  /** FLEET_RIDE_SERVICE_KEY; absent ⇒ every call is refused before sending. */
  readonly serviceKey: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpRidePort(options: HttpRidePortOptions): RidePort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(
    operation: string,
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const key = options.serviceKey;
    if (key === undefined) {
      throw new RideUnavailableError(
        operation,
        `${FLEET_RIDE_SERVICE_KEY_ENV} is not configured; ride-service is not called`,
      );
    }
    const headers: Record<string, string> = {
      [SERVICE_KEY_HEADER]: key,
      accept: "application/json",
    };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (init.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = init.idempotencyKey;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      rideLogger.warn({ err: error, operation }, "ride-service unreachable");
      throw new RideUnavailableError(operation, "ride-service is unreachable");
    }
    let body: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new RideUnavailableError(
          operation,
          "ride-service answered a body that is not JSON",
          response.status,
        );
      }
    }
    if (
      response.status >= 500 ||
      response.status === 401 ||
      response.status === 403
    ) {
      rideLogger.warn(
        { operation, status: response.status },
        "ride-service refused or failed a contract A call",
      );
      throw new RideUnavailableError(
        operation,
        `ride-service answered ${response.status}`,
        response.status,
      );
    }
    return { status: response.status, body };
  }

  function unexpected(operation: string, status: number): RideUnavailableError {
    return new RideUnavailableError(
      operation,
      `ride-service answered ${status} outside contract A`,
      status,
    );
  }

  function errorBody(body: unknown): {
    code?: string;
    details?: Record<string, unknown>;
  } {
    if (typeof body !== "object" || body === null) {
      return {};
    }
    const record = body as {
      code?: unknown;
      details?: unknown;
      error?: unknown;
    };
    const source =
      typeof record.error === "object" && record.error !== null
        ? (record.error as { code?: unknown; details?: unknown })
        : record;
    return {
      ...(typeof source.code === "string" ? { code: source.code } : {}),
      ...(typeof source.details === "object" && source.details !== null
        ? { details: source.details as Record<string, unknown> }
        : {}),
    };
  }

  return {
    async previewMaintenance(input) {
      const { status, body } = await call(
        "maintenance_preview",
        "POST",
        "/internal/fleet/occupancy/maintenance:preview",
        { body: input },
      );
      if (status !== 200) {
        throw unexpected("maintenance_preview", status);
      }
      const record = (body ?? {}) as Record<string, unknown>;
      const affectedBlocks = projectBlocks(record.affectedBlocks);
      const parsed = RideMaintenancePreviewResponseSchema.safeParse({
        feasible: record.feasible,
        affectedBlocks,
        nextFeasibleWindow: record.nextFeasibleWindow ?? null,
      });
      if (!parsed.success) {
        throw unexpected("maintenance_preview", status);
      }
      return parsed.data;
    },

    async createMaintenanceOccupancy(input, idempotencyKey) {
      const { status, body } = await call(
        "maintenance_create",
        "POST",
        "/internal/fleet/occupancy/maintenance",
        { body: input, idempotencyKey },
      );
      if (status === 201 || status === 200) {
        const parsed = RideOccupancyCreatedSchema.safeParse(body);
        if (!parsed.success) {
          throw unexpected("maintenance_create", status);
        }
        return { kind: "created", occupancyId: parsed.data.occupancyId };
      }
      if (status === 409) {
        const error = errorBody(body);
        if (error.code === "occupancy_conflict") {
          return {
            kind: "conflict",
            affectedBlocks: projectBlocks(error.details?.affectedBlocks ?? []),
          };
        }
      }
      throw unexpected("maintenance_create", status);
    },

    async releaseOccupancy(blockId, idempotencyKey) {
      const { status, body } = await call(
        "maintenance_release",
        "POST",
        `/internal/fleet/occupancy/maintenance/${encodeURIComponent(blockId)}/release`,
        { body: {}, idempotencyKey },
      );
      if (
        status !== 200 ||
        (body as { released?: unknown } | null)?.released !== true
      ) {
        throw unexpected("maintenance_release", status);
      }
    },

    async reportOffRoad(input, idempotencyKey) {
      const { status, body } = await call(
        "off_road",
        "POST",
        "/internal/fleet/occupancy/off-road",
        { body: input, idempotencyKey },
      );
      if (status !== 201 && status !== 200) {
        throw unexpected("off_road", status);
      }
      const parsed = RideOffRoadResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw unexpected("off_road", status);
      }
      return parsed.data;
    },

    async occupiedBlocks(query) {
      if (query.vehicleIds.length === 0 && query.driverIds.length === 0) {
        return [];
      }
      const params = new URLSearchParams();
      if (query.vehicleIds.length > 0) {
        params.set("vehicleIds", query.vehicleIds.join(","));
      }
      if (query.driverIds.length > 0) {
        params.set("driverIds", query.driverIds.join(","));
      }
      params.set("from", query.from);
      params.set("to", query.to);
      const { status, body } = await call(
        "blocks",
        "GET",
        `/internal/fleet/occupancy/blocks?${params.toString()}`,
      );
      if (status !== 200) {
        throw unexpected("blocks", status);
      }
      return projectBlocks((body as { blocks?: unknown } | null)?.blocks);
    },

    async driverCalendar(driverId, from, to) {
      const params = new URLSearchParams({ from, to });
      const { status, body } = await call(
        "driver_calendar",
        "GET",
        `/internal/fleet/drivers/${encodeURIComponent(driverId)}/calendar?${params.toString()}`,
      );
      if (status !== 200) {
        throw unexpected("driver_calendar", status);
      }
      const bookings = (body as { bookings?: unknown } | null)?.bookings;
      if (!Array.isArray(bookings)) {
        throw unexpected("driver_calendar", status);
      }
      return bookings.map((entry) => {
        const parsed = DriverBookingSchema.safeParse(entry);
        if (!parsed.success) {
          throw unexpected("driver_calendar", status);
        }
        return parsed.data;
      });
    },

    async requestVehicleSwap(blockId, input, idempotencyKey) {
      const { status, body } = await call(
        "vehicle_swap",
        "POST",
        `/internal/fleet/bookings/${encodeURIComponent(blockId)}/vehicle-swaps`,
        { body: input, idempotencyKey },
      );
      if (status === 201 || status === 200) {
        const parsed = RideVehicleSwapResponseSchema.safeParse(body);
        if (!parsed.success) {
          throw unexpected("vehicle_swap", status);
        }
        return { kind: "proposed", swapId: parsed.data.swapId };
      }
      if (status === 422) {
        const error = errorBody(body);
        const reasons = error.details?.reasons;
        if (error.code === "swap_ineligible" && Array.isArray(reasons)) {
          return {
            kind: "ineligible",
            reasons: reasons.filter(
              (reason): reason is string => typeof reason === "string",
            ),
          };
        }
      }
      if (status === 404) {
        return { kind: "ineligible", reasons: ["booking_not_swappable"] };
      }
      throw unexpected("vehicle_swap", status);
    },
  };
}

/** The configured key for the real wiring (undefined ⇒ calls are refused). */
export function rideServiceKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return usableKey(env, FLEET_RIDE_SERVICE_KEY_ENV);
}
