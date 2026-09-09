/**
 * Threads, the message turn, and handoff to a human.
 *
 * The message turn runs the bounded tool loop (reads only) and then persists its
 * result in ONE audited transaction: the user's redacted message, the assistant's
 * redacted answer with its cards and sources, a review row if the assistant
 * proposed a transaction (only when `ai_transactions` is on), a refusal event if
 * it hit its scope, and every ai_actions row the loop produced. The SSE stream
 * the caller sends is composed from that committed result.
 *
 * Ownership is from the gateway context on every path: a thread that is not the
 * caller's is `not_found`, never readable by guessing an id (rule #18).
 */
import {
  ContractError,
  isEnabled,
  money,
  type Money,
} from "@ubi/contracts";

import { assertFlagEnabled } from "./flags";
import { actorKindFor, auditedTransaction, type OutboxInput } from "./audit";
import { redact } from "../ai/redaction";
import { runTurn, type StoredMessage } from "../ai/loop";
import { generateId } from "../lib/ids";

import type { AskEvent } from "../ai/events";
import type { AskDeps } from "./context";
import type { Actor, AskRole, JsonRecord } from "./types";
import type { Prisma } from "@prisma/client/index";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function outboxKey(): string {
  return generateId("oik");
}

export interface OpenThreadInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly source: string;
  readonly correlationId: string | null;
}

export interface ThreadView {
  readonly id: string;
  readonly createdAt: string;
}

export async function openThread(
  deps: AskDeps,
  input: OpenThreadInput,
): Promise<ThreadView> {
  const flags = await deps.flags.flagsFor(input.cityId);
  assertFlagEnabled(flags, "ai_assistant");

  const threadId = generateId("thr");
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);

  const view = await auditedTransaction(deps.db, async (tx) => {
    await tx.askThread.create({
      data: {
        id: threadId,
        userId: input.actor.id,
        role: input.actor.role,
        source: input.source,
        createdAt: now,
      },
    });
    const event: OutboxInput = {
      name: "ask.thread.opened",
      aggregateType: "askThread",
      aggregateId: threadId,
      fromVersion: null,
      toVersion: 1,
      actor: input.actor,
      actorType,
      cityId: input.cityId,
      idempotencyKey: outboxKey(),
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { threadId, source: input.source },
    };
    return {
      result: { id: threadId, createdAt: now.toISOString() },
      events: [event],
      aiActions: [
        {
          actorKind: actorType,
          actorRef: input.actor.id,
          threadId,
          action: "thread.opened",
          authKind: "none" as const,
          outcome: "done" as const,
          redactedInputs: { source: input.source } satisfies JsonRecord,
        },
      ],
    };
  });
  return view;
}

export interface MessageInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly threadId: string;
  readonly text: string;
  readonly clarifications: Readonly<Record<string, unknown>> | null;
  readonly correlationId: string | null;
}

export interface MessageResult {
  readonly events: readonly AskEvent[];
  readonly reviewId: string | null;
}

function clarificationText(
  clarifications: Readonly<Record<string, unknown>> | null,
): string {
  if (clarifications === null) {
    return "";
  }
  const parts = Object.entries(clarifications).map(
    ([key, value]) => `${key}=${String(value)}`,
  );
  return parts.length === 0 ? "" : `\n[clarifications: ${parts.join("; ")}]`;
}

export async function handleMessage(
  deps: AskDeps,
  input: MessageInput,
): Promise<MessageResult> {
  const flags = await deps.flags.flagsFor(input.cityId);
  assertFlagEnabled(flags, "ai_assistant");
  const transactionsEnabled = isEnabled(flags, "ai_transactions");

  const thread = await deps.db.askThread.findUnique({
    where: { id: input.threadId },
  });
  if (thread === null || thread.userId !== input.actor.id) {
    // A thread you do not own must not be discoverable.
    throw new ContractError("not_found", "no such thread");
  }
  if (thread.closedAt !== null) {
    throw new ContractError("conflict", "this thread is closed");
  }
  const role = thread.role as AskRole;
  const actorType = actorKindFor(input.actor.role);

  const priorRows = await deps.db.askMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "asc" },
  });
  const history: StoredMessage[] = priorRows.map((row) => ({
    sender: row.sender as StoredMessage["sender"],
    text: row.redactedText,
  }));

  const userText = `${input.text}${clarificationText(input.clarifications)}`;

  const turn = await runTurn(deps, {
    actor: input.actor,
    role,
    actorKind: actorType,
    cityId: input.cityId,
    threadId: input.threadId,
    history,
    userText,
  });

  const now = deps.now();
  const proposal =
    turn.proposal !== null && transactionsEnabled ? turn.proposal : null;
  const proposalBlocked = turn.proposal !== null && !transactionsEnabled;

  const persisted = await auditedTransaction(deps.db, async (tx) => {
    await tx.askMessage.create({
      data: {
        id: generateId("msg"),
        threadId: input.threadId,
        sender: "user",
        redactedText: redact(userText),
        createdAt: now,
      },
    });
    await tx.askMessage.create({
      data: {
        id: generateId("msg"),
        threadId: input.threadId,
        sender: "assistant",
        redactedText: redact(turn.answerText),
        cards: turn.cards.length > 0 ? asJson(turn.cards) : undefined,
        sources: turn.sources.length > 0 ? asJson(turn.sources) : undefined,
        createdAt: now,
      },
    });

    const events: OutboxInput[] = [];
    let reviewId: string | null = null;
    let total: Money | null = null;

    if (proposal !== null) {
      reviewId = generateId("rvw");
      total = money(proposal.totalMinor, proposal.currency);
      const expiresAt = new Date(
        now.getTime() + deps.limits.reviewTtlSeconds * 1000,
      );
      await tx.askReview.create({
        data: {
          id: reviewId,
          threadId: input.threadId,
          userId: input.actor.id,
          termsVersion: proposal.termsVersion,
          items: asJson({
            items: proposal.items,
            notes: proposal.notes,
            assuranceRequired: proposal.assuranceRequired,
          }),
          totalMinor: BigInt(proposal.totalMinor),
          currency: proposal.currency,
          paymentMethodId: proposal.paymentMethodId,
          status: "awaiting_confirmation",
          expiresAt,
          createdAt: now,
        },
      });
      events.push({
        name: "ask.review.created",
        aggregateType: "askReview",
        aggregateId: reviewId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          reviewId,
          termsVersion: proposal.termsVersion,
          totalMinor: proposal.totalMinor,
          currency: proposal.currency,
          items: proposal.items.length,
        },
      });
    }

    if (turn.refused !== null) {
      events.push({
        name: "ask.action.refused",
        aggregateType: "askThread",
        aggregateId: input.threadId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { threadId: input.threadId, policy: turn.refused.policy },
      });
    }

    return {
      result: { reviewId, total },
      events,
      aiActions: turn.aiActions,
    };
  });

  // Compose the SSE stream from the committed result.
  const stream: AskEvent[] = [];
  if (turn.answerText.length > 0) {
    stream.push({ type: "token", text: turn.answerText });
  }
  for (const event of turn.events) {
    stream.push(event);
  }
  if (turn.clarify !== null && turn.clarify.length > 0) {
    stream.push({ type: "clarify", fields: turn.clarify });
  }
  if (persisted.reviewId !== null && persisted.total !== null) {
    stream.push({
      type: "review_ready",
      reviewId: persisted.reviewId,
      totals: persisted.total,
    });
  }
  if (proposalBlocked) {
    stream.push({
      type: "token",
      text: "Booking through the assistant is not available here. Use the Travel flow to book.",
    });
  }
  if (turn.refused !== null) {
    stream.push({
      type: "refused",
      deepLink: turn.refused.deepLink,
      policy: turn.refused.policy,
    });
  }
  stream.push({ type: "done" });

  return { events: stream, reviewId: persisted.reviewId };
}

export interface HandoffInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly threadId: string;
  readonly includeTranscript: boolean;
  readonly correlationId: string | null;
}

export interface HandoffResult {
  readonly supportCaseId: string;
  readonly estimatedWaitSec: number;
}

export async function handoff(
  deps: AskDeps,
  input: HandoffInput,
): Promise<HandoffResult> {
  const thread = await deps.db.askThread.findUnique({
    where: { id: input.threadId },
  });
  if (thread === null || thread.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such thread");
  }

  const rows = input.includeTranscript
    ? await deps.db.askMessage.findMany({
        where: { threadId: input.threadId },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const transcript = rows.map((row) => ({
    sender: row.sender,
    // Only the already-redacted text ever leaves this service (rule #20).
    text: row.redactedText,
  }));

  const opened = await deps.support.openCase({
    actor: input.actor,
    cityId: input.cityId,
    threadId: input.threadId,
    includeTranscript: input.includeTranscript,
    transcript,
    // A re-handoff of the same thread lands on the same support case.
    idempotencyKey: `ask.handoff:${input.actor.id}:${input.threadId}`,
  });

  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async () => ({
    result: null,
    aiActions: [
      {
        actorKind: actorType,
        actorRef: input.actor.id,
        threadId: input.threadId,
        action: "thread.handoff",
        authKind: "none" as const,
        outcome: "done" as const,
        reasonCode: "handoff",
        redactedInputs: {
          supportCaseId: opened.supportCaseId,
          includeTranscript: input.includeTranscript,
        } satisfies JsonRecord,
      },
    ],
  }));

  return opened;
}
