/**
 * The signed internal identity context.
 *
 * The gateway is the only issuer. After it has validated the client's bearer
 * token it mints a short-lived HS256 JWS describing WHO the caller is, WHAT
 * they may do and WHERE they are scoped, and forwards it to the downstream
 * service. A downstream service verifies the signature before it believes a
 * single field, so a request that reaches a service directly — or one whose
 * plaintext `x-auth-*` headers were rewritten in transit — cannot impersonate
 * anyone.
 *
 * The signing key is an INTERNAL secret (`UBI_IDENTITY_SECRET`). It is not the
 * client-facing `JWT_SECRET`: if the two were equal, anyone holding a client
 * token could forge a context. That is refused at startup, not merely
 * discouraged. Verification also accepts `UBI_IDENTITY_SECRET_PREVIOUS` so the
 * key can be rotated without a flag day; the `kid` header says which key signed
 * a given context.
 */
import { ContractError } from "@ubi/contracts";
import * as jose from "jose";

import { type IdentityMode, isIdentityMode, isScope, type Scope } from "./scopes";

export const IDENTITY_CONTEXT_ISSUER = "ubi-gateway";
export const IDENTITY_CONTEXT_AUDIENCE = "ubi-internal";
export const IDENTITY_CONTEXT_TYP = "UBI-IC";

/** A context outlives one hop and nothing more. */
export const IDENTITY_CONTEXT_TTL_SECONDS = 120;

const MIN_SECRET_LENGTH = 32;

export interface IdentityContext {
  readonly userId: string;
  readonly role: string;
  readonly scopes: readonly Scope[];
  readonly modes: readonly IdentityMode[];
  /** City / tenant scope. `null` means the caller is not bound to one city. */
  readonly cityId: string | null;
  readonly tenantId: string | null;
  readonly sessionId: string | null;
  readonly deviceId: string | null;
  readonly requestId: string;
}

interface SigningKey {
  readonly kid: string;
  readonly key: Uint8Array;
}

function readSecret(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.length === 0 ? undefined : raw;
}

function assertUsable(name: string, secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (secret === process.env.JWT_SECRET) {
    throw new Error(
      `${name} must not equal JWT_SECRET — the internal context key may never be a key clients can hold`,
    );
  }
}

/** The key contexts are signed with. Read per call so rotation needs no restart. */
export function currentSigningKey(): SigningKey {
  const secret = readSecret("UBI_IDENTITY_SECRET");
  if (secret === undefined) {
    throw new Error("UBI_IDENTITY_SECRET environment variable is required");
  }
  assertUsable("UBI_IDENTITY_SECRET", secret);
  return { kid: readSecret("UBI_IDENTITY_KEY_ID") ?? "k1", key: new TextEncoder().encode(secret) };
}

/** Current key first, then the previous one, so a rotation overlaps cleanly. */
export function verificationKeys(): readonly SigningKey[] {
  const keys: SigningKey[] = [currentSigningKey()];
  const previous = readSecret("UBI_IDENTITY_SECRET_PREVIOUS");
  if (previous !== undefined) {
    assertUsable("UBI_IDENTITY_SECRET_PREVIOUS", previous);
    keys.push({
      kid: readSecret("UBI_IDENTITY_KEY_ID_PREVIOUS") ?? "k0",
      key: new TextEncoder().encode(previous),
    });
  }
  return keys;
}

export async function signIdentityContext(
  context: IdentityContext,
  ttlSeconds: number = IDENTITY_CONTEXT_TTL_SECONDS,
): Promise<string> {
  const { kid, key } = currentSigningKey();
  const now = Math.floor(Date.now() / 1000);

  return new jose.SignJWT({
    role: context.role,
    scp: [...context.scopes],
    mod: [...context.modes],
    city: context.cityId,
    tenant: context.tenantId,
    sid: context.sessionId,
    dev: context.deviceId,
    rid: context.requestId,
  })
    .setProtectedHeader({ alg: "HS256", kid, typ: IDENTITY_CONTEXT_TYP })
    .setSubject(context.userId)
    .setIssuer(IDENTITY_CONTEXT_ISSUER)
    .setAudience(IDENTITY_CONTEXT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Verifies a context and returns it. Every failure — bad signature, wrong
 * issuer, expired, unknown key, tampered payload — is the same
 * `unauthorized`, so a caller learns nothing from probing.
 */
export async function verifyIdentityContext(token: string): Promise<IdentityContext> {
  const keys = verificationKeys();
  for (const { key } of keys) {
    try {
      const { payload } = await jose.jwtVerify(token, key, {
        issuer: IDENTITY_CONTEXT_ISSUER,
        audience: IDENTITY_CONTEXT_AUDIENCE,
        algorithms: ["HS256"],
      });

      const userId = stringOrNull(payload.sub);
      const role = stringOrNull(payload.role);
      const requestId = stringOrNull(payload.rid);
      if (userId === null || role === null || requestId === null) break;

      return {
        userId,
        role,
        scopes: stringArray(payload.scp).filter(isScope),
        modes: stringArray(payload.mod).filter(isIdentityMode),
        cityId: stringOrNull(payload.city),
        tenantId: stringOrNull(payload.tenant),
        sessionId: stringOrNull(payload.sid),
        deviceId: stringOrNull(payload.dev),
        requestId,
      };
    } catch {
      // Try the next key; a rotation means the previous one may be correct.
    }
  }
  throw new ContractError("unauthorized", "Internal identity context is missing or not trusted");
}
