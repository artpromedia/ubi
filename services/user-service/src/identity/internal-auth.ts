/**
 * Callers that are not people: the telco SIM-swap webhook and the scheduled
 * sweeps.
 *
 * Neither carries a user token, so neither can use the gateway identity
 * context. Both are authenticated with a shared secret and a constant-time
 * comparison, and both FAIL CLOSED when the secret is not configured: an
 * unconfigured webhook is refused, never waved through.
 *
 * The gateway strips `x-service-key` and every `x-internal-*` header from
 * client requests, so these credentials cannot be presented from the internet.
 */
import { ContractError } from "@ubi/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";

export const TELCO_SIGNATURE_HEADER = "x-telco-signature";
export const SERVICE_KEY_HEADER = "x-service-key";

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verifies an HMAC-SHA256 signature over the RAW request body. The body is
 * signed, not a subset of it, so a replayed body with edited fields fails.
 */
export function verifyTelcoSignature(
  rawBody: string,
  signature: string | undefined,
): void {
  const secret = process.env.TELCO_SIM_SWAP_SECRET;
  if (secret === undefined || secret.length < 32) {
    throw new ContractError(
      "service_unavailable",
      "The SIM-swap webhook is not configured on this deployment",
    );
  }
  if (signature === undefined || signature.length === 0) {
    throw new ContractError("unauthorized", "Missing webhook signature");
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!equal(expected, signature.toLowerCase())) {
    throw new ContractError("unauthorized", "Webhook signature does not match");
  }
}

/** Authenticates a scheduled sweep or another internal caller. */
export function requireServiceKey(presented: string | undefined): void {
  const secret = process.env.IDENTITY_JOB_SERVICE_KEY;
  if (secret === undefined || secret.length < 32) {
    throw new ContractError(
      "service_unavailable",
      "Identity jobs are not configured on this deployment",
    );
  }
  if (presented === undefined || !equal(secret, presented)) {
    throw new ContractError("unauthorized", "Authentication required");
  }
}

/** Reviewer actions are for operators, not for the people being reviewed. */
export function requireReviewerRole(role: string): void {
  const normalised = role.toLowerCase();
  if (
    normalised === "admin" ||
    normalised === "agent" ||
    normalised === "super_admin"
  )
    return;
  throw new ContractError("forbidden", "Only a reviewer can decide this");
}
