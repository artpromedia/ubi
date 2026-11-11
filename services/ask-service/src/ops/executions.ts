/**
 * Executions.
 *
 * An execution runs the transactional tools that a confirmed review authorised,
 * under the single-use grant that the confirm minted and consumed. Items are
 * separate orders with their own money and state: a partial outcome is
 * `partly_booked` and is NEVER coerced to `confirmed` (rule #25, the askExecution
 * machine). The grant is already spent by the time booking runs, so a partial
 * failure cannot be silently retried into a second charge.
 *
 * Each item is booked at exactly the price, currency and travellers the user
 * reviewed (the travel port refuses anything else before checkout). When an
 * item is refused, the item records WHY — the port's reason (`limited_mode`,
 * `scope_missing`, `repriced`, `sold_out`, `offer_expired`, …) as its
 * `reasonCode` and the port's own explanation as its detail — never a blanket
 * "the supplier could not be reached". A refusal the port throws happened
 * before any money could move; an outcome the port could not settle comes
 * back as the item's `unknown_reconciling` state, and an error of any other
 * kind is recorded as unknown too, never as "nothing was charged".
 */
import {
  assertTransition,
  ContractError,
  money,
  type Money,
} from "@ubi/contracts";

import { actorKindFor, auditedTransaction, type OutboxInput } from "./audit";
import { auditModelIdentity } from "./model-identity";
import { marketplaceExecutionView, type MpExecutionView } from "./mp-lifecycle";
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
const RECONCILABLE_ITEM_STATES = new Set([
  "unknown_reconciling",
  "supplier_pending",
]);
export const MAX_TRAVEL_RECONCILE_ATTEMPTS = 3;

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
  /** Why the item is not (yet) booked, when it is not. */
  readonly reasonCode?: string | null;
  /** How many background/explicit reconcile sweeps have checked this item. */
  readonly reconcileAttempts?: number;
}

/**
 * An item the travel port refused, recorded with the refusal's own reason.
 * The port throws only refusals made before any money could move, as a
 * ContractError whose `details.reason` names the cause and whose message
 * says so; anything else is not proof that nothing happened, so it is
 * recorded as unknown rather than as released.
 */
function refusedItem(
  item: {
    readonly kind: string;
    readonly title: string;
    readonly currency: string;
  },
  error: unknown,
): ExecutionItemState {
  if (error instanceof ContractError) {
    const reason = error.details?.reason;
    return {
      kind: item.kind,
      title: item.title,
      state: "failed_released",
      orderId: null,
      supplierRef: null,
      chargedMinor: null,
      releasedMinor: null,
      currency: item.currency,
      detail: error.message,
      reasonCode: typeof reason === "string" ? reason : error.code,
    };
  }
  return {
    kind: item.kind,
    title: item.title,
    state: "unknown_reconciling",
    orderId: null,
    supplierRef: null,
    chargedMinor: null,
    releasedMinor: null,
    currency: item.currency,
    detail:
      "We could not confirm what happened to this booking. Do not book it again — check your trips before trying anything else.",
    reasonCode: "outcome_unknown",
  };
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
  for (const [index, item] of stored.items.entries()) {
    if (item.kind !== "flight" && item.kind !== "stay") {
      results.push(
        refusedItem(
          item,
          new ContractError(
            "validation_failed",
            "This item is not travel the assistant can book. Nothing was booked or charged.",
            { reason: "unsupported_item" },
          ),
        ),
      );
      continue;
    }
    try {
      const booked = await deps.travel.book(input.actor, {
        grantId: input.grantId,
        offerRef: item.offerRef,
        idempotencyKey: `${input.executionId}:${index}:${item.offerRef}`,
        paymentMethodId: review.paymentMethodId,
        kind: item.kind,
        priceMinor: item.priceMinor,
        currency: item.currency,
        ...(item.payAtPropertyMinor !== undefined
          ? { payAtPropertyMinor: item.payAtPropertyMinor }
          : {}),
        travellers: stored.travellers,
        purchase: item.purchase ?? null,
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
        reasonCode: booked.reasonCode ?? null,
      });
    } catch (error) {
      results.push(refusedItem(item, error));
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
          ...auditModelIdentity(deps.model),
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

export interface ReconcileTravelExecutionInput {
  readonly executionId: string;
  readonly actor: Actor;
  readonly cityId: string;
  readonly correlationId: string | null;
}

/**
 * Reconciles uncertain travel execution items (`unknown_reconciling` or
 * `supplier_pending`), including items whose checkout answer was lost before
 * `orderId` was returned (`orderId: null`). Looks up the cart and order by
 * their deterministic derived keys on travel-service's service-key surface,
 * with a bounded retry count per item (`MAX_TRAVEL_RECONCILE_ATTEMPTS`), and
 * never books again.
 */
export async function reconcileTravelExecution(
  deps: AskDeps,
  input: ReconcileTravelExecutionInput,
): Promise<boolean> {
  const exec = await deps.db.askExecution.findUnique({
    where: { id: input.executionId },
    include: { review: true },
  });
  if (
    exec === null ||
    exec.review.userId !== input.actor.id ||
    exec.review.grantId === null
  ) {
    return false;
  }
  const grantId = exec.review.grantId;
  const rawItems = Array.isArray(exec.items)
    ? (exec.items as unknown as ExecutionItemState[])
    : [];
  const hasReconcilable = rawItems.some(
    (item) =>
      (item.kind === "flight" || item.kind === "stay") &&
      RECONCILABLE_ITEM_STATES.has(item.state) &&
      (item.reconcileAttempts ?? 0) < MAX_TRAVEL_RECONCILE_ATTEMPTS,
  );
  if (!hasReconcilable) {
    return false;
  }

  const stored = parseStoredReview(exec.review.items);
  const nextItems: ExecutionItemState[] = [];
  let changed = false;

  for (const [index, item] of rawItems.entries()) {
    const attempts = item.reconcileAttempts ?? 0;
    const reviewItem = stored.items[index];
    if (
      (item.kind !== "flight" && item.kind !== "stay") ||
      !RECONCILABLE_ITEM_STATES.has(item.state) ||
      attempts >= MAX_TRAVEL_RECONCILE_ATTEMPTS ||
      reviewItem === undefined
    ) {
      nextItems.push(item);
      continue;
    }

    const idempotencyKey = `${exec.id}:${index}:${reviewItem.offerRef}`;
    let resolved: {
      readonly orderId: string | null;
      readonly state: string;
      readonly supplierRef: string | null;
      readonly chargedMinor: number | null;
      readonly releasedMinor: number | null;
    } | null = null;

    if (deps.travel.reconcileExecutionItem !== undefined) {
      resolved = await deps.travel.reconcileExecutionItem({
        grantId,
        actorId: exec.review.userId,
        idempotencyKey,
        orderId: item.orderId,
      });
    } else if (item.orderId !== null) {
      const status = await deps.travel.executionOrderStatus({
        orderId: item.orderId,
        grantId,
        actorId: exec.review.userId,
      });
      if (status !== null) {
        resolved = {
          orderId: status.orderId,
          state: status.state,
          supplierRef: status.supplierRef,
          chargedMinor: CONFIRMED_STATES.has(status.state)
            ? reviewItem.priceMinor
            : null,
          releasedMinor: null,
        };
      }
    }

    const nextAttempts = attempts + 1;
    changed = true;

    if (resolved === null) {
      nextItems.push({
        ...item,
        reconcileAttempts: nextAttempts,
      });
      continue;
    }

    if (CONFIRMED_STATES.has(resolved.state)) {
      nextItems.push({
        ...item,
        state: resolved.state,
        orderId: resolved.orderId ?? item.orderId,
        supplierRef: resolved.supplierRef ?? item.supplierRef,
        chargedMinor: resolved.chargedMinor ?? reviewItem.priceMinor,
        releasedMinor: null,
        detail: null,
        reasonCode: "reconciled",
        reconcileAttempts: nextAttempts,
      });
      continue;
    }

    if (FAILED_STATES.has(resolved.state)) {
      const noOrderPlaced = resolved.orderId === null && item.orderId === null;
      nextItems.push({
        ...item,
        state: "failed_released",
        orderId: resolved.orderId ?? item.orderId,
        supplierRef: resolved.supplierRef ?? item.supplierRef,
        chargedMinor: null,
        releasedMinor: resolved.releasedMinor,
        detail: noOrderPlaced
          ? "This booking did not reach checkout before timing out. Nothing was booked or charged."
          : "The supplier did not take this booking. The hold was released and nothing was charged.",
        reasonCode: noOrderPlaced
          ? "reconciled_not_booked"
          : "supplier_declined",
        reconcileAttempts: nextAttempts,
      });
      continue;
    }

    nextItems.push({
      ...item,
      state: resolved.state,
      orderId: resolved.orderId ?? item.orderId,
      supplierRef: resolved.supplierRef ?? item.supplierRef,
      reconcileAttempts: nextAttempts,
    });
  }

  if (!changed) {
    return false;
  }

  const nextOverall = deriveOverall(nextItems);
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);

  await auditedTransaction(deps.db, async (tx) => {
    const current = await tx.askExecution.findUnique({
      where: { id: exec.id },
    });
    if (current === null) {
      return { result: null };
    }
    if (current.status === "processing") {
      assertTransition("askExecution", current.status, nextOverall);
    }
    await tx.askExecution.update({
      where: { id: exec.id },
      data: {
        status: nextOverall,
        items: asJson(nextItems),
        completedAt: current.completedAt ?? now,
      },
    });
    const events: OutboxInput[] = nextItems.map((item, index) => ({
      name: "ask.execution.item.updated",
      aggregateType: "askExecution",
      aggregateId: exec.id,
      fromVersion: index,
      toVersion: index + 1,
      actor: input.actor,
      actorType,
      cityId: input.cityId,
      idempotencyKey: outboxKey(),
      correlationId: input.correlationId,
      occurredAt: now,
      payload: {
        executionId: exec.id,
        kind: item.kind,
        state: item.state,
        orderId: item.orderId,
        supplierRef: item.supplierRef,
      },
    }));
    if (current.status !== nextOverall) {
      events.push({
        name: "ask.execution.completed",
        aggregateType: "askExecution",
        aggregateId: exec.id,
        fromVersion: nextItems.length,
        toVersion: nextItems.length + 1,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { executionId: exec.id, overall: nextOverall },
      });
    }
    return { result: null, events };
  });

  return true;
}

/**
 * Background sweep over travel executions with `unknown_reconciling` or
 * `supplier_pending` items that have not exhausted `MAX_TRAVEL_RECONCILE_ATTEMPTS`.
 */
export async function sweepUnknownTravelExecutions(
  deps: AskDeps,
  options: { readonly cityId?: string; readonly limit?: number } = {},
): Promise<number> {
  const candidates = await deps.db.askExecution.findMany({
    where: {
      status: { in: ["processing", "partly_booked"] },
    },
    include: { review: true },
    orderBy: { startedAt: "asc" },
    take: options.limit ?? 50,
  });
  let reconciledCount = 0;
  for (const exec of candidates) {
    const didReconcile = await reconcileTravelExecution(deps, {
      executionId: exec.id,
      actor: { id: exec.review.userId, role: "rider" },
      cityId: options.cityId ?? "lagos",
      correlationId: null,
    });
    if (didReconcile) {
      reconciledCount += 1;
    }
  }
  return reconciledCount;
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
    /** Marketplace: the awarded fare, exactly as the marketplace reports it. */
    readonly fare?: Money;
    /** Marketplace: the DRIVER's commission on the award, shown separately. */
    readonly commission?: Money;
    readonly reasonCode?: string;
    readonly detail?: string;
  }[];
  /** A marketplace execution's stage, persisted intent and reconcilability. */
  readonly marketplace?: MpExecutionView;
}

interface StoredItemExtras {
  readonly fareMinor?: number | null;
  readonly commissionMinor?: number | null;
  readonly reasonCode?: string | null;
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
    ? (exec.items as unknown as (ExecutionItemState & StoredItemExtras)[])
    : [];
  const marketplace = await marketplaceExecutionView(deps, exec);
  return {
    id: exec.id,
    status: exec.status,
    startedAt: exec.startedAt.toISOString(),
    ...(marketplace === undefined ? {} : { marketplace }),
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
      fare:
        item.fareMinor === null || item.fareMinor === undefined
          ? undefined
          : money(item.fareMinor, item.currency),
      commission:
        item.commissionMinor === null || item.commissionMinor === undefined
          ? undefined
          : money(item.commissionMinor, item.currency),
      reasonCode: item.reasonCode ?? undefined,
      detail: item.detail ?? undefined,
    })),
  };
}
