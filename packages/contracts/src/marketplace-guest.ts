/**
 * Book for another adult on the negotiated-fare marketplace (A06 part B,
 * `marketplace_guest_bookings`, deny-by-default) — the building blocks
 * `marketplace.ts` composes into the publish, request, driver-job and
 * trip-link contracts, and re-exports.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - three roles, kept apart: the REQUESTER (the only authenticated party:
 *    publishes, selects, cancels), the PAYER (the requester in this slice —
 *    rider funding stays independent of the driver's 10% commission) and the
 *    PASSENGER (a named adult, not a UBI user, never looked up);
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
  /** Who funds the fare: the requester, in this slice. */
  payerRole: z.literal("requester"),
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

/**
 * `trip_access.issued` payload — for notification-service ONLY (one SMS with
 * the link; `smsCopy` carries `{link}` to fill from its trip-link base and
 * `accessToken`). Never fanned out to riders or drivers: the event is not on
 * the mp.* channel.
 */
export const MpTripAccessIssuedPayloadSchema = z.object({
  tokenId: z.string().min(1),
  requestId: z.string().min(1),
  scope: z.literal("guest_passenger"),
  expiresAt: Timestamp,
  accessToken: z.string().min(1),
  recipient: z.object({
    channel: z.literal("sms"),
    phone: z.string().min(1),
    firstName: z.string().min(1),
  }),
  smsCopy: z.string().includes("{link}"),
});
export type MpTripAccessIssuedPayload = z.infer<
  typeof MpTripAccessIssuedPayloadSchema
>;

/** `trip_access.declined` payload — audience: the requester. */
export const MpTripAccessDeclinedPayloadSchema = z.object({
  tokenId: z.string().min(1),
  requestId: z.string().min(1),
  requesterId: z.string().min(1),
  reason: z.literal("passenger_declined"),
  feeMinor: z.literal(0),
});
