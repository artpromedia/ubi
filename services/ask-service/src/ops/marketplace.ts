/**
 * AI marketplace actions (C10) — bounded, grant-scoped, deny-by-default.
 *
 * The assistant negotiates a fare in the marketplace AS the user, through the
 * exact HTTP endpoints a human client uses (see ports/marketplace-port.ts). It
 * proposes; the server decides. Every action here is gated by the deny-by-default
 * `ai_marketplace` flag, is bound to a user's grant (its scope, cap, city,
 * currency and expiry), and is re-validated deterministically against the
 * AUTHORITATIVE marketplace state at execution time. The model's free text — and
 * any injected offer/provider text — can never widen that scope (rule #18, #19).
 *
 * The two shapes of authorization:
 *   - ATTENDED   the user confirms with an assurance (PIN/biometric); the confirm
 *                mints a single-use grant, exactly as a booking confirm does.
 *   - UNATTENDED a valid, active mandate authorises selection with no human in
 *                the loop; its per-run cap, currency, ownership and constraints
 *                are re-checked at execution and a MandateExecution receipt logged.
 *
 * Which steps move money:
 *   - `authorizeNegotiation`  mints the grant (no money).
 *   - `prepareRequest`        publishes the request within scope (spends nothing,
 *                             awards nothing; does NOT consume the grant).
 *   - `selectOffer`           the ONLY binding step: re-validates cap/city/
 *                             currency/scope against the live offer, consumes the
 *                             single-use grant, then awards through the endpoint
 *                             under a STABLE idempotency key. A replay or an
 *                             uncertain outcome converges on the existing award —
 *                             it never issues a second selection.
 */
import { ContractError, isEnabled, scopedIdempotencyKey } from "@ubi/contracts";

import { actorKindFor, auditedTransaction } from "./audit";
import { assertFlagEnabled } from "./flags";
import { consumeGrant, GrantConsumeError } from "./grants";
import { generateId } from "../lib/ids";
import {
  MarketplaceTimeoutError,
  type MarketplacePort,
  type MpAward,
  type MpOffer,
  type MpPrincipal,
  type MpQuote,
  type MpQuoteInput,
  type MpRequest,
  type MpSnapshot,
  type SanitizedOffer,
} from "../ports/marketplace-port";

import type { AskDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const AI_MARKETPLACE = "ai_marketplace" as const;

export type MarketplaceAction = "quote" | "prepare" | "select" | "cancel";

const ALL_ACTIONS: readonly MarketplaceAction[] = [
  "quote",
  "prepare",
  "select",
  "cancel",
];

/**
 * The user-approved envelope the assistant may act within. Bound into the grant
 * (`fingerprintScope`) and re-checked, in full, against the authoritative request
 * and offer at execution time. Nothing outside it is ever silently widened.
 */
export interface MarketplaceGrantScope {
  readonly principalId: string;
  /** Which of quote/prepare/select/cancel the assistant may perform. */
  readonly actions: readonly MarketplaceAction[];
  readonly service: "ride" | "delivery";
  readonly cityId: string;
  readonly currency: string;
  /** The cap the SELECTED fare must never exceed. */
  readonly maxSpendMinor: number;
  /** An approved vehicle-class constraint, or null for any class. */
  readonly vehicleClass: string | null;
  /** Binds the whole negotiation to one server-issued quote. */
  readonly quoteId: string;
}

/**
 * A stable fingerprint of exactly what the user authorised. Recomputed from the
 * authoritative request at selection time; a mismatch (city/currency/vehicle/cap/
 * action-set/quote drift) is refused deterministically, never trusted.
 */
export function fingerprintScope(scope: MarketplaceGrantScope): string {
  const actions = [...scope.actions].sort().join(",");
  return [
    "mp.scope.v1",
    scope.service,
    scope.cityId,
    scope.currency,
    scope.maxSpendMinor,
    scope.vehicleClass ?? "*",
    actions,
    scope.quoteId,
  ].join("|");
}

function assertActionPermitted(
  scope: MarketplaceGrantScope,
  action: MarketplaceAction,
): void {
  if (!scope.actions.includes(action)) {
    throw new ContractError(
      "forbidden",
      `this grant does not permit the ${action} action`,
      { reason: "action_not_in_scope", action },
    );
  }
}

async function assertFlag(deps: AskDeps, cityId: string): Promise<void> {
  const flags = await deps.flags.flagsFor(cityId);
  assertFlagEnabled(flags, AI_MARKETPLACE);
}

function port(deps: AskDeps): MarketplacePort {
  return deps.marketplace;
}

/**
 * The principal every marketplace call is made AS — and the identity the port
 * signs for ride-service: the authenticated actor's id and role plus the Ask
 * session's gateway-verified city. Both inputs reach the ops from the route's
 * request context (middleware/auth.ts), never from a tool argument or model
 * output, and only these three fields are copied, so nothing else riding on an
 * actor object can reach the delegated identity (rule #18).
 */
function principalOf(actor: Actor, cityId: string): MpPrincipal {
  return { id: actor.id, role: actor.role, cityId };
}

/**
 * The grant's city is the only city the assistant may act in for it. The
 * delegated identity carries the SESSION city, so a scope minted for another
 * city is refused before any call rather than signed for the wrong one.
 */
function assertSessionCity(scope: MarketplaceGrantScope, cityId: string): void {
  if (scope.cityId !== cityId) {
    throw new ContractError("forbidden", "the grant city is out of scope", {
      reason: "city_mismatch",
    });
  }
}

// ---------------------------------------------------------------------------
// Read: quote (non-binding) and offers
// ---------------------------------------------------------------------------

export interface QuoteInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly input: MpQuoteInput;
}

/** A live, non-binding fare envelope. Commits nothing. */
export async function quoteMarketplace(
  deps: AskDeps,
  input: QuoteInput,
): Promise<MpQuote> {
  await assertFlag(deps, input.cityId);
  const quote = await port(deps).quote(
    principalOf(input.actor, input.cityId),
    input.input,
  );
  await recordAction(deps, {
    actor: input.actor,
    action: "mp.quote",
    authKind: "read_only",
    outcome: "done",
    redactedInputs: {
      service: input.input.service,
      vehicleClass: input.input.vehicleClass,
      quoteId: quote.quoteId,
    },
  });
  return quote;
}

export interface ReviewOffersResult {
  readonly request: MpRequest;
  readonly offers: readonly SanitizedOffer[];
  readonly award: MpAward | null;
}

/**
 * Owner-scoped read of the request and its private offers, presented for the
 * review model with every free-text field marked untrusted. Read-only.
 */
export async function reviewOffers(
  deps: AskDeps,
  actor: Actor,
  cityId: string,
  requestId: string,
): Promise<ReviewOffersResult> {
  await assertFlag(deps, cityId);
  const snapshot = await port(deps).viewOffers(
    principalOf(actor, cityId),
    requestId,
  );
  if (snapshot === null || snapshot.request.requesterId !== actor.id) {
    // A request that is not the caller's is not discoverable (rule #18).
    throw new ContractError("not_found", "no such request");
  }
  return {
    request: snapshot.request,
    offers: port(deps).reviewOffer(snapshot.offers),
    award: snapshot.award,
  };
}

// ---------------------------------------------------------------------------
// Authorize a negotiation — mint the single-use grant (the confirm step)
// ---------------------------------------------------------------------------

export interface AuthorizeInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly scope: MarketplaceGrantScope;
  /** Attended: a real user assurance. Unattended: omit and pass `mandateId`. */
  readonly assurance?: {
    readonly method: "pin" | "biometric";
    readonly proof: string;
  };
  /** Unattended: the mandate that authorises no-human-in-the-loop selection. */
  readonly mandateId?: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string | null;
}

export interface AuthorizeResult {
  readonly grantId: string;
  readonly unattended: boolean;
}

/**
 * Mints the marketplace grant. Attended flow requires a user assurance; the
 * unattended flow requires a valid, active mandate and NOTHING else authorises
 * it. The grant is single-use and consumed only by `selectOffer`.
 */
export async function authorizeNegotiation(
  deps: AskDeps,
  input: AuthorizeInput,
): Promise<AuthorizeResult> {
  await assertFlag(deps, input.cityId);
  const { scope } = input;
  if (scope.principalId !== input.actor.id) {
    throw new ContractError("forbidden", "the grant is not the caller's", {
      reason: "principal_mismatch",
    });
  }
  assertSessionCity(scope, input.cityId);

  const unattended = input.mandateId !== undefined;
  if (unattended) {
    await validateMandate(deps, {
      actor: input.actor,
      mandateId: input.mandateId as string,
      currency: scope.currency,
      amountMinor: scope.maxSpendMinor,
    });
  } else if (input.assurance === undefined) {
    // No mandate and no assurance: selection would have no human in the loop and
    // no standing authority. Refuse — this is exactly the human confirm step.
    throw new ContractError(
      "step_up_required",
      "unattended selection needs a valid mandate; otherwise confirm with your PIN",
      { reason: "no_authorization" },
    );
  }

  const now = deps.now();
  const expiresAt = new Date(
    now.getTime() + deps.limits.grantTtlSeconds * 1000,
  );
  const grant = await deps.grants.mint({
    actorId: input.actor.id,
    action: "mp.negotiate",
    resourceRef: scope.quoteId,
    termsVersion: fingerprintScope(scope),
    totalMinor: scope.maxSpendMinor,
    currency: scope.currency,
    assurance: unattended
      ? "mandate"
      : input.assurance?.method === "biometric"
        ? "biometric"
        : "pin",
    assuranceProof: unattended
      ? `mandate:${input.mandateId as string}`
      : (input.assurance?.proof as string),
    idempotencyKey: scopedIdempotencyKey(
      "mp.authorize",
      input.actor.id,
      input.idempotencyKey,
    ),
    expiresAt,
    cityId: input.cityId,
  });

  await recordAction(deps, {
    actor: input.actor,
    action: "mp.authorize",
    authKind: unattended ? "mandate" : "grant",
    authRef: unattended ? (input.mandateId as string) : grant.grantId,
    outcome: "done",
    redactedInputs: {
      grantId: grant.grantId,
      capMinor: scope.maxSpendMinor,
      currency: scope.currency,
      actions: [...scope.actions].sort().join(","),
      unattended,
    },
  });

  return { grantId: grant.grantId, unattended };
}

// ---------------------------------------------------------------------------
// Prepare — publish a request within scope (spends nothing, awards nothing)
// ---------------------------------------------------------------------------

export interface PrepareInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly grantId: string;
  readonly scope: MarketplaceGrantScope;
  readonly requestedFareMinor: number;
  readonly paymentMethodId: string;
  readonly weightKg?: number;
  readonly correlationId?: string | null;
}

/**
 * Publishes a request within the grant's bounds. This is an ACTION that commits
 * the requester to the flow, so it runs only under a scope that permits it — but
 * it moves no money and does NOT consume the single-use grant (that is reserved
 * for the binding `selectOffer`). Bounds are also enforced server-side.
 */
export async function prepareRequest(
  deps: AskDeps,
  input: PrepareInput,
): Promise<MpRequest> {
  await assertFlag(deps, input.cityId);
  const { scope } = input;
  assertActionPermitted(scope, "prepare");
  assertSessionCity(scope, input.cityId);

  const grant = await loadLiveGrant(deps, input.grantId, input.actor, scope);
  if (input.requestedFareMinor > Number(grant.totalMinor)) {
    throw new ContractError(
      "fare_out_of_bounds",
      "the requested fare exceeds the authorised cap",
      { reason: "cap_exceeded", capMinor: Number(grant.totalMinor) },
    );
  }

  const idempotencyKey = scopedIdempotencyKey(
    "mp.prepare",
    input.actor.id,
    input.grantId,
  );
  const request = await port(deps).prepareRequest(
    principalOf(input.actor, input.cityId),
    {
      quoteId: scope.quoteId,
      requestedFareMinor: input.requestedFareMinor,
      currency: scope.currency,
      paymentMethodId: input.paymentMethodId,
      weightKg: input.weightKg,
      idempotencyKey,
    },
  );

  // The authoritative request must land inside the authorised scope.
  assertRequestInScope(request, scope);

  await recordAction(deps, {
    actor: input.actor,
    action: "mp.prepare",
    authKind: grant.assurance === "mandate" ? "mandate" : "grant",
    authRef: input.grantId,
    outcome: "done",
    providerRefs: [request.requestId],
    redactedInputs: {
      requestId: request.requestId,
      requestedFareMinor: input.requestedFareMinor,
      currency: scope.currency,
      state: request.state,
    },
  });

  return request;
}

// ---------------------------------------------------------------------------
// Select — the ONLY binding step
// ---------------------------------------------------------------------------

export interface SelectInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly grantId: string;
  readonly scope: MarketplaceGrantScope;
  readonly requestId: string;
  readonly bidId: string;
  /** The revision the offer was reviewed at; a bump is a material change. */
  readonly expectedRequestRevision: number;
  /** The fare the offer was reviewed at; a re-price is a material change. */
  readonly expectedFareMinor: number;
  /** Optional unattended authority; validated again here. */
  readonly mandateId?: string;
  readonly correlationId?: string | null;
}

export interface SelectResult {
  readonly award: MpAward;
  readonly pickupPin?: string;
  /** True when this call converged on an award a prior selection already made. */
  readonly converged: boolean;
}

export async function selectOffer(
  deps: AskDeps,
  input: SelectInput,
): Promise<SelectResult> {
  await assertFlag(deps, input.cityId);
  const { scope } = input;
  assertActionPermitted(scope, "select");
  assertSessionCity(scope, input.cityId);
  const principal = principalOf(input.actor, input.cityId);

  const now = deps.now();

  // Load the grant. An ALREADY-CONSUMED grant means a prior selection ran under
  // it: converge on the authoritative award rather than selecting again.
  const existing = await deps.db.actionGrant.findUnique({
    where: { id: input.grantId },
  });
  if (existing === null) {
    throw new ContractError("not_found", "no such action grant");
  }
  if (existing.actorId !== input.actor.id) {
    throw new ContractError("forbidden", "the grant is not the caller's", {
      reason: "principal_mismatch",
    });
  }
  if (existing.consumedAt !== null) {
    return convergeOnAward(deps, input);
  }

  // Unattended selection is authorised ONLY by a valid, active mandate.
  if (input.mandateId !== undefined) {
    await validateMandate(deps, {
      actor: input.actor,
      mandateId: input.mandateId,
      currency: scope.currency,
      amountMinor: scope.maxSpendMinor,
    });
  }

  // Authoritative snapshot — the offer text is untrusted; only its numbers/ids
  // (and the server-signed request) drive the decision.
  const snapshot = await port(deps).viewOffers(principal, input.requestId);
  if (snapshot === null || snapshot.request.requesterId !== input.actor.id) {
    throw new ContractError("not_found", "no such request");
  }
  assertRequestInScope(snapshot.request, scope);
  if (snapshot.request.quoteId !== existing.resourceRef) {
    throw new ContractError("forbidden", "the request is outside the grant", {
      reason: "quote_mismatch",
    });
  }

  const offer = findSelectableOffer(snapshot, input.bidId);
  const selectedFareMinor = offer.totalMinor ?? offer.amountMinor;

  // HARD CAP — the selected fare must never exceed the authorised maximum. A
  // model that proposes an out-of-scope selection is refused here, not trusted.
  if (selectedFareMinor > Number(existing.totalMinor)) {
    await recordAction(deps, {
      actor: input.actor,
      action: "mp.select",
      authKind: input.mandateId !== undefined ? "mandate" : "grant",
      authRef: input.grantId,
      outcome: "refused",
      reasonCode: "cap_exceeded",
      redactedInputs: {
        requestId: input.requestId,
        bidId: input.bidId,
        selectedFareMinor,
        capMinor: Number(existing.totalMinor),
      },
    });
    throw new ContractError(
      "fare_out_of_bounds",
      "the selected fare exceeds the authorised cap",
      {
        reason: "cap_exceeded",
        capMinor: Number(existing.totalMinor),
        selectedFareMinor,
      },
    );
  }

  // Material change between review and selection — refuse deterministically.
  if (offer.requestRevision !== input.expectedRequestRevision) {
    throw new ContractError(
      "version_conflict",
      "the request was revised since you reviewed it; re-review before selecting",
      { reason: "request_revised", revision: offer.requestRevision },
    );
  }
  if (selectedFareMinor !== input.expectedFareMinor) {
    throw new ContractError(
      "version_conflict",
      "the offer re-priced since you reviewed it; re-review before selecting",
      { reason: "price_changed", fareMinor: selectedFareMinor },
    );
  }

  // Consume the single-use grant atomically, bound to the exact scope terms.
  try {
    await deps.db.$transaction(async (tx) => {
      await consumeGrant(tx, input.grantId, now, {
        totalMinor: Number(existing.totalMinor),
        currency: existing.currency,
        termsVersion: fingerprintScope(scope),
      });
    });
  } catch (error) {
    if (
      error instanceof GrantConsumeError &&
      error.reason === "already_consumed"
    ) {
      // A concurrent selection won the race — converge on its award.
      return convergeOnAward(deps, input);
    }
    throw error;
  }

  // Award through the endpoint under a STABLE key derived from the grant, so a
  // retry converges on the same award instead of double-charging.
  const idempotencyKey = scopedIdempotencyKey(
    "mp.select",
    input.actor.id,
    input.grantId,
  );
  let award: MpAward;
  let pickupPin: string | undefined;
  let converged = false;
  try {
    const result = await port(deps).select(principal, {
      requestId: input.requestId,
      bidId: input.bidId,
      requestVersion: snapshot.request.version,
      bidVersion: offer.bidVersion,
      idempotencyKey,
    });
    award = result.award;
    pickupPin = result.pickupPin;
  } catch (error) {
    // Uncertain outcome (timeout / unknown): QUERY the authoritative award, do
    // NOT resubmit the selection.
    if (
      error instanceof MarketplaceTimeoutError ||
      (error instanceof ContractError && error.code === "award_unresolved")
    ) {
      const queried = await port(deps).getAward(principal, input.requestId);
      if (queried !== null) {
        award = queried;
        converged = true;
      } else {
        await recordAction(deps, {
          actor: input.actor,
          action: "mp.select",
          authKind: input.mandateId !== undefined ? "mandate" : "grant",
          authRef: input.grantId,
          outcome: "partial",
          reasonCode: "award_pending",
          redactedInputs: { requestId: input.requestId, bidId: input.bidId },
        });
        throw error;
      }
    } else {
      throw error;
    }
  }

  await writeSelectionReceipt(deps, input, award, converged);
  return { award, pickupPin, converged };
}

/** Converge on an award a prior selection under this grant already produced. */
async function convergeOnAward(
  deps: AskDeps,
  input: SelectInput,
): Promise<SelectResult> {
  const award = await port(deps).getAward(
    principalOf(input.actor, input.cityId),
    input.requestId,
  );
  if (award === null) {
    // The grant was spent but no award exists (e.g. the first attempt failed
    // before reaching the server). This never double-charges; a new grant is
    // required to try again.
    throw new ContractError(
      "conflict",
      "this authorization was already spent and no award exists; re-authorize to try again",
      { reason: "grant_spent_no_award" },
    );
  }
  await writeSelectionReceipt(deps, input, award, true);
  return { award, converged: true };
}

async function writeSelectionReceipt(
  deps: AskDeps,
  input: SelectInput,
  award: MpAward,
  converged: boolean,
): Promise<void> {
  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async (tx) => {
    if (input.mandateId !== undefined) {
      // A per-award receipt; the unique (mandateId, triggerRef) makes a replay
      // land on the same row.
      const triggerRef = `mp.select:${input.requestId}`;
      const already = await tx.mandateExecution.findUnique({
        where: {
          mandateId_triggerRef: {
            mandateId: input.mandateId,
            triggerRef,
          },
        },
      });
      if (already === null) {
        await tx.mandateExecution.create({
          data: {
            id: generateId("mex"),
            mandateId: input.mandateId,
            triggerRef,
            outcome: "executed",
            grantId: input.grantId,
            receiptRef: award.awardId,
            resultRef: award.requestId,
            amountMinor: BigInt(award.fareMinor),
            currency: input.scope.currency,
            summary: `Selected offer for request ${award.requestId}`,
          },
        });
      }
    }
    return {
      result: null,
      aiActions: [
        {
          actorKind: input.mandateId !== undefined ? "mandate" : actorType,
          actorRef: input.actor.id,
          threadId: null,
          action: "mp.select",
          authKind:
            input.mandateId !== undefined
              ? ("mandate" as const)
              : ("grant" as const),
          authRef: input.grantId,
          outcome: "done" as const,
          reasonCode: converged ? "converged" : null,
          providerRefs: [award.awardId, award.requestId],
          costMinor: award.fareMinor,
          currency: input.scope.currency,
          redactedInputs: {
            requestId: award.requestId,
            bidId: award.bidId,
            awardId: award.awardId,
            awardState: award.state,
            fareMinor: award.fareMinor,
            converged,
          } satisfies JsonRecord,
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Cancel — release an open request
// ---------------------------------------------------------------------------

export interface CancelInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly grantId: string;
  readonly scope: MarketplaceGrantScope;
  readonly requestId: string;
  readonly correlationId?: string | null;
}

export async function cancelRequest(
  deps: AskDeps,
  input: CancelInput,
): Promise<MpRequest> {
  await assertFlag(deps, input.cityId);
  assertActionPermitted(input.scope, "cancel");
  assertSessionCity(input.scope, input.cityId);
  const grant = await loadLiveGrant(
    deps,
    input.grantId,
    input.actor,
    input.scope,
  );
  const idempotencyKey = scopedIdempotencyKey(
    "mp.cancel",
    input.actor.id,
    `${input.grantId}:${input.requestId}`,
  );
  const request = await port(deps).cancel(
    principalOf(input.actor, input.cityId),
    input.requestId,
    idempotencyKey,
  );
  await recordAction(deps, {
    actor: input.actor,
    action: "mp.cancel",
    authKind: grant.assurance === "mandate" ? "mandate" : "grant",
    authRef: input.grantId,
    outcome: "done",
    providerRefs: [request.requestId],
    redactedInputs: { requestId: request.requestId, state: request.state },
  });
  return request;
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

interface LiveGrantRow {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly termsVersion: string;
  readonly totalMinor: bigint;
  readonly currency: string;
  readonly assurance: string;
  readonly consumedAt: Date | null;
  readonly expiresAt: Date;
}

/**
 * Loads a grant and asserts it is the caller's, unconsumed, unexpired and bound
 * to exactly this scope. Used by the non-consuming actions (prepare, cancel);
 * `selectOffer` handles the consumed/expired cases itself so it can converge.
 */
async function loadLiveGrant(
  deps: AskDeps,
  grantId: string,
  actor: Actor,
  scope: MarketplaceGrantScope,
): Promise<LiveGrantRow> {
  const grant = (await deps.db.actionGrant.findUnique({
    where: { id: grantId },
  })) as LiveGrantRow | null;
  if (grant === null) {
    throw new ContractError("not_found", "no such action grant");
  }
  if (grant.actorId !== actor.id) {
    throw new ContractError("forbidden", "the grant is not the caller's", {
      reason: "principal_mismatch",
    });
  }
  if (grant.consumedAt !== null) {
    throw new ContractError(
      "conflict",
      "this action grant has already been used",
      {
        reason: "already_consumed",
      },
    );
  }
  if (grant.expiresAt.getTime() <= deps.now().getTime()) {
    throw new ContractError("conflict", "this action grant has expired", {
      reason: "expired",
    });
  }
  if (grant.termsVersion !== fingerprintScope(scope)) {
    throw new ContractError("forbidden", "the grant scope has changed", {
      reason: "scope_mismatch",
    });
  }
  return grant;
}

function assertRequestInScope(
  request: MpRequest,
  scope: MarketplaceGrantScope,
): void {
  if (request.cityId !== scope.cityId) {
    throw new ContractError("forbidden", "the request city is out of scope", {
      reason: "city_mismatch",
    });
  }
  if (request.currency !== scope.currency) {
    throw new ContractError(
      "forbidden",
      "the request currency is out of scope",
      { reason: "currency_mismatch" },
    );
  }
  if (
    scope.vehicleClass !== null &&
    request.vehicleClass !== scope.vehicleClass
  ) {
    throw new ContractError(
      "forbidden",
      "the request vehicle class is out of scope",
      { reason: "vehicle_class_mismatch" },
    );
  }
}

function findSelectableOffer(snapshot: MpSnapshot, bidId: string): MpOffer {
  const offer = snapshot.offers.find((candidate) => candidate.bidId === bidId);
  if (offer === undefined) {
    throw new ContractError("not_found", "no such offer on this request", {
      reason: "offer_not_found",
    });
  }
  if (offer.withdrawn) {
    throw new ContractError("conflict", "that offer has been withdrawn", {
      reason: "offer_withdrawn",
    });
  }
  return offer;
}

interface MandateCheck {
  readonly actor: Actor;
  readonly mandateId: string;
  readonly currency: string;
  readonly amountMinor: number;
}

/**
 * Validates a mandate authorises an unattended action: it must exist, be the
 * caller's, be ACTIVE (not paused/revoked/expired), match the currency, be
 * unexpired, and its per-run cap must cover the amount. Revoking or pausing the
 * mandate stops every further action (deterministically, at execution time).
 */
async function validateMandate(
  deps: AskDeps,
  check: MandateCheck,
): Promise<void> {
  const mandate = await deps.db.mandate.findUnique({
    where: { id: check.mandateId },
  });
  if (mandate === null || mandate.userId !== check.actor.id) {
    throw new ContractError("not_found", "no such mandate");
  }
  if (mandate.status !== "active") {
    throw new ContractError(
      "forbidden",
      `this mandate is ${mandate.status} and cannot authorise an action`,
      { reason: `mandate_${mandate.status}` },
    );
  }
  if (mandate.expiresAt.getTime() <= deps.now().getTime()) {
    throw new ContractError("forbidden", "this mandate has expired", {
      reason: "mandate_expired",
    });
  }
  if (mandate.currency !== check.currency) {
    throw new ContractError(
      "forbidden",
      "this mandate does not cover that currency",
      { reason: "mandate_currency_mismatch" },
    );
  }
  if (check.amountMinor > Number(mandate.perRunCapMinor)) {
    throw new ContractError(
      "forbidden",
      "the amount exceeds the mandate's per-run cap",
      {
        reason: "mandate_cap_exceeded",
        perRunCapMinor: Number(mandate.perRunCapMinor),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface RecordActionInput {
  readonly actor: Actor;
  readonly action: string;
  readonly authKind: "grant" | "mandate" | "read_only" | "none";
  readonly authRef?: string | null;
  readonly outcome: "done" | "partial" | "blocked" | "refused" | "error";
  readonly reasonCode?: string | null;
  readonly providerRefs?: readonly string[];
  readonly costMinor?: number | null;
  readonly currency?: string | null;
  readonly redactedInputs?: JsonRecord | null;
}

async function recordAction(
  deps: AskDeps,
  input: RecordActionInput,
): Promise<void> {
  const actorKind =
    input.authKind === "mandate" ? "mandate" : actorKindFor(input.actor.role);
  // eslint-disable-next-line require-await -- auditedTransaction's callback is async by contract; this one only describes the log row
  await auditedTransaction(deps.db, async () => ({
    result: null,
    aiActions: [
      {
        actorKind,
        actorRef: input.actor.id,
        threadId: null,
        action: input.action,
        model: deps.model.model,
        modelRevision: deps.model.revision,
        authKind: input.authKind,
        authRef: input.authRef ?? null,
        outcome: input.outcome,
        reasonCode: input.reasonCode ?? null,
        providerRefs: input.providerRefs ?? [],
        costMinor: input.costMinor ?? null,
        currency: input.currency ?? null,
        redactedInputs: input.redactedInputs ?? null,
      },
    ],
  }));
}

/** True when the flag is on for a city, without throwing. */
export async function marketplaceAiEnabled(
  deps: AskDeps,
  cityId: string,
): Promise<boolean> {
  const flags = await deps.flags.flagsFor(cityId);
  return isEnabled(flags, AI_MARKETPLACE);
}

export const MARKETPLACE_ACTIONS = ALL_ACTIONS;
