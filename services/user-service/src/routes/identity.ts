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
import { ContractError } from "@ubi/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { decideIdentityCase, DecideCaseSchema, listOpenIdentityCases } from "../identity/cases";
import { getIdentity, requireIdentity, requireScope } from "../identity/context";
import type { IdentityDeps } from "../identity/deps";
import { enrollDevice } from "../identity/devices";
import {
  listDriverDocuments,
  reviewDocument,
  sweepDocumentExpiry,
  uploadDocument,
  UploadDocumentSchema,
} from "../identity/documents";
import { driverEligibility } from "../identity/driver";
import { contractRoute, ok, parseBody, requireIdempotencyKey } from "../identity/http";
import {
  requireReviewerRole,
  requireServiceKey,
  SERVICE_KEY_HEADER,
  TELCO_SIGNATURE_HEADER,
  verifyTelcoSignature,
} from "../identity/internal-auth";
import { livenessRequiredForShift } from "../identity/liveness";
import { requestOtp, RequestOtpSchema, verifyOtp, VerifyOtpSchema } from "../identity/otp";
import { pinState, resetPin, ResetPinSchema, verifyPin, VerifyPinSchema } from "../identity/pin";
import { recordSimSwap, safeModeState, sweepSafeModeExits } from "../identity/safe-mode";
import {
  approveFromTrustedDevice,
  ApproveFromTrustedDeviceSchema,
  passSelfieStepUp,
  SelfieStepUpSchema,
} from "../identity/step-up";
import { prisma } from "../lib/prisma";

const SimSwapWebhookSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "phone must be in E.164 form"),
  reportedAt: z.string().datetime({ offset: true }),
  source: z.string().min(2).max(60),
});

const VerifyOtpAndEnrolSchema = VerifyOtpSchema.extend({
  deviceId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  platform: z.enum(["ios", "android", "web"]).optional(),
  model: z.string().min(1).max(120).optional(),
});

const ReviewDocumentSchema = z.object({
  decision: z.enum(["valid", "rejected"]),
  note: z.string().min(4).max(500),
});

async function driverForUser(
  userId: string,
): Promise<{ id: string; vehicleId: string | null }> {
  const driver = await prisma.driver.findFirst({
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
      const user = await prisma.user.findUnique({
        where: { phone: body.phone },
        select: { id: true, status: true },
      });
      if (user?.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }
      const result = await requestOtp(deps, body, user?.id);
      return ok(c, result);
    }),
  );

  /**
   * POST /auth/verify — check the code and enrol the device.
   *
   * The OTP proves the phone number and nothing else. The token handed back is
   * decided by DEVICE TRUST, so signing in from a new phone yields a
   * LIMITED-MODE token even though the code was correct: SMS alone never
   * unlocks money (slice 03 guards).
   */
  routes.post(
    "/auth/verify",
    contractRoute(async (c) => {
      const body = await parseBody(c, VerifyOtpAndEnrolSchema);
      const user = await prisma.user.findUnique({
        where: { phone: body.phone },
        select: { id: true, email: true, role: true, status: true },
      });
      if (user === null) throw new ContractError("not_found", "No account uses that number");
      if (user.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }

      const verified = await verifyOtp(deps, { phone: body.phone, code: body.code });

      const enrolment = await enrollDevice(deps, {
        deviceId: body.deviceId,
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.model === undefined ? {} : { model: body.model }),
        userId: user.id,
        role: user.role,
        email: user.email,
        cityId: null,
        sessionId: null,
      });

      return ok(c, {
        phoneVerified: verified.verified,
        grantsMoneyAccess: verified.grantsMoneyAccess,
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
        token: {
          accessToken: enrolment.token.accessToken,
          expiresIn: enrolment.token.expiresIn,
          mode: enrolment.token.mode,
          scopes: enrolment.token.scopes,
        },
      });
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
        throw new ContractError("validation_failed", "Request body must be JSON");
      }
      const body = SimSwapWebhookSchema.parse(parsedJson);

      const user = await prisma.user.findUnique({
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

  /** Liveness + NIN face match. The image is verified and dropped; the score is kept. */
  routes.post(
    "/auth/step-up/selfie",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "auth:step_up");
      const body = await parseBody(c, SelfieStepUpSchema);

      const user = await prisma.user.findUnique({
        where: { id: principal.userId },
        select: { email: true },
      });
      if (user === null) throw new ContractError("not_found", "Account not found");

      const outcome = await passSelfieStepUp(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          email: user.email,
          cityId: principal.cityId,
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

      const user = await prisma.user.findUnique({
        where: { id: principal.userId },
        select: { email: true },
      });
      if (user === null) throw new ContractError("not_found", "Account not found");

      const outcome = await approveFromTrustedDevice(
        deps,
        {
          userId: principal.userId,
          role: principal.role,
          email: user.email,
          cityId: principal.cityId,
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
        { userId: principal.userId, role: principal.role, cityId: principal.cityId },
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
        { userId: principal.userId, role: principal.role, cityId: principal.cityId },
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
      const driver = await driverForUser(principal.userId);
      return ok(c, await listDriverDocuments(deps, driver.id, driver.vehicleId));
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
      const driver = await driverForUser(principal.userId);

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
      const driver = await driverForUser(principal.userId);
      return ok(c, await driverEligibility(deps, driver.id));
    }),
  );

  routes.get(
    "/identity/liveness/required",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      const driver = await driverForUser(principal.userId);
      if (principal.deviceId === null) {
        return ok(c, { required: true, reason: "first_shift_on_device" });
      }
      return ok(
        c,
        await livenessRequiredForShift(deps, driver.id, principal.userId, principal.deviceId),
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
        blocks: ["wallet:transfer:p2p", "wallet:transfer:nip", "security:pin:change"],
      });
    }),
  );

  // ---- Reviewer surface (board 4d) ----------------------------------------

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

  return routes;
}
