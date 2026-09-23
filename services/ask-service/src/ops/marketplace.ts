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
 *   - UNATTENDED a valid, active mandate of the service's marketplace action
 *                (`marketplace.ride.select` / `marketplace.delivery.select`)
 *                authorises selection with no human in the loop. The mandate is
 *                PERSISTED on the grant at mint and every action re-derives it
 *                from there (./mandate-scope.ts) — a caller can neither omit nor
 *                substitute it — and its full scope (action, categories,
 *                providers, constraints, currency, per-run cap) is re-checked on
 *                every action. Its period cap and run count are reserved
 *                atomically at the selection's commit boundary through the one
 *                canonical allowance mechanism (./mandate-allowance.ts).
 *
 * Which steps move money:
 *   - `authorizeNegotiation`  mints the grant (no money).
 *   - `prepareRequest`        publishes the request within scope (spends nothing,
 *                             awards nothing; does NOT consume the grant).
 *   - `selectOffer`           the ONLY binding step. It re-validates cap/city/
 *                             currency/scope against the live offer, then in ONE
 *                             transaction — the commit boundary — consumes the
 *                             single-use grant, re-checks the mandate under a
 *                             share lock, reserves its allowance and persists the
 *                             execution intent (./mp-executions.ts). Only then
 *                             does it award, under the execution's idempotency
 *                             key. An award commits the allowance at the award
 *                             fare; a definitive refusal releases it; an
 *                             ambiguous outcome stays pending and a retry
 *                             reconciles THAT execution — by query, and by
 *                             re-sending the same key only once its in-flight
 *                             lease has lapsed. It never issues a second
 *                             selection, consumes a second grant, or holds a
 *                             second allowance run.
 */
import { createHash } from "node:crypto";

import { ContractError, isEnabled, scopedIdempotencyKey } from "@ubi/contracts";

import {
  actorKindFor,
  auditedTransaction,
  type AuditedTx,
  type OutboxInput,
} from "./audit";
import { assertFlagEnabled } from "./flags";
import { consumeGrant, GrantConsumeError } from "./grants";
import {
  reserveMandateAllowance,
  settleMandateAllowance,
  type ReserveOutcome,
} from "./mandate-allowance";
import {
  assertMandateScope,
  authorityFromGrant,
  cityTimezone,
  MandateRefusedError,
  mandateScopeRefusal,
  periodHeadroomRefusal,
  type GrantAuthority,
  type MandateFacts,
  type MandateRefusal,
  type MandateRow,
  type MandateStage,
} from "./mandate-scope";
import {
  claimRetryLease,
  classifySelectFailure,
  executionIdempotencyKey,
  failureReason,
  findExecutionByGrant,
  type MpExecution,
} from "./mp-executions";
import { generateId } from "../lib/ids";

import type { AskDeps } from "./context";
import type { Actor, AskTx, JsonRecord } from "./types";
import type {
  MarketplacePort,
  MpAward,
  MpOffer,
  MpPrincipal,
  MpQuote,
  MpQuoteInput,
  MpRequest,
  MpSelectResult,
  MpSnapshot,
  SanitizedOffer,
} from "../ports/marketplace-port";

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
// Keys, facts and mandate checks shared by the actions below
// ---------------------------------------------------------------------------

/**
 * A marketplace idempotency key: the operation plus a digest of what it is
 * bound to. ride-service accepts at most 64 url-safe characters
 * (move.ValidateIdempotencyKey), which the raw actor + grant ids overrun.
 */
function wireKey(operation: string, ...parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update([operation, ...parts].join("|"))
    .digest("hex");
  return `${operation}:${digest.slice(0, 40)}`;
}

function authKindOf(authority: GrantAuthority): "grant" | "mandate" {
  return authority.kind === "mandate" ? "mandate" : "grant";
}

function mandateIdOf(authority: GrantAuthority): string | null {
  return authority.kind === "mandate" ? authority.mandateId : null;
}

/** The mandate facts of an action — all server-derived (see MandateFacts). */
async function mandateFacts(
  deps: AskDeps,
  input: {
    readonly actor: Actor;
    readonly cityId: string;
    readonly scope: MarketplaceGrantScope;
    readonly stage: MandateStage;
    readonly vehicleClass: string | null;
    readonly amountMinor: number | null;
  },
): Promise<MandateFacts> {
  return {
    actorId: input.actor.id,
    stage: input.stage,
    service: input.scope.service,
    cityId: input.cityId,
    cityTimezone: await cityTimezone(deps.db, input.cityId),
    currency: input.scope.currency,
    vehicleClass: input.vehicleClass,
    amountMinor: input.amountMinor,
    providerRef: null,
    at: deps.now(),
  };
}

/** Logs a mandate refusal and throws it. */
async function refuseForMandate(
  deps: AskDeps,
  actor: Actor,
  action: string,
  authRef: string,
  refused: MandateRefusal,
  redactedInputs: JsonRecord | null = null,
): Promise<never> {
  await recordAction(deps, {
    actor,
    action,
    authKind: "mandate",
    authRef,
    outcome: "refused",
    reasonCode: refused.reason,
    redactedInputs,
  });
  throw new MandateRefusedError(refused);
}

interface MandateCheck {
  readonly actor: Actor;
  readonly cityId: string;
  readonly scope: MarketplaceGrantScope;
  readonly mandateId: string;
  readonly stage: MandateStage;
  readonly vehicleClass: string | null;
  readonly amountMinor: number | null;
  /** When set, an advisory read of the period headroom for this amount. */
  readonly headroomMinor: number | null;
  /** The ai_actions action a refusal is logged under. */
  readonly auditAction: string;
  readonly authRef: string;
}

/**
 * A read-only mandate check for the steps that reach an effect without
 * reserving allowance (authorize, prepare, cancel) and for the early refusal
 * in select. Refuses — and logs — on any scope failure.
 */
async function checkMandate(deps: AskDeps, check: MandateCheck): Promise<void> {
  const mandate = await deps.db.mandate.findUnique({
    where: { id: check.mandateId },
  });
  const facts = await mandateFacts(deps, check);
  let refused = mandateScopeRefusal(mandate, facts);
  if (refused === null && mandate !== null && check.headroomMinor !== null) {
    refused = await periodHeadroomRefusal(
      deps.db,
      mandate,
      check.headroomMinor,
      facts.at,
    );
  }
  if (refused !== null) {
    await refuseForMandate(
      deps,
      check.actor,
      check.auditAction,
      check.authRef,
      refused,
      { mandateId: check.mandateId, stage: check.stage },
    );
  }
}

/**
 * Reads the mandate row under a SHARE lock inside the commit-boundary
 * transaction. A pause, revoke or edit is an UPDATE of that row: it either
 * committed before this read (and is seen) or waits until the selection's
 * intent has committed. That is the exact moment the mandate is "revalidated
 * immediately before the effect".
 */
async function lockMandate(
  tx: AskTx,
  mandateId: string,
): Promise<MandateRow | null> {
  await tx.$queryRaw`SELECT id FROM mandates WHERE id = ${mandateId} FOR SHARE`;
  return tx.mandate.findUnique({ where: { id: mandateId } });
}

/** Maps a refused allowance reservation to the mandate refusal it means. */
function reservationRefusal(outcome: ReserveOutcome): MandateRefusal {
  switch (outcome) {
    case "mandate_not_found":
      return {
        code: "not_found",
        reason: "mandate_not_found",
        message: "no such mandate",
      };
    case "mandate_paused":
    case "mandate_revoked":
    case "mandate_expired":
      return {
        code: "forbidden",
        reason: outcome,
        message: "this mandate can no longer authorise an action",
      };
    case "currency_mismatch":
      return {
        code: "forbidden",
        reason: "mandate_currency_mismatch",
        message: "this mandate does not cover that currency",
      };
    case "price_above_cap":
      return {
        code: "forbidden",
        reason: "mandate_cap_exceeded",
        message: "the amount exceeds the mandate's per-run cap",
      };
    default:
      return {
        code: "forbidden",
        reason: "mandate_allowance_exhausted",
        message: "this mandate's allowance for the period is used up",
      };
  }
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
  /**
   * Unattended: the mandate that authorises no-human-in-the-loop selection. It
   * is validated here and PERSISTED on the grant; later actions read it from
   * the grant, never from their callers.
   */
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
 * unattended flow requires a mandate that authorises this exact scope and
 * NOTHING else authorises it. The grant is single-use and consumed only by
 * `selectOffer`.
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

  const mandateId = input.mandateId;
  const unattended = mandateId !== undefined;
  if (unattended) {
    // The full scope — action, categories, providers, constraints, currency,
    // per-run cap — plus an early read of the period headroom for the cap.
    await checkMandate(deps, {
      actor: input.actor,
      cityId: input.cityId,
      scope,
      mandateId,
      stage: "authorize",
      vehicleClass: scope.vehicleClass,
      amountMinor: scope.maxSpendMinor,
      headroomMinor: scope.maxSpendMinor,
      auditAction: "mp.authorize",
      authRef: mandateId,
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
  const minted = await deps.grants.mint({
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
      ? `mandate:${mandateId}`
      : (input.assurance?.proof as string),
    mandateId,
    idempotencyKey: scopedIdempotencyKey(
      "mp.authorize",
      input.actor.id,
      input.idempotencyKey,
    ),
    expiresAt,
    cityId: input.cityId,
  });

  // Read the grant BACK: the stored row — not what was asked for — is the
  // authority every later action derives. A replayed key returns the original
  // grant, which must carry exactly these terms and this binding.
  const stored = await deps.db.actionGrant.findUnique({
    where: { id: minted.grantId },
  });
  if (
    stored === null ||
    stored.actorId !== input.actor.id ||
    stored.termsVersion !== fingerprintScope(scope)
  ) {
    throw new ContractError(
      "conflict",
      "the authorization does not match the confirmed terms",
      { reason: "grant_binding_mismatch" },
    );
  }
  const authority = authorityFromGrant(stored, mandateId);
  if ((authority.kind === "mandate") !== unattended) {
    throw new ContractError(
      "conflict",
      "the authorization does not match the confirmed terms",
      { reason: "grant_binding_mismatch" },
    );
  }

  await recordAction(deps, {
    actor: input.actor,
    action: "mp.authorize",
    authKind: unattended ? "mandate" : "grant",
    authRef: unattended ? (mandateId as string) : minted.grantId,
    outcome: "done",
    redactedInputs: {
      grantId: minted.grantId,
      capMinor: scope.maxSpendMinor,
      currency: scope.currency,
      actions: [...scope.actions].sort().join(","),
      unattended,
    },
  });

  return { grantId: minted.grantId, unattended };
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
  /** Optional restatement; authority comes from the grant and must match it. */
  readonly mandateId?: string;
  readonly correlationId?: string | null;
}

/**
 * Publishes a request within the grant's bounds. This is an ACTION that commits
 * the requester to the flow, so it runs only under a scope that permits it — and,
 * for a mandate grant, only while the grant's mandate still authorises it — but
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
  const authority = authorityFromGrant(grant, input.mandateId);
  if (input.requestedFareMinor > Number(grant.totalMinor)) {
    throw new ContractError(
      "fare_out_of_bounds",
      "the requested fare exceeds the authorised cap",
      { reason: "cap_exceeded", capMinor: Number(grant.totalMinor) },
    );
  }
  if (authority.kind === "mandate") {
    await checkMandate(deps, {
      actor: input.actor,
      cityId: input.cityId,
      scope,
      mandateId: authority.mandateId,
      stage: "prepare",
      vehicleClass: scope.vehicleClass,
      amountMinor: Number(grant.totalMinor),
      headroomMinor: Number(grant.totalMinor),
      auditAction: "mp.prepare",
      authRef: input.grantId,
    });
  }

  const idempotencyKey = wireKey("mp.prepare", input.actor.id, input.grantId);
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
    authKind: authKindOf(authority),
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
  /**
   * Optional restatement of the grant's mandate. Authority is read from the
   * STORED grant: omitting this changes nothing, and a different id is refused.
   */
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

  const grant = await deps.db.actionGrant.findUnique({
    where: { id: input.grantId },
  });
  if (grant === null) {
    throw new ContractError("not_found", "no such action grant");
  }
  if (grant.actorId !== input.actor.id) {
    throw new ContractError("forbidden", "the grant is not the caller's", {
      reason: "principal_mismatch",
    });
  }
  // The scope a caller presents is only trusted once it hashes to the terms
  // stored on the grant; everything below (and every retry) reads from it.
  if (grant.termsVersion !== fingerprintScope(scope)) {
    throw new ContractError("forbidden", "the grant scope has changed", {
      reason: "scope_mismatch",
    });
  }
  // Authority comes from the STORED grant: a mandate grant is bound to the
  // mandate persisted at mint, whether or not the caller restates it.
  const authority = authorityFromGrant(grant, input.mandateId);

  // A persisted execution means a selection already ran under this grant:
  // reconcile THAT execution — never start a second one.
  const prior = await findExecutionByGrant(deps.db, grant.id);
  if (prior !== null) {
    return resumeExecution(deps, input, authority, prior);
  }
  if (grant.consumedAt !== null) {
    // Spent with no execution intent (a path that predates intents): converge
    // by query only.
    return convergeOnAward(deps, input, authority);
  }

  // Early, read-only refusal for a mandate that no longer authorises this
  // scope — before any marketplace call. The binding re-check is below, under
  // a lock, at the commit boundary.
  if (authority.kind === "mandate") {
    await checkMandate(deps, {
      actor: input.actor,
      cityId: input.cityId,
      scope,
      mandateId: authority.mandateId,
      stage: "select",
      vehicleClass: scope.vehicleClass,
      amountMinor: null,
      headroomMinor: null,
      auditAction: "mp.select",
      authRef: grant.id,
    });
  }

  // Authoritative snapshot — the offer text is untrusted; only its numbers/ids
  // (and the server-signed request) drive the decision.
  const snapshot = await port(deps).viewOffers(principal, input.requestId);
  if (snapshot === null || snapshot.request.requesterId !== input.actor.id) {
    throw new ContractError("not_found", "no such request");
  }
  assertRequestInScope(snapshot.request, scope);
  if (snapshot.request.quoteId !== grant.resourceRef) {
    throw new ContractError("forbidden", "the request is outside the grant", {
      reason: "quote_mismatch",
    });
  }

  const offer = findSelectableOffer(snapshot, input.bidId, now);
  const selectedFareMinor = offer.totalMinor ?? offer.amountMinor;

  // HARD CAP — the selected fare must never exceed the authorised maximum. A
  // model that proposes an out-of-scope selection is refused here, not trusted.
  if (selectedFareMinor > Number(grant.totalMinor)) {
    await recordAction(deps, {
      actor: input.actor,
      action: "mp.select",
      authKind: authKindOf(authority),
      authRef: input.grantId,
      outcome: "refused",
      reasonCode: "cap_exceeded",
      redactedInputs: {
        requestId: input.requestId,
        bidId: input.bidId,
        selectedFareMinor,
        capMinor: Number(grant.totalMinor),
      },
    });
    throw new ContractError(
      "fare_out_of_bounds",
      "the selected fare exceeds the authorised cap",
      {
        reason: "cap_exceeded",
        capMinor: Number(grant.totalMinor),
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

  const facts =
    authority.kind === "mandate"
      ? await mandateFacts(deps, {
          actor: input.actor,
          cityId: input.cityId,
          scope,
          stage: "select",
          vehicleClass: snapshot.request.vehicleClass,
          amountMinor: selectedFareMinor,
        })
      : null;

  let execution: MpExecution;
  try {
    execution = await persistExecutionIntent(deps, {
      input,
      authority,
      grant: {
        id: grant.id,
        totalMinor: Number(grant.totalMinor),
        currency: grant.currency,
      },
      request: snapshot.request,
      offer,
      fareMinor: selectedFareMinor,
      facts,
      now,
    });
  } catch (error) {
    if (
      error instanceof GrantConsumeError &&
      error.reason === "already_consumed"
    ) {
      // A concurrent selection under this grant committed its intent first:
      // follow THAT execution rather than select again.
      const winner = await findExecutionByGrant(deps.db, grant.id);
      return winner === null
        ? convergeOnAward(deps, input, authority)
        : resumeExecution(deps, input, authority, winner);
    }
    if (error instanceof MandateRefusedError) {
      await recordAction(deps, {
        actor: input.actor,
        action: "mp.select",
        authKind: "mandate",
        authRef: grant.id,
        outcome: "refused",
        reasonCode: error.refusal.reason,
        redactedInputs: {
          requestId: input.requestId,
          bidId: input.bidId,
          fareMinor: selectedFareMinor,
        },
      });
    }
    throw error;
  }

  return attemptAward(deps, input, authority, execution, principal);
}

interface IntentInput {
  readonly input: SelectInput;
  readonly authority: GrantAuthority;
  readonly grant: {
    readonly id: string;
    readonly totalMinor: number;
    readonly currency: string;
  };
  readonly request: MpRequest;
  readonly offer: MpOffer;
  readonly fareMinor: number;
  readonly facts: MandateFacts | null;
  readonly now: Date;
}

/**
 * THE COMMIT BOUNDARY. One transaction consumes the single-use grant, re-reads
 * the grant's mandate under a share lock and re-checks its full scope, reserves
 * budget + one run through the canonical allowance function, and persists the
 * execution intent with its idempotency key — all before the external award.
 * Any refusal rolls every part back: the grant stays unspent and nothing is
 * reserved.
 */
async function persistExecutionIntent(
  deps: AskDeps,
  intent: IntentInput,
): Promise<MpExecution> {
  const { input, authority, grant, now } = intent;
  const executionId = generateId("mpx");
  const idempotencyKey = executionIdempotencyKey({
    grantId: grant.id,
    requestId: input.requestId,
    bidId: intent.offer.bidId,
    requestVersion: intent.request.version,
    bidVersion: intent.offer.bidVersion,
  });
  const actorType = actorKindFor(input.actor.role);

  const persisted = await auditedTransaction(deps.db, async (tx) => {
    await consumeGrant(tx, grant.id, now, {
      totalMinor: grant.totalMinor,
      currency: grant.currency,
      termsVersion: fingerprintScope(input.scope),
    });

    let reservationId: string | null = null;
    if (authority.kind === "mandate" && intent.facts !== null) {
      const mandate = await lockMandate(tx, authority.mandateId);
      assertMandateScope(mandate, intent.facts);
      const reserved = await reserveMandateAllowance(tx, {
        reservationId: generateId("mar"),
        idempotencyKey: `ask:${idempotencyKey}`,
        mandateId: authority.mandateId,
        amountMinor: intent.fareMinor,
        currency: input.scope.currency,
        grantId: grant.id,
        now,
      });
      if (reserved.outcome !== "reserved" || reserved.reservationId === null) {
        throw new MandateRefusedError(reservationRefusal(reserved.outcome));
      }
      reservationId = reserved.reservationId;
    }

    const execution = await tx.askMpExecution.create({
      data: {
        id: executionId,
        grantId: grant.id,
        actorId: input.actor.id,
        cityId: input.cityId,
        mandateId: mandateIdOf(authority),
        reservationId,
        requestId: input.requestId,
        bidId: intent.offer.bidId,
        requestVersion: intent.request.version,
        bidVersion: intent.offer.bidVersion,
        requestRevision: intent.offer.requestRevision,
        fareMinor: BigInt(intent.fareMinor),
        currency: input.scope.currency,
        idempotencyKey,
        status: "pending",
        leaseUntil: new Date(
          now.getTime() + deps.limits.selectLeaseSeconds * 1000,
        ),
      },
    });

    return {
      result: execution,
      aiActions: [
        {
          actorKind: authority.kind === "mandate" ? "mandate" : actorType,
          actorRef: input.actor.id,
          threadId: null,
          action: "mp.select.intent",
          model: deps.model.model,
          modelRevision: deps.model.revision,
          authKind: authKindOf(authority),
          authRef: grant.id,
          outcome: "done" as const,
          providerRefs: [input.requestId],
          redactedInputs: {
            executionId,
            requestId: input.requestId,
            bidId: intent.offer.bidId,
            fareMinor: intent.fareMinor,
            reservationId,
          } satisfies JsonRecord,
        },
      ],
      events: [
        {
          name: "action_grant.consumed",
          aggregateType: "actionGrant",
          aggregateId: grant.id,
          fromVersion: 1,
          toVersion: 2,
          actor: input.actor,
          actorType,
          cityId: input.cityId,
          idempotencyKey: `action_grant.consumed:${grant.id}`,
          correlationId: input.correlationId ?? null,
          occurredAt: now,
          payload: {
            grantId: grant.id,
            executionId,
            requestId: input.requestId,
            bidId: intent.offer.bidId,
            mandateId: mandateIdOf(authority),
            reservationId,
          },
        },
      ],
    };
  });
  return persisted;
}

/**
 * Sends the award under the execution's key and settles the outcome: an award
 * closes it `awarded`; a definitive refusal closes it `failed`; an ambiguous
 * outcome is QUERIED (never re-sent here) and otherwise left pending.
 */
async function attemptAward(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
  principal: MpPrincipal,
): Promise<SelectResult> {
  let result: MpSelectResult;
  try {
    result = await port(deps).select(principal, {
      requestId: execution.requestId,
      bidId: execution.bidId,
      requestVersion: execution.requestVersion,
      bidVersion: execution.bidVersion,
      idempotencyKey: execution.idempotencyKey,
    });
  } catch (error) {
    if (
      classifySelectFailure(error) === "definitive" &&
      execution.attempts > 1
    ) {
      // A RE-SENT attempt's refusal only proves THIS call did not award: an
      // earlier attempt still in flight (its claim not yet committed when the
      // re-send arrived) may have landed meanwhile and be what refused it
      // (version_conflict / request_closed). Query before releasing anything;
      // if the query cannot answer, the outcome stays pending, never released.
      let settled: SelectResult | null;
      try {
        settled = await settleByAwardQuery(deps, input, authority, execution);
      } catch (queryError) {
        if (
          queryError instanceof ContractError &&
          queryError.details?.reason === "request_awarded_elsewhere"
        ) {
          throw queryError;
        }
        throw error;
      }
      if (settled !== null) {
        return settled;
      }
    }
    if (classifySelectFailure(error) === "definitive") {
      await closeExecutionFailed(
        deps,
        input,
        authority,
        execution,
        failureReason(error),
      );
      throw error;
    }
    let settled: SelectResult | null = null;
    try {
      settled = await settleByAwardQuery(deps, input, authority, execution);
    } catch (queryError) {
      if (
        queryError instanceof ContractError &&
        queryError.details?.reason === "request_awarded_elsewhere"
      ) {
        throw queryError;
      }
      // The query failed too: the outcome is still unknown.
      settled = null;
    }
    if (settled !== null) {
      return settled;
    }
    await recordAction(deps, {
      actor: input.actor,
      action: "mp.select",
      authKind: authKindOf(authority),
      authRef: execution.grantId,
      outcome: "partial",
      reasonCode: "award_pending",
      redactedInputs: {
        executionId: execution.id,
        requestId: execution.requestId,
        bidId: execution.bidId,
      },
    });
    throw error;
  }
  return closeExecutionAwarded(
    deps,
    input,
    authority,
    execution,
    result.award,
    {
      converged: false,
      pickupPin: result.pickupPin,
    },
  );
}

/**
 * Queries the authoritative award for the execution's request. An award for
 * THIS bid settles the execution; an award for another bid means this
 * selection can never land (one request, one award). Null when there is none.
 */
async function settleByAwardQuery(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
): Promise<SelectResult | null> {
  const award = await port(deps).getAward(
    principalOf(input.actor, input.cityId),
    execution.requestId,
  );
  if (award === null) {
    return null;
  }
  if (award.bidId !== execution.bidId) {
    await closeExecutionFailed(
      deps,
      input,
      authority,
      execution,
      "request_awarded_elsewhere",
    );
    throw new ContractError(
      "conflict",
      "this request was awarded to a different offer",
      { reason: "request_awarded_elsewhere" },
    );
  }
  return closeExecutionAwarded(deps, input, authority, execution, award, {
    converged: true,
  });
}

/** True while the marketplace could still award this request. */
function requestCanStillAward(request: MpRequest, now: Date): boolean {
  if (request.state === "open") {
    return Date.parse(request.expiresAt) > now.getTime();
  }
  // award_pending / awarded / execution: an award is resolving or exists.
  return (
    request.state === "award_pending" ||
    request.state === "awarded" ||
    request.state === "execution"
  );
}

/**
 * Reconciles a selection that already has a persisted execution. The retry
 * must be for the SAME selection; it never consumes a new grant or a second
 * allowance run.
 */
async function resumeExecution(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
): Promise<SelectResult> {
  if (
    execution.requestId !== input.requestId ||
    execution.bidId !== input.bidId
  ) {
    throw new ContractError(
      "conflict",
      "this authorization is already committed to a different selection",
      { reason: "execution_mismatch" },
    );
  }
  if (execution.mandateId !== mandateIdOf(authority)) {
    throw new ContractError(
      "forbidden",
      "the mandate does not match this authorization",
      { reason: "mandate_mismatch" },
    );
  }

  if (execution.status === "awarded") {
    const award = await port(deps).getAward(
      principalOf(input.actor, input.cityId),
      execution.requestId,
    );
    if (award === null || award.awardId !== execution.awardId) {
      throw new ContractError(
        "service_unavailable",
        "the award for this authorization cannot be read right now",
        { reason: "award_unreadable" },
      );
    }
    return closeExecutionAwarded(deps, input, authority, execution, award, {
      converged: true,
    });
  }
  if (execution.status === "failed") {
    // Definitively not awarded; the allowance was released. A new grant is
    // required — and safe, because nothing of this one can still commit.
    throw new ContractError(
      "conflict",
      "this authorization was already spent and no award exists; re-authorize to try again",
      {
        reason: "grant_spent_no_award",
        executionReason: execution.reasonCode ?? "unknown",
      },
    );
  }
  return reconcilePendingExecution(deps, input, authority, execution);
}

/**
 * A pending execution: the award call may or may not have landed. Query first;
 * close it out if the request can no longer award; otherwise re-send the SAME
 * selection under the SAME key — but only after the in-flight lease lapses, and
 * only while the mandate (for a mandate grant) still authorises it right now.
 */
async function reconcilePendingExecution(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
): Promise<SelectResult> {
  const principal = principalOf(input.actor, input.cityId);
  const settled = await settleByAwardQuery(deps, input, authority, execution);
  if (settled !== null) {
    return settled;
  }

  const now = deps.now();
  const snapshot = await port(deps).viewOffers(principal, execution.requestId);
  if (snapshot === null || !requestCanStillAward(snapshot.request, now)) {
    await closeExecutionFailed(
      deps,
      input,
      authority,
      execution,
      "request_closed_without_award",
    );
    throw new ContractError(
      "conflict",
      "this authorization was already spent and no award exists; re-authorize to try again",
      { reason: "grant_spent_no_award" },
    );
  }

  const claimed = await claimRetryLease(
    deps.db,
    execution,
    now,
    deps.limits.selectLeaseSeconds,
  );
  if (claimed === null) {
    throw new ContractError(
      "conflict",
      "a selection under this authorization is still in progress; try again shortly",
      { reason: "selection_in_progress", executionId: execution.id },
    );
  }

  if (authority.kind === "mandate") {
    // A NEW attempt is an effect: pause / revoke / expiry stop it. The earlier
    // attempt may still land, so the execution and its reservation stay
    // pending for reconciliation rather than being released here.
    const mandate = await deps.db.mandate.findUnique({
      where: { id: authority.mandateId },
    });
    const refused = mandateScopeRefusal(
      mandate,
      await mandateFacts(deps, {
        actor: input.actor,
        cityId: input.cityId,
        scope: input.scope,
        stage: "select",
        vehicleClass: snapshot.request.vehicleClass,
        amountMinor: Number(execution.fareMinor),
      }),
    );
    if (refused !== null) {
      await refuseForMandate(
        deps,
        input.actor,
        "mp.select",
        execution.grantId,
        {
          ...refused,
          details: { ...refused.details, executionPending: "true" },
        },
        { executionId: execution.id, requestId: execution.requestId },
      );
    }
  }

  return attemptAward(deps, input, authority, claimed, principal);
}

/** Converge on an award a prior selection under this grant already produced. */
async function convergeOnAward(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
): Promise<SelectResult> {
  const award = await port(deps).getAward(
    principalOf(input.actor, input.cityId),
    input.requestId,
  );
  if (award === null) {
    // The grant was spent but no award exists and no execution was recorded
    // for it. This never double-charges; a new grant is required to try again.
    throw new ContractError(
      "conflict",
      "this authorization was already spent and no award exists; re-authorize to try again",
      { reason: "grant_spent_no_award" },
    );
  }
  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async (tx) => {
    if (authority.kind === "mandate") {
      await writeMandateReceipt(tx, authority.mandateId, input, award);
    }
    return {
      result: null,
      aiActions: [
        selectionDone(deps, input, authority, award, true, actorType),
      ],
    };
  });
  return { award, converged: true };
}

/** An award in one of these states moved no money: its allowance is released. */
function awardMovedNoMoney(award: MpAward): boolean {
  return award.state === "failed" || award.state === "compensated";
}

/**
 * Closes an execution on its award, exactly once: the pending → awarded move is
 * a guarded UPDATE, so only the first caller commits (or, for an award that
 * failed, releases) the allowance and emits the run event. Every caller gets
 * the receipt row (idempotent) and its own converged audit line.
 */
async function closeExecutionAwarded(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
  award: MpAward,
  outcome: { readonly converged: boolean; readonly pickupPin?: string },
): Promise<SelectResult> {
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  const noMoney = awardMovedNoMoney(award);
  await auditedTransaction(deps.db, async (tx) => {
    const moved = await tx.askMpExecution.updateMany({
      where: { id: execution.id, status: "pending" },
      data: {
        status: "awarded",
        awardId: award.awardId,
        reasonCode: noMoney ? `award_${award.state}` : null,
        resolvedAt: now,
      },
    });
    const first = moved.count === 1;
    const events: OutboxInput[] = [];
    if (first && execution.reservationId !== null) {
      await settleMandateAllowance(
        tx,
        noMoney
          ? {
              reservationId: execution.reservationId,
              action: "release",
              reasonCode: `award_${award.state}`,
              resultRef: award.awardId,
              now,
            }
          : {
              reservationId: execution.reservationId,
              action: "commit",
              actualMinor: award.fareMinor,
              resultRef: award.awardId,
              reasonCode:
                award.fareMinor > Number(execution.fareMinor)
                  ? "actual_exceeds_reserved"
                  : null,
              now,
            },
      );
    }
    if (authority.kind === "mandate" && !noMoney) {
      await writeMandateReceipt(tx, authority.mandateId, input, award);
      if (first) {
        events.push({
          name: "mandate.run.executed",
          aggregateType: "askMpExecution",
          aggregateId: execution.id,
          fromVersion: 1,
          toVersion: 2,
          actor: input.actor,
          actorType: "mandate",
          cityId: input.cityId,
          idempotencyKey: `mandate.run.executed:${execution.id}`,
          correlationId: input.correlationId ?? null,
          occurredAt: now,
          payload: {
            mandateId: authority.mandateId,
            executionId: execution.id,
            grantId: execution.grantId,
            resultRef: award.awardId,
            amount: {
              amountMinor: award.fareMinor,
              currency: input.scope.currency,
            },
          },
        });
      }
    }
    return {
      result: null,
      aiActions: [
        selectionDone(
          deps,
          input,
          authority,
          award,
          outcome.converged,
          actorType,
        ),
      ],
      events,
    };
  });
  return {
    award,
    pickupPin: outcome.pickupPin,
    converged: outcome.converged,
  };
}

/**
 * Closes an execution that definitively did not award, exactly once, releasing
 * its allowance reservation (budget + run) back to the period.
 */
async function closeExecutionFailed(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  execution: MpExecution,
  reasonCode: string,
): Promise<void> {
  const now = deps.now();
  const actorType = actorKindFor(input.actor.role);
  await auditedTransaction(deps.db, async (tx) => {
    const moved = await tx.askMpExecution.updateMany({
      where: { id: execution.id, status: "pending" },
      data: { status: "failed", reasonCode, resolvedAt: now },
    });
    const first = moved.count === 1;
    const events: OutboxInput[] = [];
    if (first && execution.reservationId !== null) {
      await settleMandateAllowance(tx, {
        reservationId: execution.reservationId,
        action: "release",
        reasonCode,
        now,
      });
    }
    if (first && authority.kind === "mandate") {
      events.push({
        name: "mandate.run.blocked",
        aggregateType: "askMpExecution",
        aggregateId: execution.id,
        fromVersion: 1,
        toVersion: 2,
        actor: input.actor,
        actorType: "mandate",
        cityId: input.cityId,
        idempotencyKey: `mandate.run.blocked:${execution.id}`,
        correlationId: input.correlationId ?? null,
        occurredAt: now,
        payload: {
          mandateId: authority.mandateId,
          executionId: execution.id,
          reasonCode,
          resultRef: execution.requestId,
        },
      });
    }
    return {
      result: null,
      aiActions: [
        {
          actorKind: authority.kind === "mandate" ? "mandate" : actorType,
          actorRef: input.actor.id,
          threadId: null,
          action: "mp.select",
          model: deps.model.model,
          modelRevision: deps.model.revision,
          authKind: authKindOf(authority),
          authRef: execution.grantId,
          outcome: "refused" as const,
          reasonCode,
          providerRefs: [execution.requestId],
          redactedInputs: {
            executionId: execution.id,
            requestId: execution.requestId,
            bidId: execution.bidId,
            released: first && execution.reservationId !== null,
          } satisfies JsonRecord,
        },
      ],
      events,
    };
  });
}

/**
 * A per-award mandate receipt; the unique (mandateId, triggerRef) makes a replay
 * land on the same row.
 */
async function writeMandateReceipt(
  tx: AuditedTx,
  mandateId: string,
  input: SelectInput,
  award: MpAward,
): Promise<void> {
  const triggerRef = `mp.select:${award.requestId}`;
  const already = await tx.mandateExecution.findUnique({
    where: { mandateId_triggerRef: { mandateId, triggerRef } },
  });
  if (already === null) {
    await tx.mandateExecution.create({
      data: {
        id: generateId("mex"),
        mandateId,
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

function selectionDone(
  deps: AskDeps,
  input: SelectInput,
  authority: GrantAuthority,
  award: MpAward,
  converged: boolean,
  actorType: ReturnType<typeof actorKindFor>,
) {
  return {
    actorKind: authority.kind === "mandate" ? ("mandate" as const) : actorType,
    actorRef: input.actor.id,
    threadId: null,
    action: "mp.select",
    model: deps.model.model,
    modelRevision: deps.model.revision,
    authKind: authKindOf(authority),
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
  };
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
  /** Optional restatement; authority comes from the grant and must match it. */
  readonly mandateId?: string;
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
  const authority = authorityFromGrant(grant, input.mandateId);
  if (authority.kind === "mandate") {
    // Cancelling spends nothing, but it is still an action taken under the
    // mandate: a paused, revoked or expired one stops it too.
    await checkMandate(deps, {
      actor: input.actor,
      cityId: input.cityId,
      scope: input.scope,
      mandateId: authority.mandateId,
      stage: "cancel",
      vehicleClass: input.scope.vehicleClass,
      amountMinor: null,
      headroomMinor: null,
      auditAction: "mp.cancel",
      authRef: input.grantId,
    });
  }
  // The grant authorises cancelling ITS negotiation only: the request must be
  // the caller's, inside the scope and published from the grant's quote — never
  // another of the user's requests (e.g. one they booked themselves).
  const principal = principalOf(input.actor, input.cityId);
  const snapshot = await port(deps).viewOffers(principal, input.requestId);
  if (snapshot === null || snapshot.request.requesterId !== input.actor.id) {
    throw new ContractError("not_found", "no such request");
  }
  assertRequestInScope(snapshot.request, input.scope);
  if (snapshot.request.quoteId !== grant.resourceRef) {
    throw new ContractError("forbidden", "the request is outside the grant", {
      reason: "quote_mismatch",
    });
  }
  const idempotencyKey = wireKey(
    "mp.cancel",
    input.actor.id,
    input.grantId,
    input.requestId,
  );
  const request = await port(deps).cancel(
    principal,
    input.requestId,
    idempotencyKey,
  );
  await recordAction(deps, {
    actor: input.actor,
    action: "mp.cancel",
    authKind: authKindOf(authority),
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
  readonly mandateId: string | null;
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
  const grant: LiveGrantRow | null = await deps.db.actionGrant.findUnique({
    where: { id: grantId },
  });
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
  // The service decides which mandate action authorises the selection
  // (marketplace.ride.select vs marketplace.delivery.select), so the scope's
  // declared service must be the AUTHORITATIVE request's: a ride-scoped grant
  // (or mandate) never selects a delivery offer, and vice versa.
  if (request.service !== scope.service) {
    throw new ContractError(
      "forbidden",
      "the request service is out of scope",
      {
        reason: "service_mismatch",
      },
    );
  }
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

function findSelectableOffer(
  snapshot: MpSnapshot,
  bidId: string,
  now: Date,
): MpOffer {
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
  // An expired bid cannot win; refuse before the grant is spent on it.
  if (Date.parse(offer.expiresAt) <= now.getTime()) {
    throw new ContractError("conflict", "that offer has expired", {
      reason: "offer_expired",
    });
  }
  return offer;
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
