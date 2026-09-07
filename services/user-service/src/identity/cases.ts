/**
 * Identity cases — what happens after a face check fails.
 *
 * A failed check takes the driver OFFLINE and opens a case. It does not
 * deactivate anyone: `users.status` is untouched by the automated path.
 * Automated checks are advisory; a person decides (board 4d).
 *
 * DEACTIVATION NEEDS TWO REVIEWERS. The first reviewer's call is recorded and
 * the case waits; only a SECOND, DIFFERENT reviewer applies it. Reinstating
 * needs one — restoring access is not the dangerous direction. Neither reviewer
 * may be the driver.
 */
import { ContractError } from "@ubi/contracts";
import { z } from "zod";

import { writeAudit } from "./audit";
import { auditRevision } from "./common";
import type { IdentityDeps } from "./deps";
import { APPEAL_MESSAGE, APPEAL_PATH } from "./driver";
import { newId } from "./ids";
import { eventIdempotencyKey, writeOutboxEvent } from "./outbox";

export const CASE_DECISIONS = ["reinstate", "deactivate"] as const;
export type CaseDecision = (typeof CASE_DECISIONS)[number];

export const REQUIRED_REVIEWERS: Readonly<Record<CaseDecision, number>> = {
  reinstate: 1,
  deactivate: 2,
};

export const DecideCaseSchema = z.object({
  decision: z.enum(CASE_DECISIONS),
  reason: z.string().min(4).max(500),
});

export interface DecideCaseInput extends z.infer<typeof DecideCaseSchema> {
  readonly caseId: string;
  readonly reviewerId: string;
  readonly cityId: string | null;
}

export interface CaseOutcome {
  readonly caseId: string;
  readonly status: string;
  readonly decision: CaseDecision | null;
  readonly reviewers: readonly string[];
  readonly reviewersRequired: number;
  readonly applied: boolean;
  readonly reason: string;
  readonly appealPath: string;
  readonly appealMessage: string;
}

export async function decideIdentityCase(
  deps: IdentityDeps,
  input: DecideCaseInput,
): Promise<CaseOutcome> {
  const now = deps.now();
  const policy = await deps.policy.forCity(input.cityId);

  const existing = await deps.prisma.identityCase.findUnique({ where: { id: input.caseId } });
  if (existing === null) throw new ContractError("not_found", "Identity case not found");
  if (existing.status === "decided") {
    throw new ContractError("conflict", "That case has already been decided", {
      decision: existing.decision,
    });
  }

  const driver = await deps.prisma.driver.findUnique({
    where: { id: existing.driverId },
    select: { userId: true },
  });
  if (driver === null) throw new ContractError("not_found", "Driver not found");
  if (driver.userId === input.reviewerId) {
    throw new ContractError("forbidden", "You cannot review your own case");
  }

  // A reviewer who already signed cannot be the second signature too.
  const reviewers = existing.decidedBy.includes(input.reviewerId)
    ? existing.decidedBy
    : [...existing.decidedBy, input.reviewerId];
  if (
    existing.decidedBy.includes(input.reviewerId) &&
    existing.decision === input.decision
  ) {
    throw new ContractError(
      "already_approved",
      "You have already recorded a decision on this case. A second reviewer must confirm it.",
      { reviewers: existing.decidedBy },
    );
  }

  // Changing the proposed decision restarts the count: two reviewers must agree
  // on the SAME outcome.
  const sameDecision = existing.decision === null || existing.decision === input.decision;
  const effectiveReviewers = sameDecision ? reviewers : [input.reviewerId];
  const required = REQUIRED_REVIEWERS[input.decision];
  const applied = effectiveReviewers.length >= required;
  const status = applied ? "decided" : "awaiting_second_reviewer";

  await deps.prisma.$transaction(async (tx) => {
    await tx.identityCase.update({
      where: { id: input.caseId },
      data: { status, decision: input.decision, decidedBy: effectiveReviewers },
    });

    await tx.reviewDecision.create({
      data: {
        id: newId("rvd"),
        queue: "identity",
        subjectType: "identity_case",
        subjectId: input.caseId,
        decision: input.decision,
        reviewers: effectiveReviewers,
        note: input.reason,
        createdAt: now,
      },
    });

    await writeAudit(tx, {
      actorId: input.reviewerId,
      actorRole: "agent",
      action: applied ? `identity.case_${input.decision}` : "identity.case_review_recorded",
      subjectType: "identity_case",
      subjectId: input.caseId,
      before: { status: existing.status, decidedBy: existing.decidedBy },
      after: { status, decision: input.decision, decidedBy: effectiveReviewers },
      reason: input.reason,
    });

    if (!applied) return;

    if (input.decision === "deactivate") {
      await tx.user.update({
        where: { id: driver.userId },
        data: { status: "SUSPENDED" },
      });
      await tx.driver.update({
        where: { id: existing.driverId },
        data: { isOnline: false, isAvailable: false },
      });
    }

    const revision = await auditRevision(tx, "driver", existing.driverId);
    await writeOutboxEvent(tx, {
      name: "identity.case_decided",
      subjectType: "driver",
      subjectId: existing.driverId,
      actorType: "agent",
      actorId: input.reviewerId,
      idempotencyKey: eventIdempotencyKey("identity.case_decided", input.caseId),
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: policy.cityId,
      payload: {
        driverId: existing.driverId,
        caseId: input.caseId,
        score: null,
        decision: input.decision,
        reviewers: effectiveReviewers,
        reason: input.reason,
        appealPath: APPEAL_PATH,
      },
      occurredAt: now,
    });
  });

  return {
    caseId: input.caseId,
    status,
    decision: input.decision,
    reviewers: effectiveReviewers,
    reviewersRequired: required,
    applied,
    reason: input.reason,
    appealPath: APPEAL_PATH,
    appealMessage: APPEAL_MESSAGE,
  };
}

export interface CaseView {
  readonly id: string;
  readonly driverId: string;
  readonly status: string;
  readonly decision: string | null;
  readonly reviewers: readonly string[];
  readonly reviewersRequired: number;
  readonly createdAt: string;
}

export async function listOpenIdentityCases(
  deps: IdentityDeps,
  limit = 50,
): Promise<readonly CaseView[]> {
  const cases = await deps.prisma.identityCase.findMany({
    where: { status: { not: "decided" } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return cases.map((row) => ({
    id: row.id,
    driverId: row.driverId,
    status: row.status,
    decision: row.decision,
    reviewers: row.decidedBy,
    reviewersRequired:
      row.decision === null
        ? REQUIRED_REVIEWERS.deactivate
        : REQUIRED_REVIEWERS[row.decision as CaseDecision] ?? REQUIRED_REVIEWERS.deactivate,
    createdAt: row.createdAt.toISOString(),
  }));
}
