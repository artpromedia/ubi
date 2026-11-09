/**
 * Hardened refresh-token issuance, rotation and revocation (CC-B00).
 *
 * Refresh tokens are opaque 256-bit random secrets; only their SHA-256 digest
 * is persisted in `sessions.token` (an existing pre-migration literal token is
 * accepted once and immediately rotated onto a digest). Every rotation re-reads
 * the user's `homeCityId` and the bound device's `trusted` flag so city changes,
 * step-up approvals and trust revocations take effect without signing out.
 */
import { createHash, randomBytes } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { internalDeviceId } from "./devices";
import { issueAccessToken } from "./tokens";

import type { IdentityDeps } from "./deps";

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthUserSummary {
  readonly id: string;
  readonly phone: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: string;
  readonly status: string;
  readonly cityId: string | null;
  readonly homeCityId: string | null;
  readonly avatarUrl: string | null;
}

export function toAuthUserSummary(user: {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  homeCityId?: string | null;
  avatarUrl?: string | null;
}): AuthUserSummary {
  const cityId = user.homeCityId ?? null;
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    cityId,
    homeCityId: cityId,
    avatarUrl: user.avatarUrl ?? null,
  };
}

export function hashRefreshToken(rawToken: string): string {
  const digest = createHash("sha256").update(rawToken).digest("base64url");
  return `sha256$${digest}`;
}

export function generateRefreshToken(): string {
  return `ubi_rt_${randomBytes(32).toString("base64url")}`;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly deviceId: string;
  readonly platform?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface CreatedSession {
  readonly sessionId: string;
  readonly refreshToken: string;
  readonly refreshExpiresIn: number;
}

export async function createSession(
  deps: IdentityDeps,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const now = deps.now();
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await deps.prisma.session.create({
    data: {
      userId: input.userId,
      token: hashRefreshToken(refreshToken),
      deviceId: input.deviceId,
      deviceType: input.platform ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    sessionId: session.id,
    refreshToken,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
  };
}

export interface RotateSessionInput {
  readonly refreshToken: string;
  readonly clientDeviceId?: string | undefined;
}

export interface RotatedSession {
  readonly sessionId: string;
  readonly user: AuthUserSummary;
  readonly citySelectionRequired: boolean;
  readonly tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresIn: number;
    readonly mode: "full" | "limited";
    readonly scopes: readonly string[] | null;
  };
}

export async function rotateSession(
  deps: IdentityDeps,
  input: RotateSessionInput,
): Promise<RotatedSession> {
  const now = deps.now();
  const hashed = hashRefreshToken(input.refreshToken);

  const session = await deps.prisma.session.findFirst({
    where: {
      token: { in: [hashed, input.refreshToken] },
    },
    include: {
      user: {
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
      },
    },
  });

  if (session === null) {
    throw new ContractError(
      "unauthorized",
      "Session expired. Please sign in again.",
    );
  }

  if (session.expiresAt.getTime() <= now.getTime()) {
    await deps.prisma.session.deleteMany({ where: { id: session.id } });
    throw new ContractError(
      "unauthorized",
      "Session expired. Please sign in again.",
    );
  }

  if (session.user.status === "SUSPENDED") {
    await deps.prisma.session.deleteMany({ where: { id: session.id } });
    throw new ContractError("forbidden", "This account is suspended");
  }

  if (input.clientDeviceId !== undefined && session.deviceId !== null) {
    const claimedDeviceId = internalDeviceId(
      session.userId,
      input.clientDeviceId,
    );
    if (claimedDeviceId !== session.deviceId) {
      throw new ContractError(
        "unauthorized",
        "This session belongs to a different device.",
      );
    }
  }

  const device =
    session.deviceId === null
      ? null
      : await deps.prisma.device.findUnique({
          where: { id: session.deviceId },
        });

  if (device !== null) {
    await deps.prisma.device.update({
      where: { id: device.id },
      data: { lastSeen: now },
    });
  }

  const mode: "full" | "limited" =
    device?.trusted === true ? "full" : "limited";
  const effectiveDeviceId =
    session.deviceId ??
    (input.clientDeviceId === undefined
      ? `legacy_${session.id}`
      : internalDeviceId(session.userId, input.clientDeviceId));

  const nextRefreshToken = generateRefreshToken();
  const nextExpiresAt = new Date(
    now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
  );

  // Conditional update on the current token prevents a replayed refresh token
  // from minting a second pair in a concurrent race.
  const updated = await deps.prisma.session.updateMany({
    where: { id: session.id, token: session.token },
    data: {
      token: hashRefreshToken(nextRefreshToken),
      deviceId: effectiveDeviceId,
      expiresAt: nextExpiresAt,
    },
  });

  if (updated.count === 0) {
    throw new ContractError(
      "unauthorized",
      "Refresh token was already used. Please sign in again.",
    );
  }

  const issued = await issueAccessToken({
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    mode,
    deviceId: effectiveDeviceId,
    sessionId: session.id,
    cityId: session.user.homeCityId,
  });

  return {
    sessionId: session.id,
    user: toAuthUserSummary(session.user),
    citySelectionRequired: session.user.homeCityId === null,
    tokens: {
      accessToken: issued.accessToken,
      refreshToken: nextRefreshToken,
      expiresIn: issued.expiresIn,
      mode: issued.mode,
      scopes: issued.scopes,
    },
  };
}

export async function rotateSessionForId(
  deps: IdentityDeps,
  sessionId: string | null,
): Promise<string | null> {
  if (sessionId === null) {
    return null;
  }
  const now = deps.now();
  const nextRefreshToken = generateRefreshToken();
  const updated = await deps.prisma.session.updateMany({
    where: { id: sessionId, expiresAt: { gt: now } },
    data: {
      token: hashRefreshToken(nextRefreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return updated.count > 0 ? nextRefreshToken : null;
}

export async function revokeSession(
  deps: IdentityDeps,
  input: {
    readonly sessionId?: string | null | undefined;
    readonly userId?: string | null | undefined;
    readonly refreshToken?: string | null | undefined;
  },
): Promise<void> {
  if (input.sessionId !== undefined && input.sessionId !== null) {
    await deps.prisma.session.deleteMany({ where: { id: input.sessionId } });
    return;
  }
  if (
    input.refreshToken !== undefined &&
    input.refreshToken !== null &&
    input.refreshToken.length > 0
  ) {
    const hashed = hashRefreshToken(input.refreshToken);
    await deps.prisma.session.deleteMany({
      where: { token: { in: [hashed, input.refreshToken] } },
    });
    return;
  }
  if (input.userId !== undefined && input.userId !== null) {
    await deps.prisma.session.deleteMany({ where: { userId: input.userId } });
  }
}
