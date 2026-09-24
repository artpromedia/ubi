/**
 * The honest states every fleet screen can be in (handoff "States").
 *
 * The portal never decides access. It classifies the server's answer so a
 * fleet sees WHY a screen is empty instead of a blank calendar that looks
 * like "nothing booked":
 *   - `flag_off`   404 `feature_disabled` — the deny-by-default `fleet` flag
 *                  is off in the caller's city. No preview data is shown.
 *   - `forbidden`  403 — the fleet role (or the gateway scope) lacks it.
 *   - `not_found`  404 — not staff of that fleet (existence not disclosed).
 *   - `unavailable` 503 — a dependency (ride-service's booking calendar)
 *                  could not answer; fleet-service refuses rather than serve
 *                  an empty booking lane a fleet could mistake for "free".
 *   - `offline`    the browser cannot reach UBI (TanStack pauses reads).
 */
import { ApiError } from "./api-client";
import { permissionCopy } from "./roles";

import type { FleetCapability } from "./fleet-types";

export type AccessKind =
  | "unauthenticated"
  | "flag_off"
  | "forbidden"
  | "not_found"
  | "device_unverified"
  | "safe_mode"
  | "unavailable"
  | "offline"
  | "error";

export interface AccessState {
  readonly kind: AccessKind;
  readonly title: string;
  readonly message: string;
}

export const FLAG_OFF_COPY = "Fleet tools aren't available yet in your city.";

const browserOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

const CAPABILITIES: readonly FleetCapability[] = [
  "view_calendar",
  "manage_maintenance",
  "report_off_road",
  "propose_assignment",
  "propose_terms",
  "manage_vehicles",
  "request_vehicle_swap",
  "remind_driver",
  "terminate_arrangement",
  "manage_staff",
];

function capabilityOf(error: ApiError): FleetCapability | null {
  const raw = error.details?.capability;
  return typeof raw === "string" &&
    (CAPABILITIES as readonly string[]).includes(raw)
    ? (raw as FleetCapability)
    : null;
}

export function classifyError(
  error: unknown,
  online: boolean = browserOnline(),
  context = "this",
): AccessState {
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      title: "You're offline",
      message:
        "The portal can't reach UBI right now. Nothing here is live, and every change is disabled until you reconnect.",
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        kind: "unauthenticated",
        title: "Signed out",
        message:
          "Your session has ended. Sign in with your UBI account again to open your fleet.",
      };
    }
    if (error.code === "feature_disabled") {
      return {
        kind: "flag_off",
        title: "Not available yet",
        message: FLAG_OFF_COPY,
      };
    }
    if (error.code === "limited_mode") {
      return {
        kind: "device_unverified",
        title: "Device not verified",
        message:
          "This device hasn't finished its security check, so fleet tools are blocked. Finish device verification, then reload.",
      };
    }
    if (error.code === "safe_mode_active") {
      return {
        kind: "safe_mode",
        title: "Account in safe mode",
        message:
          "A SIM-swap signal put this account in safe mode. Fleet changes are paused until it is lifted.",
      };
    }
    if (error.status === 403) {
      const capability = capabilityOf(error);
      return {
        kind: "forbidden",
        title: "Not available for your role",
        message:
          capability === null
            ? "Your account can't open this. Ask a fleet owner. Nothing was changed."
            : permissionCopy(capability),
      };
    }
    if (error.status === 404) {
      return {
        kind: "not_found",
        title: "Not found",
        message: `We couldn't find ${context} for your account. It may belong to another fleet.`,
      };
    }
    if (error.status === 503) {
      return {
        kind: "unavailable",
        title: "Temporarily unavailable",
        message:
          "The booking calendar can't answer right now, so nothing is shown as free. Nothing was changed. Try again shortly.",
      };
    }
  }
  return {
    kind: "error",
    title: "Something went wrong",
    message: "We couldn't load this. Try again.",
  };
}

/** The slice of a TanStack query result a screen's read state depends on. */
export interface ReadLike<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly fetchStatus: "fetching" | "paused" | "idle";
  readonly dataUpdatedAt: number;
}

export type ReadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly access: AccessState }
  | {
      readonly kind: "ready";
      readonly data: T;
      readonly updatedAt: number;
      /** Set when the data is kept but could not be refreshed (offline / error). */
      readonly stale: AccessState | null;
    };

/**
 * What a screen shows for a read. Offline or failed WITH data keeps the last
 * good data, marked stale with its time; without data it is the failure. A
 * paused read with nothing to show is "offline", never the empty state.
 */
export function toReadState<T>(
  query: ReadLike<T>,
  online: boolean = browserOnline(),
  context?: string,
): ReadState<T> {
  let failure: AccessState | null = null;
  if (query.isError) {
    failure = classifyError(query.error, online, context);
  } else if (!online || query.fetchStatus === "paused") {
    failure = classifyError(null, false, context);
  }
  if (query.data !== undefined) {
    // A definitive refusal (flag off, removed from the fleet, signed out)
    // must not keep showing old fleet data.
    if (
      failure !== null &&
      (failure.kind === "flag_off" ||
        failure.kind === "forbidden" ||
        failure.kind === "not_found" ||
        failure.kind === "unauthenticated")
    ) {
      return { kind: "failed", access: failure };
    }
    return {
      kind: "ready",
      data: query.data,
      updatedAt: query.dataUpdatedAt,
      stale: failure,
    };
  }
  if (failure !== null) {
    return { kind: "failed", access: failure };
  }
  return { kind: "loading" };
}

/** What a failed command tells the user (never "nothing happened" when unsure). */
export function commandErrorText(
  error: unknown,
  online: boolean = browserOnline(),
): string {
  if (!online || !(error instanceof ApiError) || error.status >= 500) {
    return "We couldn't confirm this reached UBI. Try again — it's safe: the same request is re-sent and can't apply twice.";
  }
  if (error.code === "idempotency_key_reuse") {
    // A retry after an unconfirmed attempt, with changed details: the first
    // attempt may already have applied, so say so instead of the raw code.
    return "An earlier attempt with different details may already have reached UBI. Refresh to check before sending again.";
  }
  const access = classifyError(error, online);
  if (access.kind === "error" || access.kind === "not_found") {
    return error.detail;
  }
  return access.message;
}
