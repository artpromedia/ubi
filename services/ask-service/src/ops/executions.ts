/**
 * Executions.
 *
 * An execution runs the transactional tools that a confirmed review authorised,
 * under the single-use grant that the confirm minted and consumed. Items are
 * separate orders with their own money and state: a partial outcome is
 * `partly_booked` and is NEVER coerced to `confirmed` (rule #25, the askExecution
 * machine). The grant is already spent by the time booking runs, so a partial
 * failure cannot be silently retried into a second charge.
 */
import {
  assertTransition,
  ContractError,
  money,
  type Money,
} from "@ubi/contracts";

import { actorKindFor, auditedTransaction, type OutboxInput } from "./audit";
import { parseStoredReview } from "./review-model";
import { generateId } from "../lib/ids";

import type { AskDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { Prisma } from "@prisma/client/index";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
function outboxKey(): string {
  return generateId("oik");
}

const CONFIRMED_STATES = new Set(["confirmed", "ticketed", "reserved"]);
const FAILED_STATES = new Set(["failed_released", "reservation_failed"]);

export interface ExecutionItemState {
  readonly kind: string;
  readonly title: string;
  readonly state: string;
  readonly orderId: string | null;
  readonly supplierRef: string | null;
  readonly chargedMinor: number | null;
  readonly releasedMinor: number | null;
  readonly currency: string;
  readonly detail: string | null;
}

function deriveOverall(
  items: readonly ExecutionItemState[],
): "confirmed" | "partly_booked" | "failed" {
  const total = items.length;
  const confirmed = items.filter((item) =>
    CONFIRMED_STATES.has(item.state),
  ).length;
  const failed = items.filter((item) => FAILED_STATES.has(item.state)).length;
  if (confirmed === total) {
    return "confirmed";
  }
  if (confirmed === 0 && failed === total) {
    return "failed";
  }
  return "partly_booked";
}

export interface RunExecutionInput {
  readonly executionId: string;
  readonly reviewId: string;
  readonly actor: Actor;
  readonly cityId: string;
  readonly grantId: string;
  readonly correlationId: string | null;
}

export async function runExecution(
  deps: AskDeps,
  input: RunExecutionInput,
): Promise<void> {
  const review = await deps.db.askReview.findUnique({
    where: { id: input.reviewId },
  });
  if (review === null) {
    return;
  }
  const stored = parseStoredReview(review.items);

  // Book each item as a separate order. The grant is already consumed; book is
  // idempotent per item so a retry returns the same order, never a second charge.
  const results: ExecutionItemState[] = [];
  for (const item of stored.items) {
    try {
      const booked = await deps.travel.book(input.actor, {
        grantId: input.grantId,
        offerRef: item.offerRef,
        idempotencyKey: `${input.executionId}:${item.offerRef}`,
      });
      results.push({
        kind: item.kind,
        title: item.title,
        state: booked.state,
        orderId: booked.orderId,
        supplierRef: booked.supplierRef,
        chargedMinor: booked.chargedMinor,
        releasedMinor: booked.releasedMinor,
        currency: item.currency,
        detail: booked.detail,
      });
    } catch {
      results.push({
        kind: item.kind,
        title: item.title,
        state: "failed_released",
        orderId: null,
        supplierRef: null,
        chargedMinor: null,
        releasedMinor: null,
        currency: item.currency,
        detail: "The supplier could not be reached; nothing was charged.",
      });
    }
  }

  const overall = deriveOverall(results);
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);

  await auditedTransaction(deps.db, async (tx) => {
    const exec = await tx.askExecution.findUnique({
      where: { id: input.executionId },
    });
    if (exec === null) {
      return { result: null };
    }
    assertTransition("askExecution", exec.status, overall);
    await tx.askExecution.update({
      where: { id: input.executionId },
      data: {
        status: overall,
        items: asJson(results),
        completedAt: now,
      },
    });

    const events: OutboxInput[] = results.map((item, index) => ({
      name: "ask.execution.item.updated",
      aggregateType: "askExecution",
      aggregateId: input.executionId,
      fromVersion: index,
      toVersion: index + 1,
      actor: input.actor,
      actorType,
      cityId: input.cityId,
      idempotencyKey: outboxKey(),
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        executionId: input.executionId,
        kind: item.kind,
        state: item.state,
        orderId: item.orderId,
        supplierRef: item.supplierRef,
      },
    }));
    events.push({
      name: "ask.execution.completed",
      aggregateType: "askExecution",
      aggregateId: input.executionId,
      fromVersion: results.length,
      toVersion: results.length + 1,
      actor: input.actor,
      actorType,
      cityId: input.cityId,
      idempotencyKey: outboxKey(),
      correlationId: input.correlationId,
      occurredAt: now,
      payload: { executionId: input.executionId, overall },
    });

    return {
      result: null,
      events,
      aiActions: [
        {
          actorKind: actorType,
          actorRef: input.actor.id,
          threadId: null,
          action: "execution.run",
          model: deps.model.model,
          modelRevision: deps.model.revision,
          authKind: "grant" as const,
          authRef: input.grantId,
          outcome:
            overall === "confirmed"
              ? ("done" as const)
              : overall === "failed"
                ? ("error" as const)
                : ("partial" as const),
          reasonCode: overall,
          redactedInputs: {
            executionId: input.executionId,
            items: results.length,
          } satisfies JsonRecord,
        },
      ],
    };
  });
}

export interface ExecutionView {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string;
  readonly items: readonly {
    readonly kind: string;
    readonly title: string;
    readonly state: string;
    readonly supplierRef?: string;
    readonly orderId?: string;
    readonly charged?: Money;
    readonly released?: Money;
    readonly detail?: string;
  }[];
}

export async function getExecution(
  deps: AskDeps,
  actor: Actor,
  executionId: string,
): Promise<ExecutionView> {
  const exec = await deps.db.askExecution.findUnique({
    where: { id: executionId },
    include: { review: true },
  });
  if (exec === null || exec.review.userId !== actor.id) {
    throw new ContractError("not_found", "no such execution");
  }
  const rawItems = Array.isArray(exec.items)
    ? (exec.items as unknown as ExecutionItemState[])
    : [];
  return {
    id: exec.id,
    status: exec.status,
    startedAt: exec.startedAt.toISOString(),
    items: rawItems.map((item) => ({
      kind: item.kind,
      title: item.title,
      state: item.state,
      supplierRef: item.supplierRef ?? undefined,
      orderId: item.orderId ?? undefined,
      charged:
        item.chargedMinor === null || item.chargedMinor === undefined
          ? undefined
          : money(item.chargedMinor, item.currency),
      released:
        item.releasedMinor === null || item.releasedMinor === undefined
          ? undefined
          : money(item.releasedMinor, item.currency),
      detail: item.detail ?? undefined,
    })),
  };
}
