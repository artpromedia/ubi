/**
 * Mandate scope, grant → mandate binding, the atomic period allowance and
 * execution recovery for unattended marketplace selection (recheck A03 / P02).
 *
 * Real Postgres throughout: the grant rows, the canonical allowance functions
 * (`mandate_allowance_reserve` / `mandate_allowance_settle`), the share lock on
 * the mandate at the commit boundary and the execution-intent rows are the
 * production ones. Only the marketplace is the in-memory fake, and its failure
 * modes (lost / delayed / crashed / refused selections) model what the HTTP
 * port can actually return.
 *
 * What these prove:
 *   - authority is derived from the STORED grant: an omitted mandateId is still
 *     enforced, a substituted one is refused, a mandate grant with no recorded
 *     mandate runs nothing;
 *   - the full scope is enforced at select, not only at authorize: action,
 *     categories, providers, constraints (city, vehicle class, time window,
 *     unverifiable area), currency and per-run cap;
 *   - concurrent selections exhaust the period run count / budget with EXACTLY
 *     the allowed number succeeding;
 *   - pause / revoke / expiry between proposal and effect is refused, including
 *     a revoke that lands mid-selection (the commit-boundary lock);
 *   - a crash or an ambiguous timeout is reconciled on retry under the SAME
 *     execution and key, with no second grant, award or allowance run.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import {
  authorizeNegotiation,
  cancelRequest,
  fingerprintScope,
  prepareRequest,
  selectOffer,
  type MarketplaceGrantScope,
  type SelectInput,
} from "../src/ops/marketplace";
import {
  closeTestDb,
  FakeMarketplacePort,
  makeDeps,
  mpOffer,
  mpQuote,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

const FARE = 250_000;

let cityId: string;
let actor: Actor;
let clock: Date;

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  cityId = await seedCity(testDb(), { aiMarketplace: true });
  actor = rider();
  clock = new Date();
});

interface MandateSeed {
  readonly status?: string;
  readonly action?: string;
  readonly categories?: string[];
  readonly providers?: string[];
  readonly constraints?: unknown[];
  readonly perRunCapMinor?: number;
  readonly periodCapMinor?: number;
  readonly periodRuns?: number;
  readonly currency?: string;
  readonly expiresAt?: Date;
  readonly userId?: string;
}

async function seedMandate(seed: MandateSeed = {}): Promise<string> {
  const id = uid("mnd");
  await testDb().mandate.create({
    data: {
      id,
      userId: seed.userId ?? actor.id,
      action: seed.action ?? "marketplace.ride.select",
      title: "Commute",
      passengers: "self_only",
      categories: seed.categories ?? ["go"],
      providers: seed.providers ?? [],
      perRunCapMinor: BigInt(seed.perRunCapMinor ?? 300_000),
      periodCapMinor: BigInt(seed.periodCapMinor ?? 3_000_000),
      periodRuns: seed.periodRuns ?? 20,
      currency: seed.currency ?? "NGN",
      constraints: (seed.constraints ?? []) as never,
      status: seed.status ?? "active",
      expiresAt: seed.expiresAt ?? new Date(clock.getTime() + 86_400_000),
    },
  });
  return id;
}

interface World {
  readonly deps: TestDeps;
  readonly mp: FakeMarketplacePort;
  readonly quoteId: string;
  readonly scope: MarketplaceGrantScope;
}

function world(overrides: Partial<MarketplaceGrantScope> = {}): World {
  const mp = new FakeMarketplacePort();
  mp.now = () => clock;
  const quote = mpQuote({ cityId, currency: "NGN", vehicleClass: "go" });
  mp.setQuote(quote);
  const deps = makeDeps(testDb(), { marketplace: mp, now: () => clock });
  const scope: MarketplaceGrantScope = {
    principalId: actor.id,
    actions: ["quote", "prepare", "select", "cancel"],
    service: "ride",
    cityId,
    currency: "NGN",
    maxSpendMinor: 300_000,
    vehicleClass: "go",
    quoteId: quote.quoteId,
    ...overrides,
  };
  return { deps, mp, quoteId: quote.quoteId, scope };
}

interface Negotiation {
  readonly grantId: string;
  readonly requestId: string;
  readonly bidId: string;
  readonly select: SelectInput;
}

/** Authorizes under a mandate, publishes a request and seeds one offer. */
async function negotiate(w: World, mandateId: string): Promise<Negotiation> {
  const { grantId } = await authorizeNegotiation(w.deps, {
    actor,
    cityId,
    scope: w.scope,
    mandateId,
    idempotencyKey: uid("ik"),
  });
  const request = await prepareRequest(w.deps, {
    actor,
    cityId,
    grantId,
    scope: w.scope,
    requestedFareMinor: 200_000,
    paymentMethodId: "pm_wallet",
  });
  const bidId = uid("bid");
  w.mp.setOffers(request.requestId, [
    mpOffer({
      bidId,
      requestRevision: 0,
      amountMinor: FARE,
      totalMinor: FARE,
      expiresAt: new Date(clock.getTime() + 600_000).toISOString(),
    }),
  ]);
  return {
    grantId,
    requestId: request.requestId,
    bidId,
    select: {
      actor,
      cityId,
      grantId,
      scope: w.scope,
      requestId: request.requestId,
      bidId,
      expectedRequestRevision: 0,
      expectedFareMinor: FARE,
    },
  };
}

async function allowanceOf(
  mandateId: string,
): Promise<{ runs: number; amount: number }> {
  const rows = await testDb().mandateAllowance.findMany({
    where: { mandateId },
  });
  return {
    runs: rows.reduce((sum, row) => sum + row.runsUsed, 0),
    amount: rows.reduce((sum, row) => sum + Number(row.amountUsedMinor), 0),
  };
}

async function reservationsOf(mandateId: string) {
  return testDb().mandateAllowanceReservation.findMany({
    where: { mandateId },
    orderBy: { createdAt: "asc" },
  });
}

async function executionOf(grantId: string) {
  return testDb().askMpExecution.findUnique({ where: { grantId } });
}

function advance(seconds: number): void {
  clock = new Date(clock.getTime() + seconds * 1000);
}

// ---------------------------------------------------------------------------
// Authority is derived from the stored grant
// ---------------------------------------------------------------------------

describe("grant → mandate binding", () => {
  it("enforces the grant's mandate when the caller omits mandateId, and commits one allowance run", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);

    const result = await selectOffer(w.deps, n.select); // no mandateId passed
    expect(result.award.state).toBe("confirmed");

    // The mandate was applied although nobody restated it: its allowance was
    // reserved and committed at the award fare, and a receipt was written.
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    const [reservation] = await reservationsOf(mandateId);
    expect(reservation).toMatchObject({
      status: "committed",
      grantId: n.grantId,
      reservedMinor: BigInt(FARE),
      committedMinor: BigInt(FARE),
      resultRef: result.award.awardId,
    });
    const execution = await executionOf(n.grantId);
    expect(execution).toMatchObject({
      status: "awarded",
      mandateId,
      reservationId: reservation?.id,
      awardId: result.award.awardId,
    });
    const receipt = await testDb().mandateExecution.findFirst({
      where: { mandateId, grantId: n.grantId, outcome: "executed" },
    });
    expect(receipt?.receiptRef).toBe(result.award.awardId);
    const events = await testDb().outboxEvent.findMany({
      where: { aggregateId: { in: [n.grantId, execution?.id ?? ""] } },
      select: { name: true },
    });
    expect(events.map((e) => e.name).sort()).toEqual([
      "action_grant.consumed",
      "mandate.run.executed",
    ]);
  });

  it("refuses a substituted mandateId on every action, and awards nothing", async () => {
    const w = world();
    const bound = await seedMandate();
    const other = await seedMandate(); // valid, active, the caller's own
    const n = await negotiate(w, bound);

    await expect(
      selectOffer(w.deps, { ...n.select, mandateId: other }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "mandate_mismatch" },
    });
    await expect(
      prepareRequest(w.deps, {
        actor,
        cityId,
        grantId: n.grantId,
        scope: w.scope,
        requestedFareMinor: 200_000,
        paymentMethodId: "pm_wallet",
        mandateId: other,
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_mismatch" } });
    await expect(
      cancelRequest(w.deps, {
        actor,
        cityId,
        grantId: n.grantId,
        scope: w.scope,
        requestId: n.requestId,
        mandateId: other,
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_mismatch" } });
    expect(w.mp.awardsCreated).toBe(0);
    expect(await allowanceOf(bound)).toEqual({ runs: 0, amount: 0 });
    expect(await allowanceOf(other)).toEqual({ runs: 0, amount: 0 });
  });

  it("an attended (PIN) grant cannot be upgraded by naming a mandate", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const { grantId } = await authorizeNegotiation(w.deps, {
      actor,
      cityId,
      scope: w.scope,
      assurance: { method: "pin", proof: uid("p") },
      idempotencyKey: uid("ik"),
    });
    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId,
        scope: w.scope,
        requestId: uid("mpr"),
        bidId: uid("bid"),
        expectedRequestRevision: 0,
        expectedFareMinor: FARE,
        mandateId,
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_mismatch" } });
  });

  it("a mandate grant with no recorded mandate runs nothing", async () => {
    const w = world();
    const grantId = uid("grn");
    await testDb().actionGrant.create({
      data: {
        id: grantId,
        actorId: actor.id,
        action: "mp.negotiate",
        resourceRef: w.quoteId,
        termsVersion: fingerprintScope(w.scope),
        totalMinor: BigInt(300_000),
        currency: "NGN",
        idempotencyKey: uid("ik"),
        assurance: "mandate",
        mandateId: null,
        expiresAt: new Date(clock.getTime() + 300_000),
      },
    });
    await expect(
      prepareRequest(w.deps, {
        actor,
        cityId,
        grantId,
        scope: w.scope,
        requestedFareMinor: 200_000,
        paymentMethodId: "pm_wallet",
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_binding_missing" } });
    expect(w.mp.prepareCalls).toHaveLength(0);
  });

  it("a replayed authorize key cannot swap the grant's mandate", async () => {
    const w = world();
    const first = await seedMandate();
    const second = await seedMandate();
    const key = uid("ik");
    await authorizeNegotiation(w.deps, {
      actor,
      cityId,
      scope: w.scope,
      mandateId: first,
      idempotencyKey: key,
    });
    await expect(
      authorizeNegotiation(w.deps, {
        actor,
        cityId,
        scope: w.scope,
        mandateId: second,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_mismatch" } });
  });
});

// ---------------------------------------------------------------------------
// Scope is enforced at the effect, not only at authorization
// ---------------------------------------------------------------------------

describe("mandate scope at selection", () => {
  it("a grant bound to a travel mandate cannot select, even if it was minted", async () => {
    // Simulates a grant minted outside the authorize path (or before this fix)
    // carrying a scheduled_ride.book mandate: select checks the action itself.
    const w = world();
    const travel = await seedMandate({ action: "scheduled_ride.book" });
    const grantId = uid("grn");
    await testDb().actionGrant.create({
      data: {
        id: grantId,
        actorId: actor.id,
        action: "mp.negotiate",
        resourceRef: w.quoteId,
        termsVersion: fingerprintScope(w.scope),
        totalMinor: BigInt(300_000),
        currency: "NGN",
        idempotencyKey: uid("ik"),
        assurance: "mandate",
        mandateId: travel,
        expiresAt: new Date(clock.getTime() + 300_000),
      },
    });
    const request = await w.mp.prepareRequest(actor, {
      quoteId: w.quoteId,
      requestedFareMinor: 200_000,
      currency: "NGN",
      paymentMethodId: "pm_wallet",
      idempotencyKey: uid("prep"),
    });
    const bidId = uid("bid");
    w.mp.setOffers(request.requestId, [
      mpOffer({ bidId, amountMinor: FARE, totalMinor: FARE }),
    ]);

    await expect(
      selectOffer(w.deps, {
        actor,
        cityId,
        grantId,
        scope: w.scope,
        requestId: request.requestId,
        bidId,
        expectedRequestRevision: 0,
        expectedFareMinor: FARE,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "mandate_action_not_permitted" },
    });
    expect(w.mp.selectCalls).toHaveLength(0);
    const grant = await testDb().actionGrant.findUnique({
      where: { id: grantId },
    });
    expect(grant?.consumedAt).toBeNull();
  });

  it("an edit that narrows the mandate after authorization stops the selection", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    await testDb().mandate.update({
      where: { id: mandateId },
      data: { categories: ["comfort"] },
    });
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "mandate_category_not_permitted" },
    });
    expect(w.mp.awardsCreated).toBe(0);
  });

  it.each([
    [
      "vehicle class outside the categories",
      { categories: ["comfort"] },
      "mandate_category_not_permitted",
    ],
    [
      "a provider restriction the offer cannot prove",
      { providers: ["fleet_alpha"] },
      "mandate_provider_unverifiable",
    ],
    ["another currency", { currency: "KES" }, "mandate_currency_mismatch"],
    [
      "a city constraint",
      { constraints: [{ key: "city", mode: "allow", values: ["city_abuja"] }] },
      "mandate_constraint_violation",
    ],
    [
      "a vehicle-class constraint that asks",
      {
        constraints: [
          { key: "vehicle_class", mode: "ask", values: ["comfort"] },
        ],
      },
      "mandate_constraint_ask",
    ],
    [
      "an area the request cannot prove",
      {
        constraints: [{ key: "pickup_area", mode: "allow", values: ["ikeja"] }],
      },
      "mandate_constraint_unverifiable",
    ],
    [
      "an always-ask condition",
      { constraints: [{ key: "surge_pricing", mode: "always_ask" }] },
      "mandate_constraint_ask",
    ],
  ])("refuses %s", async (_label, seed, reason) => {
    const w = world();
    const mandateId = await seedMandate(seed as MandateSeed);
    await expect(
      authorizeNegotiation(w.deps, {
        actor,
        cityId,
        scope: w.scope,
        mandateId,
        idempotencyKey: uid("ik"),
      }),
    ).rejects.toMatchObject({ code: "forbidden", details: { reason } });
    expect(w.deps.grants.minted).toHaveLength(0);
  });

  it("honours a time window in the city's own time zone, at the moment of the effect", async () => {
    // Lagos is UTC+1. 09:30 UTC is 10:30 local.
    clock = new Date("2026-09-23T09:30:00.000Z");
    const w = world();
    const mandateId = await seedMandate({
      constraints: [
        { key: "time_window", mode: "allow", values: ["06:00-11:00"] },
        { key: "city", mode: "allow", values: [cityId] },
      ],
    });
    const n = await negotiate(w, mandateId);

    // By the time the selection runs it is 11:10 local: outside the window.
    advance(40 * 60);
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "mandate_constraint_violation", key: "time_window" },
    });
    expect(w.mp.awardsCreated).toBe(0);

    // A window wrapping midnight admits 23:30 local.
    clock = new Date("2026-09-23T22:30:00.000Z");
    const night = await seedMandate({
      constraints: [
        { key: "time_window", mode: "allow", values: ["22:00-06:00"] },
      ],
    });
    const late = await negotiate(w, night);
    const result = await selectOffer(w.deps, late.select);
    expect(result.award.state).toBe("confirmed");
  });

  it("a ride-scoped mandate grant cannot select a DELIVERY request (service is checked against the request)", async () => {
    // The scope says "ride" (so a marketplace.ride.select mandate passes), but
    // the server-issued quote — and so the authoritative request — is a
    // delivery. The service must come from the request, not the scope.
    const mp = new FakeMarketplacePort();
    mp.now = () => clock;
    const quote = mpQuote({
      cityId,
      currency: "NGN",
      vehicleClass: "go",
      service: "delivery",
    });
    mp.setQuote(quote);
    const deps = makeDeps(testDb(), { marketplace: mp, now: () => clock });
    const scope: MarketplaceGrantScope = {
      principalId: actor.id,
      actions: ["prepare", "select"],
      service: "ride",
      cityId,
      currency: "NGN",
      maxSpendMinor: 300_000,
      vehicleClass: "go",
      quoteId: quote.quoteId,
    };
    const mandateId = await seedMandate();
    const { grantId } = await authorizeNegotiation(deps, {
      actor,
      cityId,
      scope,
      mandateId,
      idempotencyKey: uid("ik"),
    });
    const request = await mp.prepareRequest(actor, {
      quoteId: quote.quoteId,
      requestedFareMinor: 200_000,
      currency: "NGN",
      paymentMethodId: "pm_wallet",
      idempotencyKey: uid("prep"),
    });
    const bidId = uid("bid");
    mp.setOffers(request.requestId, [
      mpOffer({ bidId, amountMinor: FARE, totalMinor: FARE }),
    ]);

    await expect(
      selectOffer(deps, {
        actor,
        cityId,
        grantId,
        scope,
        requestId: request.requestId,
        bidId,
        expectedRequestRevision: 0,
        expectedFareMinor: FARE,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "service_mismatch" },
    });
    expect(mp.selectCalls).toHaveLength(0);
    const grant = await testDb().actionGrant.findUnique({
      where: { id: grantId },
    });
    expect(grant?.consumedAt).toBeNull();
    expect(await reservationsOf(mandateId)).toHaveLength(0);
  });

  it("a mandate grant cannot cancel another of the user's requests — only its own negotiation's", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    // A request the user published themselves, from a different quote.
    const other = mpQuote({ cityId, currency: "NGN", vehicleClass: "go" });
    w.mp.setQuote(other);
    const theirs = await w.mp.prepareRequest(actor, {
      quoteId: other.quoteId,
      requestedFareMinor: 200_000,
      currency: "NGN",
      paymentMethodId: "pm_wallet",
      idempotencyKey: uid("prep"),
    });
    await expect(
      cancelRequest(w.deps, {
        actor,
        cityId,
        grantId: n.grantId,
        scope: w.scope,
        requestId: theirs.requestId,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: { reason: "quote_mismatch" },
    });
    const untouched = await w.mp.viewOffers(actor, theirs.requestId);
    expect(untouched?.request.state).toBe("open");

    // Its own negotiation's request it may cancel.
    const cancelled = await cancelRequest(w.deps, {
      actor,
      cityId,
      grantId: n.grantId,
      scope: w.scope,
      requestId: n.requestId,
    });
    expect(cancelled.state).toBe("cancelled");
  });

  it.each([
    ["an unknown constraint mode", [{ key: "surge_pricing", mode: "never" }]],
    ["a non-empty non-list constraints value", { city: ["city_abuja"] }],
  ])(
    "refuses a mandate with %s instead of reading it as permission",
    async (_label, constraints) => {
      const w = world();
      const mandateId = uid("mnd");
      await testDb().mandate.create({
        data: {
          id: mandateId,
          userId: actor.id,
          action: "marketplace.ride.select",
          title: "Commute",
          passengers: "self_only",
          categories: ["go"],
          providers: [],
          perRunCapMinor: BigInt(300_000),
          periodCapMinor: BigInt(3_000_000),
          periodRuns: 20,
          currency: "NGN",
          constraints: constraints as never,
          status: "active",
          expiresAt: new Date(clock.getTime() + 86_400_000),
        },
      });
      await expect(
        authorizeNegotiation(w.deps, {
          actor,
          cityId,
          scope: w.scope,
          mandateId,
          idempotencyKey: uid("ik"),
        }),
      ).rejects.toMatchObject({
        code: "forbidden",
        details: { reason: "mandate_constraint_unverifiable" },
      });
      expect(w.deps.grants.minted).toHaveLength(0);
    },
  );

  it("a scope wider than the mandate (any vehicle class) cannot be authorized", async () => {
    const w = world({ vehicleClass: null });
    const mandateId = await seedMandate();
    await expect(
      authorizeNegotiation(w.deps, {
        actor,
        cityId,
        scope: w.scope,
        mandateId,
        idempotencyKey: uid("ik"),
      }),
    ).rejects.toMatchObject({
      details: { reason: "mandate_category_not_permitted" },
    });
  });

  it("someone else's mandate is not found", async () => {
    const w = world();
    const theirs = await seedMandate({ userId: uid("rider") });
    await expect(
      authorizeNegotiation(w.deps, {
        actor,
        cityId,
        scope: w.scope,
        mandateId: theirs,
        idempotencyKey: uid("ik"),
      }),
    ).rejects.toMatchObject({
      code: "not_found",
      details: { reason: "mandate_not_found" },
    });
  });
});

// ---------------------------------------------------------------------------
// Atomic period allowance under concurrency
// ---------------------------------------------------------------------------

describe("period allowance under concurrent selections", () => {
  async function race(
    w: World,
    mandateId: string,
    count: number,
  ): Promise<{
    negotiations: Negotiation[];
    results: PromiseSettledResult<unknown>[];
  }> {
    const negotiations: Negotiation[] = [];
    for (let i = 0; i < count; i += 1) {
      negotiations.push(await negotiate(w, mandateId));
    }
    const results = await Promise.allSettled(
      negotiations.map((n) => selectOffer(w.deps, n.select)),
    );
    return { negotiations, results };
  }

  it("exhausting the period RUN count: exactly the allowed number succeed", async () => {
    const w = world();
    const mandateId = await seedMandate({ periodRuns: 3 });
    const { negotiations, results } = await race(w, mandateId, 7);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(won).toHaveLength(3);
    expect(lost).toHaveLength(4);
    for (const failure of lost) {
      expect(failure.reason).toMatchObject({
        code: "forbidden",
        details: { reason: "mandate_allowance_exhausted" },
      });
    }
    expect(w.mp.awardsCreated).toBe(3);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 3, amount: 3 * FARE });
    const reservations = await reservationsOf(mandateId);
    expect(reservations.map((r) => r.status)).toEqual([
      "committed",
      "committed",
      "committed",
    ]);
    // The refused selections spent nothing: their grants are still unconsumed.
    const grants = await testDb().actionGrant.findMany({
      where: { id: { in: negotiations.map((n) => n.grantId) } },
    });
    expect(grants.filter((g) => g.consumedAt === null)).toHaveLength(4);
  });

  it("exhausting the period BUDGET: exactly the allowed number succeed", async () => {
    const w = world();
    // 700_000 fits two 250_000 selections, not three.
    const mandateId = await seedMandate({
      periodCapMinor: 700_000,
      periodRuns: 50,
    });
    // Authorize all first (the advisory headroom read passes for each while
    // nothing is used), then fire the selections together.
    const { results } = await race(w, mandateId, 6);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(w.mp.awardsCreated).toBe(2);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 2, amount: 2 * FARE });
  });

  it("once the period is used up, a further authorization is refused early", async () => {
    const w = world();
    const mandateId = await seedMandate({ periodRuns: 1 });
    const n = await negotiate(w, mandateId);
    await selectOffer(w.deps, n.select);
    await expect(
      authorizeNegotiation(w.deps, {
        actor,
        cityId,
        scope: w.scope,
        mandateId,
        idempotencyKey: uid("ik"),
      }),
    ).rejects.toMatchObject({
      details: { reason: "mandate_allowance_exhausted" },
    });
  });

  it("two concurrent selections under ONE grant yield one award and one allowance run", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    const results = await Promise.allSettled([
      selectOffer(w.deps, n.select),
      selectOffer(w.deps, n.select),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "rejected") {
        // The loser followed the winner's execution instead of selecting.
        expect(r.reason).toMatchObject({
          details: { reason: "selection_in_progress" },
        });
      }
    }
    expect(w.mp.awardsCreated).toBe(1);
    expect(w.mp.selectCalls).toHaveLength(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
  });
});

// ---------------------------------------------------------------------------
// Pause / revoke / expiry between proposal and effect
// ---------------------------------------------------------------------------

describe("mandate changes between proposal and effect", () => {
  it.each(["paused", "revoked"])(
    "a mandate %s after the offer was reviewed stops the selection",
    async (status) => {
      const w = world();
      const mandateId = await seedMandate();
      const n = await negotiate(w, mandateId);
      await testDb().mandate.update({
        where: { id: mandateId },
        data: { status },
      });
      await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
        code: "forbidden",
        details: { reason: `mandate_${status}` },
      });
      expect(w.mp.selectCalls).toHaveLength(0);
      expect(await allowanceOf(mandateId)).toEqual({ runs: 0, amount: 0 });
      expect((await executionOf(n.grantId)) ?? null).toBeNull();
    },
  );

  it("a mandate that expires before the effect stops the selection", async () => {
    const w = world();
    const mandateId = await seedMandate({
      expiresAt: new Date(clock.getTime() + 60_000),
    });
    const n = await negotiate(w, mandateId);
    advance(120);
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "mandate_expired" },
    });
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("a revoke that lands mid-selection is caught at the commit boundary", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    // The early check has already passed when the snapshot is read; the user
    // revokes at exactly that moment.
    w.mp.onViewOffers = async () => {
      await testDb().mandate.update({
        where: { id: mandateId },
        data: { status: "revoked" },
      });
    };
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "mandate_revoked" },
    });
    // The whole commit-boundary transaction rolled back: grant unspent, nothing
    // reserved, no intent, no award call.
    const grant = await testDb().actionGrant.findUnique({
      where: { id: n.grantId },
    });
    expect(grant?.consumedAt).toBeNull();
    expect(await reservationsOf(mandateId)).toHaveLength(0);
    expect(await executionOf(n.grantId)).toBeNull();
    expect(w.mp.selectCalls).toHaveLength(0);
  });

  it("a paused mandate also stops publishing and cancelling under its grant", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    await testDb().mandate.update({
      where: { id: mandateId },
      data: { status: "paused" },
    });
    await expect(
      cancelRequest(w.deps, {
        actor,
        cityId,
        grantId: n.grantId,
        scope: w.scope,
        requestId: n.requestId,
      }),
    ).rejects.toMatchObject({ details: { reason: "mandate_paused" } });
  });
});

// ---------------------------------------------------------------------------
// Crash / ambiguous outcome → the retry reconciles the SAME execution
// ---------------------------------------------------------------------------

describe("execution recovery", () => {
  it("a LOST selection is re-sent under the same key after the lease, with one grant, one award and one run", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);

    w.mp.loseNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "marketplace_timeout" },
    });
    // Intent persisted before the call; the reservation is pending and counted.
    const pending = await executionOf(n.grantId);
    expect(pending?.status).toBe("pending");
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    expect((await reservationsOf(mandateId))[0]?.status).toBe("pending");

    // An immediate retry must not race the attempt that may still be in flight.
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "selection_in_progress" },
    });
    expect(w.mp.selectCalls).toHaveLength(1);

    // After the lease lapses the retry re-sends the SAME selection.
    advance(w.deps.limits.selectLeaseSeconds + 1);
    const result = await selectOffer(w.deps, n.select);
    expect(result.award.state).toBe("confirmed");

    expect(w.mp.selectCalls).toHaveLength(2);
    expect(w.mp.selectCalls[1]?.idempotencyKey).toBe(
      w.mp.selectCalls[0]?.idempotencyKey,
    );
    expect(w.mp.selectCalls[1]?.idempotencyKey).toBe(pending?.idempotencyKey);
    expect(w.mp.awardsCreated).toBe(1);
    expect(w.deps.grants.minted).toHaveLength(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    const reservations = await reservationsOf(mandateId);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.status).toBe("committed");
    expect(await executionOf(n.grantId)).toMatchObject({
      status: "awarded",
      attempts: 2,
    });
  });

  it("a DELAYED award (crash after the award) converges by query, never a second selection", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);

    w.mp.delayNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    expect((await executionOf(n.grantId))?.status).toBe("pending");

    // The answer finally lands; the retry finds it before any re-send.
    w.mp.landDelayedAwards();
    const result = await selectOffer(w.deps, n.select);
    expect(result.converged).toBe(true);
    expect(w.mp.selectCalls).toHaveLength(1);
    expect(w.mp.awardsCreated).toBe(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });

    // Further replays stay converged and consume nothing more.
    await selectOffer(w.deps, n.select);
    expect(w.mp.selectCalls).toHaveLength(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    const receipts = await testDb().mandateExecution.count({
      where: { mandateId, outcome: "executed" },
    });
    expect(receipts).toBe(1);
  });

  it("a delayed award still unseen after the lease is replayed under the same key — one award", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    w.mp.delayNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    advance(w.deps.limits.selectLeaseSeconds + 1);
    const result = await selectOffer(w.deps, n.select);
    expect(result.award.state).toBe("confirmed");
    expect(w.mp.selectCalls).toHaveLength(2);
    expect(w.mp.awardsCreated).toBe(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
  });

  it("a crash before the call leaves a reconcilable intent that the retry completes", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    w.mp.crashNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toThrow(/process died/);
    expect((await executionOf(n.grantId))?.status).toBe("pending");
    advance(w.deps.limits.selectLeaseSeconds + 1);
    const result = await selectOffer(w.deps, n.select);
    expect(result.award.state).toBe("confirmed");
    expect(w.mp.awardsCreated).toBe(1);
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
  });

  it("a DEFINITIVE refusal releases the allowance and the grant cannot be re-run", async () => {
    const w = world();
    const mandateId = await seedMandate({ periodRuns: 1 });
    const n = await negotiate(w, mandateId);
    w.mp.refuseNextSelect = new ContractError(
      "bid_not_live",
      "this offer is no longer live",
    );
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      code: "bid_not_live",
    });
    expect(await executionOf(n.grantId)).toMatchObject({
      status: "failed",
      reasonCode: "bid_not_live",
    });
    // Budget and run are back: the single period run can be used again.
    expect(await allowanceOf(mandateId)).toEqual({ runs: 0, amount: 0 });
    expect((await reservationsOf(mandateId))[0]?.status).toBe("released");

    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "grant_spent_no_award" },
    });
    expect(w.mp.selectCalls).toHaveLength(1);

    const again = await negotiate(w, mandateId);
    const result = await selectOffer(w.deps, again.select);
    expect(result.award.state).toBe("confirmed");
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
  });

  it("a revoke while an outcome is unknown blocks any NEW attempt but keeps the reservation until reconciled", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    w.mp.loseNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    await testDb().mandate.update({
      where: { id: mandateId },
      data: { status: "revoked" },
    });
    advance(w.deps.limits.selectLeaseSeconds + 1);

    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "mandate_revoked", executionPending: "true" },
    });
    expect(w.mp.selectCalls).toHaveLength(1); // nothing re-sent
    // The first attempt could still have landed: the run stays reserved.
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    expect((await executionOf(n.grantId))?.status).toBe("pending");

    // Once the request can no longer award, reconciliation releases it.
    await w.mp.cancel(actor, n.requestId, uid("cancel"));
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      details: { reason: "grant_spent_no_award" },
    });
    expect((await executionOf(n.grantId))?.status).toBe("failed");
    expect(await allowanceOf(mandateId)).toEqual({ runs: 0, amount: 0 });
    expect(w.mp.awardsCreated).toBe(0);
  });

  it("a RE-SENT attempt refused because the earlier attempt landed meanwhile settles on that award — it never releases the run", async () => {
    // Attempt 1 is still in flight when the lease lapses. The retry's pre-send
    // query sees no award yet; the earlier attempt then lands and the re-send
    // (which raced it) is refused as stale. Releasing on that refusal would
    // hand back a run that WAS spent.
    const w = world();
    const mandateId = await seedMandate({ periodRuns: 1 });
    const n = await negotiate(w, mandateId);
    w.mp.delayNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    advance(w.deps.limits.selectLeaseSeconds + 1);
    w.mp.onViewOffers = () => {
      w.mp.landDelayedAwards();
      return Promise.resolve();
    };
    w.mp.refuseNextSelect = new ContractError(
      "version_conflict",
      "the terms changed after you reviewed them",
    );

    const result = await selectOffer(w.deps, n.select);
    expect(result.converged).toBe(true);
    expect(w.mp.selectCalls).toHaveLength(2);
    expect(w.mp.awardsCreated).toBe(1);
    expect(await executionOf(n.grantId)).toMatchObject({
      status: "awarded",
      awardId: result.award.awardId,
    });
    // The one period run stays spent: no second selection can use it.
    expect(await allowanceOf(mandateId)).toEqual({ runs: 1, amount: FARE });
    expect((await reservationsOf(mandateId))[0]?.status).toBe("committed");
  });

  it("a RE-SENT attempt refused with no award anywhere closes the execution and releases the run", async () => {
    const w = world();
    const mandateId = await seedMandate({ periodRuns: 1 });
    const n = await negotiate(w, mandateId);
    w.mp.loseNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    advance(w.deps.limits.selectLeaseSeconds + 1);
    w.mp.refuseNextSelect = new ContractError(
      "bid_not_live",
      "this offer is no longer live",
    );
    await expect(selectOffer(w.deps, n.select)).rejects.toMatchObject({
      code: "bid_not_live",
    });
    expect(w.mp.selectCalls).toHaveLength(2);
    expect(await executionOf(n.grantId)).toMatchObject({
      status: "failed",
      reasonCode: "bid_not_live",
      attempts: 2,
    });
    expect(await allowanceOf(mandateId)).toEqual({ runs: 0, amount: 0 });
    expect((await reservationsOf(mandateId))[0]?.status).toBe("released");
  });

  it("a retry cannot redirect a committed execution to another offer", async () => {
    const w = world();
    const mandateId = await seedMandate();
    const n = await negotiate(w, mandateId);
    w.mp.loseNextSelect = true;
    await expect(selectOffer(w.deps, n.select)).rejects.toBeInstanceOf(
      ContractError,
    );
    await expect(
      selectOffer(w.deps, { ...n.select, bidId: uid("bid") }),
    ).rejects.toMatchObject({ details: { reason: "execution_mismatch" } });
  });
});
