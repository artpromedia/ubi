/**
 * The driver liveness gate.
 *
 * Slice 03: a liveness check is required before the first shift on a new
 * device, and on roughly one shift in ten after that.
 *
 * The "random" tenth is DETERMINISTIC — a hash of driver, device and shift
 * date, not `Math.random()`. That matters three ways: the same shift always
 * gives the same answer however many times the app asks, ops can reproduce why
 * a driver was challenged, and the sampling rate is testable rather than
 * flaky.
 */
import { createHash } from "node:crypto";

import type { IdentityDeps } from "./deps";

/** One shift in ten, as a percentage. */
export const LIVENESS_SAMPLE_PERCENT = 10;

export function shiftDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** 0–99, uniform over the hash. */
export function samplingBucket(driverId: string, deviceId: string, date: string): number {
  const digest = createHash("sha256").update(`${driverId}|${deviceId}|${date}`).digest();
  return ((digest[0] ?? 0) * 256 + (digest[1] ?? 0)) % 100;
}

export interface LivenessGate {
  readonly required: boolean;
  readonly reason: "first_shift_on_device" | "random_sample" | "not_required";
}

export async function livenessRequiredForShift(
  deps: IdentityDeps,
  driverId: string,
  userId: string,
  deviceId: string,
): Promise<LivenessGate> {
  const passedOnThisDevice = await deps.prisma.stepUpChallenge.count({
    where: { userId, deviceId, method: "selfie_nin", status: { in: ["passed", "consumed"] } },
  });
  if (passedOnThisDevice === 0) {
    return { required: true, reason: "first_shift_on_device" };
  }

  const bucket = samplingBucket(driverId, deviceId, shiftDate(deps.now()));
  return bucket < LIVENESS_SAMPLE_PERCENT
    ? { required: true, reason: "random_sample" }
    : { required: false, reason: "not_required" };
}
