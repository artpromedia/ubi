/**
 * The driver's wallet PIN, verified by user-service — never here.
 *
 * Signing a fleet offer is the driver's consent to remittance terms, so the
 * PIN check is user-service's REAL one (services/user-service/src/identity/
 * pin.ts `verifyPin`, route POST /auth/pin/verify): the attempt counter and
 * the lockout live on the wallet rows there, shared with every other PIN use,
 * so a wrong PIN here counts toward the same lock. The request carries the
 * driver's OWN gateway-signed context, relayed unchanged (lib/identity-relay.ts)
 * — fleet-service never asserts a result, never accepts one from a client and
 * never presents a service key in the driver's place.
 *
 * user-service's documented contract (src/routes/identity.ts):
 *   POST /auth/pin/verify   x-ubi-identity (scope wallet:read)   { pin }
 *   200 { success: true,  data: { verified: true, coolingUntil } }
 *   422 { success: false, error: { code: "wrong_pin", details: { attemptsRemaining } } }
 *   403 { success: false, error: { code: "pin_locked", details: { lockedUntil } } }
 *   409 pin_not_verified (no PIN set) · 404 not_found (no wallet) · 401 unauthorized
 * Those refusals are passed through with their own code, so the driver app
 * can say "wrong PIN, 2 tries left" or "locked". Anything else is
 * service_unavailable and nothing is signed.
 *
 * The PIN is sent once, over the relay, and is never logged, stored, hashed
 * into an idempotency record or echoed back.
 */
import { ContractError, ERROR_CODES, type ErrorCode } from "@ubi/contracts";

import {
  currentIdentityRelay,
  signedRelayHeaders,
} from "../lib/identity-relay";
import { pinLogger } from "../lib/logger";

export interface PinVerification {
  /** user-service verification reference: the relayed request's gateway id. */
  readonly reference: string;
  readonly verifiedAt: Date;
}

export interface PinPort {
  /** Verifies the CURRENT request's driver's PIN, or throws the refusal. */
  verify(pin: string): Promise<PinVerification>;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

const PASSED_THROUGH: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "wrong_pin",
  "pin_locked",
  "pin_not_verified",
  "not_found",
  "unauthorized",
  "forbidden",
  "limited_mode",
  "safe_mode_active",
  "validation_failed",
  "rate_limited",
]);

function unavailable(message: string): ContractError {
  return new ContractError(
    "service_unavailable",
    `${message}; nothing was signed`,
  );
}

export interface HttpPinPortOptions {
  /** user-service base URL; the route is unversioned (/auth/pin/verify). */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export function createHttpPinPort(options: HttpPinPortOptions): PinPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());

  return {
    async verify(pin: string): Promise<PinVerification> {
      const relay = currentIdentityRelay();
      if (relay === undefined || relay.kind !== "signed") {
        // user-service authenticates ONLY the gateway-signed context; there
        // is no weaker identity to fall back to (and the unsigned development
        // mode has none to relay).
        throw unavailable(
          "the PIN can only be checked with your verified sign-in",
        );
      }
      let response: Response;
      try {
        response = await fetchImpl(`${base}/auth/pin/verify`, {
          method: "POST",
          headers: {
            ...signedRelayHeaders(relay),
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ pin }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
        });
      } catch (error) {
        pinLogger.warn(
          { err: error },
          "user-service unreachable for PIN check",
        );
        throw unavailable("the PIN check is unavailable");
      }
      let body: unknown = null;
      try {
        body = (await response.json()) as unknown;
      } catch {
        throw unavailable("the PIN check answered an unreadable response");
      }
      const envelope = (body ?? {}) as {
        success?: unknown;
        data?: { verified?: unknown };
        error?: { code?: unknown; message?: unknown; details?: unknown };
      };
      if (
        response.status === 200 &&
        envelope.success === true &&
        envelope.data?.verified === true
      ) {
        const at = now();
        return {
          reference: `user-service:/auth/pin/verify:${relay.requestId ?? at.toISOString()}`,
          verifiedAt: at,
        };
      }
      const code = envelope.error?.code;
      if (
        typeof code === "string" &&
        KNOWN_CODES.has(code) &&
        PASSED_THROUGH.has(code as ErrorCode)
      ) {
        const details =
          typeof envelope.error?.details === "object" &&
          envelope.error.details !== null
            ? (envelope.error.details as Record<string, unknown>)
            : undefined;
        throw new ContractError(
          code as ErrorCode,
          typeof envelope.error?.message === "string"
            ? envelope.error.message
            : "the PIN was not accepted",
          details,
        );
      }
      pinLogger.warn(
        { status: response.status },
        "PIN check answered outside its contract",
      );
      throw unavailable("the PIN check failed");
    },
  };
}
