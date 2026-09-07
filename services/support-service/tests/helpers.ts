/**
 * Fixtures and wiring for the support-service tests.
 *
 * These run against a real PostgreSQL database, because most of what they assert
 * only exists in the database: the deferred double-entry trigger that refuses an
 * unbalanced remedy entry, the rollback that must take the audit row with it,
 * and the unique primary keys that make a replay a replay.
 *
 * The fakes below live here and nowhere near `src/`.
 */
import { PrismaClient } from "@prisma/client";

import { ContractError, money } from "@ubi/contracts";

import { createCityConfigProvider } from "../src/ops/city-config";

import type { SupportDeps } from "../src/ops/context";
import type {
  LedgerPort,
  PostedRemedyEntry,
  RemedyPostingRequest,
} from "../src/ops/ledger-port";
import type { NotifyChannel, SafetyAlert, SafetyNotifier } from "../src/ops/notifier";
import type { SupportDb } from "../src/ops/types";

export const TEST_DATABASE_URL =
  process.env.SUPPORT_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_support_test";

let client: PrismaClient | undefined;

export function testDb(): SupportDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as SupportDb;
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

// ---------------------------------------------------------------------------
// City fixture
// ---------------------------------------------------------------------------

export interface SupportPolicyOverrides {
  readonly slaMinutesByCategory?: Record<string, number>;
  readonly safetySlaMinutesBySeverity?: Record<string, number>;
  readonly sosSeverityByTrigger?: Record<string, string>;
  readonly sosMaxDeliveryAttempts?: number;
  readonly sosRetryBackoffSeconds?: number[];
  readonly remedyCapMinorByType?: Record<string, number>;
  readonly remedyHighValueAboveMinor?: number;
  readonly reviewDualControlDecisions?: string[];
  readonly reviewDualControlAboveMinor?: number;
}

export interface SeedCityOptions {
  readonly currency?: string;
  readonly emergencyNumber?: string;
  readonly flags?: Record<string, boolean>;
  readonly policy?: SupportPolicyOverrides;
  readonly omitSupportPolicy?: boolean;
  readonly active?: boolean;
}

export interface SeededCity {
  readonly cityId: string;
  readonly currency: string;
  readonly emergencyNumber: string;
}

export async function seedCity(
  db: SupportDb,
  options: SeedCityOptions = {},
): Promise<SeededCity> {
  const cityId = uid("city");
  const currency = options.currency ?? "NGN";
  const emergencyNumber = options.emergencyNumber ?? "112";

  const config: Record<string, unknown> = {
    cityId,
    version: 1,
    currency,
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber,
    vehicleClasses: ["go", "comfort"],
    fares: {
      go: {
        baseMinor: 50_000,
        perKmMinor: 12_000,
        perMinMinor: 3_000,
        bookingFeeMinor: 10_000,
        minFareMinor: 80_000,
      },
    },
    waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
    cancelPolicy: {
      riderFeeAfterAssignMinor: 30_000,
      driverFeeMinor: 0,
      freeWindowSec: 120,
    },
    pinRequired: true,
    quoteTtlSec: 120,
    offerTtlSec: 20,
    matchingRings: [{ radiusMeters: 1500, maxCandidates: 8 }],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 3,
    paymentMethods: [
      { id: "wallet", available: true },
      { id: "cash", available: true },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: 1_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS"],
      arrivalBufferMin: 45,
      checkInCutoffMin: 60,
      trafficBufferMin: 30,
      doors: { LOS: "D" },
    },
    taxes: { vat: 7.5 },
  };

  if (options.omitSupportPolicy !== true) {
    config.supportPolicy = {
      slaMinutesByCategory: options.policy?.slaMinutesByCategory ?? {
        ride: 240,
        wallet: 120,
        bites: 180,
        send: 240,
        travel: 240,
        stays: 240,
        fleet: 480,
        safety: 15,
        account: 480,
      },
      safetySlaMinutesBySeverity: options.policy?.safetySlaMinutesBySeverity ?? {
        critical: 5,
        high: 15,
        standard: 60,
      },
      sosSeverityByTrigger: options.policy?.sosSeverityByTrigger ?? {
        sos_button: "critical",
        crash_detected: "critical",
        route_deviation: "high",
        audio_alarm: "high",
        third_party_report: "standard",
      },
      sosMaxDeliveryAttempts: options.policy?.sosMaxDeliveryAttempts ?? 5,
      sosRetryBackoffSeconds: options.policy?.sosRetryBackoffSeconds ?? [30, 60, 300],
      remedyCapMinorByType: options.policy?.remedyCapMinorByType ?? {
        fee_reversal: 500_000,
        refund: 2_000_000,
        credit: 500_000,
        redelivery: 500_000,
        cash_dispute_resolution: 1_000_000,
      },
      remedyHighValueAboveMinor: options.policy?.remedyHighValueAboveMinor ?? 200_000,
      reviewDualControlDecisions: options.policy?.reviewDualControlDecisions ?? [
        "deactivate",
      ],
      reviewDualControlAboveMinor:
        options.policy?.reviewDualControlAboveMinor ?? 1_000_000,
    };
  }

  await db.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone: "Africa/Lagos",
      active: options.active ?? true,
    },
  });
  await db.cityConfigVersion.create({
    data: {
      id: uid("cfg"),
      cityId,
      version: 1,
      config: config as never,
      activatedAt: new Date(),
      createdBy: "seed",
      approvedBy: "seed-approver",
    },
  });

  const flags = options.flags ?? { bites: true, stays: true, fleet: true, send: true };
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

  return { cityId, currency, emergencyNumber };
}

export interface SeededUser {
  readonly id: string;
  readonly phone: string;
  readonly email: string;
}

export async function seedUser(db: SupportDb, name = "Ada"): Promise<SeededUser> {
  counter += 1;
  const suffix = uid("u").replace(/[^a-z0-9]/gi, "");
  const digits = [
    String(Date.now() % 1_000_000).padStart(6, "0"),
    String(process.pid % 1_000).padStart(3, "0"),
    String(counter % 1_000).padStart(3, "0"),
  ].join("");
  const phone = `+234${digits}`;
  const email = `${suffix}@example.test`;
  const user = await db.user.create({
    data: {
      email,
      phone,
      passwordHash: "not-a-real-hash",
      firstName: name,
      lastName: "Tester",
      country: "NG",
      status: "ACTIVE",
    },
  });
  return { id: user.id, phone, email };
}

/** A wallet for the customer, so the fake ledger has somewhere to post. */
export async function seedWallet(
  db: SupportDb,
  ownerId: string,
  currency: string,
): Promise<string> {
  const wallet = await db.wallet.create({
    data: {
      id: uid("wal"),
      ownerType: "rider",
      ownerId,
      currency,
      tier: "tier1",
    },
  });
  return wallet.id;
}

/**
 * Posts a completed-ride entry the way payment-service would, so a remedy test
 * has a real prior entry it can prove was left untouched.
 */
export async function seedRideEntry(
  db: SupportDb,
  walletId: string,
  currency: string,
  fareMinor: number,
): Promise<string> {
  const entryId = uid("je");
  await db.$transaction(async (tx) => {
    await tx.journalEntry.create({
      data: {
        id: entryId,
        kind: "ride_completion",
        reference: `ride:${uid("rd")}`,
        occurredAt: new Date(),
      },
    });
    await tx.journalLine.createMany({
      data: [
        {
          id: uid("jl"),
          entryId,
          account: "wallet",
          walletId,
          amountMinor: BigInt(-fareMinor),
          currency,
          counterpartRef: `ride:${entryId}`,
        },
        {
          id: uid("jl"),
          entryId,
          account: "ubi_commission",
          walletId: null,
          amountMinor: BigInt(fareMinor),
          currency,
          counterpartRef: `ride:${entryId}`,
        },
      ],
    });
  });
  return entryId;
}

// ---------------------------------------------------------------------------
// Fakes — tests only
// ---------------------------------------------------------------------------

/**
 * Stands in for payment-service's remedy endpoint. It writes REAL journal rows
 * into the test database, so the assertions about counter-lines, the case
 * reference and the untouched prior entry are checked by the same deferred
 * balance trigger that guards production, not by a mock's memory.
 */
export class FakeLedger implements LedgerPort {
  readonly requests: RemedyPostingRequest[] = [];

  constructor(
    private readonly db: SupportDb,
    private readonly failing = false,
  ) {}

  async postRemedy(request: RemedyPostingRequest): Promise<PostedRemedyEntry> {
    this.requests.push(request);
    if (this.failing) {
      throw new ContractError("service_unavailable", "the ledger is not reachable");
    }

    const existing = await this.db.journalEntry.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
      include: { lines: true },
    });
    if (existing !== null) {
      return {
        entryId: existing.id,
        caseRef: existing.caseRef ?? request.caseId,
        lines: existing.lines.map((line) => ({
          account: line.account,
          amountMinor: Number(line.amountMinor),
          currency: line.currency,
          counterpartRef: line.counterpartRef,
        })),
        replayed: true,
      };
    }

    const wallet = await this.db.wallet.findFirst({
      where: { ownerId: request.beneficiary.userId, currency: request.amount.currency },
    });
    if (wallet === null) {
      throw new ContractError("not_found", "the beneficiary has no wallet");
    }

    const entryId = uid("je");
    const amount = money(request.amount.amountMinor, request.amount.currency);
    await this.db.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          id: entryId,
          kind: "support_remedy",
          reference: `remedy:${request.remedyId}`,
          description: request.type,
          occurredAt: new Date(),
          idempotencyKey: request.idempotencyKey,
          caseRef: request.caseId,
        },
      });
      await tx.journalLine.createMany({
        data: [
          {
            id: uid("jl"),
            entryId,
            account: "ubi_float",
            walletId: null,
            amountMinor: BigInt(-amount.amountMinor),
            currency: amount.currency,
            counterpartRef: `case:${request.caseId}`,
          },
          {
            id: uid("jl"),
            entryId,
            account: "wallet",
            walletId: wallet.id,
            amountMinor: BigInt(amount.amountMinor),
            currency: amount.currency,
            counterpartRef: `case:${request.caseId}`,
          },
        ],
      });
    });

    return {
      entryId,
      caseRef: request.caseId,
      lines: [
        {
          account: "ubi_float",
          amountMinor: -amount.amountMinor,
          currency: amount.currency,
          counterpartRef: `case:${request.caseId}`,
        },
        {
          account: "wallet",
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          counterpartRef: `case:${request.caseId}`,
        },
      ],
      replayed: false,
    };
  }
}

export interface DeliveryAttempt {
  readonly channel: NotifyChannel;
  readonly caseId: string;
}

/** Fails the channels it is told to fail, and records everything it was asked. */
export class FakeNotifier implements SafetyNotifier {
  readonly attempts: DeliveryAttempt[] = [];
  failing: ReadonlySet<NotifyChannel>;

  constructor(failing: readonly NotifyChannel[] = []) {
    this.failing = new Set(failing);
  }

  async deliver(channel: NotifyChannel, alert: SafetyAlert): Promise<void> {
    this.attempts.push({ channel, caseId: alert.caseId });
    await Promise.resolve();
    if (this.failing.has(channel)) {
      throw new ContractError("service_unavailable", `channel ${channel} is down`);
    }
  }

  recover(): void {
    this.failing = new Set();
  }
}

export interface DepsOptions {
  readonly ledger?: LedgerPort;
  readonly notifier?: SafetyNotifier;
  readonly now?: () => Date;
}

export function makeDeps(db: SupportDb, options: DepsOptions = {}): SupportDeps {
  return {
    db,
    config: createCityConfigProvider(db),
    ledger: options.ledger ?? new FakeLedger(db),
    notifier: options.notifier ?? new FakeNotifier(),
    now: options.now ?? (() => new Date()),
  };
}

/** Gateway headers, the only place an actor or a city may come from. */
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
