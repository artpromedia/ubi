/**
 * Verified driver-profile read model (P10) — the privacy-limited card
 * user-service resolves for a batch of driver identities.
 *
 * WHO MAY READ IT: service-to-service only. ride-service (offer, winner and
 * queue projections) and ask-service (offer review) call
 * `GET /internal/driver-profiles?ids=…` on user-service with their own
 * `x-service-name` + `x-service-key`. The gateway never forwards `/internal/*`
 * and strips both headers from client traffic, so an end user cannot
 * enumerate drivers through it.
 *
 * `driverId` is the driver's USER identity (`users.id`) — the id ride-service
 * stores on bids, awards and claims (`actor.UserID`) — not `drivers.id`.
 *
 * Non-negotiables encoded here rather than in prose:
 *  - nothing is fabricated: a field with no real source is `null` or an
 *    explicit `"unavailable"`, never a default. No ratings → `rating: null`,
 *    never `0` and never the `drivers.rating` column default of 5.0;
 *  - `rating` and `completedTrips` are derived from real trip rows, never from
 *    the denormalised `drivers.rating` / `drivers.total_rides` counters;
 *  - privacy by role: first name + last initial, a masked plate, a month-level
 *    tenure. No surname, phone, email, licence, full plate or location;
 *  - non-disclosure: an unknown id, a user who is not a driver, and a
 *    suspended / deactivated / deleted / not-yet-activated driver all resolve
 *    to the SAME `{ driverId, status: "unavailable" }`, so a caller cannot tell
 *    a suspension from a typo.
 *
 * A consumer may present a profile as verified only when
 * `verification.status === "verified"`; anything else is a driver whose
 * checks are not (or no longer) complete, and the card must say so.
 */
import { z } from "zod";

/** Upper bound on ids per call: a projection batch, not a directory export. */
export const DRIVER_PROFILE_BATCH_MAX = 50;

/** The only machine callers allowed to resolve driver profiles. */
export const DRIVER_PROFILE_CALLERS = ["ride-service", "ask-service"] as const;
export type DriverProfileCaller = (typeof DRIVER_PROFILE_CALLERS)[number];

/**
 * Where the verification stands, without saying why:
 *  - `verified`: approved by a reviewer, every document on file (and every
 *    expiry date recorded on the driver and vehicle) is current, and no
 *    identity review is undecided;
 *  - `pending_review`: never approved;
 *  - `not_current`: approved once, but a document or recorded expiry lapsed, a
 *    document was rejected, or an identity review is undecided. The reason is
 *    deliberately not disclosed.
 */
export const DRIVER_VERIFICATION_STATUSES = [
  "verified",
  "pending_review",
  "not_current",
] as const;
export type DriverVerificationStatus =
  (typeof DRIVER_VERIFICATION_STATUSES)[number];

/** The registered body type (Prisma `VehicleType`), lower-cased. */
export const DRIVER_VEHICLE_TYPES = [
  "sedan",
  "suv",
  "van",
  "motorcycle",
  "electric",
] as const;
export type DriverVehicleType = (typeof DRIVER_VEHICLE_TYPES)[number];

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const DriverProfileVehicleSchema = z
  .object({
    make: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    colour: z.string().min(1).nullable(),
    /**
     * The registered body type. NOT the city-sold vehicle class (go, comfort,
     * xl…): ride-service remains the authority on class eligibility.
     */
    type: z.enum(DRIVER_VEHICLE_TYPES),
    /** "•••" plus the last two plate characters; never the full plate. */
    plateMasked: z.string().min(1),
  })
  .strict();
export type DriverProfileVehicle = z.infer<typeof DriverProfileVehicleSchema>;

/** Present only when at least one completed trip carries a rating. */
export const DriverProfileRatingSchema = z
  .object({
    /** Mean of the real 1–5 ratings, rounded to two decimal places. */
    average: z.number().min(1).max(5),
    /** How many completed trips carry a rating. */
    count: z.number().int().positive(),
  })
  .strict();
export type DriverProfileRating = z.infer<typeof DriverProfileRatingSchema>;

export const DriverProfilePhotoSchema = z
  .object({
    /** Object-storage reference / URL the account holds. */
    ref: z.string().min(1),
    /**
     * Whether the photo was checked against the driver's identity. False today:
     * the only photo on file is the self-set account avatar, and liveness checks
     * keep a score, never an image.
     */
    verified: z.boolean(),
  })
  .strict();
export type DriverProfilePhoto = z.infer<typeof DriverProfilePhotoSchema>;

export const AvailableDriverProfileSchema = z
  .object({
    driverId: z.string().uuid(),
    status: z.literal("available"),
    /** First name + last initial ("Adaeze O."); null when no name is on file. */
    displayName: z.string().min(1).nullable(),
    /** Two-letter avatar fallback ("AO"); null when no name is on file. */
    initials: z.string().min(1).nullable(),
    photo: DriverProfilePhotoSchema.nullable(),
    verification: z
      .object({
        status: z.enum(DRIVER_VERIFICATION_STATUSES),
        /** Approval date (YYYY-MM-DD), only while `status` is "verified". */
        verifiedAt: IsoDateSchema.nullable(),
      })
      .strict(),
    /** Null when no vehicle is attached to the driver profile. */
    vehicle: DriverProfileVehicleSchema.nullable(),
    /** Null when no completed trip has been rated — never 0, never a default. */
    rating: DriverProfileRatingSchema.nullable(),
    /** Completed trips counted from real trip rows. */
    completedTrips: z.number().int().nonnegative(),
    /** Month the driver profile was created (YYYY-MM). */
    memberSince: IsoMonthSchema,
    /**
     * Verified accessibility capability. The data model has no verified
     * vehicle-capability source yet, so this is always "unavailable" — a
     * consumer must not claim accessible supply from it.
     */
    accessibility: z.object({ status: z.literal("unavailable") }).strict(),
  })
  .strict();
export type AvailableDriverProfile = z.infer<
  typeof AvailableDriverProfileSchema
>;

/** Unknown, not a driver, or not disclosable — indistinguishable on purpose. */
export const UnavailableDriverProfileSchema = z
  .object({
    driverId: z.string().uuid(),
    status: z.literal("unavailable"),
  })
  .strict();
export type UnavailableDriverProfile = z.infer<
  typeof UnavailableDriverProfileSchema
>;

export const DriverProfileResolutionSchema = z.discriminatedUnion("status", [
  AvailableDriverProfileSchema,
  UnavailableDriverProfileSchema,
]);
export type DriverProfileResolution = z.infer<
  typeof DriverProfileResolutionSchema
>;

/**
 * Response body `data` for `GET /internal/driver-profiles`. One entry per
 * distinct requested id, in request order.
 */
export const DriverProfilesResponseSchema = z
  .object({
    profiles: z
      .array(DriverProfileResolutionSchema)
      .max(DRIVER_PROFILE_BATCH_MAX),
  })
  .strict();
export type DriverProfilesResponse = z.infer<
  typeof DriverProfilesResponseSchema
>;
