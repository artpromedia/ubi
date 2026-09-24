/**
 * A faithful double of user-service's documented wallet-PIN check
 * (services/user-service/src/routes/identity.ts `POST /auth/pin/verify`,
 * services/user-service/src/identity/pin.ts `verifyPin`):
 *
 *   - authenticates ONLY the gateway-signed `x-ubi-identity` context (HS256,
 *     issuer ubi-gateway, audience ubi-internal, unexpired) — the same
 *     verification user-service performs — and answers 401 without one;
 *   - requires scope `wallet:read` on that context (requireScope);
 *   - body `{ pin }`, 4-6 digits, else 422 validation_failed;
 *   - a wrong PIN counts an attempt (422 `wrong_pin`, `attemptsRemaining`);
 *     reaching `maxPinAttempts` locks (403 `pin_locked`, `lockedUntil`), and a
 *     locked wallet refuses even the right PIN until the lock lapses;
 *   - no PIN set → 409 `pin_not_verified`; no wallet → 404 `not_found`;
 *   - success resets the counter: 200 `{ success: true, data: { verified,
 *     coolingUntil } }`; every refusal is `{ success: false, error: {…} }`.
 *
 * It records the identity context each request carried (never the PIN), so a
 * test can prove fleet-service relayed the driver's OWN context unchanged.
 */
import { createServer, type Server } from "node:http";

import {
  identityVerificationKeys,
  verifyIdentityContext,
} from "../../src/lib/identity-context";

export interface PinWallet {
  pin: string | null;
  failedAttempts: number;
  lockedUntil: number | null;
}

export interface PinDouble {
  readonly url: string;
  readonly wallets: Map<string, PinWallet>;
  /** The x-ubi-identity values received, in order (never the PIN). */
  readonly relayedContexts: string[];
  readonly maxAttempts: number;
  setPin(userId: string, pin: string): void;
  reset(): void;
  close(): Promise<void>;
}

const LOCK_MS = 30 * 60_000;

export async function startPinDouble(maxAttempts = 5): Promise<PinDouble> {
  const wallets = new Map<string, PinWallet>();
  const relayedContexts: string[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const refuse = (
        status: number,
        code: string,
        message: string,
        details?: Record<string, unknown>,
      ): void =>
        send(status, {
          success: false,
          error: {
            code,
            message,
            ...(details === undefined ? {} : { details }),
          },
        });
      if (req.method !== "POST" || req.url !== "/auth/pin/verify") {
        refuse(404, "not_found", "no such route");
        return;
      }
      const context = req.headers["x-ubi-identity"];
      if (typeof context !== "string" || context.length === 0) {
        refuse(401, "unauthorized", "Authentication required");
        return;
      }
      relayedContexts.push(context);
      let principal;
      try {
        principal = verifyIdentityContext(
          context,
          identityVerificationKeys(process.env),
        );
      } catch {
        refuse(
          401,
          "unauthorized",
          "Internal identity context is missing or not trusted",
        );
        return;
      }
      if (!principal.scopes.includes("wallet:read")) {
        refuse(
          403,
          "forbidden",
          "You don't have permission to perform this action",
          { required: "wallet:read" },
        );
        return;
      }
      let pin: unknown;
      try {
        pin = (
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            pin?: unknown;
          }
        ).pin;
      } catch {
        pin = undefined;
      }
      if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
        refuse(422, "validation_failed", "Request validation failed");
        return;
      }
      const wallet = wallets.get(principal.userId);
      if (wallet === undefined) {
        refuse(404, "not_found", "You don't have a wallet yet");
        return;
      }
      const now = Date.now();
      if (wallet.lockedUntil !== null && wallet.lockedUntil > now) {
        refuse(
          403,
          "pin_locked",
          "Your PIN is locked. Reset it with a selfie check to unlock your wallet.",
          {
            lockedUntil: new Date(wallet.lockedUntil).toISOString(),
          },
        );
        return;
      }
      if (wallet.pin === null) {
        refuse(409, "pin_not_verified", "Set a wallet PIN before using it");
        return;
      }
      if (wallet.pin === pin) {
        wallet.failedAttempts = 0;
        wallet.lockedUntil = null;
        send(200, {
          success: true,
          data: { verified: true, coolingUntil: null },
        });
        return;
      }
      wallet.failedAttempts += 1;
      if (wallet.failedAttempts >= maxAttempts) {
        wallet.lockedUntil = now + LOCK_MS;
        refuse(
          403,
          "pin_locked",
          "Your PIN is locked after too many wrong tries. Reset it with a selfie check.",
          {
            lockedUntil: new Date(wallet.lockedUntil).toISOString(),
            attempts: wallet.failedAttempts,
          },
        );
        return;
      }
      refuse(422, "wrong_pin", "That PIN is not right", {
        attemptsRemaining: Math.max(0, maxAttempts - wallet.failedAttempts),
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    wallets,
    relayedContexts,
    maxAttempts,
    setPin(userId, pin) {
      wallets.set(userId, { pin, failedAttempts: 0, lockedUntil: null });
    },
    reset() {
      wallets.clear();
      relayedContexts.length = 0;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
