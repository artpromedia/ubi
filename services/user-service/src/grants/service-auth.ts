/**
 * Authenticating the machine callers of the grant + mandate-run surface.
 *
 * Minting, consuming and running are SERVICE-TO-SERVICE only (CLAUDE.md #18):
 * ask-service and travel-service call them after a user has confirmed a review
 * or an external trigger fired. None of these endpoints is ever exposed to a
 * model tool — a model runs with the caller's gateway identity and can never
 * present the internal service key.
 *
 * The check is a constant-time comparison against `AI_GRANTS_SERVICE_KEY`, and
 * it FAILS CLOSED: an unconfigured deployment refuses every call rather than
 * waving it through. The gateway strips `x-service-key` and every `x-internal-*`
 * header from client requests, so this credential can never arrive from the
 * internet.
 */
import { ContractError } from "@ubi/contracts";
import { timingSafeEqual } from "node:crypto";

export const SERVICE_KEY_HEADER = "x-service-key";

const MIN_SECRET_LENGTH = 32;

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Authenticates ask-service / travel-service / the mandate runner. */
export function requireInternalService(presented: string | undefined): void {
  const secret = process.env.AI_GRANTS_SERVICE_KEY;
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    throw new ContractError(
      "service_unavailable",
      "Action grants are not configured on this deployment",
    );
  }
  if (presented === undefined || !equal(secret, presented)) {
    throw new ContractError("unauthorized", "Authentication required");
  }
}
