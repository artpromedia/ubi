/**
 * Marketplace execution intent (recheck A03 / P02, CLAUDE.md #3).
 *
 * One assistant selection is one `ask_mp_executions` row, written in the SAME
 * transaction that consumes the single-use grant (and, for a mandate grant,
 * reserves the period allowance) — BEFORE the external award call. Its
 * idempotency key is bound to (grant, request, bid, request version, bid
 * version) and is the only key the award call ever carries, so:
 *
 *   - a crash before the call, a lost request or an ambiguous timeout leaves a
 *     `pending` execution that a retry RECONCILES — it queries the award and,
 *     only once the in-flight lease has lapsed, re-sends the SAME selection
 *     under the SAME key. It never consumes a second grant or allowance run;
 *   - an award converges (`awarded`, allowance committed at the award fare);
 *   - a definitive refusal closes it (`failed`, allowance released).
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { MarketplaceTimeoutError } from "../ports/marketplace-port";

import type { AskDb } from "./types";

export type MpExecutionStatus = "pending" | "awarded" | "failed";

/** The persisted execution row (an `ask_mp_executions` row). */
export interface MpExecution {
  readonly id: string;
  readonly grantId: string;
  readonly actorId: string;
  readonly cityId: string;
  readonly mandateId: string | null;
  readonly reservationId: string | null;
  readonly requestId: string;
  readonly bidId: string;
  readonly requestVersion: number;
  readonly bidVersion: number;
  readonly requestRevision: number;
  readonly fareMinor: bigint;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly status: string;
  readonly awardId: string | null;
  readonly reasonCode: string | null;
  readonly attempts: number;
  readonly leaseUntil: Date;
}

export interface ExecutionBinding {
  readonly grantId: string;
  readonly requestId: string;
  readonly bidId: string;
  readonly requestVersion: number;
  readonly bidVersion: number;
}

/**
 * The award call's idempotency key. A digest, because ride-service caps keys
 * at 64 url-safe characters (move.ValidateIdempotencyKey) and the ids alone
 * would overrun it; the grant id is inside the digest, so one grant can never
 * yield two keys for one selection, nor one key for two selections.
 */
export function executionIdempotencyKey(binding: ExecutionBinding): string {
  const digest = createHash("sha256")
    .update(
      [
        "mp.select.v1",
        binding.grantId,
        binding.requestId,
        binding.bidId,
        String(binding.requestVersion),
        String(binding.bidVersion),
      ].join("|"),
    )
    .digest("hex");
  return `mp.select:${digest.slice(0, 40)}`;
}

export async function findExecutionByGrant(
  db: AskDb,
  grantId: string,
): Promise<MpExecution | null> {
  const execution = await db.askMpExecution.findUnique({ where: { grantId } });
  return execution;
}

/**
 * Claims the right to re-send the selection: succeeds for exactly one caller,
 * and only once the previous attempt's lease has lapsed, so a retry never races
 * an attempt that may still be in flight.
 */
export async function claimRetryLease(
  db: AskDb,
  execution: MpExecution,
  now: Date,
  leaseSeconds: number,
): Promise<MpExecution | null> {
  const claimed = await db.askMpExecution.updateMany({
    where: {
      id: execution.id,
      status: "pending",
      leaseUntil: { lte: now },
      attempts: execution.attempts,
    },
    data: {
      attempts: { increment: 1 },
      leaseUntil: new Date(now.getTime() + leaseSeconds * 1000),
    },
  });
  if (claimed.count !== 1) {
    return null;
  }
  return db.askMpExecution.findUnique({ where: { id: execution.id } });
}

export type SelectFailureKind = "definitive" | "ambiguous";

/**
 * Whether a failed award call may still have awarded. A canonical refusal
 * (version_conflict, request_closed, bid_not_live, forbidden …) is definitive:
 * the marketplace answered and did not award. A timeout, an unreadable answer,
 * `award_unresolved`, a 5xx or an unknown exception is ambiguous: the award may
 * exist, so the reservation stays pending and the outcome is reconciled by
 * query. A refused delegated identity never reached the marketplace at all.
 */
export function classifySelectFailure(error: unknown): SelectFailureKind {
  if (error instanceof MarketplaceTimeoutError) {
    return "ambiguous";
  }
  if (error instanceof ContractError) {
    if (error.code === "service_unavailable") {
      return error.details?.reason === "delegation_refused"
        ? "definitive"
        : "ambiguous";
    }
    return error.code === "award_unresolved" || error.code === "internal_error"
      ? "ambiguous"
      : "definitive";
  }
  return "ambiguous";
}

/** The reason code a definitive refusal is recorded under. */
export function failureReason(error: unknown): string {
  if (error instanceof ContractError) {
    const reason = error.details?.reason;
    return typeof reason === "string" ? reason : error.code;
  }
  return "select_failed";
}
