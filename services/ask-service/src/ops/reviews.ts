/**
 * Reviews — the exact terms a user confirms before anything is booked.
 *
 * `getReview` is read-only and owner-scoped. `confirmReview` is the one place a
 * grant comes into existence and an execution begins, and it enforces rule #18
 * end to end:
 *
 *   - an expired review is refused (410) and never confirmed;
 *   - a material change — a client-supplied terms version that no longer matches,
 *     or an offer that re-priced when re-resolved — supersedes the review and
 *     returns a FRESH review to confirm (409), so a stale price is never charged;
 *   - only then is a single-use grant minted (by user-service, via GrantPort),
 *     the review moved to `executing`, the grant consumed atomically, and an
 *     execution started — all in one transaction with the ai_actions and outbox
 *     rows.
 *
 * The confirm is idempotent on its Idempotency-Key: a replay lands on the same
 * deterministic execution id and returns it without minting a second grant or
 * starting a second execution (CLAUDE.md #3).
 */
import {
  assertTransition,
  ContractError,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { actorKindFor, auditedTransaction, type OutboxInput } from "./audit";
import { consumeGrant } from "./grants";
import { runExecution } from "./executions";
import {
  fingerprintResolved,
  parseStoredReview,
  resolvedToStoredItem,
  reviewView,
  type ReviewView,
  type StoredReviewItem,
} from "./review-model";
import { deterministicId, generateId } from "../lib/ids";

import type { ResolvedOffer } from "../ports/travel-port";
import type { AskDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { Prisma } from "@prisma/client/index";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
function outboxKey(): string {
  return generateId("oik");
}

/** Review has expired — the endpoint answers 410 (contracts/openapi/ask.yaml). */
export class ReviewExpiredError extends ContractError {
  constructor() {
    super("quote_expired", "this review has expired");
    this.name = "ReviewExpiredError";
  }
}

/** Terms changed — the endpoint answers 409 with the fresh review to confirm. */
export class TermsChangedError extends Error {
  readonly code = "terms_changed";
  constructor(readonly review: ReviewView) {
    super("the terms changed; a new review is required");
    this.name = "TermsChangedError";
  }
}

export async function getReview(
  deps: AskDeps,
  actor: Actor,
  reviewId: string,
): Promise<ReviewView> {
  const row = await deps.db.askReview.findUnique({ where: { id: reviewId } });
  if (row === null || row.userId !== actor.id) {
    throw new ContractError("not_found", "no such review");
  }
  const now = deps.now();
  if (
    row.status === "expired" ||
    (row.status === "awaiting_confirmation" && row.expiresAt.getTime() <= now.getTime())
  ) {
    throw new ReviewExpiredError();
  }
  return reviewView(row);
}

export interface ConfirmInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly reviewId: string;
  readonly termsVersion: string;
  readonly assurance: { readonly method: string; readonly proof: string };
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface ConfirmResult {
  readonly executionId: string;
}

/**
 * Re-resolves the offers behind a review and creates a fresh review row with the
 * current, server-computed totals. Supersedes the stale review in the same
 * transaction so the two are never both confirmable.
 */
async function supersedeAndReprice(
  deps: AskDeps,
  actor: Actor,
  cityId: string,
  staleReview: {
    id: string;
    threadId: string;
    paymentMethodId: string;
    status: string;
    items: unknown;
  },
  correlationId: string | null,
): Promise<ReviewView> {
  const stored = parseStoredReview(staleReview.items);
  const resolved: ResolvedOffer[] = [];
  for (const item of stored.items) {
    const offer = await deps.travel.resolveOffer(actor, item.offerRef);
    if (offer !== null) {
      resolved.push(offer);
    }
  }
  const items: StoredReviewItem[] = resolved.map(resolvedToStoredItem);
  const currency = items[0]?.currency ?? staleReviewCurrency(stored.items);
  const totalMinor = items.reduce((sum, item) => sum + item.priceMinor, 0);
  const termsVersion = fingerprintResolved(resolved);
  const now = deps.now();
  const freshId = generateId("rvw");
  const expiresAt = new Date(
    now.getTime() + deps.limits.reviewTtlSeconds * 1000,
  );
  const actorType = actorKindFor(actor.role);

  return auditedTransaction(deps.db, async (tx) => {
    if (staleReview.status === "awaiting_confirmation") {
      assertTransition("askReview", staleReview.status, "superseded");
      await tx.askReview.update({
        where: { id: staleReview.id },
        data: { status: "superseded" },
      });
    }
    await tx.askReview.create({
      data: {
        id: freshId,
        threadId: staleReview.threadId,
        userId: actor.id,
        termsVersion,
        items: asJson({
          items,
          notes: [
            "These are separate orders with their own money, status and policy.",
          ],
          assuranceRequired: stored.assuranceRequired,
        }),
        totalMinor: BigInt(totalMinor),
        currency,
        paymentMethodId: staleReview.paymentMethodId,
        status: "awaiting_confirmation",
        expiresAt,
        createdAt: now,
      },
    });
    const events: OutboxInput[] = [
      {
        name: "ask.review.superseded",
        aggregateType: "askReview",
        aggregateId: staleReview.id,
        fromVersion: 1,
        toVersion: 2,
        actor,
        actorType,
        cityId,
        idempotencyKey: outboxKey(),
        correlationId,
        occurredAt: now,
        payload: { reviewId: staleReview.id, replacedBy: freshId },
      },
      {
        name: "ask.review.created",
        aggregateType: "askReview",
        aggregateId: freshId,
        fromVersion: null,
        toVersion: 1,
        actor,
        actorType,
        cityId,
        idempotencyKey: outboxKey(),
        correlationId,
        occurredAt: now,
        payload: { reviewId: freshId, termsVersion, totalMinor, currency },
      },
    ];
    const created = await tx.askReview.findUniqueOrThrow({
      where: { id: freshId },
    });
    return { result: reviewView(created), events };
  });
}

function staleReviewCurrency(items: readonly StoredReviewItem[]): string {
  return items[0]?.currency ?? "NGN";
}

export async function confirmReview(
  deps: AskDeps,
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const scoped = scopedIdempotencyKey(
    "ask.review.confirm",
    input.actor.id,
    input.idempotencyKey,
  );
  const executionId = deterministicId("exec", scoped);

  // Replay: the deterministic id already exists → return it, mint nothing new.
  const existing = await deps.db.askExecution.findUnique({
    where: { id: executionId },
  });
  if (existing !== null) {
    return { executionId };
  }

  const review = await deps.db.askReview.findUnique({
    where: { id: input.reviewId },
  });
  if (review === null || review.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such review");
  }
  const now = deps.now();

  const isExpired =
    review.status === "expired" ||
    (review.status === "awaiting_confirmation" &&
      review.expiresAt.getTime() <= now.getTime());
  if (isExpired) {
    if (review.status === "awaiting_confirmation") {
      await auditedTransaction(deps.db, async (tx) => {
        assertTransition("askReview", review.status, "expired");
        await tx.askReview.update({
          where: { id: review.id },
          data: { status: "expired" },
        });
        return {
          result: null,
          events: [
            {
              name: "ask.review.expired",
              aggregateType: "askReview",
              aggregateId: review.id,
              fromVersion: 1,
              toVersion: 2,
              actor: input.actor,
              actorType: actorKindFor(input.actor.role),
              cityId: input.cityId,
              idempotencyKey: outboxKey(),
              correlationId: input.correlationId,
              occurredAt: now,
              payload: { reviewId: review.id },
            },
          ],
        };
      });
    }
    throw new ReviewExpiredError();
  }

  if (review.status !== "awaiting_confirmation") {
    throw new ContractError(
      "conflict",
      "this review is no longer awaiting confirmation",
      { status: review.status },
    );
  }

  // Terms check 1: the client is looking at a version we no longer hold.
  if (input.termsVersion !== review.termsVersion) {
    const fresh = await supersedeAndReprice(
      deps,
      input.actor,
      input.cityId,
      review,
      input.correlationId,
    );
    throw new TermsChangedError(fresh);
  }

  // Terms check 2: re-resolve the offers now; a material change re-prices.
  const stored = parseStoredReview(review.items);
  const resolved: ResolvedOffer[] = [];
  let missing = false;
  for (const item of stored.items) {
    const offer = await deps.travel.resolveOffer(input.actor, item.offerRef);
    if (offer === null) {
      missing = true;
      break;
    }
    resolved.push(offer);
  }
  if (missing || fingerprintResolved(resolved) !== review.termsVersion) {
    const fresh = await supersedeAndReprice(
      deps,
      input.actor,
      input.cityId,
      review,
      input.correlationId,
    );
    throw new TermsChangedError(fresh);
  }

  // Mint the single-use grant. user-service is the only minting authority; the
  // grant is bound to exactly these terms and this idempotency key.
  const expiresAt = new Date(
    now.getTime() + deps.limits.grantTtlSeconds * 1000,
  );
  const grant = await deps.grants.mint({
    actorId: input.actor.id,
    action: "ask.execute",
    resourceRef: review.id,
    termsVersion: review.termsVersion,
    totalMinor: Number(review.totalMinor),
    currency: review.currency,
    assurance: input.assurance.method === "biometric" ? "biometric" : "pin",
    assuranceProof: input.assurance.proof,
    idempotencyKey: scoped,
    expiresAt,
    cityId: input.cityId,
  });

  const actorType = actorKindFor(input.actor.role);
  const initialItems = stored.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    state: "submitted",
    orderId: null,
    supplierRef: null,
    chargedMinor: null,
    releasedMinor: null,
    currency: item.currency,
    detail: null,
  }));

  await auditedTransaction(deps.db, async (tx) => {
    const current = await tx.askReview.findUnique({
      where: { id: review.id },
    });
    if (current === null || current.status !== "awaiting_confirmation") {
      // A concurrent confirm won the race; refuse this one rather than double-run.
      throw new ContractError(
        "conflict",
        "this review is no longer awaiting confirmation",
      );
    }
    assertTransition("askReview", current.status, "executing");
    await tx.askReview.update({
      where: { id: review.id },
      data: { status: "executing", grantId: grant.grantId },
    });
    // Single-use enforcement: consume the grant now, bound to these terms.
    await consumeGrant(tx, grant.grantId, now, {
      totalMinor: Number(review.totalMinor),
      currency: review.currency,
      termsVersion: review.termsVersion,
    });
    await tx.askExecution.create({
      data: {
        id: executionId,
        reviewId: review.id,
        status: "processing",
        items: asJson(initialItems),
        startedAt: now,
      },
    });
    const events: OutboxInput[] = [
      {
        name: "ask.review.confirmed",
        aggregateType: "askReview",
        aggregateId: review.id,
        fromVersion: 1,
        toVersion: 2,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          reviewId: review.id,
          grantId: grant.grantId,
          termsVersion: review.termsVersion,
          totalMinor: Number(review.totalMinor),
          currency: review.currency,
        },
      },
      {
        name: "ask.execution.started",
        aggregateType: "askExecution",
        aggregateId: executionId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { executionId, reviewId: review.id },
      },
    ];
    return {
      result: null,
      events,
      aiActions: [
        {
          actorKind: actorType,
          actorRef: input.actor.id,
          threadId: review.threadId,
          action: "review.confirm",
          model: deps.model.model,
          modelRevision: deps.model.revision,
          authKind: "grant" as const,
          authRef: grant.grantId,
          outcome: "done" as const,
          redactedInputs: {
            reviewId: review.id,
            assurance:
              input.assurance.method === "biometric" ? "biometric" : "pin",
          } satisfies JsonRecord,
        },
      ],
    };
  });

  await runExecution(deps, {
    executionId,
    reviewId: review.id,
    actor: input.actor,
    cityId: input.cityId,
    grantId: grant.grantId,
    correlationId: input.correlationId,
  });

  return { executionId };
}
