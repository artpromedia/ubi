/**
 * Fixtures and wiring for the ask-service tests.
 *
 * They run against a real PostgreSQL database, because most of what they assert
 * only exists there: the single-use grant consume (a conditional UPDATE), the
 * transactional ai_actions + outbox rows, the FK from a review to its grant, and
 * the state-machine transitions. Every fake lives here and nowhere near `src/`.
 *
 * The `DeterministicModelProvider` does REAL tool-selection over the strict
 * schemas the loop hands it: it reads `@tool <name> <json>` directives from the
 * user's message, selects those tools, and emits the arguments verbatim for the
 * tool's zod schema to accept or reject. It also models a COMPROMISED model: an
 * `@obey <name> <json>` directive appearing anywhere in the context it is given —
 * including a retrieved policy document or a tool result — makes it comply,
 * which is exactly how the prompt-injection tests prove the server, not the
 * model, decides permissions.
 */
import { PrismaClient } from "@prisma/client";

import { ContractError } from "@ubi/contracts";

import { createHashEmbeddingProvider } from "../src/ai/embedding-provider";
import { createRetriever, type Retriever } from "../src/ai/rag";
import { createFlagProvider } from "../src/ops/flags";
import {
  DEFAULT_LIMITS,
  type AskDeps,
  type AskLimits,
} from "../src/ops/context";

import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from "../src/ai/model-provider";
import type {
  RidePort,
  RideQuote,
  RideQuoteInput,
  RideStatusResult,
} from "../src/ports/ride-port";
import type {
  BookInput,
  BookedItem,
  BookingStatusResult,
  ExecutionOrderRef,
  FlightSearchInput,
  ResolvedOffer,
  StaySearchInput,
  TravelOffer,
  TravelPort,
} from "../src/ports/travel-port";
import type {
  EligibilityInput,
  EligibilityResult,
  IncentiveExplanation,
  PromotionsPort,
} from "../src/ports/promotions-port";
import {
  assertMintBinding,
  type GrantAssurance,
  type GrantMintRequest,
  type GrantPort,
  type MintedGrant,
} from "../src/ports/grant-port";
import {
  presentOffersForReview,
  MarketplaceTimeoutError,
  type MarketplacePort,
  type MpAward,
  type MpOffer,
  type MpQuote,
  type MpQuoteInput,
  type MpPrepareInput,
  type MpRequest,
  type MpSelectInput,
  type MpSelectResult,
  type MpSnapshot,
  type SanitizedOffer,
} from "../src/ports/marketplace-port";
import type {
  OpenCaseInput,
  OpenedCase,
  SupportPort,
} from "../src/ports/support-port";
import type { Actor, AskDb } from "../src/ops/types";

export const TEST_DATABASE_URL =
  process.env.ASK_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_ask_test";

let client: PrismaClient | undefined;

export function testDb(): AskDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as AskDb;
}

export async function closeTestDb(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${process.pid.toString(36)}_${Date.now().toString(36)}_${counter}`;
}

export function idemKey(label = "k"): string {
  return uid(label).replace(/[^A-Za-z0-9_.:-]/g, "-");
}

// ---------------------------------------------------------------------------
// City + flags
// ---------------------------------------------------------------------------

export interface SeedCityOptions {
  readonly aiAssistant?: boolean;
  readonly aiTransactions?: boolean;
  readonly aiMarketplace?: boolean;
}

export async function seedCity(
  db: AskDb,
  options: SeedCityOptions = {},
): Promise<string> {
  const cityId = uid("city");
  await db.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone: "Africa/Lagos",
      active: true,
    },
  });
  const flags: Record<string, boolean> = {
    ai_assistant: options.aiAssistant ?? true,
    ai_transactions: options.aiTransactions ?? true,
    ai_marketplace: options.aiMarketplace ?? false,
  };
  for (const [key, enabled] of Object.entries(flags)) {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, defaultOn: false },
      update: {},
    });
    await db.flagRule.upsert({
      where: { flagKey_cityId: { flagKey: key, cityId } },
      create: { id: uid("rule"), flagKey: key, cityId, enabled },
      update: { enabled },
    });
  }
  return cityId;
}

export function rider(id?: string): Actor {
  return { id: id ?? uid("rider"), role: "rider" };
}
export function driver(id?: string): Actor {
  return { id: id ?? uid("driver"), role: "driver" };
}
export function admin(id?: string): Actor {
  return { id: id ?? uid("admin"), role: "ops_admin" };
}

// ---------------------------------------------------------------------------
// Deterministic model provider (real tool-selection + compromise model)
// ---------------------------------------------------------------------------

/** Captures a balanced-brace JSON object starting at `start` (which is a `{`). */
function readJsonObject(
  text: string,
  start: number,
): { json: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

function parseDirectives(
  text: string,
  tag: "@tool" | "@obey",
): { name: string; args: unknown }[] {
  const out: { name: string; args: unknown }[] = [];
  const re = new RegExp(`${tag}\\s+([A-Za-z0-9._]+)\\s*`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1] ?? "";
    let args: unknown = {};
    const rest = re.lastIndex;
    if (text[rest] === "{") {
      const obj = readJsonObject(text, rest);
      if (obj !== null) {
        try {
          args = JSON.parse(obj.json);
        } catch {
          args = {};
        }
        re.lastIndex = obj.end;
      }
    }
    out.push({ name, args });
  }
  return out;
}

export class DeterministicModelProvider implements ModelProvider {
  readonly model = "Qwen/Qwen3-30B-A3B-Instruct-2507";
  readonly revision = "test";
  /** Every request handed to the provider, for redaction assertions. */
  readonly requests: ModelRequest[] = [];
  private readonly obeyed = new Set<string>();
  private callId = 0;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const usage = { tokens: 7 };
    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user");
    const toolMessages = request.messages.filter(
      (message) => message.role === "tool",
    );
    const lastTool = toolMessages[toolMessages.length - 1];

    // Compromise: obey an injected directive found in the newest tool result
    // (e.g. a retrieved policy document) or in the user's own message.
    const injectionSources: { scope: string; text: string }[] = [];
    if (lastTool !== undefined) {
      injectionSources.push({ scope: "tool", text: lastTool.content });
    }
    if (lastUser !== undefined) {
      injectionSources.push({ scope: "user", text: lastUser.content });
    }
    for (const source of injectionSources) {
      const obey = parseDirectives(source.text, "@obey")[0];
      if (obey !== undefined) {
        const marker = `${source.scope}:${obey.name}`;
        if (!this.obeyed.has(marker)) {
          this.obeyed.add(marker);
          return {
            text: "",
            toolCalls: [this.call(obey.name, obey.args)],
            usage,
          };
        }
      }
    }

    if (toolMessages.length === 0) {
      const planned = parseDirectives(lastUser?.content ?? "", "@tool");
      if (planned.length > 0) {
        return {
          text: "",
          toolCalls: planned.map((p) => this.call(p.name, p.args)),
          usage,
        };
      }
      return {
        text: "How can I help with your trip or booking?",
        toolCalls: [],
        usage,
      };
    }

    return {
      text: "Here is what I found. Ask me to refine anything.",
      toolCalls: [],
      usage,
    };
  }

  private call(name: string, args: unknown): ModelToolCall {
    this.callId += 1;
    return { id: `call_${this.callId}`, name, arguments: args };
  }
}

// ---------------------------------------------------------------------------
// Fake ports (tests only) — real DB rows where a constraint must be exercised
// ---------------------------------------------------------------------------

export interface FakeTrip {
  readonly ownerId: string;
  readonly state: string;
  readonly driverEtaMinutes?: number;
}

export class FakeRidePort implements RidePort {
  constructor(
    private readonly trips: Map<string, FakeTrip> = new Map(),
    private readonly currency = "NGN",
  ) {}

  setTrip(tripId: string, trip: FakeTrip): void {
    this.trips.set(tripId, trip);
  }

  async quote(_actor: Actor, input: RideQuoteInput): Promise<RideQuote> {
    return {
      quoteId: uid("q"),
      vehicleClass: input.vehicleClass ?? "go",
      priceMinor: 250_000,
      currency: this.currency,
      quotedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      etaMinutes: 4,
    };
  }

  async status(actor: Actor, tripId: string): Promise<RideStatusResult | null> {
    const trip = this.trips.get(tripId);
    // Ownership is from the actor in context, never from the tool arg.
    if (trip === undefined || trip.ownerId !== actor.id) {
      return null;
    }
    return {
      tripId,
      state: trip.state,
      driverEtaMinutes: trip.driverEtaMinutes ?? null,
    };
  }
}

export interface FakeOfferOutcome {
  readonly state: string;
  readonly charged?: number;
}

export class FakeTravelPort implements TravelPort {
  readonly booked: BookInput[] = [];
  private readonly offers = new Map<string, ResolvedOffer>();
  private readonly outcomes = new Map<string, FakeOfferOutcome>();
  private readonly orders = new Map<
    string,
    { ownerId: string; state: string }
  >();
  searchResults: TravelOffer[] = [];

  setOffer(
    offer: ResolvedOffer,
    outcome: FakeOfferOutcome = { state: "confirmed" },
  ): void {
    this.offers.set(offer.offerRef, offer);
    this.outcomes.set(offer.offerRef, outcome);
  }

  removeOffer(offerRef: string): void {
    this.offers.delete(offerRef);
  }

  setOrder(orderId: string, ownerId: string, state: string): void {
    this.orders.set(orderId, { ownerId, state });
  }

  async searchFlights(
    _actor: Actor,
    _input: FlightSearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]> {
    return this.searchResults.slice(0, limit);
  }
  async searchStays(
    _actor: Actor,
    _input: StaySearchInput,
    limit: number,
  ): Promise<readonly TravelOffer[]> {
    return this.searchResults.slice(0, limit);
  }
  async resolveOffer(
    _actor: Actor,
    offerRef: string,
  ): Promise<ResolvedOffer | null> {
    return this.offers.get(offerRef) ?? null;
  }
  async bookingStatus(
    actor: Actor,
    orderId: string,
  ): Promise<BookingStatusResult | null> {
    const order = this.orders.get(orderId);
    if (order === undefined || order.ownerId !== actor.id) {
      return null;
    }
    return { orderId, state: order.state, supplierRef: null };
  }
  async executionOrderStatus(
    ref: ExecutionOrderRef,
  ): Promise<BookingStatusResult | null> {
    const order = this.orders.get(ref.orderId);
    if (order === undefined || order.ownerId !== ref.actorId) {
      return null;
    }
    return { orderId: ref.orderId, state: order.state, supplierRef: null };
  }
  async book(_actor: Actor, input: BookInput): Promise<BookedItem> {
    this.booked.push(input);
    const offer = this.offers.get(input.offerRef);
    const outcome = this.outcomes.get(input.offerRef) ?? { state: "confirmed" };
    const kind: "flight" | "stay" = offer?.kind === "stay" ? "stay" : "flight";
    if (outcome.state === "failed_released") {
      return {
        kind,
        state: "failed_released",
        orderId: null,
        supplierRef: null,
        chargedMinor: null,
        releasedMinor: offer?.priceMinor ?? null,
        detail: "supplier declined",
      };
    }
    return {
      kind,
      state: outcome.state,
      orderId: uid("ord"),
      supplierRef: uid("PNR"),
      chargedMinor: outcome.charged ?? offer?.priceMinor ?? null,
      releasedMinor: null,
      detail: null,
    };
  }
}

export class FakePromotionsPort implements PromotionsPort {
  eligibilityResult: EligibilityResult = {
    covered: false,
    adjustments: [],
    notes: ["No active promotion for you right now."],
  };
  private readonly incentives = new Map<string, IncentiveExplanation>();

  setIncentive(explanation: IncentiveExplanation): void {
    this.incentives.set(explanation.postingId, explanation);
  }

  async eligibility(
    _actor: Actor,
    _input: EligibilityInput,
  ): Promise<EligibilityResult> {
    return this.eligibilityResult;
  }
  async explainIncentive(
    _actor: Actor,
    postingId: string,
  ): Promise<IncentiveExplanation | null> {
    return this.incentives.get(postingId) ?? null;
  }
}

/**
 * Mints REAL action_grants rows so the single-use + expiry guards run for real.
 * Like user-service's mint (grants.ts insertGrant) it persists the assurance and
 * the originating mandate exactly as asked, and replays the original row for a
 * reused idempotency key.
 */
export class FakeGrantPort implements GrantPort {
  readonly minted: GrantMintRequest[] = [];

  constructor(private readonly db: AskDb) {}

  async mint(request: GrantMintRequest): Promise<MintedGrant> {
    assertMintBinding(request);
    this.minted.push(request);
    const existing = await this.db.actionGrant.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
    });
    if (existing !== null) {
      return {
        grantId: existing.id,
        expiresAt: existing.expiresAt.toISOString(),
        assurance: existing.assurance as GrantAssurance,
      };
    }
    const grantId = uid("grn");
    await this.db.actionGrant.create({
      data: {
        id: grantId,
        actorId: request.actorId,
        action: request.action,
        resourceRef: request.resourceRef,
        provider: request.provider ?? null,
        termsVersion: request.termsVersion,
        totalMinor: BigInt(request.totalMinor),
        currency: request.currency,
        idempotencyKey: request.idempotencyKey,
        assurance: request.assurance,
        mandateId: request.mandateId ?? null,
        expiresAt: request.expiresAt,
      },
    });
    return {
      grantId,
      expiresAt: request.expiresAt.toISOString(),
      assurance: request.assurance,
    };
  }
}

export class FakeSupportPort implements SupportPort {
  readonly cases: OpenCaseInput[] = [];

  async openCase(input: OpenCaseInput): Promise<OpenedCase> {
    this.cases.push(input);
    return { supportCaseId: uid("case"), estimatedWaitSec: 120 };
  }
}

/**
 * A faithful in-memory marketplace. It models the properties the C10 tests turn
 * on: publish awards nothing; select is idempotent on its key and one request
 * yields exactly one award; a timed-out select still records the award so the
 * caller converges by querying; and there is deliberately NO method to bypass a
 * stationary gate or to auto-bid. It never charges twice.
 */
export class FakeMarketplacePort implements MarketplacePort {
  readonly selectCalls: MpSelectInput[] = [];
  readonly prepareCalls: MpPrepareInput[] = [];
  /** Number of DISTINCT awards actually created — the "charge count". */
  awardsCreated = 0;
  /** When set, the next select() records the award then throws a timeout. */
  timeoutNextSelect = false;
  /** When set, the next select() throws award_unresolved (races a pending award). */
  unresolvedNextSelect = false;
  /**
   * When set, the next select() is LOST in transit: it times out and the
   * marketplace never saw it (no award, nothing stored under its key).
   */
  loseNextSelect = false;
  /**
   * When set, the next select() lands but its answer is delayed past the
   * caller's timeout: the award is stored under its key and becomes visible to
   * getAward/viewOffers only once `landDelayedAwards()` runs (or a replay of
   * the same key arrives).
   */
  delayNextSelect = false;
  /** When set, the next select() dies with a non-contract error before sending. */
  crashNextSelect = false;
  /** When set, the next select() is definitively refused with this error. */
  refuseNextSelect: ContractError | null = null;
  /** When set, the next prepareRequest() fails with this error (nothing stored). */
  failNextPrepare: ContractError | null = null;
  /** Runs inside viewOffers — lets a test race a change against a selection. */
  onViewOffers: (() => Promise<void>) | null = null;
  /**
   * Runs at the start of select() — lets a test land a racing award AFTER the
   * caller read its snapshot but before its selection arrives.
   */
  onSelect: (() => void) | null = null;
  /** The marketplace's clock (request expiry); a test with its own clock sets it. */
  now: () => Date = () => new Date();
  private readonly delayed = new Map<string, MpAward>();

  private readonly quotes = new Map<string, MpQuote>();
  private readonly requests = new Map<string, MpRequest>();
  private readonly offersByRequest = new Map<string, MpOffer[]>();
  private readonly awardByRequest = new Map<string, MpAward>();
  private readonly awardByKey = new Map<string, MpAward>();
  private readonly requestByPrepareKey = new Map<string, MpRequest>();

  setQuote(quote: MpQuote): void {
    this.quotes.set(quote.quoteId, quote);
  }

  seedRequest(request: MpRequest): void {
    this.requests.set(request.requestId, request);
  }

  seedAward(award: MpAward): void {
    this.awardByRequest.set(award.requestId, award);
  }

  setOffers(requestId: string, offers: MpOffer[]): void {
    this.offersByRequest.set(requestId, offers);
  }

  async quote(_actor: Actor, input: MpQuoteInput): Promise<MpQuote> {
    const existing = [...this.quotes.values()].find(
      (q) =>
        q.service === input.service && q.vehicleClass === input.vehicleClass,
    );
    if (existing !== undefined) {
      return existing;
    }
    const quote: MpQuote = {
      quoteId: uid("mpq"),
      service: input.service,
      vehicleClass: input.vehicleClass,
      cityId: "city_default",
      currency: "NGN",
      suggestedFareMinor: 200_000,
      minimumFareMinor: 150_000,
      maximumFareMinor: 400_000,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      pricingVersion: "pv1",
      policyVersion: 1,
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  async prepareRequest(
    actor: Actor,
    input: MpPrepareInput,
  ): Promise<MpRequest> {
    this.prepareCalls.push(input);
    if (this.failNextPrepare !== null) {
      const failure = this.failNextPrepare;
      this.failNextPrepare = null;
      throw failure;
    }
    const replay = this.requestByPrepareKey.get(input.idempotencyKey);
    if (replay !== undefined) {
      return replay;
    }
    const quote = this.quotes.get(input.quoteId);
    const request: MpRequest = {
      requestId: uid("mpr"),
      state: "open",
      revision: 0,
      version: 1,
      service: quote?.service ?? "ride",
      vehicleClass: quote?.vehicleClass ?? "go",
      cityId: quote?.cityId ?? "city_default",
      currency: quote?.currency ?? input.currency,
      requesterId: actor.id,
      quoteId: input.quoteId,
      requestedFareMinor: input.requestedFareMinor,
      expiresAt: new Date(this.now().getTime() + 120_000).toISOString(),
    };
    this.requests.set(request.requestId, request);
    this.requestByPrepareKey.set(input.idempotencyKey, request);
    return request;
  }

  /** Makes every delayed award visible, as if its answer finally arrived. */
  landDelayedAwards(): void {
    for (const [requestId, award] of this.delayed) {
      this.awardByRequest.set(requestId, award);
    }
    this.delayed.clear();
  }

  async viewOffers(
    actor: Actor,
    requestId: string,
  ): Promise<MpSnapshot | null> {
    if (this.onViewOffers !== null) {
      const hook = this.onViewOffers;
      this.onViewOffers = null;
      await hook();
    }
    const request = this.requests.get(requestId);
    if (request === undefined || request.requesterId !== actor.id) {
      return null;
    }
    return {
      request,
      offers: this.offersByRequest.get(requestId) ?? [],
      award: this.awardByRequest.get(requestId) ?? null,
      seq: 1,
    };
  }

  reviewOffer(offers: readonly MpOffer[]): readonly SanitizedOffer[] {
    return presentOffersForReview(offers);
  }

  async getAward(actor: Actor, requestId: string): Promise<MpAward | null> {
    const request = this.requests.get(requestId);
    if (request === undefined || request.requesterId !== actor.id) {
      return null;
    }
    return this.awardByRequest.get(requestId) ?? null;
  }

  async select(actor: Actor, input: MpSelectInput): Promise<MpSelectResult> {
    this.selectCalls.push(input);
    if (this.onSelect !== null) {
      const hook = this.onSelect;
      this.onSelect = null;
      hook();
    }
    // An ambiguous, racing outcome: the award may or may not exist yet. The
    // caller must converge by querying, never resubmit.
    if (this.unresolvedNextSelect) {
      this.unresolvedNextSelect = false;
      throw new ContractError(
        "award_unresolved",
        "a selection is already pending for this request",
      );
    }
    if (this.crashNextSelect) {
      this.crashNextSelect = false;
      throw new Error("the process died before the selection was sent");
    }
    if (this.loseNextSelect) {
      this.loseNextSelect = false;
      throw new MarketplaceTimeoutError(
        "the selection did not confirm in time",
      );
    }
    if (this.refuseNextSelect !== null) {
      const refusal = this.refuseNextSelect;
      this.refuseNextSelect = null;
      throw refusal;
    }
    // Idempotent on the key: an exact replay returns the same award.
    const byKey = this.awardByKey.get(input.idempotencyKey);
    if (byKey !== undefined) {
      if (this.delayed.has(input.requestId)) {
        this.delayed.delete(input.requestId);
        this.awardByRequest.set(input.requestId, byKey);
      }
      return { award: byKey };
    }
    if (this.delayed.has(input.requestId)) {
      // An award is resolving for this request under another key.
      throw new ContractError(
        "award_unresolved",
        "a selection is already pending for this request",
      );
    }
    const existing = this.awardByRequest.get(input.requestId);
    if (existing !== undefined) {
      if (existing.bidId === input.bidId) {
        return { award: existing };
      }
      // A different selection racing the resolved award.
      throw new ContractError(
        "award_unresolved",
        "an award already exists for this request",
      );
    }

    const request = this.requests.get(input.requestId);
    const offer = (this.offersByRequest.get(input.requestId) ?? []).find(
      (o) => o.bidId === input.bidId,
    );
    const award: MpAward = {
      awardId: uid("mpaw"),
      requestId: input.requestId,
      bidId: input.bidId,
      state: "confirmed",
      requestVersion: input.requestVersion,
      bidVersion: input.bidVersion,
      driverId: uid("drv"),
      requesterId: actor.id,
      fareMinor: offer?.totalMinor ?? offer?.amountMinor ?? 0,
      commissionMinor: Math.round((offer?.amountMinor ?? 0) * 0.1),
      slot: "current",
      createdAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    };
    // Record BEFORE the possible timeout so the caller can converge by querying.
    this.awardsCreated += 1;
    this.awardByKey.set(input.idempotencyKey, award);
    if (request !== undefined) {
      this.requests.set(input.requestId, { ...request, state: "awarded" });
    }
    if (this.delayNextSelect) {
      this.delayNextSelect = false;
      this.delayed.set(input.requestId, award);
      throw new MarketplaceTimeoutError(
        "the selection did not confirm in time",
      );
    }
    this.awardByRequest.set(input.requestId, award);
    if (this.timeoutNextSelect) {
      this.timeoutNextSelect = false;
      throw new MarketplaceTimeoutError(
        "the selection did not confirm in time",
      );
    }
    return { award, pickupPin: "482913" };
  }

  async cancel(
    actor: Actor,
    requestId: string,
    _idempotencyKey: string,
  ): Promise<MpRequest> {
    const request = this.requests.get(requestId);
    if (request === undefined || request.requesterId !== actor.id) {
      throw new ContractError("not_found", "no such request");
    }
    const cancelled: MpRequest = {
      ...request,
      state: "cancelled",
      closeReason: "cancelled",
    };
    this.requests.set(requestId, cancelled);
    return cancelled;
  }
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface DepsOverrides {
  readonly model?: ModelProvider;
  readonly ride?: RidePort;
  readonly travel?: TravelPort;
  readonly marketplace?: MarketplacePort;
  readonly promotions?: PromotionsPort;
  readonly grants?: GrantPort;
  readonly support?: SupportPort;
  readonly retriever?: Retriever;
  readonly now?: () => Date;
  readonly limits?: Partial<AskLimits>;
}

export interface TestDeps extends AskDeps {
  readonly model: ModelProvider;
  readonly ride: FakeRidePort;
  readonly travel: FakeTravelPort;
  readonly marketplace: FakeMarketplacePort;
  readonly promotions: FakePromotionsPort;
  readonly grants: FakeGrantPort;
  readonly support: FakeSupportPort;
}

export function makeDeps(db: AskDb, overrides: DepsOverrides = {}): TestDeps {
  const embedder = createHashEmbeddingProvider();
  const model = overrides.model ?? new DeterministicModelProvider();
  const ride = (overrides.ride ?? new FakeRidePort()) as FakeRidePort;
  const travel = (overrides.travel ?? new FakeTravelPort()) as FakeTravelPort;
  const marketplace = (overrides.marketplace ??
    new FakeMarketplacePort()) as FakeMarketplacePort;
  const promotions = (overrides.promotions ??
    new FakePromotionsPort()) as FakePromotionsPort;
  const grants = (overrides.grants ?? new FakeGrantPort(db)) as FakeGrantPort;
  const support = (overrides.support ??
    new FakeSupportPort()) as FakeSupportPort;
  return {
    db,
    flags: createFlagProvider(db),
    model,
    embedder,
    retriever: overrides.retriever ?? createRetriever(embedder),
    ride,
    travel,
    marketplace,
    promotions,
    grants,
    support,
    limits: { ...DEFAULT_LIMITS, ...overrides.limits },
    now: overrides.now ?? (() => new Date()),
  };
}

export function offer(
  overrides: Partial<ResolvedOffer> & { offerRef: string },
): ResolvedOffer {
  return {
    offerRef: overrides.offerRef,
    kind: overrides.kind ?? "flight",
    title: overrides.title ?? "LOS → ACC",
    detail: overrides.detail ?? null,
    priceMinor: overrides.priceMinor ?? 4_500_000,
    currency: overrides.currency ?? "NGN",
    termsVersion: overrides.termsVersion ?? "v1",
    terms: overrides.terms ?? [{ text: "Non-refundable", tone: "warning" }],
  };
}

// ---------------------------------------------------------------------------
// Marketplace builders (C10)
// ---------------------------------------------------------------------------

export function mpQuote(overrides: Partial<MpQuote> = {}): MpQuote {
  return {
    quoteId: overrides.quoteId ?? uid("mpq"),
    service: overrides.service ?? "ride",
    vehicleClass: overrides.vehicleClass ?? "go",
    cityId: overrides.cityId ?? "city_mp",
    currency: overrides.currency ?? "NGN",
    suggestedFareMinor: overrides.suggestedFareMinor ?? 200_000,
    minimumFareMinor: overrides.minimumFareMinor ?? 150_000,
    maximumFareMinor: overrides.maximumFareMinor ?? 400_000,
    expiresAt:
      overrides.expiresAt ?? new Date(Date.now() + 120_000).toISOString(),
    pricingVersion: overrides.pricingVersion ?? "pv1",
    policyVersion: overrides.policyVersion ?? 1,
  };
}

export function mpRequest(
  overrides: Partial<MpRequest> & { requesterId: string },
): MpRequest {
  return {
    requestId: overrides.requestId ?? uid("mpr"),
    state: overrides.state ?? "open",
    revision: overrides.revision ?? 0,
    version: overrides.version ?? 1,
    service: overrides.service ?? "ride",
    vehicleClass: overrides.vehicleClass ?? "go",
    cityId: overrides.cityId ?? "city_mp",
    currency: overrides.currency ?? "NGN",
    requesterId: overrides.requesterId,
    quoteId: overrides.quoteId ?? uid("mpq"),
    requestedFareMinor: overrides.requestedFareMinor ?? 200_000,
    expiresAt:
      overrides.expiresAt ?? new Date(Date.now() + 120_000).toISOString(),
    closeReason: overrides.closeReason,
  };
}

export function mpOffer(
  overrides: Partial<MpOffer> & { bidId: string },
): MpOffer {
  const amountMinor = overrides.amountMinor ?? 200_000;
  return {
    bidId: overrides.bidId,
    bidVersion: overrides.bidVersion ?? 1,
    requestRevision: overrides.requestRevision ?? 0,
    amountMinor,
    currency: overrides.currency ?? "NGN",
    kind: overrides.kind ?? "immediate",
    driver: overrides.driver ?? {
      displayName: "Driver A",
      initials: "DA",
      rating: "4.9",
      completedTrips: 320,
      vehicle: "go",
      plateMasked: "•••12",
      profileStatus: "verified",
    },
    pickupLabel: overrides.pickupLabel ?? "Near Ikeja",
    expiresAt:
      overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    withdrawn: overrides.withdrawn ?? false,
    whyRecommended: overrides.whyRecommended,
    totalMinor: overrides.totalMinor ?? amountMinor,
  };
}
