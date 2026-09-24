/**
 * TEST SUPPORT ONLY — never imported by production code (tsup bundles from
 * src/index.ts, which does not reach this file).
 *
 * The notification service only OPENS trip-access envelopes; ride-service
 * seals them. Tests need realistic sealed payloads, so this is the producer's
 * algorithm (AES-256-GCM, AAD "ubi.trip_access.v1|" + tokenId, 12-byte IV,
 * base64url without padding) plus envelope builders. The fixed interop vector
 * pins this helper to the contract too (sealed.test.ts).
 */
import { createCipheriv, randomBytes } from "node:crypto";

import type { EventEnvelope } from "@ubi/contracts";

/** The contract's fixed interop vector (TRIP_ACCESS_SEALED_TEST_VECTOR). */
export const VECTOR = {
  keyBase64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  ivBase64Url: "oKGio6Slpqeoqaqr",
  tokenId: "tac_0123456789abcdef",
  aad: "ubi.trip_access.v1|tac_0123456789abcdef",
  plaintext:
    '{"phone":"+2348000000000","token":"tat_test_TOKEN_value_0001","firstName":"Ada"}',
  ctBase64Url:
    "nToMRSqlZ51YR6zhNE747kCcaSCih3JcviIE8hDAEG_wTGWLzlYMSTrvcJddNci8CUQwKQ6lfyFxbjtvhlyn1t3O9ht-xImF1tjdWeuv7sc",
  tagBase64Url: "F8NgMLVA0GJzT4obDPRkEA",
} as const;

/** The SMS template ride-service sends (guest.go guestSMSTemplate). */
export const GUEST_SMS_TEMPLATE =
  "{firstName}, a UBI rider has requested a ride for you. No driver is confirmed yet. " +
  "Follow the trip, see your driver and pickup PIN once one is confirmed, or decline for free before pickup: {link}";

export function randomKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

export interface SealInput {
  readonly keyBase64: string;
  readonly kid: string;
  readonly tokenId: string;
  readonly plaintext: string;
  /** Fixed IV for vector tests; otherwise 12 fresh random bytes. */
  readonly iv?: Buffer;
}

export function sealForTest(input: SealInput): {
  v: 1;
  alg: "A256GCM";
  kid: string;
  iv: string;
  ct: string;
  tag: string;
} {
  const key = Buffer.from(input.keyBase64, "base64");
  const iv = input.iv ?? randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`ubi.trip_access.v1|${input.tokenId}`, "utf8"));
  const ct = Buffer.concat([
    cipher.update(Buffer.from(input.plaintext, "utf8")),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "A256GCM",
    kid: input.kid,
    iv: iv.toString("base64url"),
    ct: ct.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export interface IssuedInput {
  readonly keyBase64: string;
  readonly kid: string;
  readonly tokenId: string;
  readonly phone: string;
  readonly token: string;
  readonly firstName: string;
  readonly eventId?: string;
  readonly requestId?: string;
  readonly expiresAt?: string;
  readonly smsCopy?: string;
  /** Extra payload keys (e.g. a legacy producer's clear fields). */
  readonly extraPayload?: Record<string, unknown>;
}

/** A contract-conforming trip_access.issued envelope. */
export function issuedEnvelope(input: IssuedInput): EventEnvelope {
  const sealed = sealForTest({
    keyBase64: input.keyBase64,
    kid: input.kid,
    tokenId: input.tokenId,
    plaintext: JSON.stringify({
      phone: input.phone,
      token: input.token,
      firstName: input.firstName,
    }),
  });
  return {
    id: input.eventId ?? `evt_${randomBytes(8).toString("hex")}`,
    name: "trip_access.issued",
    version: 1,
    occurredAt: "2026-09-23T10:00:00.000Z",
    actor: { type: "rider", id: "11111111-1111-4111-8111-111111111111" },
    subject: { type: "trip_access", id: input.tokenId },
    idempotencyKey: `trip_access.issued:${input.tokenId}`.slice(0, 64),
    fromVersion: null,
    toVersion: 1,
    cityId: "lagos",
    payload: {
      tokenId: input.tokenId,
      requestId: input.requestId ?? "22222222-2222-4222-8222-222222222222",
      scope: "guest_passenger",
      expiresAt: input.expiresAt ?? "2099-01-01T00:00:00Z",
      recipient: { channel: "sms" },
      smsCopy: input.smsCopy ?? GUEST_SMS_TEMPLATE,
      sealed,
      ...input.extraPayload,
    },
  };
}
