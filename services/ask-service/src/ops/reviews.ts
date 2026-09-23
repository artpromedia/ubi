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
import { runExecution } from "./executions";
import { assertFlagEnabled } from "./flags";
import { consumeGrant } from "./grants";
import { auditModelIdentity } from "./model-identity";
import { confirmMarketplaceReview } from "./mp-lifecycle";
import { isMarketplaceReview } from "./mp-review";
import { ReviewExpiredError, TermsChangedError } from "./review-errors";
import {
  fingerprintResolved,
  parseStoredReview,
  resolvedToStoredItem,
  reviewView,
  type ReviewView,
  type StoredReviewItem,
} from "./review-model";
import {
  moveReviewToExecuting,
  supersedeIfAwaiting,
} from "./review-transitions";
import { deterministicId, generateId } from "../lib/ids";
import { grantTermsVersion } from "../ports/grant-port";

import type { AskDeps } from "./context";
import type { Actor, JsonRecord } from "./types";
import type { ResolvedOffer } from "../ports/travel-port";
import type { Prisma } from "@prisma/client/index";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
function outboxKey(): string {
  return generateId("oik");
}

export { ReviewExpiredError, TermsChangedError };

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
    (row.status === "awaiting_confirmation" &&
      row.expiresAt.getTime() <= now.getTime())
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
  /**
   * For a marketplace review: the persisted scope fingerprint / request
   * revision / bid the client rendered. A mismatch is a terms change.
   */
  readonly expect?: {
    readonly scopeFingerprint?: string;
    readonly requestRevision?: number;
    readonly bidId?: string;
  };
  readonly assurance: { readonly method: string; readonly proof: string };
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
  /**
   * Whether the gateway granted this session the marketplace scope
   * (middleware/auth.ts `marketplaceAllowed`). A marketplace review's confirm
   * selects in the marketplace, so it needs the same scope `/v1/mp` does.
   */
  readonly marketplaceAllowed?: boolean;
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
    let superseded = false;
    if (staleReview.status === "awaiting_confirmation") {
      assertTransition("askReview", staleReview.status, "superseded");
      // Conditional: a review a concurrent confirm already moved to executing
      // keeps that status (the in-memory status above may be stale), and no
      // superseded event is claimed for it.
      superseded = await supersedeIfAwaiting(tx, staleReview.id);
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
      ...(superseded
        ? [
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
          ]
        : []),
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
  // The key is the caller's for ONE confirmation: reused for another review it
  // is refused, never answered with the other review's execution.
  const existing = await deps.db.askExecution.findUnique({
    where: { id: executionId },
  });
  if (existing !== null) {
    if (existing.reviewId !== input.reviewId) {
      throw new ContractError(
        "idempotency_key_reuse",
        "this idempotency key was already used for a different confirmation",
      );
    }
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

  // `ai_transactions` gates minting a grant and starting an execution: the kill
  // switch stops a confirm even for a review created while it was on.
  assertFlagEnabled(await deps.flags.flagsFor(input.cityId), "ai_transactions");

  if (isMarketplaceReview(review.items)) {
    if (input.marketplaceAllowed === false) {
      throw new ContractError(
        "forbidden",
        "the marketplace is not available in this session",
        { reason: "marketplace_scope_missing" },
      );
    }
    // A structured marketplace review runs its own stage (publish / select)
    // under a grant minted from its persisted scope (./mp-lifecycle.ts).
    return confirmMarketplaceReview(deps, {
      actor: input.actor,
      cityId: input.cityId,
      review,
      termsVersion: input.termsVersion,
      expect: input.expect,
      assurance: input.assurance,
      idempotencyKey: input.idempotencyKey,
      executionId,
      correlationId: input.correlationId,
    });
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
  // The grant carries a digest of the review's terms: the review fingerprint
  // can outgrow user-service's 60-character terms column (several offers).
  const grantTerms = grantTermsVersion("ask.review.v1", review.termsVersion);
  const grant = await deps.grants.mint({
    actorId: input.actor.id,
    action: "ask.execute",
    resourceRef: review.id,
    termsVersion: grantTerms,
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
    // Conditional on the status just read: a concurrent confirm (another key)
    // that committed first leaves nothing to move, and this one is refused —
    // the read above alone cannot stop two transactions both passing it.
    await moveReviewToExecuting(tx, review.id, grant.grantId);
    // Single-use enforcement: consume the grant now, bound to these terms.
    await consumeGrant(tx, grant.grantId, now, {
      totalMinor: Number(review.totalMinor),
      currency: review.currency,
      termsVersion: grantTerms,
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
          ...auditModelIdentity(deps.model),
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
