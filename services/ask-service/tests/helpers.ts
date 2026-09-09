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

import { createHashEmbeddingProvider } from "../src/ai/embedding-provider";
import { createRetriever, type Retriever } from "../src/ai/rag";
import { createFlagProvider } from "../src/ops/flags";
import { DEFAULT_LIMITS, type AskDeps, type AskLimits } from "../src/ops/context";

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
import type { GrantMintRequest, GrantPort, MintedGrant } from "../src/ports/grant-port";
import type { OpenCaseInput, OpenedCase, SupportPort } from "../src/ports/support-port";
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
function readJsonObject(text: string, start: number): { json: string; end: number } | null {
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
          return { text: "", toolCalls: [this.call(obey.name, obey.args)], usage };
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
      return { text: "How can I help with your trip or booking?", toolCalls: [], usage };
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
  private readonly orders = new Map<string, { ownerId: string; state: string }>();
  searchResults: TravelOffer[] = [];

  setOffer(offer: ResolvedOffer, outcome: FakeOfferOutcome = { state: "confirmed" }): void {
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
  async resolveOffer(_actor: Actor, offerRef: string): Promise<ResolvedOffer | null> {
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

/** Mints REAL action_grants rows so the single-use + expiry guards run for real. */
export class FakeGrantPort implements GrantPort {
  readonly minted: GrantMintRequest[] = [];

  constructor(private readonly db: AskDb) {}

  async mint(request: GrantMintRequest): Promise<MintedGrant> {
    this.minted.push(request);
    const existing = await this.db.actionGrant.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
    });
    if (existing !== null) {
      return {
        grantId: existing.id,
        expiresAt: existing.expiresAt.toISOString(),
        assurance:
          existing.assurance === "biometric" ? "biometric" : "pin",
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
        assurance:
          request.assurance === "biometric" ? "biometric" : "pin",
        expiresAt: request.expiresAt,
      },
    });
    return {
      grantId,
      expiresAt: request.expiresAt.toISOString(),
      assurance: request.assurance === "biometric" ? "biometric" : "pin",
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

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface DepsOverrides {
  readonly model?: ModelProvider;
  readonly ride?: RidePort;
  readonly travel?: TravelPort;
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
  readonly promotions: FakePromotionsPort;
  readonly grants: FakeGrantPort;
  readonly support: FakeSupportPort;
}

export function makeDeps(db: AskDb, overrides: DepsOverrides = {}): TestDeps {
  const embedder = createHashEmbeddingProvider();
  const model = overrides.model ?? new DeterministicModelProvider();
  const ride = (overrides.ride ?? new FakeRidePort()) as FakeRidePort;
  const travel = (overrides.travel ?? new FakeTravelPort()) as FakeTravelPort;
  const promotions = (overrides.promotions ??
    new FakePromotionsPort()) as FakePromotionsPort;
  const grants = (overrides.grants ?? new FakeGrantPort(db)) as FakeGrantPort;
  const support = (overrides.support ?? new FakeSupportPort()) as FakeSupportPort;
  return {
    db,
    flags: createFlagProvider(db),
    model,
    embedder,
    retriever: overrides.retriever ?? createRetriever(embedder),
    ride,
    travel,
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
