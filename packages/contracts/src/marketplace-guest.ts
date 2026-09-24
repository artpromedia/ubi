/**
 * Book for another adult on the negotiated-fare marketplace (A06 part B,
 * `marketplace_guest_bookings`, deny-by-default) — the building blocks
 * `marketplace.ts` composes into the publish, request, driver-job and
 * trip-link contracts, and re-exports.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - three roles, kept apart: the REQUESTER (the only authenticated party:
 *    publishes, selects, cancels), the PAYER (the requester — or, on a request
 *    booked on an organization (A06 part C), the organization's budget; rider
 *    funding stays independent of the driver's 10% commission either way) and
 *    the PASSENGER (a named adult, never looked up);
 *  - the requester ATTESTS the passenger is an adult who agreed to be booked
 *    for; an unaccompanied minor is refused outright
 *    (`unaccompanied_minor_not_supported`) — that needs a separately designed
 *    service and operating policy;
 *  - the passenger's trip link is an opaque token (stored server-side only
 *    as its SHA-256) bound to ONE trip, expiring and revocable, sent in the
 *    `X-Trip-Access-Token` header — never in a URL. It opens the verified
 *    driver card once a driver is committed, live status/ETA, the pickup PIN
 *    while it is relevant, the support contact and a free decline before
 *    pickup — nothing about the requester, the money or any other trip;
 *  - the requester sees the passenger's details on THAT request only; there
 *    is no read of a passenger's trips; the driver sees the first name and
 *    how pickup is verified, never the phone or the requester.
 */
import { z } from "zod";

const Timestamp = z.string().datetime({ offset: true });

/** The header a guest passenger's trip link sends its token in. */
export const MP_TRIP_ACCESS_HEADER = "X-Trip-Access-Token";

/** Why a passenger input was refused (`details.reason` on 422). */
export const MP_GUEST_REFUSAL_REASONS = [
  "passenger_attestation_required",
  "unaccompanied_minor_not_supported",
  "passenger_consent_required",
] as const;
export type MpGuestRefusalReason = (typeof MP_GUEST_REFUSAL_REASONS)[number];

/**
 * `POST /v1/mp/requests` → `passenger` (rides only). Both attestations are
 * required: `isAdult: false` is refused with
 * `unaccompanied_minor_not_supported`, `consentConfirmed: false` with
 * `passenger_consent_required`. `phone` is E.164. Names are letters (any
 * script), combining marks, spaces, hyphens and apostrophes (a family name
 * may also carry full stops): the first name opens a UBI-sent SMS to a number
 * the requester chose, so it can never carry a link, a number or a call to
 * action.
 */
export const MpPassengerInputSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{M}' \u2019-]+$/u),
    lastName: z
      .string()
      .trim()
      .max(60)
      .regex(/^[\p{L}\p{M}' .\u2019-]*$/u)
      .optional(),
    phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    isAdult: z.boolean(),
    consentConfirmed: z.boolean(),
  })
  .strict();
export type MpPassengerInput = z.infer<typeof MpPassengerInputSchema>;

/** Where the passenger's trip link stands, on the requester's view. */
export const MP_TRIP_ACCESS_STATUSES = [
  "active",
  "revoked",
  "expired",
  "declined",
] as const;

/**
 * The passenger block of the REQUESTER's own request view: what they
 * entered, on this request only. Never the link token.
 */
export const MpRequestPassengerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1).nullable(),
  phone: z.string().min(1),
  /**
   * Who funds the fare: the requester — or, on a request booked on an
   * organization (A06 part C, `business`), the organization's budget.
   */
  payerRole: z.enum(["requester", "organization"]),
  /** The attestation the requester made, stated back. */
  attestation: z.string().min(1),
  attestedAt: Timestamp,
  accessStatus: z.enum(MP_TRIP_ACCESS_STATUSES),
  accessSentAt: Timestamp.nullable(),
  accessExpiresAt: Timestamp.nullable(),
  declinedAt: Timestamp.nullable(),
});
export type MpRequestPassenger = z.infer<typeof MpRequestPassengerSchema>;

/** How the driver verifies pickup (from the market's PIN setting). */
export const MP_PICKUP_VERIFICATIONS = ["pin", "first_name"] as const;

/**
 * The passenger block on the DRIVER's job card: the first name and how pickup
 * is verified — never the phone, the family name or the requester.
 */
export const MpDriverPassengerSchema = z.object({
  firstName: z.string().min(1),
  bookedForAnother: z.literal(true),
  pickupVerification: z.enum(MP_PICKUP_VERIFICATIONS),
  note: z.string().min(1),
});
export type MpDriverPassenger = z.infer<typeof MpDriverPassengerSchema>;

/** The passenger's trip status, server-composed. */
export const MP_GUEST_TRIP_STATUSES = [
  "finding_driver",
  "confirming_driver",
  "driver_queued",
  "driver_on_the_way",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled",
  "declined",
] as const;
export type MpGuestTripStatus = (typeof MP_GUEST_TRIP_STATUSES)[number];

/** Why a trip link was refused (`details.reason` on 401). */
export const MP_TRIP_ACCESS_REFUSALS = [
  "invalid",
  "expired",
  "revoked",
] as const;

/** The driver's time to pickup: an ESTIMATE with its basis and age. */
export const MpGuestTripEtaSchema = z.object({
  label: z.string().min(1),
  etaSeconds: z.number().int().nonnegative().nullable(),
  basis: z.enum(["routed_leg", "unavailable"]),
  asOf: Timestamp,
});

/** How pickup is verified, and whether the PIN can be fetched now. */
export const MpGuestTripVerificationSchema = z.object({
  method: z.enum(MP_PICKUP_VERIFICATIONS),
  /** `GET /v1/mp/trip-access/pin` answers the PIN only while this is true. */
  pinAvailable: z.boolean(),
  instructions: z.string().min(1),
});

/** Who to contact: a trip reference and the market's emergency number. */
export const MpGuestTripSupportSchema = z.object({
  reference: z.string().min(1),
  emergencyNumber: z.string().min(1).nullable(),
  note: z.string().min(1),
});

/** Server-decided actions; a client never infers them. */
export const MpGuestTripActionsSchema = z.object({
  canDecline: z.boolean(),
  /** Declining before pickup is always free. */
  declineIsFree: z.literal(true),
  declineNote: z.string().min(1),
});

// ── TRIP-LINK SEALED DELIVERY CONTRACT (ride-service → notification-service)

/**
 * The `trip_access.issued` event rides the shared outbox relay, which
 * broadcasts every event to every `event:*` subscriber and keeps the row in
 * `public.outbox_events` — so the payload carries NOTHING sensitive in
 * clear. The passenger's phone, first name and the one-time link token travel
 * only inside `sealed`, an AES-256-GCM envelope only notification-service can
 * open:
 *
 *  - plaintext = the compact JSON object `{"phone","token","firstName"}`
 *    (consumers parse JSON; key order is not part of the contract);
 *  - AAD = the UTF-8 string `ubi.trip_access.v1|` + tokenId (the payload's
 *    `tokenId`, which is also the event's aggregate id) — an envelope cannot
 *    be replayed onto another token's event;
 *  - key = `TRIP_ACCESS_DELIVERY_KEY`, base64 (standard) of 32 random bytes,
 *    named by `TRIP_ACCESS_DELIVERY_KID`; the consumer also accepts
 *    `TRIP_ACCESS_DELIVERY_KEY_PREVIOUS` / `…_KID_PREVIOUS` for rotation and
 *    selects by `kid`;
 *  - iv = 12 fresh random bytes per message, never reused; `iv`, `ct` and
 *    the 16-byte `tag` are base64url without padding.
 *
 * Fail closed on both sides: without a usable key the producer refuses to
 * issue a trip link (the guest booking, and a link reissue, is refused 503
 * `service_unavailable` with `details.reason` `trip_link_delivery_unavailable`
 * — the canonical errors have no feature_unavailable code — and it never
 * emits clear values) and the consumer does not start its
 * trip_access consumer (and never sends). Both sides pin the interop vector
 * `TRIP_ACCESS_SEALED_TEST_VECTOR` in a test.
 */
export const TRIP_ACCESS_SEALED_VERSION = 1 as const;
export const TRIP_ACCESS_SEALED_ALG = "A256GCM" as const;
export const TRIP_ACCESS_SEALED_AAD_PREFIX = "ubi.trip_access.v1|" as const;
export const TRIP_ACCESS_DELIVERY_ENV = {
  key: "TRIP_ACCESS_DELIVERY_KEY",
  kid: "TRIP_ACCESS_DELIVERY_KID",
  previousKey: "TRIP_ACCESS_DELIVERY_KEY_PREVIOUS",
  previousKid: "TRIP_ACCESS_DELIVERY_KID_PREVIOUS",
} as const;

const Base64Url = /^[A-Za-z0-9_-]+$/;

export const MpTripAccessSealedSchema = z
  .object({
    v: z.literal(TRIP_ACCESS_SEALED_VERSION),
    alg: z.literal(TRIP_ACCESS_SEALED_ALG),
    kid: z.string().min(1).max(64),
    /** 12 bytes → 16 base64url characters. */
    iv: z.string().regex(Base64Url).length(16),
    ct: z.string().regex(Base64Url).min(1),
    /** 16 bytes → 22 base64url characters. */
    tag: z.string().regex(Base64Url).length(22),
  })
  .strict();
export type MpTripAccessSealed = z.infer<typeof MpTripAccessSealedSchema>;

/** What `sealed` opens to. */
export const MpTripAccessSealedPlaintextSchema = z.object({
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  token: z.string().min(1),
  firstName: z.string().min(1),
});
export type MpTripAccessSealedPlaintext = z.infer<
  typeof MpTripAccessSealedPlaintextSchema
>;

/**
 * The fixed interop vector (AES-256-GCM): sealing `plaintext` under `key` and
 * `iv` with `aad` must reproduce `ct` and `tag` exactly, and opening them must
 * yield the plaintext; a one-bit change to ct, tag or aad must fail to open.
 */
export const TRIP_ACCESS_SEALED_TEST_VECTOR = {
  keyBase64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  ivBase64Url: "oKGio6Slpqeoqaqr",
  aad: "ubi.trip_access.v1|tac_0123456789abcdef",
  plaintext:
    '{"phone":"+2348000000000","token":"tat_test_TOKEN_value_0001","firstName":"Ada"}',
  ctBase64Url:
    "nToMRSqlZ51YR6zhNE747kCcaSCih3JcviIE8hDAEG_wTGWLzlYMSTrvcJddNci8CUQwKQ6lfyFxbjtvhlyn1t3O9ht-xImF1tjdWeuv7sc",
  tagBase64Url: "F8NgMLVA0GJzT4obDPRkEA",
} as const;

/**
 * `trip_access.issued` payload — for notification-service ONLY (one SMS with
 * the link). `.strict()`: no access token, phone or first name may appear in
 * clear. `smsCopy` is a TEMPLATE: the consumer fills `{firstName}` from the
 * opened envelope and `{link}` from its trip-link base plus the token. Never
 * fanned out to riders or drivers: the event is not on the mp.* channel.
 */
export const MpTripAccessIssuedPayloadSchema = z
  .object({
    tokenId: z.string().min(1),
    requestId: z.string().min(1),
    scope: z.literal("guest_passenger"),
    expiresAt: Timestamp,
    recipient: z.object({ channel: z.literal("sms") }).strict(),
    smsCopy: z.string().includes("{link}").includes("{firstName}"),
    sealed: MpTripAccessSealedSchema,
  })
  .strict();
export type MpTripAccessIssuedPayload = z.infer<
  typeof MpTripAccessIssuedPayloadSchema
>;

/**
 * `GET /v1/mp/trip-access/pin` — the guest passenger's pickup PIN. `.strict()`:
 * unlike the requester's `MpPickupPin` it carries no execution ride id — the
 * trip link identifies nothing internal.
 */
export const MpTripAccessPinSchema = z
  .object({
    pin: z.string().min(1),
    /** The lifecycle state that still makes the PIN retrievable. */
    state: z.string().min(1),
    expiresAt: Timestamp,
  })
  .strict();
export type MpTripAccessPin = z.infer<typeof MpTripAccessPinSchema>;

/** `trip_access.declined` payload — audience: the requester. */
export const MpTripAccessDeclinedPayloadSchema = z.object({
  tokenId: z.string().min(1),
  requestId: z.string().min(1),
  requesterId: z.string().min(1),
  reason: z.literal("passenger_declined"),
  feeMinor: z.literal(0),
});
