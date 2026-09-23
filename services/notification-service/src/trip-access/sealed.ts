/**
 * TRIP-LINK SEALED DELIVERY CONTRACT — consumer side.
 *
 * Shared with ride-service's producer (internal/marketplace/trip_access_seal.go)
 * and described in packages/contracts/src/marketplace-guest.ts. The
 * `trip_access.issued` event rides the shared outbox relay, which broadcasts
 * every event to every `event:*` subscriber and keeps the row in
 * `public.outbox_events`, so the payload carries nothing sensitive in clear.
 * The passenger's phone, first name and the one-time link token travel only in
 *
 *   sealed = {"v":1,"alg":"A256GCM","kid":…,"iv":…,"ct":…,"tag":…}
 *
 * with iv/ct/tag base64url WITHOUT padding, where
 *
 *   - plaintext = the compact JSON object {"phone","token","firstName"}
 *     (parsed as JSON here; key order is not part of the contract);
 *   - AAD       = the UTF-8 string "ubi.trip_access.v1|" + tokenId (the
 *     payload's tokenId, which is also the event's aggregate id), so an
 *     envelope cannot be replayed onto another token's event;
 *   - key       = TRIP_ACCESS_DELIVERY_KEY, standard base64 of exactly 32
 *     bytes, named by TRIP_ACCESS_DELIVERY_KID. TRIP_ACCESS_DELIVERY_KEY_PREVIOUS
 *     / TRIP_ACCESS_DELIVERY_KID_PREVIOUS are also accepted for rotation and
 *     the key is selected by the envelope's `kid`;
 *   - iv        = 12 bytes (fresh per message on the producer side);
 *   - tag       = the 16-byte GCM tag.
 *
 * This module only OPENS. Fail closed: a key ring that cannot be built means
 * the trip-access consumer does not start (see ./consumer.ts), and any
 * envelope that does not authenticate is refused — never partially used.
 */
import { createDecipheriv } from "node:crypto";

export const TRIP_ACCESS_SEALED_VERSION = 1;
export const TRIP_ACCESS_SEALED_ALG = "A256GCM";
export const TRIP_ACCESS_AAD_PREFIX = "ubi.trip_access.v1|";

export const TRIP_ACCESS_ENV = {
  key: "TRIP_ACCESS_DELIVERY_KEY",
  kid: "TRIP_ACCESS_DELIVERY_KID",
  previousKey: "TRIP_ACCESS_DELIVERY_KEY_PREVIOUS",
  previousKid: "TRIP_ACCESS_DELIVERY_KID_PREVIOUS",
} as const;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Same bound the producer enforces on a key id. */
const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
/** E.164, as the contract's MpTripAccessSealedPlaintextSchema states it. */
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
/** The token goes into a URL fragment verbatim: URL-safe characters only. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_FIRST_NAME = 64;

export interface TripAccessSealed {
  readonly v: number;
  readonly alg: string;
  readonly kid: string;
  readonly iv: string;
  readonly ct: string;
  readonly tag: string;
}

export interface TripAccessPlaintext {
  readonly phone: string;
  readonly token: string;
  readonly firstName: string;
}

/** Keys by id. Built once at startup; never logged. */
export interface TripAccessKeyRing {
  readonly currentKid: string;
  readonly kids: readonly string[];
  keyFor(kid: string): Buffer | undefined;
}

export type KeyRingResult =
  | {
      readonly ok: true;
      readonly ring: TripAccessKeyRing;
      /** A configured-but-unusable PREVIOUS pair, ignored (current still works). */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Strict standard base64 of exactly 32 bytes, as the producer's
 * `base64.StdEncoding.Strict()` reads it: canonical (re-encodes to the same
 * text, padding included) or rejected. A key is used exactly as configured
 * or not at all.
 */
function decodeKey(text: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    return null;
  }
  const key = Buffer.from(text, "base64");
  if (key.toString("base64") !== text || key.length !== KEY_BYTES) {
    return null;
  }
  return key;
}

function keyPair(
  keyText: string | undefined,
  kidText: string | undefined,
  label: string,
): { kid: string; key: Buffer } | { error: string } | null {
  const key = (keyText ?? "").trim();
  const kid = (kidText ?? "").trim();
  if (key === "" && kid === "") {
    return null;
  }
  if (key === "" || kid === "") {
    return { error: `${label}: key and key id must both be set` };
  }
  if (!KID_PATTERN.test(kid)) {
    return { error: `${label}: key id must match [A-Za-z0-9._-]{1,64}` };
  }
  const decoded = decodeKey(key);
  if (decoded === null) {
    return {
      error: `${label}: key must be standard base64 of exactly ${KEY_BYTES} bytes`,
    };
  }
  return { kid, key: decoded };
}

/**
 * Build the key ring from the environment. The CURRENT pair is mandatory; the
 * PREVIOUS pair is optional and, when half-set or invalid, ignored with a
 * warning (envelopes sealed under it then fail to open and dead-letter —
 * they are never sent unauthenticated). Reasons never contain key material.
 */
export function loadTripAccessKeyRing(
  env: Readonly<Record<string, string | undefined>>,
): KeyRingResult {
  const current = keyPair(
    env[TRIP_ACCESS_ENV.key],
    env[TRIP_ACCESS_ENV.kid],
    "current",
  );
  if (current === null) {
    return {
      ok: false,
      reason: `${TRIP_ACCESS_ENV.key} and ${TRIP_ACCESS_ENV.kid} are not configured`,
    };
  }
  if ("error" in current) {
    return { ok: false, reason: current.error };
  }
  const keys = new Map<string, Buffer>([[current.kid, current.key]]);
  const warnings: string[] = [];
  const previous = keyPair(
    env[TRIP_ACCESS_ENV.previousKey],
    env[TRIP_ACCESS_ENV.previousKid],
    "previous",
  );
  if (previous !== null) {
    if ("error" in previous) {
      warnings.push(`${previous.error}; the previous key is ignored`);
    } else if (previous.kid === current.kid) {
      warnings.push(
        "previous: key id equals the current key id; the previous key is ignored",
      );
    } else {
      keys.set(previous.kid, previous.key);
    }
  }
  const ring: TripAccessKeyRing = {
    currentKid: current.kid,
    kids: [...keys.keys()],
    keyFor: (kid) => keys.get(kid),
  };
  return { ok: true, ring, warnings };
}

export type OpenFailure =
  | "malformed_envelope"
  | "unknown_kid"
  | "auth_failed"
  | "invalid_plaintext";

export class TripAccessOpenError extends Error {
  constructor(readonly code: OpenFailure) {
    super(`trip access envelope refused: ${code}`);
    this.name = "TripAccessOpenError";
  }
}

/** Canonical base64url without padding, of an exact byte length when given. */
function decodeBase64Url(text: unknown, bytes?: number): Buffer | null {
  if (typeof text !== "string" || !BASE64URL_PATTERN.test(text)) {
    return null;
  }
  const decoded = Buffer.from(text, "base64url");
  if (decoded.toString("base64url") !== text) {
    return null;
  }
  if (bytes !== undefined && decoded.length !== bytes) {
    return null;
  }
  return decoded;
}

/** The AAD for one token's event. */
export function tripAccessAad(tokenId: string): Buffer {
  return Buffer.from(TRIP_ACCESS_AAD_PREFIX + tokenId, "utf8");
}

/**
 * Structural check of a `sealed` object, mirroring the contract's
 * MpTripAccessSealedSchema (strict: no extra keys).
 */
export function isSealedEnvelope(value: unknown): value is TripAccessSealed {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["v", "alg", "kid", "iv", "ct", "tag"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return false;
  }
  return (
    record.v === TRIP_ACCESS_SEALED_VERSION &&
    record.alg === TRIP_ACCESS_SEALED_ALG &&
    typeof record.kid === "string" &&
    KID_PATTERN.test(record.kid) &&
    decodeBase64Url(record.iv, IV_BYTES) !== null &&
    decodeBase64Url(record.ct) !== null &&
    decodeBase64Url(record.tag, TAG_BYTES) !== null
  );
}

/**
 * Open one envelope for `tokenId`. Throws TripAccessOpenError — never returns
 * a partially-authenticated or unvalidated plaintext.
 */
export function openTripAccess(
  ring: TripAccessKeyRing,
  tokenId: string,
  sealed: unknown,
): TripAccessPlaintext {
  if (!isSealedEnvelope(sealed)) {
    throw new TripAccessOpenError("malformed_envelope");
  }
  const key = ring.keyFor(sealed.kid);
  if (key === undefined) {
    throw new TripAccessOpenError("unknown_kid");
  }
  const iv = decodeBase64Url(sealed.iv, IV_BYTES);
  const ct = decodeBase64Url(sealed.ct);
  const tag = decodeBase64Url(sealed.tag, TAG_BYTES);
  if (iv === null || ct === null || tag === null) {
    throw new TripAccessOpenError("malformed_envelope"); // isSealedEnvelope checked; defensive
  }

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(tripAccessAad(tokenId));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new TripAccessOpenError("auth_failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new TripAccessOpenError("invalid_plaintext");
  } finally {
    plaintext.fill(0);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TripAccessOpenError("invalid_plaintext");
  }
  const record = parsed as Record<string, unknown>;
  const { phone, token, firstName } = record;
  if (
    typeof phone !== "string" ||
    !E164_PATTERN.test(phone) ||
    typeof token !== "string" ||
    !TOKEN_PATTERN.test(token) ||
    typeof firstName !== "string" ||
    firstName.trim().length === 0
  ) {
    throw new TripAccessOpenError("invalid_plaintext");
  }
  return {
    phone,
    token,
    firstName: firstName.trim().slice(0, MAX_FIRST_NAME),
  };
}
