/**
 * Wallet safe mode.
 *
 * A telco SIM-swap signal puts the wallet into a time-boxed hold: P2P, NIP and
 * every security change (PIN, phone, emergency contacts) are refused for the
 * window. Booking, reading and cash keep working — a hold is not a suspension.
 *
 * WHERE THE TRUTH LIVES. `wallets.safe_mode_until` is authoritative and
 * durable; the service that actually moves money reads it inside the same
 * transaction as the transfer. The Redis key is a fast copy the API gateway
 * reads so it can refuse the request one hop earlier, and the gateway fails
 * closed when it cannot read it. Losing the copy therefore costs an early
 * refusal, never the hold itself.
 *
 * SMS OTP NEVER LIFTS THIS. A hold is lifted by time, or by an operator with a
 * reason on the record — never by proving control of the phone number that was
 * just swapped.
 */
import { ContractError } from "@ubi/contracts";

import { writeAudit } from "./audit";
import { auditRevision } from "./common";
import type { IdentityCache, IdentityDeps } from "./deps";
import { deterministicId } from "./ids";
import { eventIdempotencyKey, writeOutboxEventOnce } from "./outbox";

/** Must match services/api-gateway/src/identity/state.ts. */
export function safeModeKey(userId: string): string {
  return `ubi:identity:safe_mode:${userId}`;
}

export interface SimSwapReport {
  readonly userId: string;
  readonly phone: string;
  readonly reportedAt: Date;
  readonly source: string;
}

export interface SafeModeState {
  readonly active: boolean;
  readonly until: Date | null;
}

async function publishHold(
  cache: IdentityCache,
  userId: string,
  until: Date,
  now: Date,
): Promise<void> {
  const ttlSeconds = Math.ceil((until.getTime() - now.getTime()) / 1000);
  if (ttlSeconds <= 0) return;
  await cache.set(safeModeKey(userId), until.toISOString(), "EX", ttlSeconds);
}

/**
 * Records a SIM-swap signal and enters safe mode for the configured window.
 *
 * Idempotent on (user, phone, reportedAt, source): a telco that retries its
 * webhook produces one signal row and one event, because the row id and the
 * outbox idempotency key are both derived from those fields.
 */
export async function recordSimSwap(
  deps: IdentityDeps,
  report: SimSwapReport,
): Promise<{ signalId: string; until: Date; entered: boolean }> {
  const now = deps.now();
  const policy = await deps.policy.forCity(null);
  const until = new Date(report.reportedAt.getTime() + policy.safeModeMs);
  const signalId = deterministicId(
    "sim",
    report.userId,
    report.phone,
    report.reportedAt.toISOString(),
    report.source,
  );

  const entered = await deps.prisma.$transaction(async (tx) => {
    const existing = await tx.simSwapSignal.findUnique({
      where: { id: signalId },
    });
    if (existing !== null) return false;

    await tx.simSwapSignal.create({
      data: {
        id: signalId,
        userId: report.userId,
        phone: report.phone,
        reportedAt: report.reportedAt,
        source: report.source,
        handled: until.getTime() <= now.getTime(),
      },
    });

    if (until.getTime() <= now.getTime()) {
      // A signal about a swap old enough that its window has already passed is
      // still recorded — it is evidence — but it starts no hold.
      return false;
    }

    const wallets = await tx.wallet.findMany({
      where: { ownerId: report.userId },
    });
    for (const wallet of wallets) {
      if (
        wallet.safeModeUntil !== null &&
        wallet.safeModeUntil.getTime() >= until.getTime()
      ) {
        continue;
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { safeModeUntil: until, version: { increment: 1 } },
      });
    }

    const revision = await auditRevision(tx, "user", report.userId);
    await writeAudit(tx, {
      actorId: `telco:${report.source}`,
      actorRole: "system",
      action: "wallet.safe_mode_entered",
      subjectType: "user",
      subjectId: report.userId,
      after: {
        until: until.toISOString(),
        signalId,
        walletsHeld: wallets.length,
      },
      reason: "sim_swap_signal",
    });

    await writeOutboxEventOnce(tx, {
      name: "wallet.safe_mode_entered",
      subjectType: "user",
      subjectId: report.userId,
      actorType: "system",
      actorId: `telco:${report.source}`,
      idempotencyKey: eventIdempotencyKey("wallet.safe_mode_entered", signalId),
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        userId: report.userId,
        deviceId: null,
        method: "sim_swap",
        until: until.toISOString(),
      },
      occurredAt: now,
    });

    return true;
  });

  if (entered) {
    await publishHold(deps.cache, report.userId, until, now);
  }

  return { signalId, until, entered };
}

/** The authoritative answer, read from the wallet rows rather than the cache. */
export async function safeModeState(
  deps: IdentityDeps,
  userId: string,
): Promise<SafeModeState> {
  const now = deps.now();
  const held = await deps.prisma.wallet.findFirst({
    where: { ownerId: userId, safeModeUntil: { gt: now } },
    orderBy: { safeModeUntil: "desc" },
  });
  if (held?.safeModeUntil != null)
    return { active: true, until: held.safeModeUntil };

  const signal = await deps.prisma.simSwapSignal.findFirst({
    where: { userId, handled: false },
    orderBy: { reportedAt: "desc" },
  });
  if (signal === null) return { active: false, until: null };

  const policy = await deps.policy.forCity(null);
  const until = new Date(signal.reportedAt.getTime() + policy.safeModeMs);
  return until.getTime() > now.getTime()
    ? { active: true, until }
    : { active: false, until: null };
}

/** Refuses an action that safe mode forbids. */
export async function assertNotInSafeMode(
  deps: IdentityDeps,
  userId: string,
  action: string,
): Promise<void> {
  const state = await safeModeState(deps, userId);
  if (!state.active) return;
  throw new ContractError(
    "safe_mode_active",
    "Your wallet is in safe mode after a SIM-swap report. This action is paused until the hold lifts.",
    { action, until: state.until?.toISOString() ?? null },
  );
}

/**
 * Lifts every hold whose window has passed and emits `wallet.safe_mode_exited`
 * once per signal. Safe to run on a schedule; the outbox idempotency key makes
 * a second run a no-op.
 */
export async function sweepSafeModeExits(
  deps: IdentityDeps,
): Promise<readonly string[]> {
  const now = deps.now();
  const policy = await deps.policy.forCity(null);
  const cutoff = new Date(now.getTime() - policy.safeModeMs);

  const due = await deps.prisma.simSwapSignal.findMany({
    where: { handled: false, reportedAt: { lte: cutoff } },
    orderBy: { reportedAt: "asc" },
    take: 500,
  });

  const exited: string[] = [];
  for (const signal of due) {
    const cleared = await deps.prisma.$transaction(async (tx) => {
      await tx.simSwapSignal.update({
        where: { id: signal.id },
        data: { handled: true },
      });

      const stillHeld = await tx.simSwapSignal.findFirst({
        where: {
          userId: signal.userId,
          handled: false,
          reportedAt: { gt: cutoff },
        },
      });
      if (stillHeld !== null) return false;

      await tx.wallet.updateMany({
        where: {
          ownerId: signal.userId,
          safeModeUntil: { not: null, lte: now },
        },
        data: { safeModeUntil: null, version: { increment: 1 } },
      });

      const revision = await auditRevision(tx, "user", signal.userId);
      await writeAudit(tx, {
        actorId: "system:identity-sweep",
        actorRole: "system",
        action: "wallet.safe_mode_exited",
        subjectType: "user",
        subjectId: signal.userId,
        after: { signalId: signal.id },
        reason: "safe_mode_window_elapsed",
      });

      await writeOutboxEventOnce(tx, {
        name: "wallet.safe_mode_exited",
        subjectType: "user",
        subjectId: signal.userId,
        actorType: "system",
        actorId: "system:identity-sweep",
        idempotencyKey: eventIdempotencyKey(
          "wallet.safe_mode_exited",
          signal.id,
        ),
        fromVersion: revision,
        toVersion: revision + 1,
        cityId: policy.cityId,
        payload: {
          userId: signal.userId,
          deviceId: null,
          method: "sim_swap",
          until: new Date(
            signal.reportedAt.getTime() + policy.safeModeMs,
          ).toISOString(),
        },
        occurredAt: now,
      });

      return true;
    });

    if (cleared) {
      await deps.cache.del(safeModeKey(signal.userId));
      exited.push(signal.userId);
    }
  }

  return exited;
}
