/**
 * Fixtures and wiring for the growth-service tests.
 *
 * These run against a real PostgreSQL database, because most of what they assert
 * only exists there: the SELECT … FOR UPDATE lock that serialises reservations,
 * the deferred double-entry trigger that refuses an unbalanced incentive entry,
 * and the unique keys that make a replay a replay.
 *
 * The fake ledger below lives here and nowhere near `src/`. It writes REAL
 * journal rows, so the assertions about counter-lines and the untouched base
 * commission are checked by the same balance trigger that guards production.
 */
import { PrismaClient } from "@prisma/client";

import { ContractError, money } from "@ubi/contracts";

import { createFlagProvider } from "../src/ops/config";

import type { GrowthDeps } from "../src/ops/context";
import type {
  BenefitPostingRequest,
  IncentivePostingRequest,
  LedgerPort,
  PostedEntry,
} from "../src/ops/ledger-port";
import type { GrowthDb } from "../src/ops/types";

export const TEST_DATABASE_URL =
  process.env.GROWTH_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_growth_test";

let client: PrismaClient | undefined;

export function testDb(): GrowthDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as GrowthDb;
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

/** Idempotency keys must be at least 8 url-safe characters. */
export function idemKey(label = "k"): string {
  return uid(label).replace(/[^A-Za-z0-9_.:-]/g, "-");
}

export function headers(
  actor: { id: string; role: string },
  cityId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-User-ID": actor.id,
    "X-User-Role": actor.role,
    "X-City-ID": cityId,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export async function seedUser(
  db: GrowthDb,
  country = "NG",
): Promise<{ id: string }> {
  counter += 1;
  const suffix = uid("u").replace(/[^a-z0-9]/gi, "");
  const digits = [
    String(Date.now() % 1_000_000).padStart(6, "0"),
    String(process.pid % 1_000).padStart(3, "0"),
    String(counter % 1_000).padStart(3, "0"),
  ].join("");
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      phone: `+234${digits}`,
      passwordHash: "not-a-real-hash",
      firstName: "Ada",
      lastName: "Tester",
      country,
      status: "ACTIVE",
    },
  });
  return { id: user.id };
}

export async function seedCity(
  db: GrowthDb,
  flags: Record<string, boolean> = {},
): Promise<{ cityId: string }> {
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
  return { cityId };
}

export interface SeedCampaignOptions {
  readonly benefitType?: string;
  readonly state?: string;
  readonly authorId?: string;
  readonly budgetLimitMinor?: number;
  readonly currency?: string;
  readonly caps?: Record<string, unknown>;
  readonly value?: Record<string, unknown>;
  readonly funding?: Record<string, unknown>;
  readonly market?: string;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
}

export interface SeededCampaign {
  readonly campaignId: string;
  readonly versionId: string;
  readonly currency: string;
}

export async function seedCampaign(
  db: GrowthDb,
  options: SeedCampaignOptions = {},
): Promise<SeededCampaign> {
  const campaignId = uid("cmp");
  const versionId = uid("cver");
  const currency = options.currency ?? "NGN";
  const now = Date.now();
  await db.campaign.create({
    data: {
      id: campaignId,
      name: `campaign ${campaignId}`,
      benefitType: options.benefitType ?? "fare_discount",
      state: options.state ?? "active",
      authorId: options.authorId ?? uid("author"),
      stateBy: options.authorId ?? uid("author"),
    },
  });
  await db.campaignVersion.create({
    data: {
      id: versionId,
      campaignId,
      version: 1,
      audienceRule: "all",
      market: options.market ?? "Lagos",
      windowStart: options.windowStart ?? new Date(now - 3_600_000),
      windowEnd: options.windowEnd ?? new Date(now + 30 * 24 * 3_600_000),
      timezone: "Africa/Lagos",
      value: (options.value ?? {}) as never,
      caps: (options.caps ?? {}) as never,
      qualificationEvent: "ride.completed_and_paid",
      stacking: {} as never,
      funding: (options.funding ?? { party: "ubi_marketing" }) as never,
      budgetLimitMinor: BigInt(options.budgetLimitMinor ?? 1_000_000),
      currency,
      copy: "Save on your ride",
    },
  });
  await db.campaignBudget.create({ data: { campaignVersionId: versionId } });
  return { campaignId, versionId, currency };
}

export interface SeedRuleOptions {
  readonly kind?: string;
  readonly baseBps?: number;
  readonly reductionBps?: number;
  readonly exclusions?: string[];
  readonly eligibleTripCap?: number | null;
  readonly moneyCapMinor?: number | null;
  readonly cashSettlement?: string;
  readonly startsAt?: Date | null;
  readonly endsAt?: Date | null;
  readonly currency?: string;
}

export interface SeededRule {
  readonly ruleId: string;
  readonly versionId: string;
  readonly campaignId: string;
  readonly currency: string;
}

export async function seedIncentiveRule(
  db: GrowthDb,
  options: SeedRuleOptions = {},
): Promise<SeededRule> {
  const seeded = await seedCampaign(db, {
    benefitType: options.kind === "window" ? "driver_window" : "driver_rebate",
    currency: options.currency ?? "NGN",
  });
  const ruleId = uid("dir");
  await db.driverIncentiveRule.create({
    data: {
      id: ruleId,
      campaignVersionId: seeded.versionId,
      kind: options.kind ?? "percentage_points",
      baseBps: options.baseBps ?? 2000,
      reductionBps: options.reductionBps ?? 500,
      exclusions: options.exclusions ?? ["tips", "tolls", "taxes"],
      eligibleTripCap: options.eligibleTripCap ?? null,
      moneyCapMinor:
        options.moneyCapMinor === null || options.moneyCapMinor === undefined
          ? null
          : BigInt(options.moneyCapMinor),
      zones: [],
      startsAt: options.startsAt ?? null,
      endsAt: options.endsAt ?? null,
      cashSettlement: options.cashSettlement ?? "nets_against_owed",
    },
  });
  return {
    ruleId,
    versionId: seeded.versionId,
    campaignId: seeded.campaignId,
    currency: seeded.currency,
  };
}

// ---------------------------------------------------------------------------
// Fake ledger — tests only. Writes REAL balanced journal rows.
// ---------------------------------------------------------------------------

export class FakeLedger implements LedgerPort {
  readonly incentives: IncentivePostingRequest[] = [];
  readonly benefits: BenefitPostingRequest[] = [];

  constructor(
    private readonly db: GrowthDb,
    private readonly failing = false,
  ) {}

  private async postPair(
    idempotencyKey: string,
    kind: string,
    reference: string,
    driverAccount: string,
    driverAmountMinor: number,
    counterAccount: string,
    currency: string,
  ): Promise<PostedEntry> {
    const existing = await this.db.journalEntry.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing !== null) {
      const line = existing.lines.find((l) => l.account === driverAccount);
      return {
        entryId: existing.id,
        ledgerLineId: line?.id ?? existing.lines[0]?.id ?? existing.id,
        replayed: true,
      };
    }
    const entryId = uid("je");
    const driverLineId = uid("jl");
    await this.db.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          id: entryId,
          kind,
          reference,
          idempotencyKey,
          occurredAt: new Date(),
        },
      });
      await tx.journalLine.createMany({
        data: [
          {
            id: driverLineId,
            entryId,
            account: driverAccount,
            walletId: null,
            amountMinor: BigInt(driverAmountMinor),
            currency,
            counterpartRef: reference,
          },
          {
            id: uid("jl"),
            entryId,
            account: counterAccount,
            walletId: null,
            amountMinor: BigInt(-driverAmountMinor),
            currency,
            counterpartRef: reference,
          },
        ],
      });
    });
    return { entryId, ledgerLineId: driverLineId, replayed: false };
  }

  async postIncentive(request: IncentivePostingRequest): Promise<PostedEntry> {
    this.incentives.push(request);
    if (this.failing) {
      throw new ContractError("service_unavailable", "the ledger is down");
    }
    const account =
      request.settlement === "driver_owed" ? "driver_owed" : "driver_payout";
    // A rebate/window/milestone credits the driver (+); a reversal debits (−).
    const signed =
      request.kind === "rebate_reversal"
        ? -request.amount.amountMinor
        : request.amount.amountMinor;
    return this.postPair(
      request.idempotencyKey,
      `incentive_${request.kind}`,
      `trip:${request.tripId}:${request.kind}`,
      account,
      signed,
      "ubi_commission",
      request.amount.currency,
    );
  }

  async postBenefit(request: BenefitPostingRequest): Promise<PostedEntry> {
    this.benefits.push(request);
    if (this.failing) {
      throw new ContractError("service_unavailable", "the ledger is down");
    }
    // Funding party is debited (−); the beneficiary is credited (+). A rider
    // benefit therefore never posts a negative line against the beneficiary.
    return this.postPair(
      request.idempotencyKey,
      `benefit_${request.adjustmentType}`,
      `reservation:${request.reservationId}`,
      request.beneficiary.account,
      request.amount.amountMinor,
      request.funding,
      request.amount.currency,
    );
  }
}

export interface DepsOptions {
  readonly ledger?: LedgerPort;
  readonly now?: () => Date;
}

export function makeDeps(db: GrowthDb, options: DepsOptions = {}): GrowthDeps {
  return {
    db,
    flags: createFlagProvider(db),
    ledger: options.ledger ?? new FakeLedger(db),
    now: options.now ?? (() => new Date()),
  };
}

export { money };
