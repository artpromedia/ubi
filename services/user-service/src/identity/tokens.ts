/**
 * Access tokens the API gateway will accept.
 *
 * Claims match what services/api-gateway/src/middleware/auth.ts reads. Two of
 * them carry slice-03 meaning:
 *
 *   mode    "limited" for a token issued to a device that has not passed
 *           step-up. The gateway turns that into LIMITED MODE.
 *   scopes  a NARROWING of the role's scopes. The gateway intersects it with
 *           the role ceiling, so a token can only ever reduce what its holder
 *           may do — never widen it.
 *
 * Limited-mode scopes are stated here as literals rather than imported, because
 * the gateway owns the canonical list and this service must not be able to
 * widen it. If the two lists drift, the gateway's intersection still wins.
 */
import * as jose from "jose";

const ISSUER = "ubi.africa";
const AUDIENCE = "ubi-api";
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Book with cash, view history, read your own profile and balance, and finish
 * the step-up that lifts the limitation. Nothing that moves money.
 *
 * The token's `scopes` claim NARROWS the gateway's own limited-mode list, so a
 * scope missing here is lost to every limited session even when the gateway
 * allows it. This list therefore mirrors the gateway's LIMITED_MODE_SCOPES
 * (services/api-gateway/src/identity/scopes.ts) exactly:
 *
 *   ask:converse  the assistant's chat and read-only answers (its confirm,
 *                 ask:transact, stays off);
 *   travel:read   searching travel inventory and reading your own trips
 *                 (carts, checkout, cancel and switch — travel:book — stay
 *                 off).
 *
 * The fleet scopes (fleet:read, fleet:manage for fleet staff; fleet:driver
 * for a driver's offers, PIN signing, schedule and availability) are NOT on
 * this list, deliberately: a full-mode token carries no `scopes` claim, so
 * they come from the gateway's role ceiling (riders and drivers may be fleet
 * staff; only drivers hold fleet:driver), and a limited session holds none of
 * them — deny-by-default for the new capability. fleet-service's own staff
 * table decides owner / manager / read-only inside a fleet.
 *
 * services/api-gateway/tests/limited-token.test.ts sends tokens minted by
 * `issueAccessToken` through the gateway scope matrix, so a drift between the
 * two lists fails there.
 */
export const LIMITED_MODE_SCOPES: readonly string[] = [
  "profile:read",
  "ride:book:cash",
  "ride:read",
  "history:read",
  "wallet:read",
  "device:enroll",
  "auth:step_up",
  "support:write",
  "ask:converse",
  "travel:read",
];

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (value === undefined || value.length === 0) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(value);
}

export interface AccessTokenInput {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly mode: "full" | "limited";
  readonly deviceId: string;
  readonly sessionId?: string | undefined;
  readonly cityId?: string | null | undefined;
}

export interface IssuedToken {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly mode: "full" | "limited";
  readonly scopes: readonly string[] | null;
}

export async function issueAccessToken(
  input: AccessTokenInput,
): Promise<IssuedToken> {
  const scopes = input.mode === "limited" ? LIMITED_MODE_SCOPES : null;

  const claims: Record<string, unknown> = {
    email: input.email,
    role: input.role.toLowerCase(),
    permissions: [],
    mode: input.mode,
    deviceId: input.deviceId,
  };
  if (scopes !== null) {
    claims.scopes = [...scopes];
  }
  if (input.sessionId !== undefined) {
    claims.sid = input.sessionId;
  }
  if (input.cityId !== undefined && input.cityId !== null) {
    claims.cityId = input.cityId;
  }

  const accessToken = await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());

  return {
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    mode: input.mode,
    scopes,
  };
}
