/**
 * Step-up: proving a new device belongs to the account.
 *
 * Two methods, both stronger than an SMS code:
 *
 *   old_device_approve  a device this account already trusts approves the new
 *                       one. The approval is authorised by the APPROVER's
 *                       signed identity context, not by anything the new device
 *                       sends.
 *   selfie_nin          liveness plus a NIN face match.
 *
 * SMS OTP IS NOT ONE OF THEM. `sms_otp` exists in the challenge table because
 * the DDL allows it for low-value flows, but `passStepUp` refuses it: an OTP
 * alone never unlocks money or lifts limited mode (slice 03 guards).
 *
 * WHAT IS STORED. The selfie is sent to the verifier and then dropped. Nothing
 * writes it to a column, a log or an event: the challenge row keeps the match
 * SCORE and the pass/fail, and a driver additionally gets a `face_checks` row
 * with the score (CLAUDE.md #6).
 */
import { ContractError } from "@ubi/contracts";
import { z } from "zod";

import { writeAudit } from "./audit";
import { actorTypeFor, auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { APPEAL_MESSAGE, APPEAL_PATH, takeDriverOffline } from "./driver";
import { newId } from "./ids";
import { eventIdempotencyKey, writeOutboxEvent } from "./outbox";
import { issueAccessToken, type IssuedToken } from "./tokens";

/**
 * The biometric provider. Liveness and NIN matching happen there; this service
 * never keeps the image it forwards.
 */
export interface FaceVerification {
  readonly livenessScore: number;
  readonly matchScore: number;
  readonly providerRef: string;
}

export interface FaceVerifier {
  verify(input: {
    userId: string;
    nin: string;
    imageBase64: string;
  }): Promise<FaceVerification>;
}

export const SelfieStepUpSchema = z.object({
  challengeId: z.string().min(1).max(64),
  /** National Identity Number to match against. Matched, never stored. */
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits"),
  /** The selfie. Forwarded to the verifier and then dropped. */
  imageBase64: z.string().min(64).max(8_000_000),
});

export type SelfieStepUpBody = z.infer<typeof SelfieStepUpSchema>;

export const ApproveFromTrustedDeviceSchema = z.object({
  challengeId: z.string().min(1).max(64),
});

export interface StepUpOutcome {
  readonly status: "passed" | "failed";
  readonly challengeId: string;
  readonly deviceId: string | null;
  /** 0–1, four decimal places. The image is never part of this. */
  readonly score: number | null;
  readonly reason: string | null;
  readonly appealPath: string | null;
  readonly appealMessage: string | null;
  readonly token: IssuedToken | null;
}

interface ResolveContext {
  readonly userId: string;
  readonly role: string;
  readonly email: string;
  readonly cityId: string | null;
  readonly sessionId: string | null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function loadPendingChallenge(
  deps: IdentityDeps,
  userId: string,
  challengeId: string,
  ttlMs: number,
) {
  const challenge = await deps.prisma.stepUpChallenge.findUnique({ where: { id: challengeId } });
  if (challenge === null || challenge.userId !== userId) {
    throw new ContractError("not_found", "That security check was not found");
  }
  if (challenge.status !== "pending") {
    throw new ContractError("conflict", "That security check has already been answered", {
      status: challenge.status,
    });
  }
  if (deps.now().getTime() - challenge.createdAt.getTime() > ttlMs) {
    throw new ContractError("step_up_required", "That security check expired. Start a new one.", {
      challengeId,
    });
  }
  return challenge;
}

/**
 * Liveness + NIN face match. The image is passed to the verifier and never
 * persisted; only the score and the verdict survive this function.
 */
export async function passSelfieStepUp(
  deps: IdentityDeps,
  context: ResolveContext,
  body: SelfieStepUpBody,
): Promise<StepUpOutcome> {
  const now = deps.now();
  const policy = await deps.policy.forCity(context.cityId);
  const challenge = await loadPendingChallenge(
    deps,
    context.userId,
    body.challengeId,
    policy.stepUpTtlMs,
  );

  const verification = await deps.faceVerifier.verify({
    userId: context.userId,
    nin: body.nin,
    imageBase64: body.imageBase64,
  });

  const score = round4(Math.min(verification.livenessScore, verification.matchScore));
  const passed = score >= policy.faceMatchThreshold;
  const reason = passed
    ? null
    : verification.livenessScore < policy.faceMatchThreshold
      ? "The photo did not pass the liveness check."
      : "The photo did not match your NIN record closely enough.";

  const driver = await deps.prisma.driver.findFirst({
    where: { userId: context.userId },
    select: { id: true },
  });

  await deps.prisma.$transaction(async (tx) => {
    await tx.stepUpChallenge.update({
      where: { id: challenge.id },
      data: {
        method: "selfie_nin",
        status: passed ? "passed" : "failed",
        score,
        resolvedAt: now,
      },
    });

    if (passed && challenge.deviceId !== null) {
      await tx.device.update({
        where: { id: challenge.deviceId },
        data: { trusted: true, lastSeen: now },
      });
    }

    if (driver !== null) {
      await tx.faceCheck.create({
        data: {
          id: newId("fc"),
          driverId: driver.id,
          score,
          passed,
          createdAt: now,
          ...(challenge.deviceId === null ? {} : { deviceId: challenge.deviceId }),
          ...(reason === null ? {} : { reason }),
        },
      });
    }

    const revision = await auditRevision(tx, "user", context.userId);
    await writeAudit(tx, {
      actorId: context.userId,
      actorRole: context.role,
      action: passed ? "step_up.passed" : "step_up.failed",
      subjectType: "user",
      subjectId: context.userId,
      // Score and verdict only. No image, no NIN.
      after: { challengeId: challenge.id, method: "selfie_nin", score, passed },
      ...(reason === null ? {} : { reason }),
    });

    await writeOutboxEvent(tx, {
      name: passed ? "step_up.passed" : "step_up.failed",
      subjectType: "user",
      subjectId: context.userId,
      actorType: actorTypeFor(context.role),
      actorId: context.userId,
      idempotencyKey: eventIdempotencyKey("step_up", challenge.id),
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        userId: context.userId,
        deviceId: challenge.deviceId,
        method: "selfie_nin",
        until: null,
        score,
      },
      occurredAt: now,
    });

    if (!passed && driver !== null) {
      await writeOutboxEvent(tx, {
        name: "face_check.failed",
        subjectType: "driver",
        subjectId: driver.id,
        actorType: "system",
        actorId: "system:identity",
        idempotencyKey: eventIdempotencyKey("face_check.failed", challenge.id),
        fromVersion: revision,
        toVersion: revision + 1,
        cityId: policy.cityId,
        payload: {
          driverId: driver.id,
          score,
          decision: null,
          reviewers: [],
          reason,
          appealPath: APPEAL_PATH,
        },
        occurredAt: now,
      });

      // A failed check takes the driver offline. It does NOT deactivate the
      // account: `users.status` is untouched, and a person decides what next.
      await takeDriverOffline(tx, {
        driverId: driver.id,
        reasons: [reason ?? "Liveness check failed."],
        actorId: "system:identity",
        actorRole: "system",
        cityId: policy.cityId,
        occurredAt: now,
      });

      const caseId = newId("idc");
      await tx.identityCase.create({
        data: {
          id: caseId,
          driverId: driver.id,
          signals: { challengeId: challenge.id, score, deviceId: challenge.deviceId },
          status: "open",
          decidedBy: [],
          createdAt: now,
        },
      });

      await writeOutboxEvent(tx, {
        name: "identity.case_opened",
        subjectType: "driver",
        subjectId: driver.id,
        actorType: "system",
        actorId: "system:identity",
        idempotencyKey: eventIdempotencyKey("identity.case_opened", caseId),
        fromVersion: revision,
        toVersion: revision + 1,
        cityId: policy.cityId,
        payload: { driverId: driver.id, caseId, score, decision: null, reviewers: [] },
        occurredAt: now,
      });
    }
  });

  if (!passed) {
    return {
      status: "failed",
      challengeId: challenge.id,
      deviceId: challenge.deviceId,
      score,
      reason,
      appealPath: APPEAL_PATH,
      appealMessage: APPEAL_MESSAGE,
      token: null,
    };
  }

  return {
    status: "passed",
    challengeId: challenge.id,
    deviceId: challenge.deviceId,
    score,
    reason: null,
    appealPath: null,
    appealMessage: null,
    token: await issueAccessToken({
      userId: context.userId,
      email: context.email,
      role: context.role,
      mode: "full",
      deviceId: challenge.deviceId ?? "unknown",
      sessionId: context.sessionId ?? undefined,
      cityId: context.cityId,
    }),
  };
}

/**
 * A device this account already trusts approves a new one. The approving device
 * comes from the caller's SIGNED identity context — a client cannot name it.
 */
export async function approveFromTrustedDevice(
  deps: IdentityDeps,
  context: ResolveContext & { approvingDeviceId: string | null },
  challengeId: string,
): Promise<StepUpOutcome> {
  const now = deps.now();
  const policy = await deps.policy.forCity(context.cityId);

  if (context.approvingDeviceId === null) {
    throw new ContractError(
      "step_up_required",
      "Approve from a device you have already verified.",
    );
  }

  const approver = await deps.prisma.device.findUnique({
    where: { id: context.approvingDeviceId },
  });
  if (approver === null || approver.userId !== context.userId || !approver.trusted) {
    throw new ContractError(
      "step_up_required",
      "This device is not trusted yet, so it cannot approve another one.",
    );
  }

  const challenge = await loadPendingChallenge(
    deps,
    context.userId,
    challengeId,
    policy.stepUpTtlMs,
  );
  if (challenge.deviceId === context.approvingDeviceId) {
    throw new ContractError("forbidden", "A device cannot approve itself");
  }

  await deps.prisma.$transaction(async (tx) => {
    await tx.stepUpChallenge.update({
      where: { id: challenge.id },
      data: { method: "old_device_approve", status: "passed", resolvedAt: now },
    });
    if (challenge.deviceId !== null) {
      await tx.device.update({
        where: { id: challenge.deviceId },
        data: { trusted: true, lastSeen: now },
      });
    }

    const revision = await auditRevision(tx, "user", context.userId);
    await writeAudit(tx, {
      actorId: context.userId,
      actorRole: context.role,
      action: "step_up.passed",
      subjectType: "user",
      subjectId: context.userId,
      after: {
        challengeId: challenge.id,
        method: "old_device_approve",
        approvedBy: context.approvingDeviceId,
      },
    });

    await writeOutboxEvent(tx, {
      name: "step_up.passed",
      subjectType: "user",
      subjectId: context.userId,
      actorType: actorTypeFor(context.role),
      actorId: context.userId,
      idempotencyKey: eventIdempotencyKey("step_up", challenge.id),
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        userId: context.userId,
        deviceId: challenge.deviceId,
        method: "old_device_approve",
        until: null,
      },
      occurredAt: now,
    });
  });

  return {
    status: "passed",
    challengeId: challenge.id,
    deviceId: challenge.deviceId,
    score: null,
    reason: null,
    appealPath: null,
    appealMessage: null,
    token: await issueAccessToken({
      userId: context.userId,
      email: context.email,
      role: context.role,
      mode: "full",
      deviceId: challenge.deviceId ?? "unknown",
      sessionId: context.sessionId ?? undefined,
      cityId: context.cityId,
    }),
  };
}

/**
 * Refused on purpose. An SMS code proves control of a phone number, and a phone
 * number is exactly what a SIM swap takes. It can never be a step-up that
 * unlocks money or trusts a device.
 */
export function rejectSmsOtpAsStepUp(): never {
  throw new ContractError(
    "step_up_required",
    "An SMS code is not enough to verify this device. Use a trusted device or a selfie check.",
    { allowedMethods: ["old_device_approve", "selfie_nin"] },
  );
}
