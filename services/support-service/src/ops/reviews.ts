/**
 * Review queues (board 4d KYC, 11c merchants, 18a hotels) and the decisions
 * taken on them.
 *
 * The slice is explicit that automated checks are ADVISORY and a human decides.
 * So the checks below never gate anything: they are computed, labelled and shown
 * next to the item. Nothing in this module lets a check approve or reject
 * something on its own, and the decision endpoint does not read them.
 *
 * Every completed decision writes a `review_decisions` row naming every reviewer
 * AND an audit row, in one transaction. Decisions the city marks as
 * dual-control — deactivation, and anything above the city's value threshold —
 * cannot be completed by one person: the first reviewer records an intent, and a
 * *different* reviewer completes it.
 */
import {
  ContractError,
  scopedIdempotencyKey,
  type FlagKey,
} from "@ubi/contracts";

import { auditedTransaction, type OutboxInput } from "./audit";
import { assertFlagEnabled, type SupportCityConfig } from "./city-config";
import { isUniqueViolation } from "./errors";
import { actorTypeFor, assertPermission } from "./roles";
import { deterministicId } from "../lib/ids";

import type { SupportDeps } from "./context";
import type { Actor, JsonRecord, SupportTx } from "./types";

export const REVIEW_QUEUES = [
  "kyc",
  "merchants",
  "hotels",
  "fleets",
  "claims",
  "identity",
] as const;
export type ReviewQueue = (typeof REVIEW_QUEUES)[number];

export const REVIEW_DECISIONS = [
  "approve",
  "reject",
  "request_fix",
  "deactivate",
] as const;
export type ReviewDecisionKind = (typeof REVIEW_DECISIONS)[number];

/**
 * A queue for a vertical that is off in this city is a deep link into a feature
 * that does not exist here, so it 404s rather than 403s (CLAUDE.md #5, #8).
 * KYC and identity are core, not a vertical, and have no flag.
 */
const QUEUE_FLAG: Readonly<Record<ReviewQueue, FlagKey | null>> = {
  kyc: null,
  identity: null,
  merchants: "bites",
  hotels: "stays",
  fleets: "fleet",
  claims: "send",
};

export type CheckLevel = "pass" | "warn" | "fail";

export interface AdvisoryCheck {
  readonly code: string;
  readonly level: CheckLevel;
  readonly detail: string;
}

export interface ReviewItem {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly submittedAt: string;
  /** Advisory only. A human reads these; nothing in the code branches on them. */
  readonly checks: readonly AdvisoryCheck[];
  readonly summary: JsonRecord;
}

export interface ReviewQueueView {
  readonly queue: ReviewQueue;
  /**
   * False when this deployment has no table behind the queue. Shown as
   * unavailable with the reason, never hidden and never faked (CLAUDE.md #8).
   */
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly items: readonly ReviewItem[];
  readonly pendingDualControl: readonly PendingDecisionView[];
}

export interface PendingDecisionView {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly decision: string;
  readonly reviewers: readonly string[];
  readonly valueMinor: number | null;
  readonly createdAt: string;
}

export function isReviewQueue(value: string): value is ReviewQueue {
  return (REVIEW_QUEUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Queue contents
// ---------------------------------------------------------------------------

async function kycItems(tx: SupportTx, limit: number): Promise<ReviewItem[]> {
  const rows = await tx.identityDocument.findMany({
    where: { reviewedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const now = Date.now();
  return rows.map((row) => {
    const checks: AdvisoryCheck[] = [
      row.fileRef.length > 0
        ? {
            code: "document.file_attached",
            level: "pass",
            detail: "a file is attached",
          }
        : {
            code: "document.file_attached",
            level: "fail",
            detail: "no file is attached to this document",
          },
      row.expiresAt === null
        ? {
            code: "document.expiry_present",
            level: "warn",
            detail: "no expiry date was captured",
          }
        : row.expiresAt.getTime() <= now
          ? {
              code: "document.not_expired",
              level: "fail",
              detail: "the document is already expired",
            }
          : {
              code: "document.not_expired",
              level: "pass",
              detail: "the document is in date",
            },
    ];
    return {
      subjectType: "document",
      subjectId: row.id,
      submittedAt: row.createdAt.toISOString(),
      checks,
      summary: {
        docType: row.type,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        status: row.status,
        expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
      },
    };
  });
}

async function identityItems(
  tx: SupportTx,
  limit: number,
): Promise<ReviewItem[]> {
  const rows = await tx.identityCase.findMany({
    where: { decision: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (rows.length === 0) {
    return [];
  }
  const faceChecks = await tx.faceCheck.findMany({
    where: { driverId: { in: rows.map((row) => row.driverId) } },
    orderBy: { createdAt: "desc" },
    take: limit * 5,
  });
  return rows.map((row) => {
    const latest = faceChecks.find((check) => check.driverId === row.driverId);
    const checks: AdvisoryCheck[] = [
      latest === undefined
        ? {
            code: "face_check.present",
            level: "warn",
            detail: "no face check is on file for this driver",
          }
        : latest.passed
          ? {
              code: "face_check.latest_passed",
              level: "pass",
              detail: "the most recent face check passed",
            }
          : {
              code: "face_check.latest_failed",
              level: "fail",
              detail: "the most recent face check failed",
            },
    ];
    return {
      subjectType: "identity_case",
      subjectId: row.id,
      submittedAt: row.createdAt.toISOString(),
      checks,
      summary: {
        driverId: row.driverId,
        status: row.status,
        // The biometric score is kept; the image never was (CLAUDE.md #6).
        latestScore:
          latest?.score === null || latest === undefined
            ? null
            : Number(latest.score),
      },
    };
  });
}

async function merchantItems(
  tx: SupportTx,
  limit: number,
): Promise<ReviewItem[]> {
  const rows = await tx.merchant.findMany({
    where: { verifiedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((row) => {
    const checks: AdvisoryCheck[] = [
      row.businessName.trim().length > 1
        ? {
            code: "merchant.business_name",
            level: "pass",
            detail: "a business name was given",
          }
        : {
            code: "merchant.business_name",
            level: "fail",
            detail: "the business name is missing or too short",
          },
      row.address.trim().length > 0
        ? {
            code: "merchant.address",
            level: "pass",
            detail: "an address was given",
          }
        : {
            code: "merchant.address",
            level: "fail",
            detail: "no address was given",
          },
      row.latitude !== 0 || row.longitude !== 0
        ? {
            code: "merchant.geo",
            level: "pass",
            detail: "the store has been placed on the map",
          }
        : {
            code: "merchant.geo",
            level: "warn",
            detail: "the store has no coordinates",
          },
    ];
    return {
      subjectType: "merchant",
      subjectId: row.id,
      submittedAt: row.createdAt.toISOString(),
      checks,
      summary: { businessName: row.businessName, userId: row.userId },
    };
  });
}

/** Queues with no table behind them in this schema. */
const UNBACKED: Readonly<Partial<Record<ReviewQueue, string>>> = {
  hotels:
    "no hotel partner table exists in this schema yet (slice 09); the queue cannot be populated",
  fleets:
    "no fleet operator table exists in this schema yet (slice 10); the queue cannot be populated",
  claims:
    "no delivery claim table exists in this schema yet (slice 06); the queue cannot be populated",
};

export interface ListQueueInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly queue: ReviewQueue;
  readonly limit: number;
}

export async function listQueue(
  deps: SupportDeps,
  input: ListQueueInput,
): Promise<ReviewQueueView> {
  assertPermission(input.actor.role, "review.read");
  const config = await deps.config.loadForSupport(input.cityId);
  const flag = QUEUE_FLAG[input.queue];
  if (flag !== null) {
    assertFlagEnabled(config.flags, flag);
  }

  const unavailable = UNBACKED[input.queue];
  if (unavailable !== undefined) {
    return {
      queue: input.queue,
      available: false,
      unavailableReason: unavailable,
      items: [],
      pendingDualControl: await pendingDecisions(deps, input.queue),
    };
  }

  const items =
    input.queue === "kyc"
      ? await kycItems(deps.db, input.limit)
      : input.queue === "identity"
        ? await identityItems(deps.db, input.limit)
        : await merchantItems(deps.db, input.limit);

  return {
    queue: input.queue,
    available: true,
    unavailableReason: null,
    items,
    pendingDualControl: await pendingDecisions(deps, input.queue),
  };
}

// ---------------------------------------------------------------------------
// Dual control
// ---------------------------------------------------------------------------

interface ChecksBlock {
  readonly advisory?: readonly AdvisoryCheck[];
  readonly dualControl?: {
    readonly required: boolean;
    readonly complete: boolean;
  };
  readonly valueMinor?: number | null;
  readonly note?: string | null;
}

function readChecks(value: unknown): ChecksBlock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as ChecksBlock;
}

export function requiresDualControl(
  config: SupportCityConfig,
  decision: ReviewDecisionKind,
  valueMinor: number | null,
): boolean {
  if (config.policy.reviewDualControlDecisions.includes(decision)) {
    return true;
  }
  return (
    valueMinor !== null &&
    valueMinor > config.policy.reviewDualControlAboveMinor
  );
}

/**
 * What the subject is worth, decided by the server. The only subject in this
 * schema that carries money is a support case, whose value is the sum of the
 * remedies posted against it — so approving a review of a heavily-remedied case
 * needs two people. A client cannot supply this number.
 */
export async function subjectValueMinor(
  tx: SupportTx,
  subjectType: string,
  subjectId: string,
): Promise<number | null> {
  if (subjectType !== "support_case") {
    return null;
  }
  const remedies = await tx.remedy.findMany({
    where: { caseId: subjectId },
    select: { amountMinor: true },
  });
  if (remedies.length === 0) {
    return null;
  }
  return remedies.reduce(
    (total, remedy) => total + Number(remedy.amountMinor ?? 0),
    0,
  );
}

async function pendingDecisions(
  deps: SupportDeps,
  queue: ReviewQueue,
): Promise<PendingDecisionView[]> {
  const rows = await deps.db.reviewDecision.findMany({
    where: { queue },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows
    .filter((row) => {
      const checks = readChecks(row.checks);
      return (
        checks.dualControl?.required === true &&
        checks.dualControl.complete !== true
      );
    })
    .map((row) => ({
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      decision: row.decision,
      reviewers: row.reviewers,
      valueMinor: readChecks(row.checks).valueMinor ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export interface DecideInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly queue: ReviewQueue;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly decision: ReviewDecisionKind;
  readonly note: string;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface DecisionView {
  readonly id: string;
  readonly queue: ReviewQueue;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly decision: string;
  readonly reviewers: readonly string[];
  readonly status: "pending_second_reviewer" | "complete";
  readonly valueMinor: number | null;
  readonly createdAt: string;
  readonly replayed: boolean;
}

/** Contract events for the queues that have one. See the slice report for the rest. */
function eventForDecision(
  queue: ReviewQueue,
  decision: ReviewDecisionKind,
): string | null {
  switch (queue) {
    case "identity":
      return "identity.case_decided";
    case "merchants":
      return decision === "approve"
        ? "merchant.approved"
        : decision === "request_fix"
          ? "merchant.fix_requested"
          : null;
    case "hotels":
      return decision === "approve" ? "partner.approved" : null;
    case "claims":
      return "claim.decided";
    case "kyc":
    case "fleets":
      return null;
    default:
      return null;
  }
}

/**
 * Applies a completed decision to the record it is about. The queue exists to
 * change something; a decision that only writes a decision row is a decision
 * nobody acted on.
 */
async function applyDecision(
  tx: SupportTx,
  input: DecideInput,
  reviewers: readonly string[],
  now: Date,
): Promise<void> {
  const status =
    input.decision === "approve"
      ? "approved"
      : input.decision === "reject"
        ? "rejected"
        : input.decision === "request_fix"
          ? "needs_fix"
          : "revoked";

  if (input.queue === "kyc" && input.subjectType === "document") {
    await tx.identityDocument.update({
      where: { id: input.subjectId },
      data: {
        status,
        reviewedBy: reviewers.join(","),
        reviewedAt: now,
        reviewNote: input.note,
      },
    });
    return;
  }
  if (input.queue === "identity" && input.subjectType === "identity_case") {
    await tx.identityCase.update({
      where: { id: input.subjectId },
      data: {
        decision: input.decision,
        decidedBy: [...reviewers],
        status: "decided",
      },
    });
    return;
  }
  if (input.queue === "merchants" && input.subjectType === "merchant") {
    await tx.merchant.update({
      where: { id: input.subjectId },
      data: { verifiedAt: input.decision === "approve" ? now : null },
    });
  }
}

export async function decide(
  deps: SupportDeps,
  input: DecideInput,
): Promise<DecisionView> {
  assertPermission(input.actor.role, "review.decide");
  const config = await deps.config.loadForSupport(input.cityId);
  const flag = QUEUE_FLAG[input.queue];
  if (flag !== null) {
    assertFlagEnabled(config.flags, flag);
  }

  const valueMinor = await subjectValueMinor(
    deps.db,
    input.subjectType,
    input.subjectId,
  );
  const dualControl = requiresDualControl(config, input.decision, valueMinor);
  const now = deps.now();

  const scoped = scopedIdempotencyKey(
    `review.decide:${input.queue}`,
    input.actor.id,
    input.idempotencyKey,
  );
  const decisionId = deterministicId("rvd", scoped);

  const replay = await deps.db.reviewDecision.findUnique({
    where: { id: decisionId },
  });
  if (replay !== null) {
    const checks = readChecks(replay.checks);
    return {
      id: replay.id,
      queue: input.queue,
      subjectType: replay.subjectType,
      subjectId: replay.subjectId,
      decision: replay.decision,
      reviewers: replay.reviewers,
      status:
        checks.dualControl?.required === true &&
        checks.dualControl.complete !== true
          ? "pending_second_reviewer"
          : "complete",
      valueMinor: checks.valueMinor ?? null,
      createdAt: replay.createdAt.toISOString(),
      replayed: true,
    };
  }

  // Not a replay. A dual-control decision another reviewer has already proposed
  // is completed here rather than started a second time.
  if (dualControl) {
    const open = await findOpenProposal(deps, input);
    if (open !== null) {
      if (open.reviewers.includes(input.actor.id)) {
        throw new ContractError(
          "already_approved",
          "you have already signed this decision; a different reviewer has to confirm it",
          { decisionId: open.id },
        );
      }
      const completion = await completeProposal(
        deps,
        input,
        open.id,
        open.reviewers,
        valueMinor,
        now,
      );
      return completion;
    }
  }

  const advisory = await advisoryFor(deps, input);
  const complete = !dualControl;

  try {
    const decided = await auditedTransaction(deps.db, async (tx) => {
      const row = await tx.reviewDecision.create({
        data: {
          id: decisionId,
          queue: input.queue,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          checks: {
            advisory: [...advisory],
            dualControl: { required: dualControl, complete },
            valueMinor,
            note: input.note,
          } as never,
          decision: input.decision,
          reviewers: [input.actor.id],
          note: input.note,
        },
      });

      const events: OutboxInput[] = [];
      if (complete) {
        await applyDecision(tx, input, [input.actor.id], now);
        const name = eventForDecision(input.queue, input.decision);
        if (name !== null) {
          events.push({
            name,
            aggregateType: "case",
            aggregateId: input.subjectId,
            fromVersion: null,
            toVersion: 1,
            actor: input.actor,
            actorType: actorTypeFor(input.actor.role),
            cityId: input.cityId,
            idempotencyKey: `${name}:${decisionId}`,
            correlationId: input.correlationId,
            occurredAt: now,
            payload: {
              queue: input.queue,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              decision: input.decision,
              reviewers: [input.actor.id],
            },
          });
        }
      }

      return {
        result: {
          id: row.id,
          queue: input.queue,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          decision: input.decision,
          reviewers: row.reviewers,
          status: complete
            ? ("complete" as const)
            : ("pending_second_reviewer" as const),
          valueMinor,
          createdAt: row.createdAt.toISOString(),
          replayed: false,
        },
        audit: {
          actor: input.actor,
          action: complete
            ? `review.${input.queue}.decided`
            : `review.${input.queue}.proposed`,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          reason: input.note,
          before: { decision: null },
          after: {
            decision: input.decision,
            reviewers: [input.actor.id],
            dualControlRequired: dualControl,
            complete,
            valueMinor,
          },
          correlationId: input.correlationId,
        },
        events,
      };
    });
    return decided;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await deps.db.reviewDecision.findUnique({
        where: { id: decisionId },
      });
      if (existing !== null) {
        const checks = readChecks(existing.checks);
        return {
          id: existing.id,
          queue: input.queue,
          subjectType: existing.subjectType,
          subjectId: existing.subjectId,
          decision: existing.decision,
          reviewers: existing.reviewers,
          status:
            checks.dualControl?.required === true &&
            checks.dualControl.complete !== true
              ? "pending_second_reviewer"
              : "complete",
          valueMinor: checks.valueMinor ?? null,
          createdAt: existing.createdAt.toISOString(),
          replayed: true,
        };
      }
    }
    throw error;
  }
}

interface OpenProposal {
  readonly id: string;
  readonly reviewers: readonly string[];
}

async function findOpenProposal(
  deps: SupportDeps,
  input: DecideInput,
): Promise<OpenProposal | null> {
  const rows = await deps.db.reviewDecision.findMany({
    where: {
      queue: input.queue,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      decision: input.decision,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const row of rows) {
    const checks = readChecks(row.checks);
    if (
      checks.dualControl?.required === true &&
      checks.dualControl.complete !== true
    ) {
      return { id: row.id, reviewers: row.reviewers };
    }
  }
  return null;
}

async function completeProposal(
  deps: SupportDeps,
  input: DecideInput,
  decisionId: string,
  existingReviewers: readonly string[],
  valueMinor: number | null,
  now: Date,
): Promise<DecisionView> {
  const reviewers = [...existingReviewers, input.actor.id];
  const completed = await auditedTransaction(deps.db, async (tx) => {
    const current = await tx.reviewDecision.findUnique({
      where: { id: decisionId },
    });
    if (current === null) {
      throw new ContractError("not_found", "that decision is no longer open", {
        decisionId,
      });
    }
    const checks = readChecks(current.checks);
    const row = await tx.reviewDecision.update({
      where: { id: decisionId },
      data: {
        reviewers,
        checks: {
          advisory: [...(checks.advisory ?? [])],
          dualControl: { required: true, complete: true },
          valueMinor,
          note: `${checks.note ?? ""}${checks.note === undefined || checks.note === null ? "" : " | "}${input.note}`,
        } as never,
      },
    });

    await applyDecision(tx, input, reviewers, now);

    const events: OutboxInput[] = [];
    const name = eventForDecision(input.queue, input.decision);
    if (name !== null) {
      events.push({
        name,
        aggregateType: "case",
        aggregateId: input.subjectId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        idempotencyKey: `${name}:${decisionId}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          queue: input.queue,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          decision: input.decision,
          reviewers: [...reviewers],
        },
      });
    }

    return {
      result: {
        id: row.id,
        queue: input.queue,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        decision: row.decision,
        reviewers: row.reviewers,
        status: "complete" as const,
        valueMinor,
        createdAt: row.createdAt.toISOString(),
        replayed: false,
      },
      audit: {
        actor: input.actor,
        action: `review.${input.queue}.decided`,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        reason: input.note,
        before: { reviewers: [...existingReviewers], complete: false },
        after: {
          decision: input.decision,
          reviewers,
          complete: true,
          valueMinor,
        },
        correlationId: input.correlationId,
      },
      events,
    };
  });
  return completed;
}

/** The advisory checks for the item being decided, recorded with the decision. */
async function advisoryFor(
  deps: SupportDeps,
  input: DecideInput,
): Promise<readonly AdvisoryCheck[]> {
  const items =
    input.queue === "kyc"
      ? await kycItems(deps.db, 200)
      : input.queue === "identity"
        ? await identityItems(deps.db, 200)
        : input.queue === "merchants"
          ? await merchantItems(deps.db, 200)
          : [];
  const match = items.find(
    (item) =>
      item.subjectType === input.subjectType &&
      item.subjectId === input.subjectId,
  );
  return match?.checks ?? [];
}
