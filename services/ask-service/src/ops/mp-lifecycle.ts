/**
 * The AI marketplace inside the existing Ask lifecycle (recheck A01 / P01).
 *
 * The marketplace ops (./marketplace.ts) are the bounded, grant-scoped actions;
 * this module is what CONNECTS them to the served Ask surfaces as distinct
 * stages, each with a server-owned record:
 *
 *   quote    READ. A live, non-binding fare envelope (`quoteForAsk`).
 *   prepare  PROPOSAL → CONFIRM → EXECUTE. `buildPublishProposal` persists a
 *            structured review (quote, the server's bounds, the fare offered);
 *            its confirm mints a grant whose scope permits ONLY `prepare` and
 *            publishes the request. Publishing asks drivers for offers — it
 *            never awards, and nothing it mints can select.
 *   review   READ. The owner's private offers (the `mp.review_offers` tool).
 *   select   PROPOSAL → CONFIRM → EXECUTE. `buildSelectionProposal` (the
 *            `mp.propose_selection` tool, or the client choosing an offer)
 *            persists the exact request id + revision, bid id + version, the
 *            price and the driver commission shown separately; its confirm
 *            re-validates all of it live, mints a grant capped at EXACTLY the
 *            approved price with scope `select` only, and runs `selectOffer`,
 *            which persists the execution intent before the award and
 *            reconciles an ambiguous outcome under the same idempotency key.
 *   cancel   CONFIRM → EXECUTE. Only a request the assistant published, with
 *            its own assurance-bound, cancel-only grant (`cancelMarketplaceRequest`).
 *
 * Each execution is an `ask_executions` row with per-order status; a pending
 * selection is reconciled by `reconcileMarketplaceExecution` (query first,
 * re-send the SAME selection only after its in-flight lease) — never a second
 * grant, award, funding or commission. A proposal that can no longer be made
 * (offer withdrawn, request closed, marketplace unavailable) hands the user a
 * `conventionalFlow` link instead of a dead end.
 *
 * Unattended (mandate) selection stays an ops capability (./marketplace.ts,
 * round-2 enforcement); every path here is ATTENDED: the user's explicit
 * confirm with an assurance is what mints each grant.
 */
import {
  assertTransition,
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { actorKindFor, auditedTransaction, type OutboxInput } from "./audit";
import { assertFlagEnabled } from "./flags";
import {
  authorizeNegotiation,
  cancelRequest,
  fingerprintScope,
  prepareRequest,
  quoteMarketplace,
  requestNotSelectable,
  reviewOffers,
  selectOffer,
  type MarketplaceGrantScope,
} from "./marketplace";
import { auditModelIdentity } from "./model-identity";
import { classifySelectFailure, failureReason } from "./mp-executions";
import {
  commissionTerms,
  isMarketplaceReview,
  MP_REQUEST_PAYMENT_METHOD,
  MP_REVIEW_KIND,
  mpReviewTermsVersion,
  parseStoredMpReview,
  storedFromProposal,
  type MarketplaceReviewProposal,
  type MpPublishItem,
  type MpSelectionItem,
  type StoredMpReview,
} from "./mp-review";
import { TermsChangedError } from "./review-errors";
import { reviewView, type ReviewView } from "./review-model";
import {
  moveReviewToExecuting,
  supersedeIfAwaiting,
} from "./review-transitions";
import { deterministicId, generateId } from "../lib/ids";
import {
  MarketplaceTimeoutError,
  type MpAward,
  type MpQuote,
  type MpQuoteInput,
} from "../ports/marketplace-port";

import type { AskDeps } from "./context";
import type { Actor, AskTx, JsonRecord } from "./types";
import type { Prisma } from "@prisma/client/index";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
function outboxKey(): string {
  return generateId("oik");
}

/** Where the conventional (non-assistant) flow for a request lives. */
export function requestFlowLink(requestId: string): string {
  return `ubi://marketplace/requests/${encodeURIComponent(requestId)}`;
}
export const COMPOSE_FLOW_LINK = "ubi://marketplace/compose";

async function assertTransactionalFlags(
  deps: AskDeps,
  cityId: string,
): Promise<void> {
  const flags = await deps.flags.flagsFor(cityId);
  // ai_transactions gates minting a grant and starting an execution;
  // ai_marketplace gates every marketplace action. Both deny by default.
  assertFlagEnabled(flags, "ai_transactions");
  assertFlagEnabled(flags, "ai_marketplace");
}

function narrowService(service: string): "ride" | "delivery" {
  if (service === "ride" || service === "delivery") {
    return service;
  }
  throw new ContractError(
    "service_unavailable",
    "the marketplace answered an unknown service",
    { reason: "unknown_service" },
  );
}

// ---------------------------------------------------------------------------
// Stage: quote (read)
// ---------------------------------------------------------------------------

export interface QuoteForAskInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly input: MpQuoteInput;
}

export interface QuoteView {
  readonly quoteId: string;
  readonly service: string;
  readonly vehicleClass: string;
  readonly cityId: string;
  readonly suggested: Money;
  readonly minimum: Money;
  readonly maximum: Money;
  readonly expiresAt: string;
}

export function quoteView(quote: MpQuote): QuoteView {
  return {
    quoteId: quote.quoteId,
    service: quote.service,
    vehicleClass: quote.vehicleClass,
    cityId: quote.cityId,
    suggested: money(quote.suggestedFareMinor, quote.currency),
    minimum: money(quote.minimumFareMinor, quote.currency),
    maximum: money(quote.maximumFareMinor, quote.currency),
    expiresAt: quote.expiresAt,
  };
}

/** A live, non-binding fare envelope for the session city. Commits nothing. */
export async function quoteForAsk(
  deps: AskDeps,
  input: QuoteForAskInput,
): Promise<QuoteView> {
  const quote = await quoteMarketplace(deps, input);
  if (quote.cityId !== input.cityId) {
    throw new ContractError("forbidden", "the quote is for another city", {
      reason: "city_mismatch",
    });
  }
  return quoteView(quote);
}

// ---------------------------------------------------------------------------
// Proposals — the structured review objects
// ---------------------------------------------------------------------------

export interface SelectionProposalInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly requestId: string;
  readonly bidId: string;
}

/**
 * Proposes selecting one offer, from the AUTHORITATIVE owner snapshot. Refuses
 * (typed, with the conventional flow to fall back to) anything that could not
 * be selected right now: not the caller's, another city, a request that cannot
 * award, a withdrawn / expired offer or one made on an earlier revision.
 */
export async function buildSelectionProposal(
  deps: AskDeps,
  input: SelectionProposalInput,
): Promise<MarketplaceReviewProposal> {
  const now = deps.now();
  const result = await reviewOffers(
    deps,
    input.actor,
    input.cityId,
    input.requestId,
  );
  const { request } = result;
  const conventionalFlow = requestFlowLink(request.requestId);
  if (request.cityId !== input.cityId) {
    throw new ContractError("forbidden", "the request is in another city", {
      reason: "city_mismatch",
      conventionalFlow,
    });
  }
  const closed = requestNotSelectable(
    { request, offers: [], award: result.award, seq: 0 },
    now,
  );
  if (closed !== null) {
    throw new ContractError(closed.code, closed.message, {
      ...closed.details,
      conventionalFlow,
    });
  }
  const offer = result.offers.find(
    (candidate) => candidate.bidId === input.bidId,
  );
  if (offer === undefined) {
    throw new ContractError("not_found", "no such offer on this request", {
      reason: "offer_not_found",
      conventionalFlow,
    });
  }
  if (offer.withdrawn) {
    throw new ContractError("conflict", "that offer has been withdrawn", {
      reason: "offer_withdrawn",
      conventionalFlow,
    });
  }
  if (Date.parse(offer.expiresAt) <= now.getTime()) {
    throw new ContractError("offer_expired", "that offer has expired", {
      reason: "offer_expired",
      conventionalFlow,
    });
  }
  if (offer.requestRevision !== request.revision) {
    throw new ContractError(
      "version_conflict",
      "that offer was made on an earlier version of the request",
      { reason: "offer_revision_stale", conventionalFlow },
    );
  }

  const scope: MarketplaceGrantScope = {
    principalId: input.actor.id,
    // Selecting only — the grant this proposal mints can do nothing else.
    actions: ["select"],
    service: narrowService(request.service),
    cityId: request.cityId,
    currency: request.currency,
    // The cap IS the approved price: nothing above it can ever be selected.
    maxSpendMinor: offer.totalMinor,
    vehicleClass: request.vehicleClass,
    quoteId: request.quoteId,
  };
  const scopeFingerprint = fingerprintScope(scope);
  const item: MpSelectionItem = {
    kind: "mp_selection",
    action: "mp.select",
    title: `Select the ${offer.vehicle} offer`,
    requestId: request.requestId,
    requestRevision: request.revision,
    requestVersion: request.version,
    quoteId: request.quoteId,
    bidId: offer.bidId,
    bidVersion: offer.bidVersion,
    priceMinor: offer.totalMinor,
    bidAmountMinor: offer.amountMinor,
    currency: offer.currency,
    offerExpiresAt: offer.expiresAt,
    vehicle: offer.vehicle,
    driverRating: offer.driverRating,
    driverProfileStatus: offer.driverProfileStatus,
    commission: commissionTerms(null),
  };
  return {
    kind: MP_REVIEW_KIND,
    stage: "select",
    scope,
    scopeFingerprint,
    item,
    totalMinor: item.priceMinor,
    currency: item.currency,
    paymentMethodId: MP_REQUEST_PAYMENT_METHOD,
    termsVersion: mpReviewTermsVersion("select", scopeFingerprint, item),
    assuranceRequired: "pin",
    notes: [
      "Selecting awards this driver the job. Your payment is authorised only when the award is made.",
      "If the offer changes before you confirm, nothing is selected and you review the new terms.",
    ],
    conventionalFlow,
  };
}

export interface PublishProposalInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly quote: MpQuoteInput;
  /** The fare to offer; null means the server's suggested fare. */
  readonly requestedFare: Money | null;
  readonly paymentMethodId: string;
}

/**
 * Proposes publishing a request at a fare INSIDE the server's bounds. The fare
 * is the user's number or the server's suggestion — never the model's.
 */
export async function buildPublishProposal(
  deps: AskDeps,
  input: PublishProposalInput,
): Promise<MarketplaceReviewProposal> {
  const quote = await quoteMarketplace(deps, {
    actor: input.actor,
    cityId: input.cityId,
    input: input.quote,
  });
  if (quote.cityId !== input.cityId) {
    throw new ContractError("forbidden", "the quote is for another city", {
      reason: "city_mismatch",
      conventionalFlow: COMPOSE_FLOW_LINK,
    });
  }
  if (
    input.requestedFare !== null &&
    input.requestedFare.currency !== quote.currency
  ) {
    throw new ContractError(
      "validation_failed",
      "the fare is not in the quote's currency",
      { reason: "currency_mismatch", currency: quote.currency },
    );
  }
  const fareMinor =
    input.requestedFare?.amountMinor ?? quote.suggestedFareMinor;
  if (
    fareMinor < quote.minimumFareMinor ||
    fareMinor > quote.maximumFareMinor
  ) {
    throw new ContractError(
      "fare_out_of_bounds",
      "the fare is outside the range the marketplace allows",
      {
        reason: "fare_out_of_bounds",
        minimumMinor: quote.minimumFareMinor,
        maximumMinor: quote.maximumFareMinor,
      },
    );
  }
  const service = narrowService(quote.service);
  const scope: MarketplaceGrantScope = {
    principalId: input.actor.id,
    // Publishing only — this grant can never select or award.
    actions: ["prepare"],
    service,
    cityId: quote.cityId,
    currency: quote.currency,
    maxSpendMinor: fareMinor,
    vehicleClass: quote.vehicleClass,
    quoteId: quote.quoteId,
  };
  const scopeFingerprint = fingerprintScope(scope);
  const item: MpPublishItem = {
    kind: "mp_publish",
    action: "mp.prepare",
    title: `Ask ${quote.vehicleClass} drivers for offers`,
    quoteId: quote.quoteId,
    service,
    vehicleClass: quote.vehicleClass,
    priceMinor: fareMinor,
    currency: quote.currency,
    bounds: {
      minimumMinor: quote.minimumFareMinor,
      suggestedMinor: quote.suggestedFareMinor,
      maximumMinor: quote.maximumFareMinor,
    },
    quoteExpiresAt: quote.expiresAt,
    paymentMethodId: input.paymentMethodId,
    weightKg: input.quote.weightKg ?? null,
  };
  return {
    kind: MP_REVIEW_KIND,
    stage: "publish",
    scope,
    scopeFingerprint,
    item,
    totalMinor: fareMinor,
    currency: quote.currency,
    paymentMethodId: input.paymentMethodId,
    termsVersion: mpReviewTermsVersion("publish", scopeFingerprint, item),
    assuranceRequired: "pin",
    notes: [
      "Publishing asks nearby drivers for offers. No driver is booked and nothing is charged until you approve an offer.",
    ],
    conventionalFlow: COMPOSE_FLOW_LINK,
  };
}

// ---------------------------------------------------------------------------
// Persisting a proposal as a review
// ---------------------------------------------------------------------------

function proposalExpiry(
  proposal: MarketplaceReviewProposal,
  now: Date,
  ttlSeconds: number,
): Date {
  const ttl = now.getTime() + ttlSeconds * 1000;
  const item = proposal.item;
  const liveUntil = Date.parse(
    item.kind === "mp_selection" ? item.offerExpiresAt : item.quoteExpiresAt,
  );
  // A review never outlives what it reviews: the offer / quote expiry.
  return new Date(Number.isFinite(liveUntil) ? Math.min(ttl, liveUntil) : ttl);
}

/**
 * Writes a marketplace review row in the caller's transaction. Shared by the
 * message turn (a tool proposal) and the client-initiated review route.
 */
export async function insertMarketplaceReview(
  tx: AskTx,
  input: {
    readonly id: string;
    readonly threadId: string;
    readonly userId: string;
    readonly proposal: MarketplaceReviewProposal;
    readonly now: Date;
    readonly ttlSeconds: number;
  },
): Promise<void> {
  await tx.askReview.create({
    data: {
      id: input.id,
      threadId: input.threadId,
      userId: input.userId,
      termsVersion: input.proposal.termsVersion,
      items: asJson(storedFromProposal(input.proposal)),
      totalMinor: BigInt(input.proposal.totalMinor),
      currency: input.proposal.currency,
      paymentMethodId: input.proposal.paymentMethodId,
      status: "awaiting_confirmation",
      expiresAt: proposalExpiry(input.proposal, input.now, input.ttlSeconds),
      createdAt: input.now,
    },
  });
}

function reviewCreatedEvent(
  actor: Actor,
  cityId: string,
  reviewId: string,
  proposal: MarketplaceReviewProposal,
  now: Date,
  correlationId: string | null,
): OutboxInput {
  return {
    name: "ask.review.created",
    aggregateType: "askReview",
    aggregateId: reviewId,
    fromVersion: null,
    toVersion: 1,
    actor,
    actorType: actorKindFor(actor.role),
    cityId,
    idempotencyKey: outboxKey(),
    correlationId,
    occurredAt: now,
    payload: {
      reviewId,
      kind: MP_REVIEW_KIND,
      stage: proposal.stage,
      termsVersion: proposal.termsVersion,
      totalMinor: proposal.totalMinor,
      currency: proposal.currency,
      items: 1,
    },
  };
}

function proposalRefs(proposal: MarketplaceReviewProposal): JsonRecord {
  const item = proposal.item;
  return item.kind === "mp_selection"
    ? {
        stage: proposal.stage,
        requestId: item.requestId,
        requestRevision: item.requestRevision,
        bidId: item.bidId,
        priceMinor: item.priceMinor,
        currency: item.currency,
      }
    : {
        stage: proposal.stage,
        quoteId: item.quoteId,
        priceMinor: item.priceMinor,
        currency: item.currency,
      };
}

export type MarketplaceReviewRequest =
  | {
      readonly stage: "select";
      readonly requestId: string;
      readonly bidId: string;
    }
  | {
      readonly stage: "publish";
      readonly quote: MpQuoteInput;
      readonly requestedFare: Money | null;
      readonly paymentMethodId: string;
    };

export interface CreateMarketplaceReviewInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly threadId: string;
  readonly request: MarketplaceReviewRequest;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

/**
 * The client-initiated proposal (the user picked an offer, or composed a
 * request, in the Ask surface). Idempotent on its key: a replay returns the
 * review the first attempt created.
 */
export async function createMarketplaceReview(
  deps: AskDeps,
  input: CreateMarketplaceReviewInput,
): Promise<ReviewView> {
  await assertTransactionalFlags(deps, input.cityId);
  const reviewId = deterministicId(
    "rvw",
    scopedIdempotencyKey("ask.mp.review", input.actor.id, input.idempotencyKey),
  );
  const replay = await deps.db.askReview.findUnique({
    where: { id: reviewId },
  });
  if (replay !== null) {
    if (replay.userId !== input.actor.id) {
      throw new ContractError("not_found", "no such review");
    }
    return reviewView(replay);
  }

  const thread = await deps.db.askThread.findUnique({
    where: { id: input.threadId },
  });
  if (thread === null || thread.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such thread");
  }
  if (thread.closedAt !== null) {
    throw new ContractError("conflict", "this thread is closed");
  }

  const proposal =
    input.request.stage === "select"
      ? await buildSelectionProposal(deps, {
          actor: input.actor,
          cityId: input.cityId,
          requestId: input.request.requestId,
          bidId: input.request.bidId,
        })
      : await buildPublishProposal(deps, {
          actor: input.actor,
          cityId: input.cityId,
          quote: input.request.quote,
          requestedFare: input.request.requestedFare,
          paymentMethodId: input.request.paymentMethodId,
        });

  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  return auditedTransaction(deps.db, async (tx) => {
    await insertMarketplaceReview(tx, {
      id: reviewId,
      threadId: input.threadId,
      userId: input.actor.id,
      proposal,
      now,
      ttlSeconds: deps.limits.reviewTtlSeconds,
    });
    const row = await tx.askReview.findUniqueOrThrow({
      where: { id: reviewId },
    });
    return {
      result: reviewView(row),
      events: [
        reviewCreatedEvent(
          input.actor,
          input.cityId,
          reviewId,
          proposal,
          now,
          input.correlationId,
        ),
      ],
      aiActions: [
        {
          actorKind: actorType,
          actorRef: input.actor.id,
          threadId: input.threadId,
          action: "mp.review.proposed",
          ...auditModelIdentity(deps.model),
          authKind: "none" as const,
          outcome: "done" as const,
          providerRefs: [reviewId],
          redactedInputs: { reviewId, ...proposalRefs(proposal) },
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Execution items (per-order status)
// ---------------------------------------------------------------------------

/** One marketplace order's status inside an `ask_executions` row. */
export interface MpExecutionItem {
  readonly kind: "mp_selection" | "mp_publish";
  readonly title: string;
  /**
   * published · cancelled · submitted · award_pending · driver_confirmed ·
   * award_failed · unknown_reconciling · failed — distinct words for distinct
   * facts ("request published" is never "driver confirmed").
   */
  readonly state: string;
  /** The marketplace request this order is. */
  readonly orderId: string | null;
  /** The award, once one exists. */
  readonly supplierRef: string | null;
  readonly chargedMinor: null;
  readonly releasedMinor: null;
  readonly currency: string;
  readonly detail: string | null;
  /** The awarded fare exactly as the marketplace reports it. */
  readonly fareMinor: number | null;
  /** The driver's commission on the award, as the marketplace reports it. */
  readonly commissionMinor: number | null;
  readonly reasonCode: string | null;
}

type Overall = "processing" | "confirmed" | "failed";

const AI_OUTCOME = {
  confirmed: "done",
  failed: "error",
  processing: "partial",
} as const satisfies Record<Overall, "done" | "error" | "partial">;

interface ItemOutcome {
  readonly item: MpExecutionItem;
  readonly overall: Overall;
}

function baseItem(
  stored: StoredMpReview,
  state: string,
  detail: string | null,
): MpExecutionItem {
  const [item] = stored.items;
  return {
    kind: item.kind,
    title: item.title,
    state,
    orderId: item.kind === "mp_selection" ? item.requestId : null,
    supplierRef: null,
    chargedMinor: null,
    releasedMinor: null,
    currency: item.currency,
    detail,
    fareMinor: null,
    commissionMinor: null,
    reasonCode: null,
  };
}

function outcomeFromAward(stored: StoredMpReview, award: MpAward): ItemOutcome {
  const base = baseItem(stored, "award_pending", null);
  const withAward = {
    ...base,
    supplierRef: award.awardId,
    fareMinor: award.fareMinor,
    commissionMinor: award.commissionMinor,
  };
  if (award.state === "confirmed") {
    return {
      item: {
        ...withAward,
        state: "driver_confirmed",
        detail:
          "Driver confirmed. The driver's commission is taken from their fare, not added to yours.",
      },
      overall: "confirmed",
    };
  }
  if (award.state === "pending") {
    return {
      item: {
        ...withAward,
        state: "award_pending",
        detail:
          "The offer was selected and the award is being settled. You will not be charged twice.",
      },
      overall: "processing",
    };
  }
  return {
    item: {
      ...withAward,
      state: "award_failed",
      reasonCode: `award_${award.state}`,
      detail:
        "The award did not complete; any hold on your payment is released.",
    },
    overall: "failed",
  };
}

/** Whether a failed selection may still resolve (reconcile, never re-charge). */
function selectionStillPending(error: unknown): boolean {
  if (error instanceof MarketplaceTimeoutError) {
    return true;
  }
  if (error instanceof ContractError) {
    const reason = error.details?.reason;
    if (reason === "selection_in_progress" || reason === "award_pending") {
      return true;
    }
  }
  return classifySelectFailure(error) === "ambiguous";
}

function outcomeFromSelectFailure(
  stored: StoredMpReview,
  error: unknown,
): ItemOutcome {
  const reasonCode = failureReason(error);
  if (selectionStillPending(error)) {
    return {
      item: {
        ...baseItem(
          stored,
          "unknown_reconciling",
          "We could not confirm the result yet. Check again — the same selection is reconciled, never repeated or charged twice.",
        ),
        reasonCode,
      },
      overall: "processing",
    };
  }
  return {
    item: {
      ...baseItem(
        stored,
        "failed",
        "This offer was not selected and nothing was charged. You can review the offers again.",
      ),
      reasonCode,
    },
    overall: "failed",
  };
}

// ---------------------------------------------------------------------------
// Confirm — the explicit approval step
// ---------------------------------------------------------------------------

export interface MarketplaceConfirmInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly review: {
    readonly id: string;
    readonly threadId: string;
    readonly userId: string;
    readonly status: string;
    readonly termsVersion: string;
    readonly items: unknown;
    readonly totalMinor: bigint;
    readonly currency: string;
    readonly expiresAt: Date;
  };
  readonly termsVersion: string;
  /** Optional echo of the persisted scope/revision the client rendered. */
  readonly expect?: {
    readonly scopeFingerprint?: string;
    readonly requestRevision?: number;
    readonly bidId?: string;
  };
  readonly assurance: { readonly method: string; readonly proof: string };
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly correlationId: string | null;
}

function expectMatches(
  stored: StoredMpReview,
  expect: MarketplaceConfirmInput["expect"],
): boolean {
  if (expect === undefined) {
    return true;
  }
  const [item] = stored.items;
  if (
    expect.scopeFingerprint !== undefined &&
    expect.scopeFingerprint !== stored.scopeFingerprint
  ) {
    return false;
  }
  if (item.kind === "mp_selection") {
    if (
      expect.requestRevision !== undefined &&
      expect.requestRevision !== item.requestRevision
    ) {
      return false;
    }
    if (expect.bidId !== undefined && expect.bidId !== item.bidId) {
      return false;
    }
  }
  return true;
}

/**
 * Supersedes a selection review with a fresh proposal of the same offer and
 * answers it (409 + the new review). When the offer can no longer be proposed
 * at all, the refusal carries the conventional flow instead.
 */
async function supersedeSelection(
  deps: AskDeps,
  input: MarketplaceConfirmInput,
  stored: StoredMpReview,
): Promise<never> {
  const [item] = stored.items;
  if (item.kind !== "mp_selection") {
    throw new ContractError(
      "conflict",
      "the terms changed; start the request again",
      { reason: "terms_changed", conventionalFlow: stored.conventionalFlow },
    );
  }
  const fresh = await buildSelectionProposal(deps, {
    actor: input.actor,
    cityId: input.cityId,
    requestId: item.requestId,
    bidId: item.bidId,
  });
  const freshId = generateId("rvw");
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  const view = await auditedTransaction(deps.db, async (tx) => {
    const current = await tx.askReview.findUnique({
      where: { id: input.review.id },
    });
    let superseded = false;
    if (current !== null && current.status === "awaiting_confirmation") {
      assertTransition("askReview", current.status, "superseded");
      // Conditional: a concurrent confirm that already moved it to executing
      // keeps its status (./review-transitions.ts), and no superseded event
      // is claimed for it.
      superseded = await supersedeIfAwaiting(tx, input.review.id);
    }
    await insertMarketplaceReview(tx, {
      id: freshId,
      threadId: input.review.threadId,
      userId: input.actor.id,
      proposal: fresh,
      now,
      ttlSeconds: deps.limits.reviewTtlSeconds,
    });
    const row = await tx.askReview.findUniqueOrThrow({
      where: { id: freshId },
    });
    const events: OutboxInput[] = [];
    if (superseded) {
      events.push({
        name: "ask.review.superseded",
        aggregateType: "askReview",
        aggregateId: input.review.id,
        fromVersion: 1,
        toVersion: 2,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { reviewId: input.review.id, replacedBy: freshId },
      });
    }
    events.push(
      reviewCreatedEvent(
        input.actor,
        input.cityId,
        freshId,
        fresh,
        now,
        input.correlationId,
      ),
    );
    return { result: reviewView(row), events };
  });
  throw new TermsChangedError(view);
}

/**
 * The confirm of a marketplace review: re-validates the persisted terms LIVE,
 * mints the grant the review's scope describes (user-service is the minting
 * authority; the assurance is the user's explicit approval), moves the review
 * to executing with an execution row, then runs the stage. Idempotent on the
 * confirm key through the deterministic execution id (checked by the caller).
 */
export async function confirmMarketplaceReview(
  deps: AskDeps,
  input: MarketplaceConfirmInput,
): Promise<{ readonly executionId: string }> {
  await assertTransactionalFlags(deps, input.cityId);
  const stored = parseStoredMpReview(input.review.items);
  const [item] = stored.items;
  if (stored.scope.principalId !== input.actor.id) {
    throw new ContractError("not_found", "no such review");
  }
  if (stored.scope.cityId !== input.cityId) {
    throw new ContractError("forbidden", "this review is for another city", {
      reason: "city_mismatch",
    });
  }

  // Terms check 1: the client confirms exactly the persisted terms.
  if (
    input.termsVersion !== input.review.termsVersion ||
    !expectMatches(stored, input.expect)
  ) {
    await supersedeSelection(deps, input, stored);
  }

  // Terms check 2: the live marketplace still offers exactly these terms.
  if (item.kind === "mp_selection") {
    let live: MarketplaceReviewProposal;
    try {
      live = await buildSelectionProposal(deps, {
        actor: input.actor,
        cityId: input.cityId,
        requestId: item.requestId,
        bidId: item.bidId,
      });
    } catch (error) {
      if (error instanceof ContractError && error.code === "feature_disabled") {
        throw error;
      }
      if (error instanceof ContractError) {
        // Withdrawn, expired, closed or unavailable: nothing was confirmed,
        // and the conventional offers screen is where the user goes next.
        throw new ContractError(error.code, error.message, {
          ...error.details,
          conventionalFlow: stored.conventionalFlow,
        });
      }
      throw error;
    }
    if (live.termsVersion !== input.review.termsVersion) {
      await supersedeSelection(deps, input, stored);
    }
  } else if (Date.parse(item.quoteExpiresAt) <= deps.now().getTime()) {
    throw new ContractError(
      "quote_expired",
      "the quote behind this request expired; get a new price",
      { reason: "quote_expired", conventionalFlow: stored.conventionalFlow },
    );
  }

  // Mint the grant the persisted scope describes — the explicit approval.
  const { grantId } = await authorizeNegotiation(deps, {
    actor: input.actor,
    cityId: input.cityId,
    scope: stored.scope,
    assurance: {
      method: input.assurance.method === "biometric" ? "biometric" : "pin",
      proof: input.assurance.proof,
    },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });

  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async (tx) => {
    const current = await tx.askReview.findUnique({
      where: { id: input.review.id },
    });
    if (current === null || current.status !== "awaiting_confirmation") {
      throw new ContractError(
        "conflict",
        "this review is no longer awaiting confirmation",
      );
    }
    assertTransition("askReview", current.status, "executing");
    // One approval, one execution: a concurrent confirm under another key that
    // committed first leaves nothing to move, and this one is refused before
    // it creates an execution or reaches the marketplace.
    await moveReviewToExecuting(tx, input.review.id, grantId);
    await tx.askExecution.create({
      data: {
        id: input.executionId,
        reviewId: input.review.id,
        status: "processing",
        items: asJson([baseItem(stored, "submitted", null)]),
        startedAt: now,
      },
    });
    const events: OutboxInput[] = [
      {
        name: "ask.review.confirmed",
        aggregateType: "askReview",
        aggregateId: input.review.id,
        fromVersion: 1,
        toVersion: 2,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          reviewId: input.review.id,
          grantId,
          kind: MP_REVIEW_KIND,
          stage: stored.stage,
          termsVersion: input.review.termsVersion,
          totalMinor: Number(input.review.totalMinor),
          currency: input.review.currency,
        },
      },
      {
        name: "ask.execution.started",
        aggregateType: "askExecution",
        aggregateId: input.executionId,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          executionId: input.executionId,
          reviewId: input.review.id,
          stage: stored.stage,
        },
      },
    ];
    return {
      result: null,
      events,
      aiActions: [
        {
          actorKind: actorType,
          actorRef: input.actor.id,
          threadId: input.review.threadId,
          action: "review.confirm",
          ...auditModelIdentity(deps.model),
          authKind: "grant" as const,
          authRef: grantId,
          outcome: "done" as const,
          redactedInputs: {
            reviewId: input.review.id,
            kind: MP_REVIEW_KIND,
            stage: stored.stage,
            assurance:
              input.assurance.method === "biometric" ? "biometric" : "pin",
          } satisfies JsonRecord,
        },
      ],
    };
  });

  await runStage(deps, {
    actor: input.actor,
    cityId: input.cityId,
    executionId: input.executionId,
    stored,
    grantId,
    correlationId: input.correlationId,
  });
  return { executionId: input.executionId };
}

interface StageInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly executionId: string;
  readonly stored: StoredMpReview;
  readonly grantId: string;
  readonly correlationId: string | null;
  /** The order's state before this run (reconcile), when there was one. */
  readonly previousState?: string;
}

/** The per-order outcome of a publish that did not come back published. */
function publishFailure(input: StageInput, error: unknown): ItemOutcome {
  // A reconcile that can no longer re-send the SAME publish (its grant
  // lapsed) cannot know whether the first attempt landed: say so, and send
  // the user to their requests, rather than claim it did not.
  if (
    error instanceof ContractError &&
    error.details?.reason === "expired" &&
    input.previousState === "unknown_reconciling"
  ) {
    return {
      item: {
        ...baseItem(
          input.stored,
          "failed",
          "We could not confirm whether the request was published. Open your requests to check — it is never published twice.",
        ),
        reasonCode: "publish_outcome_unknown",
      },
      overall: "failed",
    };
  }
  const pending =
    error instanceof ContractError &&
    error.code === "service_unavailable" &&
    error.details?.reason !== "delegation_refused" &&
    error.details?.reason !== "malformed_marketplace_response";
  if (pending) {
    return {
      item: {
        ...baseItem(
          input.stored,
          "unknown_reconciling",
          "We could not confirm the request was published. Check again — it is never published twice.",
        ),
        reasonCode: failureReason(error),
      },
      overall: "processing",
    };
  }
  return {
    item: {
      ...baseItem(
        input.stored,
        "failed",
        "The request was not published and nothing was charged.",
      ),
      reasonCode: failureReason(error),
    },
    overall: "failed",
  };
}

/** Runs (or re-runs, on reconcile) the stage a confirmed review authorised. */
async function runStage(deps: AskDeps, input: StageInput): Promise<void> {
  const [item] = input.stored.items;
  let outcome: ItemOutcome;
  if (item.kind === "mp_selection") {
    try {
      const result = await selectOffer(deps, {
        actor: input.actor,
        cityId: input.cityId,
        grantId: input.grantId,
        scope: input.stored.scope,
        requestId: item.requestId,
        bidId: item.bidId,
        expectedRequestRevision: item.requestRevision,
        expectedFareMinor: item.priceMinor,
        expectedBidVersion: item.bidVersion,
        correlationId: input.correlationId,
      });
      outcome = outcomeFromAward(input.stored, result.award);
    } catch (error) {
      outcome = outcomeFromSelectFailure(input.stored, error);
    }
  } else {
    try {
      const request = await prepareRequest(deps, {
        actor: input.actor,
        cityId: input.cityId,
        grantId: input.grantId,
        scope: input.stored.scope,
        requestedFareMinor: item.priceMinor,
        paymentMethodId: item.paymentMethodId,
        weightKg: item.weightKg ?? undefined,
        correlationId: input.correlationId,
      });
      outcome = {
        item: {
          ...baseItem(
            input.stored,
            "published",
            "Request published. Drivers can now send offers — no driver is booked until you approve one.",
          ),
          orderId: request.requestId,
        },
        overall: "confirmed",
      };
    } catch (error) {
      outcome = publishFailure(input, error);
    }
  }
  await recordOutcome(deps, input, outcome);
}

async function recordOutcome(
  deps: AskDeps,
  input: StageInput,
  outcome: ItemOutcome,
): Promise<void> {
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async (tx) => {
    const exec = await tx.askExecution.findUnique({
      where: { id: input.executionId },
    });
    if (exec === null || exec.status !== "processing") {
      // Already settled by a concurrent reconcile: the first writer wins.
      return { result: null };
    }
    const terminal = outcome.overall !== "processing";
    if (terminal) {
      assertTransition("askExecution", exec.status, outcome.overall);
    }
    await tx.askExecution.update({
      where: { id: input.executionId },
      data: {
        status: outcome.overall,
        items: asJson([outcome.item]),
        completedAt: terminal ? now : null,
      },
    });
    const events: OutboxInput[] = [
      {
        name: "ask.execution.item.updated",
        aggregateType: "askExecution",
        aggregateId: input.executionId,
        fromVersion: 1,
        toVersion: 2,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: {
          executionId: input.executionId,
          kind: outcome.item.kind,
          state: outcome.item.state,
          orderId: outcome.item.orderId,
          supplierRef: outcome.item.supplierRef,
        },
      },
    ];
    if (terminal) {
      events.push({
        name: "ask.execution.completed",
        aggregateType: "askExecution",
        aggregateId: input.executionId,
        fromVersion: 2,
        toVersion: 3,
        actor: input.actor,
        actorType,
        cityId: input.cityId,
        idempotencyKey: outboxKey(),
        correlationId: input.correlationId,
        occurredAt: now,
        payload: { executionId: input.executionId, overall: outcome.overall },
      });
    }
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
          outcome: AI_OUTCOME[outcome.overall],
          reasonCode: outcome.item.reasonCode ?? outcome.item.state,
          providerRefs: [outcome.item.orderId, outcome.item.supplierRef].filter(
            (ref): ref is string => ref !== null,
          ),
          redactedInputs: {
            executionId: input.executionId,
            stage: input.stored.stage,
            state: outcome.item.state,
          } satisfies JsonRecord,
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Reconcile — the execution-status follow-up for an ambiguous outcome
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly executionId: string;
  readonly correlationId: string | null;
  /** The gateway's marketplace scope for this session (re-driving selects). */
  readonly marketplaceAllowed?: boolean;
}

/**
 * Re-drives a processing marketplace execution through the SAME grant and the
 * SAME persisted intent: the award is queried first and the selection is only
 * re-sent under its original idempotency key once the in-flight lease has
 * lapsed (./marketplace.ts). A settled execution, or a travel one, is left as
 * it is. Returns nothing; the caller reads the execution view.
 */
export async function reconcileMarketplaceExecution(
  deps: AskDeps,
  input: ReconcileInput,
): Promise<void> {
  const exec = await deps.db.askExecution.findUnique({
    where: { id: input.executionId },
    include: { review: true },
  });
  if (exec === null || exec.review.userId !== input.actor.id) {
    throw new ContractError("not_found", "no such execution");
  }
  if (
    !isMarketplaceReview(exec.review.items) ||
    exec.status !== "processing" ||
    exec.review.grantId === null
  ) {
    return;
  }
  if (input.marketplaceAllowed === false) {
    throw new ContractError(
      "forbidden",
      "the marketplace is not available in this session",
      { reason: "marketplace_scope_missing" },
    );
  }
  await assertTransactionalFlags(deps, input.cityId);
  const stored = parseStoredMpReview(exec.review.items);
  if (stored.scope.cityId !== input.cityId) {
    // Refused before anything runs: a session in another city neither drives
    // nor settles this execution.
    throw new ContractError(
      "forbidden",
      "this execution belongs to another city",
      { reason: "city_mismatch" },
    );
  }
  const items = Array.isArray(exec.items)
    ? (exec.items as unknown as MpExecutionItem[])
    : [];
  await runStage(deps, {
    actor: input.actor,
    cityId: input.cityId,
    executionId: exec.id,
    stored,
    grantId: exec.review.grantId,
    correlationId: input.correlationId,
    previousState: items[0]?.state,
  });
}

// ---------------------------------------------------------------------------
// Cancel — a request the assistant published
// ---------------------------------------------------------------------------

export interface CancelMarketplaceInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly requestId: string;
  readonly assurance: { readonly method: string; readonly proof: string };
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface CancelResult {
  readonly requestId: string;
  readonly state: string;
}

/**
 * Cancels a request the ASSISTANT published (found by the publish review's
 * persisted quote), with a fresh, assurance-bound grant whose scope permits
 * only `cancel`. A request the user published elsewhere is refused with the
 * conventional flow — the assistant's authority never reaches it.
 */
export async function cancelMarketplaceRequest(
  deps: AskDeps,
  input: CancelMarketplaceInput,
): Promise<CancelResult> {
  await assertTransactionalFlags(deps, input.cityId);
  const conventionalFlow = requestFlowLink(input.requestId);
  const owned = await reviewOffers(
    deps,
    input.actor,
    input.cityId,
    input.requestId,
  );
  const publishReview = await deps.db.askReview.findFirst({
    where: {
      userId: input.actor.id,
      status: "executing",
      items: { path: ["scope", "quoteId"], equals: owned.request.quoteId },
    },
    include: { executions: true },
  });
  const stored =
    publishReview === null || !isMarketplaceReview(publishReview.items)
      ? null
      : parseStoredMpReview(publishReview.items);
  if (publishReview === null || stored === null || stored.stage !== "publish") {
    throw new ContractError(
      "forbidden",
      "the assistant did not publish this request; cancel it from the request screen",
      { reason: "not_published_by_assistant", conventionalFlow },
    );
  }
  const scope: MarketplaceGrantScope = {
    ...stored.scope,
    actions: ["cancel"],
    // Cancelling spends nothing: the grant authorises no amount at all.
    maxSpendMinor: 0,
  };
  const { grantId } = await authorizeNegotiation(deps, {
    actor: input.actor,
    cityId: input.cityId,
    scope,
    assurance: {
      method: input.assurance.method === "biometric" ? "biometric" : "pin",
      proof: input.assurance.proof,
    },
    idempotencyKey: `cancel:${input.idempotencyKey}`,
    correlationId: input.correlationId,
  });
  const request = await cancelRequest(deps, {
    actor: input.actor,
    cityId: input.cityId,
    grantId,
    scope,
    requestId: input.requestId,
    correlationId: input.correlationId,
  });

  // The publish order's per-order status follows the request — a state change
  // like any other, so it commits with its outbox event (never a bare write).
  const execution = publishReview.executions[0];
  if (execution !== undefined) {
    const items = Array.isArray(execution.items)
      ? (execution.items as unknown as MpExecutionItem[])
      : [];
    if (items.some((entry) => entry.orderId === input.requestId)) {
      const now = deps.now();
      await auditedTransaction(deps.db, async (tx) => {
        await tx.askExecution.update({
          where: { id: execution.id },
          data: {
            items: asJson(
              items.map((entry) =>
                entry.orderId === input.requestId
                  ? {
                      ...entry,
                      state: "cancelled",
                      detail:
                        "Request cancelled. Drivers' offers were released.",
                    }
                  : entry,
              ),
            ),
          },
        });
        return {
          result: null,
          events: [
            {
              name: "ask.execution.item.updated",
              aggregateType: "askExecution",
              aggregateId: execution.id,
              fromVersion: 2,
              toVersion: 3,
              actor: input.actor,
              actorType: actorKindFor(input.actor.role),
              cityId: input.cityId,
              idempotencyKey: outboxKey(),
              correlationId: input.correlationId,
              occurredAt: now,
              payload: {
                executionId: execution.id,
                kind: "mp_publish",
                state: "cancelled",
                orderId: input.requestId,
                supplierRef: null,
              },
            },
          ],
        };
      });
    }
  }
  return { requestId: request.requestId, state: request.state };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface MpExecutionIntentView {
  /** The persisted selection intent (`ask_mp_executions`): pending/awarded/failed. */
  readonly status: string;
  readonly attempts: number;
  readonly awardId: string | null;
}

export interface MpExecutionView {
  readonly stage: "publish" | "select";
  readonly requestId: string | null;
  readonly intent: MpExecutionIntentView | null;
  /** True when a reconcile may still move this execution. */
  readonly reconcilable: boolean;
  readonly conventionalFlow: string;
}

export async function marketplaceExecutionView(
  deps: AskDeps,
  exec: {
    readonly status: string;
    readonly items: unknown;
    readonly review: {
      readonly items: unknown;
      readonly grantId: string | null;
    };
  },
): Promise<MpExecutionView | undefined> {
  if (!isMarketplaceReview(exec.review.items)) {
    return undefined;
  }
  const stored = parseStoredMpReview(exec.review.items);
  const intent =
    exec.review.grantId === null
      ? null
      : await deps.db.askMpExecution.findUnique({
          where: { grantId: exec.review.grantId },
        });
  const items = Array.isArray(exec.items)
    ? (exec.items as unknown as MpExecutionItem[])
    : [];
  const [item] = stored.items;
  const requestId =
    items[0]?.orderId ?? (item.kind === "mp_selection" ? item.requestId : null);
  return {
    stage: stored.stage,
    requestId,
    intent:
      intent === null
        ? null
        : {
            status: intent.status,
            attempts: intent.attempts,
            awardId: intent.awardId,
          },
    reconcilable: exec.status === "processing",
    conventionalFlow:
      requestId === null ? stored.conventionalFlow : requestFlowLink(requestId),
  };
}
