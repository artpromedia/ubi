/**
 * Identity routes (slice 03): OTP, step-up, PIN, driver documents, SIM-swap and
 * the review queue.
 *
 * Everything a user calls is authorised by the gateway's SIGNED identity
 * context (identity/context.ts). Everything a machine calls — the telco webhook
 * and the sweeps — is authorised by a shared secret with a constant-time
 * comparison (identity/internal-auth.ts). There is no path that trusts a plain
 * `x-auth-user-id` header.
 *
 * Paths are mounted WITHOUT the `/v1` prefix, because the gateway strips it
 * before forwarding. `POST /v1/auth/step-up/selfie` at the edge arrives here as
 * `POST /auth/step-up/selfie`.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";
import { generateReferralCode } from "@ubi/utils";

import { writeAudit } from "../identity/audit";
import {
  decideIdentityCase,
  DecideCaseSchema,
  listOpenIdentityCases,
} from "../identity/cases";
import {
  getIdentity,
  IDENTITY_HEADER,
  requireIdentity,
  requireScope,
  verifyIdentityContext,
} from "../identity/context";
import { assertLaunchedCity, type IdentityDeps } from "../identity/deps";
import {
  ClientDeviceIdSchema,
  enrollDevice,
  internalDeviceId,
  RecoverDeviceSchema,
  recoverTrustedDevice,
} from "../identity/devices";
import {
  listDriverDocuments,
  reviewDocument,
  sweepDocumentExpiry,
  uploadDocument,
  UploadDocumentSchema,
} from "../identity/documents";
import { driverEligibility } from "../identity/driver";
import {
  contractRoute,
  ok,
  parseBody,
  requireIdempotencyKey,
} from "../identity/http";
import {
  requireReviewerRole,
  requireServiceKey,
  SERVICE_KEY_HEADER,
  TELCO_SIGNATURE_HEADER,
  verifyTelcoSignature,
} from "../identity/internal-auth";
import { livenessRequiredForShift } from "../identity/liveness";
import {
  requestOtp,
  RequestOtpSchema,
  verifyOtp,
  VerifyOtpSchema,
} from "../identity/otp";
import {
  pinState,
  resetPin,
  ResetPinSchema,
  verifyPin,
  VerifyPinSchema,
} from "../identity/pin";
import {
  recordSimSwap,
  safeModeState,
  sweepSafeModeExits,
} from "../identity/safe-mode";
import {
  createSession,
  revokeSession,
  rotateSession,
  rotateSessionForId,
  toAuthUserSummary,
} from "../identity/sessions";
import {
  approveFromTrustedDevice,
  ApproveFromTrustedDeviceSchema,
  passSelfieStepUp,
  SelfieStepUpSchema,
} from "../identity/step-up";
import { issueAccessToken } from "../identity/tokens";

const SimSwapWebhookSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "phone must be in E.164 form"),
  reportedAt: z.string().datetime({ offset: true }),
  source: z.string().min(2).max(60),
});

const SignupSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "phone must be in E.164 form"),
  email: z.string().email().optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  cityId: z.string().trim().min(2).max(16),
  country: z.string().trim().length(2).optional(),
  language: z.string().trim().min(2).max(5).default("en"),
  role: z.enum(["RIDER", "DRIVER"]).default("RIDER"),
  referralCode: z.string().trim().min(3).max(32).optional(),
});

const VerifyOtpAndEnrolSchema = VerifyOtpSchema.extend({
  deviceId: ClientDeviceIdSchema,
  platform: z.enum(["ios", "android", "web"]).optional(),
  model: z.string().min(1).max(120).optional(),
});

const RefreshSessionSchema = z.object({
  refreshToken: z.string().min(10).max(512),
  deviceId: ClientDeviceIdSchema.optional(),
});

const LogoutSessionSchema = z
  .object({
    refreshToken: z.string().min(1).max(512).optional(),
  })
  .optional();

const SelectCitySchema = z.object({
  cityId: z.string().trim().min(2).max(16),
});

const ReviewDocumentSchema = z.object({
  decision: z.enum(["valid", "rejected"]),
  note: z.string().min(4).max(500),
});

async function driverForUser(
  deps: IdentityDeps,
  userId: string,
): Promise<{ id: string; vehicleId: string | null }> {
  const driver = await deps.prisma.driver.findFirst({
    where: { userId },
    select: { id: true, vehicleId: true },
  });
  if (driver === null) {
    throw new ContractError("forbidden", "This account has no driver profile");
  }
  return driver;
}

export function createIdentityRoutes(deps: IdentityDeps): Hono {
  const routes = new Hono();

  // =========================================================================
  // Pre-authentication — the caller has no token yet
  // =========================================================================

  /**
   * GET /auth/cities — cities config-service marks as launched (`active`).
   *
   * Sign-up and the post-login city picker both read from this list so a user
   * can never select an unlaunched or unknown city.
   */
  routes.get(
    "/auth/cities",
    contractRoute(async (c) => {
      const cities = await deps.cities.listLaunchedCities();
      return ok(c, { cities });
    }),
  );

  /**
   * POST /auth/signup — create a rider or driver account with a verified
   * launched home city (DEC-8) and send the hardened scrypt-hashed OTP.
   */
  routes.post(
    "/auth/signup",
    contractRoute(async (c) => {
      const body = await parseBody(c, SignupSchema);
      const city = await assertLaunchedCity(deps, body.cityId);

      if (
        body.country !== undefined &&
        body.country.toUpperCase() !== city.country.toUpperCase()
      ) {
        throw new ContractError(
          "validation_failed",
          "Selected city does not match the stated country",
          { cityId: city.id, cityCountry: city.country },
        );
      }

      const existingPhone = await deps.prisma.user.findUnique({
        where: { phone: body.phone },
      });

      if (
        existingPhone !== null &&
        (existingPhone.phoneVerified || existingPhone.status !== "PENDING")
      ) {
        throw new ContractError(
          "conflict",
          "An account with this phone number already exists. Sign in instead.",
        );
      }

      if (body.email !== undefined) {
        const existingEmail = await deps.prisma.user.findUnique({
          where: { email: body.email },
          select: { id: true },
        });
        if (existingEmail !== null && existingEmail.id !== existingPhone?.id) {
          throw new ContractError(
            "conflict",
            "An account with this email address already exists.",
          );
        }
      }

      let referredBy: string | undefined;
      if (body.referralCode !== undefined) {
        const referrer = await deps.prisma.rider.findUnique({
          where: { referralCode: body.referralCode },
          select: { id: true },
        });
        if (referrer !== null) {
          referredBy = referrer.id;
        }
      }

      const user =
        existingPhone !== null
          ? await deps.prisma.user.update({
              where: { id: existingPhone.id },
              data: {
                firstName: body.firstName,
                lastName: body.lastName,
                country: city.country,
                homeCityId: city.id,
                language: body.language,
                role: body.role,
                ...(body.email === undefined ? {} : { email: body.email }),
              },
            })
          : await deps.prisma.$transaction(async (tx) => {
              const created = await tx.user.create({
                data: {
                  phone: body.phone,
                  email: body.email ?? `${body.phone}@placeholder.ubi.africa`,
                  passwordHash: "",
                  firstName: body.firstName,
                  lastName: body.lastName,
                  country: city.country,
                  homeCityId: city.id,
                  language: body.language,
                  role: body.role,
                  status: "PENDING",
                  ...(body.role === "RIDER"
                    ? {
                        rider: {
                          create: {
                            referralCode: generateReferralCode(),
                            ...(referredBy === undefined ? {} : { referredBy }),
                          },
                        },
                      }
                    : {}),
                },
              });

              await writeAudit(tx, {
                actorId: created.id,
                actorRole: created.role,
                action: "user.signed_up",
                subjectType: "user",
                subjectId: created.id,
                after: {
                  role: created.role,
                  homeCityId: city.id,
                  country: city.country,
                },
                reason: "self_signup",
              });

              return created;
            });

      const otp = await requestOtp(
        deps,
        { phone: body.phone, purpose: "verification" },
        user.id,
        city.id,
      );

      return ok(
        c,
        {
          user: toAuthUserSummary(user),
          expiresIn: otp.expiresInSeconds,
          expiresInSeconds: otp.expiresInSeconds,
          resendAfterSeconds: otp.resendAfterSeconds,
        },
        201,
      );
    }),
  );

  /**
   * POST /auth/otp — send a login code.
   *
   * Hardened replacement for `/auth/login/otp`: the code is hashed at rest,
   * the cache key is a hash of the number, and both a resend cooldown and an
   * hourly cap apply.
   */
  routes.post(
    "/auth/otp",
    contractRoute(async (c) => {
      const body = await parseBody(c, RequestOtpSchema);
      const user = await deps.prisma.user.findUnique({
        where: { phone: body.phone },
        select: { id: true, status: true, homeCityId: true },
      });
      if (user?.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }
      const result = await requestOtp(
        deps,
        body,
        user?.id,
        user?.homeCityId ?? null,
      );
      return ok(c, result);
    }),
  );

  /**
   * POST /auth/verify — check the code, activate pending sign-ups, create a
   * rotatable session, and enrol the device.
   *
   * DEC-7 (A): a brand-new account's FIRST device is trusted once its OTP is
   * verified (`first_device_trusted`); every subsequent device yields a
   * LIMITED-MODE token until step-up passes.
   * DEC-8 (A): the user's `homeCityId` is signed into the token; existing
   * accounts without a city receive `citySelectionRequired: true`.
   */
  routes.post(
    "/auth/verify",
    contractRoute(async (c) => {
      const body = await parseBody(c, VerifyOtpAndEnrolSchema);
      let user = await deps.prisma.user.findUnique({
        where: { phone: body.phone },
        select: {
          id: true,
          phone: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          phoneVerified: true,
          homeCityId: true,
          avatarUrl: true,
        },
      });
      if (user === null) {
        throw new ContractError("not_found", "No account uses that number");
      }
      if (user.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }

      const verified = await verifyOtp(
        deps,
        {
          phone: body.phone,
          code: body.code,
        },
        user.homeCityId,
      );

      if (user.status === "PENDING" || !user.phoneVerified) {
        user = await deps.prisma.user.update({
          where: { id: user.id },
          data: {
            status: user.status === "PENDING" ? "ACTIVE" : user.status,
            phoneVerified: true,
          },
          select: {
            id: true,
            phone: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            phoneVerified: true,
            homeCityId: true,
            avatarUrl: true,
          },
        });
      }

      const resolvedDeviceId = internalDeviceId(user.id, body.deviceId);
      const session = await createSession(deps, {
        userId: user.id,
        deviceId: resolvedDeviceId,
        platform: body.platform,
        ipAddress:
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          c.req.header("x-real-ip"),
        userAgent: c.req.header("user-agent"),
      });

      const enrolment = await enrollDevice(deps, {
        deviceId: body.deviceId,
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.model === undefined ? {} : { model: body.model }),
        userId: user.id,
        role: user.role,
        email: user.email,
        cityId: user.homeCityId,
        sessionId: session.sessionId,
        otpVerified: true,
      });

      const tokenPayload = {
        accessToken: enrolment.token.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: enrolment.token.expiresIn,
        mode: enrolment.token.mode,
        scopes: enrolment.token.scopes,
      };

      return ok(c, {
        phoneVerified: verified.verified,
        grantsMoneyAccess: verified.grantsMoneyAccess,
        citySelectionRequired: user.homeCityId === null,
        user: toAuthUserSummary(user),
        device: {
          id: enrolment.deviceId,
          trusted: enrolment.trusted,
        },
        stepUp: {
          required: enrolment.status === "step_up_required",
          challengeId: enrolment.challengeId,
          methods: enrolment.methods,
          unavailable: enrolment.unavailable,
        },
        token: tokenPayload,
        tokens: tokenPayload,
      });
    }),
  );

  /**
   * POST /auth/refresh — rotate the session's refresh token and mint a fresh
   * access token carrying the user's current `homeCityId` and device trust mode.
   */
  routes.post(
    "/auth/refresh",
    contractRoute(async (c) => {
      const body = await parseBody(c, RefreshSessionSchema);
      const rotated = await rotateSession(deps, {
        refreshToken: body.refreshToken,
        clientDeviceId: body.deviceId,
      });
      return ok(c, {
        user: rotated.user,
        citySelectionRequired: rotated.citySelectionRequired,
        tokens: rotated.tokens,
      });
    }),
  );

  /**
   * POST /auth/logout — invalidate the caller's session by signed context
   * (`sessionId` / `userId`) or refresh token.
   */
  routes.post(
    "/auth/logout",
    contractRoute(async (c) => {
      let body: z.infer<typeof LogoutSessionSchema>;
      try {
        const rawText = await c.req.text();
        body =
          rawText.trim().length > 0
            ? LogoutSessionSchema.parse(JSON.parse(rawText))
            : undefined;
      } catch {
        body = undefined;
      }

      let sessionId: string | null = null;
      let userId: string | null = null;
      const identityHeader = c.req.header(IDENTITY_HEADER);
      if (identityHeader !== undefined && identityHeader.length > 0) {
        try {
          const verified = await verifyIdentityContext(identityHeader);
          sessionId = verified.sessionId;
          userId = verified.userId;
        } catch {
          // Expired or absent identity still allows revoking by refreshToken.
        }
      }

      await revokeSession(deps, {
        sessionId,
        userId,
        refreshToken: body?.refreshToken,
      });

      return ok(c, { message: "Logged out successfully" });
    }),
  );

  /**
   * POST /webhooks/telco/sim-swap — a telco reports a SIM change.
   *
   * Signed with a shared secret over the raw body. A verified report puts the
   * wallet into safe mode for the configured window and emits
   * `wallet.safe_mode_entered`.
   */
  routes.post(
    "/webhooks/telco/sim-swap",
    contractRoute(async (c) => {
      const rawBody = await c.req.text();
      verifyTelcoSignature(rawBody, c.req.header(TELCO_SIGNATURE_HEADER));

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody) as unknown;
      } catch {
        throw new ContractError(
          "validation_failed",
          "Request body must be JSON",
        );
      }
      const body = SimSwapWebhookSchema.parse(parsedJson);

      const user = await deps.prisma.user.findUnique({
        where: { phone: body.phone },
        select: { id: true },
      });
      if (user === null) {
        // Nothing to hold, and nothing to tell the telco about who we do or do
        // not have on file.
        return ok(c, { accepted: true, held: false });
      }

      const result = await recordSimSwap(deps, {
        userId: user.id,
        phone: body.phone,
        reportedAt: new Date(body.reportedAt),
        source: body.source,
      });

      return ok(c, {
        accepted: true,
        held: result.entered,
        until: result.until.toISOString(),
      });
    }),
  );

  // =========================================================================
  // Machine callers — scheduled sweeps
  // =========================================================================

  routes.post(
    "/identity/jobs/document-expiry",
    contractRoute(async (c) => {
      requireServiceKey(c.req.header(SERVICE_KEY_HEADER));
      return ok(c, await sweepDocumentExpiry(deps));
    }),
  );

  routes.post(
    "/identity/jobs/safe-mode-exit",
    contractRoute(async (c) => {
      requireServiceKey(c.req.header(SERVICE_KEY_HEADER));
      return ok(c, { exited: await sweepSafeModeExits(deps) });
    }),
  );

  // =========================================================================
  // Authenticated — gateway identity context required
  //
  // `requireIdentity` is attached PER ROUTE, never with `use("*")`. This router
  // is mounted at "/" alongside the service's existing routes, and a wildcard
  // middleware here would run for `/users/*`, `/drivers/*` and `/sessions/*`
  // too, locking out every endpoint this slice does not own.
  // =========================================================================

  /**
   * POST /auth/city — set or change the caller's home city (DEC-8) and re-issue
   * a fresh token carrying the verified `cityId`.
   *
   * Requires `profile:read` (kept in limited mode) so an existing cityless
   * account on an unverified device can still select a launched city.
   */
  routes.post(
    "/auth/city",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      requireIdempotencyKey(c);
      const body = await parseBody(c, SelectCitySchema);

      const city = await assertLaunchedCity(deps, body.cityId);

      const current = await deps.prisma.user.findUnique({
        where: { id: principal.userId },
        select: {
          id: true,
          phone: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          homeCityId: true,
          avatarUrl: true,
        },
      });
      if (current === null) {
        throw new ContractError("not_found", "Account not found");
      }
      if (current.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }

      const updatedUser = await deps.prisma.$transaction(async (tx) => {
        const nextUser = await tx.user.update({
          where: { id: principal.userId },
          data: {
            homeCityId: city.id,
            country: city.country,
          },
          select: {
            id: true,
            phone: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            homeCityId: true,
            avatarUrl: true,
          },
        });

        await writeAudit(tx, {
          actorId: principal.userId,
          actorRole: principal.role,
          action: "user.city_changed",
          subjectType: "user",
          subjectId: principal.userId,
          before: { homeCityId: current.homeCityId },
          after: { homeCityId: city.id, country: city.country },
          reason: "user_selected_city",
        });

        return nextUser;
      });

      let mode: "full" | "limited" = principal.modes.includes("limited")
        ? "limited"
        : "full";
      if (principal.deviceId !== null) {
        const device = await deps.prisma.device.findUnique({
          where: { id: principal.deviceId },
          select: { trusted: true },
        });
        if (device !== null) {
          mode = device.trusted ? "full" : "limited";
        }
      }

      const issued = await issueAccessToken({
        userId: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        mode,
        deviceId: principal.deviceId ?? `session_${principal.userId}`,
        sessionId: principal.sessionId ?? undefined,
        cityId: city.id,
      });

      const rotatedRefreshToken = await rotateSessionForId(
        deps,
        principal.sessionId,
      );

      const tokenPayload = {
        accessToken: issued.accessToken,
        ...(rotatedRefreshToken === null
          ? {}
          : { refreshToken: rotatedRefreshToken }),
        expiresIn: issued.expiresIn,
        mode: issued.mode,
        scopes: issued.scopes,
      };

      return ok(c, {
        cityId: city.id,
        user: toAuthUserSummary(updatedUser),
        token: tokenPayload,
        tokens: tokenPayload,
      });
    }),
  );

  /** Liveness + NIN face match. The image is verified and dropped; the score is kept. */
  routes.post(
    "/auth/step-up/selfie",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "auth:step_up");
      const body = await parseBody(c, SelfieStepUpSchema);

      const user = await deps.prisma.user.findUnique({
        where: { id: principal.userId },
        select: { email: true, homeCityId: true },
      });
      if (user === null) {
        throw new ContractError("not_found", "Account not found");
      }

      const outcome = await passSelfieStepUp(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          email: user.email,
          cityId: user.homeCityId ?? principal.cityId,
          sessionId: principal.sessionId,
        },
        body,
      );

      return ok(c, {
        status: outcome.status,
        challengeId: outcome.challengeId,
        deviceId: outcome.deviceId,
        score: outcome.score,
        reason: outcome.reason,
        appealPath: outcome.appealPath,
        appealMessage: outcome.appealMessage,
        token:
          outcome.token === null
            ? null
            : {
                accessToken: outcome.token.accessToken,
                expiresIn: outcome.token.expiresIn,
                mode: outcome.token.mode,
                scopes: outcome.token.scopes,
              },
      });
    }),
  );

  /** A device this account already trusts approves the new one. */
  routes.post(
    "/auth/step-up/approve",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "auth:step_up");
      const body = await parseBody(c, ApproveFromTrustedDeviceSchema);

      const user = await deps.prisma.user.findUnique({
        where: { id: principal.userId },
        select: { email: true, homeCityId: true },
      });
      if (user === null) {
        throw new ContractError("not_found", "Account not found");
      }

      const outcome = await approveFromTrustedDevice(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          email: user.email,
          cityId: user.homeCityId ?? principal.cityId,
          sessionId: principal.sessionId,
          // The approving device is named by the SIGNED context, not the body.
          approvingDeviceId: principal.deviceId,
        },
        body.challengeId,
      );

      return ok(c, {
        status: outcome.status,
        challengeId: outcome.challengeId,
        deviceId: outcome.deviceId,
        token:
          outcome.token === null
            ? null
            : {
                accessToken: outcome.token.accessToken,
                expiresIn: outcome.token.expiresIn,
                mode: outcome.token.mode,
                scopes: outcome.token.scopes,
              },
      });
    }),
  );

  routes.get(
    "/auth/pin/state",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "wallet:read");
      const state = await pinState(deps, {
        userId: principal.userId,
        role: principal.role,
        cityId: principal.cityId,
      });
      return ok(c, {
        locked: state.locked,
        lockedUntil: state.lockedUntil?.toISOString() ?? null,
        attemptsRemaining: state.attemptsRemaining,
        coolingUntil: state.coolingUntil?.toISOString() ?? null,
      });
    }),
  );

  routes.post(
    "/auth/pin/verify",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "wallet:read");
      const body = await parseBody(c, VerifyPinSchema);
      const result = await verifyPin(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          cityId: principal.cityId,
        },
        body.pin,
      );
      return ok(c, {
        verified: result.verified,
        coolingUntil: result.coolingUntil?.toISOString() ?? null,
      });
    }),
  );

  /** Reset needs a passed biometric step-up, and starts the cooling window. */
  routes.post(
    "/auth/pin/reset",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "auth:step_up");
      const body = await parseBody(c, ResetPinSchema);
      const result = await resetPin(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          cityId: principal.cityId,
        },
        body,
      );
      return ok(c, {
        rotated: result.rotated,
        coolingUntil: result.coolingUntil.toISOString(),
      });
    }),
  );

  routes.get(
    "/drivers/me/documents",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      const driver = await driverForUser(deps, principal.userId);
      return ok(
        c,
        await listDriverDocuments(deps, driver.id, driver.vehicleId),
      );
    }),
  );

  routes.post(
    "/drivers/me/documents",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "driver:documents:write");
      const idempotencyKey = requireIdempotencyKey(c);
      const body = await parseBody(c, UploadDocumentSchema);
      const driver = await driverForUser(deps, principal.userId);

      const document = await uploadDocument(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          driverId: driver.id,
          vehicleId: driver.vehicleId,
          cityId: principal.cityId,
          idempotencyKey,
        },
        body,
      );
      return ok(c, { document }, 201);
    }),
  );

  routes.get(
    "/drivers/me/eligibility",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      const driver = await driverForUser(deps, principal.userId);
      return ok(c, await driverEligibility(deps, driver.id));
    }),
  );

  routes.get(
    "/identity/liveness/required",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      const driver = await driverForUser(deps, principal.userId);
      if (principal.deviceId === null) {
        return ok(c, { required: true, reason: "first_shift_on_device" });
      }
      return ok(
        c,
        await livenessRequiredForShift(
          deps,
          driver.id,
          principal.userId,
          principal.deviceId,
        ),
      );
    }),
  );

  routes.get(
    "/identity/safe-mode",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "wallet:read");
      const state = await safeModeState(deps, principal.userId);
      return ok(c, {
        active: state.active,
        until: state.until?.toISOString() ?? null,
        blocks: [
          "wallet:transfer:p2p",
          "wallet:transfer:nip",
          "security:pin:change",
        ],
      });
    }),
  );

  // ---- Reviewer surface (board 4d + DEC-7 device recovery) ----------------

  routes.get(
    "/identity/cases",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireReviewerRole(principal.role);
      return ok(c, { cases: await listOpenIdentityCases(deps) });
    }),
  );

  /** Deactivation needs two different reviewers; reinstating needs one. */
  routes.post(
    "/identity/cases/:id/decide",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireReviewerRole(principal.role);
      const body = await parseBody(c, DecideCaseSchema);
      const outcome = await decideIdentityCase(deps, {
        ...body,
        caseId: c.req.param("id"),
        reviewerId: principal.userId,
        cityId: principal.cityId,
      });
      return ok(c, outcome);
    }),
  );

  routes.post(
    "/identity/documents/:id/review",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireReviewerRole(principal.role);
      const body = await parseBody(c, ReviewDocumentSchema);
      const document = await reviewDocument(deps, {
        documentId: c.req.param("id"),
        reviewerId: principal.userId,
        decision: body.decision,
        note: body.note,
        cityId: principal.cityId,
      });
      return ok(c, { document });
    }),
  );

  /**
   * POST /identity/devices/recover — support-assisted recovery for an existing
   * account with zero trusted devices (DEC-7).
   */
  routes.post(
    "/identity/devices/recover",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireReviewerRole(principal.role);
      const idempotencyKey = requireIdempotencyKey(c);
      const body = await parseBody(c, RecoverDeviceSchema);
      const outcome = await recoverTrustedDevice(deps, {
        ...body,
        reviewerId: principal.userId,
        reviewerRole: principal.role,
        cityId: principal.cityId,
        idempotencyKey,
      });
      return ok(c, outcome);
    }),
  );

  return routes;
}
