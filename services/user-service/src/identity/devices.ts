/**
 * Device enrolment and trust.
 *
 * A known, trusted device signs in normally. A NEW device is enrolled
 * untrusted, gets a step-up challenge, and is handed a LIMITED-MODE token — it
 * can book with cash and read history, but cannot move money or change security
 * settings until the step-up passes (slice 03, board 15a).
 *
 * The device id the client sends is an install identifier, not a credential:
 * it is namespaced per user (`deterministicId("dev", userId, clientId)`), so
 * two users claiming the same install id get two different device rows and
 * neither can inherit the other's trust.
 */
import { ContractError } from "@ubi/contracts";
import { z } from "zod";

import { writeAudit } from "./audit";
import { actorTypeFor, auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { deterministicId } from "./ids";
import { writeOutboxEventOnce } from "./outbox";
import { issueAccessToken, type IssuedToken } from "./tokens";

export const STEP_UP_METHODS = ["old_device_approve", "selfie_nin"] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

export const ClientDeviceIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, "device id must be url-safe");

export const EnrollDeviceSchema = z.object({
  deviceId: ClientDeviceIdSchema,
  platform: z.enum(["ios", "android", "web"]).optional(),
  model: z.string().min(1).max(120).optional(),
});

export type EnrollDeviceBody = z.infer<typeof EnrollDeviceSchema>;

export interface EnrollDeviceInput extends EnrollDeviceBody {
  readonly userId: string;
  readonly role: string;
  readonly email: string;
  readonly cityId: string | null;
  readonly sessionId: string | null;
}

export interface EnrollDeviceResult {
  readonly status: "enrolled" | "step_up_required";
  readonly deviceId: string;
  readonly trusted: boolean;
  readonly methods: readonly StepUpMethod[];
  readonly challengeId: string | null;
  readonly token: IssuedToken;
  /** Shown to the user when a method is offered but not available to them. */
  readonly unavailable: readonly { method: StepUpMethod; reason: string }[];
}

export function internalDeviceId(userId: string, clientDeviceId: string): string {
  return deterministicId("dev", userId, clientDeviceId);
}

/**
 * Which step-up methods this user can actually use right now. Honest
 * unavailability (CLAUDE.md #8): a method they cannot use is returned with the
 * reason, never silently dropped.
 */
export async function availableStepUpMethods(
  deps: IdentityDeps,
  userId: string,
  enrollingDeviceId: string,
): Promise<{
  methods: readonly StepUpMethod[];
  unavailable: readonly { method: StepUpMethod; reason: string }[];
}> {
  const trustedElsewhere = await deps.prisma.device.count({
    where: { userId, trusted: true, id: { not: enrollingDeviceId } },
  });

  if (trustedElsewhere > 0) {
    return { methods: ["old_device_approve", "selfie_nin"], unavailable: [] };
  }
  return {
    methods: ["selfie_nin"],
    unavailable: [
      {
        method: "old_device_approve",
        reason: "You have no other device we already trust.",
      },
    ],
  };
}

export async function enrollDevice(
  deps: IdentityDeps,
  input: EnrollDeviceInput,
): Promise<EnrollDeviceResult> {
  const now = deps.now();
  const policy = await deps.policy.forCity(input.cityId);
  const deviceId = internalDeviceId(input.userId, input.deviceId);

  const existing = await deps.prisma.device.findUnique({ where: { id: deviceId } });

  if (existing !== null && existing.userId !== input.userId) {
    // Cannot happen while the id is namespaced by user, but a row that says
    // otherwise is a conflict, not something to overwrite.
    throw new ContractError("conflict", "This device is registered to another account");
  }

  if (existing !== null && existing.trusted) {
    await deps.prisma.device.update({ where: { id: deviceId }, data: { lastSeen: now } });
    return {
      status: "enrolled",
      deviceId,
      trusted: true,
      methods: [],
      challengeId: null,
      unavailable: [],
      token: await issueAccessToken({
        userId: input.userId,
        email: input.email,
        role: input.role,
        mode: "full",
        deviceId,
        sessionId: input.sessionId ?? undefined,
        cityId: input.cityId,
      }),
    };
  }

  const { methods, unavailable } = await availableStepUpMethods(deps, input.userId, deviceId);
  const challengeId = deterministicId("suc", deviceId, now.toISOString());

  await deps.prisma.$transaction(async (tx) => {
    if (existing === null) {
      await tx.device.create({
        data: {
          id: deviceId,
          userId: input.userId,
          trusted: false,
          enrolledAt: now,
          lastSeen: now,
          ...(input.platform === undefined ? {} : { platform: input.platform }),
          ...(input.model === undefined ? {} : { model: input.model }),
        },
      });
    } else {
      await tx.device.update({ where: { id: deviceId }, data: { lastSeen: now } });
    }

    // One open challenge per device: a client that retries enrolment does not
    // accumulate challenges it could answer later.
    await tx.stepUpChallenge.updateMany({
      where: { userId: input.userId, deviceId, status: "pending" },
      data: { status: "superseded", resolvedAt: now },
    });

    await tx.stepUpChallenge.create({
      data: {
        id: challengeId,
        userId: input.userId,
        deviceId,
        method: methods.includes("old_device_approve") ? "old_device_approve" : "selfie_nin",
        status: "pending",
        createdAt: now,
      },
    });

    const revision = await auditRevision(tx, "device", deviceId);
    await writeAudit(tx, {
      actorId: input.userId,
      actorRole: input.role,
      action: "device.enrolled",
      subjectType: "device",
      subjectId: deviceId,
      after: { trusted: false, platform: input.platform ?? null, challengeId },
      reason: "new_device",
    });

    await writeOutboxEventOnce(tx, {
      name: "device.enrolled",
      subjectType: "device",
      subjectId: deviceId,
      actorType: actorTypeFor(input.role),
      actorId: input.userId,
      idempotencyKey: `device.enrolled:${deviceId}`,
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        userId: input.userId,
        deviceId,
        method: methods.includes("old_device_approve") ? "old_device_approve" : "selfie_nin",
        until: new Date(now.getTime() + policy.stepUpTtlMs).toISOString(),
      },
      occurredAt: now,
    });
  });

  return {
    status: "step_up_required",
    deviceId,
    trusted: false,
    methods,
    challengeId,
    unavailable,
    token: await issueAccessToken({
      userId: input.userId,
      email: input.email,
      role: input.role,
      mode: "limited",
      deviceId,
      sessionId: input.sessionId ?? undefined,
      cityId: input.cityId,
    }),
  };
}

export interface DeviceSummary {
  readonly id: string;
  readonly platform: string | null;
  readonly model: string | null;
  readonly trusted: boolean;
  readonly enrolledAt: string;
  readonly lastSeen: string | null;
}

export async function listDevices(
  deps: IdentityDeps,
  userId: string,
): Promise<readonly DeviceSummary[]> {
  const devices = await deps.prisma.device.findMany({
    where: { userId },
    orderBy: { enrolledAt: "desc" },
  });
  return devices.map((device) => ({
    id: device.id,
    platform: device.platform,
    model: device.model,
    trusted: device.trusted,
    enrolledAt: device.enrolledAt.toISOString(),
    lastSeen: device.lastSeen?.toISOString() ?? null,
  }));
}
