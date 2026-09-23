/**
 * Role / device-access guard states for the ops consoles (G11).
 *
 * Authorization is enforced where it can be: the gateway checks the admin
 * token's scopes (`mp:admin:read` for /v1/admin/mp, `travel:ops` for
 * /v1/ops/travel, `travel:read` for trips) and answers a device that has not
 * finished its security check with `limited_mode`; the services re-check an
 * operator role on the signed identity. This console never decides access
 * itself — it classifies the server's answer so an operator sees WHY a board
 * is empty (wrong role, unverified device, signed out, offline) instead of a
 * blank table that looks like "nothing is stuck".
 */
import { ApiError } from "./api-client";

export type AccessKind =
  | "unauthenticated"
  | "forbidden"
  | "device_unverified"
  | "safe_mode"
  | "feature_disabled"
  | "not_found"
  | "offline"
  | "error";

export type AccessState = {
  kind: AccessKind;
  title: string;
  message: string;
};

const browserOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** A 409 optimistic-concurrency refusal: the row changed since it was read. */
export const isVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === "version_conflict" ||
    (error.status === 409 && error.code === null));

/**
 * A command failure whose outcome is UNKNOWN — the request may have reached
 * the server (network drop, timeout, 5xx). Only a re-send under the same
 * idempotency key is safe; a definite 4xx refusal applied nothing.
 *
 * Fail safe: only a decoded 4xx answer counts as definite. Anything else —
 * a TypeError from fetch, a 2xx whose body failed to parse (the command DID
 * run), an unexpected throw — is ambiguous, never "nothing was applied".
 */
export const isAmbiguousFailure = (
  error: unknown,
  online: boolean = browserOnline(),
): boolean => !online || !(error instanceof ApiError) || error.status >= 500;

/** Classifies a failed read or command into the state the operator sees. */
export function classifyError(
  error: unknown,
  online: boolean = browserOnline(),
): AccessState {
  if (!online || error instanceof TypeError) {
    // fetch rejects with a TypeError when the network is unreachable. This
    // copy never claims "nothing was sent": a command whose connection
    // dropped may still have reached UBI (see isAmbiguousFailure), and the
    // command panels say so next to this notice.
    return {
      kind: "offline",
      title: "You are offline",
      message:
        "This console cannot reach UBI right now. Nothing shown here is live; reconnect and it reloads.",
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        kind: "unauthenticated",
        title: "Signed out",
        message: "Your operator session has ended. Sign in again to continue.",
      };
    }
    if (error.code === "limited_mode") {
      return {
        kind: "device_unverified",
        title: "Device not verified",
        message:
          "This device has not finished its security check, so operator reads and commands are blocked. Finish device verification, then reload.",
      };
    }
    if (error.code === "safe_mode_active") {
      return {
        kind: "safe_mode",
        title: "Account in safe mode",
        message:
          "A SIM-swap signal put this account in safe mode; operator actions are paused until it is lifted.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: "Not available for your role",
        message:
          "Your operator role does not include this console. Ask an administrator for the required scope; nothing was changed.",
      };
    }
    if (error.code === "feature_disabled") {
      return {
        kind: "feature_disabled",
        title: "Not enabled here",
        message:
          "This capability is switched off for this market (deny-by-default).",
      };
    }
    if (error.status === 404) {
      return {
        kind: "not_found",
        title: "Not found",
        message: "No record with that id exists (or it is not visible to you).",
      };
    }
  }
  return {
    kind: "error",
    title: "Could not load",
    message: error instanceof Error ? error.message : "Unexpected error",
  };
}

/** The slice of a TanStack query result a board's read state depends on. */
export type ReadLike = {
  isError: boolean;
  error: unknown;
  data: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
};

/**
 * The failure a board shows for a read, or null. TanStack PAUSES a query
 * while the browser is offline: it is neither loading (`isLoading` is false)
 * nor errored, and has no data — so without this a board falls through to
 * its empty copy ("nothing is stuck", "no events") when it simply could not
 * ask. A paused or offline read with nothing to show is "offline" instead.
 */
export function readFailure(
  query: ReadLike,
  online: boolean = browserOnline(),
): AccessState | null {
  if (query.isError) {
    return classifyError(query.error, online);
  }
  if (query.data === undefined && (query.fetchStatus === "paused" || !online)) {
    return classifyError(null, false);
  }
  return null;
}
