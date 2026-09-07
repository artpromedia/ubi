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

export async function issueAccessToken(input: AccessTokenInput): Promise<IssuedToken> {
  const scopes = input.mode === "limited" ? LIMITED_MODE_SCOPES : null;

  const claims: Record<string, unknown> = {
    email: input.email,
    role: input.role.toLowerCase(),
    permissions: [],
    mode: input.mode,
    deviceId: input.deviceId,
  };
  if (scopes !== null) claims.scopes = [...scopes];
  if (input.sessionId !== undefined) claims.sid = input.sessionId;
  if (input.cityId !== undefined && input.cityId !== null) claims.cityId = input.cityId;

  const accessToken = await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());

  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, mode: input.mode, scopes };
}
