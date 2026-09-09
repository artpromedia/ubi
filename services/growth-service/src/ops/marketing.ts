/**
 * The marketing assistant (CLAUDE.md #22).
 *
 * The assistant produces DRAFT material only. It reads aggregates — never
 * individual users — and any cohort it cites must have a sample of at least 50,
 * or it is suppressed rather than shown. Activation, outbound sending and budget
 * changes are NOT available here: they go through the two-person campaign
 * approval flow. This module can propose; it can never move money or send.
 *
 * Every call is logged as an AI action (`ai.action.logged`) and every proposal
 * as `marketing.proposal.created`, so ops.ai can audit what the model did.
 */
import { auditedTransaction, type OutboxInput } from "./audit";
import { assertPermission } from "./roles";

import type { GrowthDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const MIN_COHORT = 50;
const MODEL = process.env.MARKETING_MODEL ?? "unset";
const PROMPT_VERSION = process.env.MARKETING_PROMPT_VERSION ?? "unset";

export interface ProposeInput {
  readonly actor: Actor;
  readonly cityId: string | null;
  readonly threadId: string;
  readonly text: string;
  readonly correlationId: string | null;
}

/**
 * Turns a marketer's brief into a draft proposal. The evidence is a real
 * aggregate over the user base; a cohort smaller than the k-anonymity floor is
 * reported as suppressed, never as a number.
 */
export async function proposeMessage(
  deps: GrowthDeps,
  input: ProposeInput,
): Promise<JsonRecord> {
  assertPermission(input.actor.role, "marketing.draft");

  const totalUsers = await deps.db.user.count();
  const evidence: JsonRecord[] = [
    totalUsers >= MIN_COHORT
      ? { query: "eligible_user_base", value: String(totalUsers) }
      : { query: "eligible_user_base", value: `suppressed (k<${MIN_COHORT})` },
  ];

  // The proposal is draft material. It names no user, invents no price, and its
  // budget is an estimate the human still has to size and approve.
  const proposal: JsonRecord = {
    brief: input.text,
    audienceRule: "all",
    benefit: { type: "fare_discount", note: "draft — sized and approved by a human" },
    copy: [
      {
        locale: "en-NG",
        channel: "push",
        text: "Draft copy — pending native review",
        needsNativeReview: true,
      },
    ],
    channels: {
      plan: ["push"],
      frequencyCap: "enforced by notification-service at send time",
      quietHours: "enforced by notification-service at send time",
    },
    experiment: "holdout suggested; stable by user id",
    evidence,
    assumptions: [
      "activation, sending and budget go through two-person approval",
      "the assistant cannot activate or send",
    ],
    budget: {
      eligibleUsers: totalUsers,
      expectedRedemptionPct: 0,
      redemptionRange: [0, 1],
      maxLiability: null,
      expectedSpend: null,
      warnings: ["draft only; not yet simulated"],
    },
  };

  const now = deps.now();
  await auditedTransaction(deps.db, async (_tx) => {
    const events: OutboxInput[] = [
      {
        name: "marketing.proposal.created",
        aggregateType: "config",
        aggregateId: input.threadId,
        fromVersion: null,
        toVersion: 0,
        actor: input.actor,
        actorType: "system",
        cityId: input.cityId,
        idempotencyKey: `marketing.proposal.created:${input.threadId}:${now.getTime()}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          threadId: input.threadId,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
        },
      },
      {
        name: "ai.action.logged",
        aggregateType: "config",
        aggregateId: input.threadId,
        fromVersion: null,
        toVersion: 0,
        actor: input.actor,
        actorType: "system",
        cityId: input.cityId,
        idempotencyKey: `ai.action.logged:marketing:${input.threadId}:${now.getTime()}`,
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          action: "marketing.propose",
          tool: "marketing_assistant",
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          authKind: "read_only",
          outcome: "done",
        },
      },
    ];
    return {
      result: null,
      audit: {
        actor: input.actor,
        action: "growth.marketing.proposed",
        subjectType: "marketing_thread",
        subjectId: input.threadId,
        reason: "assistant produced a draft proposal",
        before: null,
        after: { threadId: input.threadId, cohortSuppressed: totalUsers < MIN_COHORT },
        correlationId: input.correlationId,
      },
      events,
    };
  });

  return proposal;
}
