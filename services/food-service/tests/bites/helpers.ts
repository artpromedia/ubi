/**
 * Fixtures and wiring for the Bites tests.
 *
 * These run against a real PostgreSQL database, because most of what they assert
 * only exists in the database: the deferred double-entry trigger that refuses an
 * unbalanced refund entry, the derived `wallet_balances` view a refund must move,
 * and the unique keys that make an order-create replay a replay.
 *
 * The one fake — payment-service — lives here and nowhere near `src/`. It writes
 * REAL balanced journal rows when it refunds, so "refund per item at menu price"
 * is checked by the same trigger that guards production, not by a mock's memory.
 */
import { PrismaClient } from "@prisma/client";

import { ContractError, money, type Money } from "@ubi/contracts";

import { createCityConfigProvider } from "../../src/bites/city-config";

import type { BitesDeps } from "../../src/bites/context";
import type { BitesDb } from "../../src/bites/lib/types";
import type {
  AuthorizeRequest,
  Authorization,
  CaptureRequest,
  PaymentPort,
  RefundRequest,
  RefundResult,
  ReleaseRequest,
} from "../../src/bites/payment-port";

export const TEST_DATABASE_URL =
  process.env.BITES_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_bites_p2";

let client: PrismaClient | undefined;

export function testDb(): BitesDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as BitesDb;
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
// Clock + deps
// ---------------------------------------------------------------------------

export interface Clock {
  t: Date;
}

export function makeDeps(
  db: BitesDb,
  payments: PaymentPort,
  clock: Clock,
): BitesDeps {
  return {
    db,
    config: createCityConfigProvider(db),
    payments,
    now: () => clock.t,
  };
}

// ---------------------------------------------------------------------------
// Fake payment-service
// ---------------------------------------------------------------------------

export class FakePayments implements PaymentPort {
  readonly authorizations: AuthorizeRequest[] = [];
  readonly releases: ReleaseRequest[] = [];
  readonly captures: CaptureRequest[] = [];
  readonly refunds: RefundRequest[] = [];

  constructor(private readonly db: BitesDb) {}

  async authorize(request: AuthorizeRequest): Promise<Authorization> {
    this.authorizations.push(request);
    // A pre-authorization is a hold on the payment method, not a ledger posting.
    return { paymentIntentId: `pi_${request.orderId}` };
  }

  async releaseAuth(request: ReleaseRequest): Promise<void> {
    // Releasing a hold posts nothing — no capture, no transfer.
    this.releases.push(request);
  }

  async capture(request: CaptureRequest): Promise<void> {
    this.captures.push(request);
  }

  async refundToWallet(request: RefundRequest): Promise<RefundResult> {
    this.refunds.push(request);
    const existing = await this.db.journalEntry.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
    });
    if (existing !== null) {
      return { entryId: existing.id, replayed: true };
    }
    const wallet = await this.db.wallet.findFirst({
      where: { ownerId: request.userId, currency: request.amount.currency },
    });
    if (wallet === null) {
      throw new ContractError("not_found", "the customer has no wallet");
    }
    const entryId = uid("je");
    await this.db.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          id: entryId,
          kind: "bites_refund",
          reference: `bites:${request.orderId}`,
          description: request.reason,
          occurredAt: new Date(),
          idempotencyKey: request.idempotencyKey,
        },
      });
      await tx.journalLine.createMany({
        data: [
          {
            id: uid("jl"),
            entryId,
            account: "ubi_bites_refunds",
            walletId: null,
            amountMinor: BigInt(-request.amount.amountMinor),
            currency: request.amount.currency,
            counterpartRef: `bites:${request.orderId}`,
          },
          {
            id: uid("jl"),
            entryId,
            account: "wallet",
            walletId: wallet.id,
            amountMinor: BigInt(request.amount.amountMinor),
            currency: request.amount.currency,
            counterpartRef: `bites:${request.orderId}`,
          },
        ],
      });
    });
    return { entryId, replayed: false };
  }
}

// ---------------------------------------------------------------------------
// City fixture
// ---------------------------------------------------------------------------

export interface SeedCityOptions {
  readonly currency?: string;
  readonly serviceFeePct?: number;
  readonly deliveryFeeMinor?: number;
  readonly issueResponseWindowMinutes?: number;
  readonly flags?: Record<string, boolean>;
  readonly omitBitesPolicy?: boolean;
  readonly active?: boolean;
}

export interface SeededCity {
  readonly cityId: string;
  readonly currency: string;
}

export async function seedCity(
  db: BitesDb,
  options: SeedCityOptions = {},
): Promise<SeededCity> {
  const cityId = uid("city");
  const currency = options.currency ?? "NGN";

  const config: Record<string, unknown> = {
    cityId,
    version: 1,
    currency,
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone: "Africa/Lagos",
    emergencyNumber: "112",
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
      { id: "card", available: false, reason: "not enabled in this city" },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: 5_000_000,
        singleTransferMinor: 2_000_000,
        balanceCapMinor: 30_000_000,
      },
    ],
    serviceFeePct: options.serviceFeePct ?? 20,
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

  if (options.omitBitesPolicy !== true) {
    config.bitesPolicy = {
      deliveryFeeMinor: options.deliveryFeeMinor ?? 50_000,
      prepEtaMinutes: 15,
      courierEtaMinutes: 20,
      issueResponseWindowMinutes: options.issueResponseWindowMinutes ?? 120,
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

  const flags = options.flags ?? { bites: true };
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

  return { cityId, currency };
}

// ---------------------------------------------------------------------------
// Merchant / outlet / menu fixtures
// ---------------------------------------------------------------------------

export interface SeededMerchant {
  readonly merchantId: string;
  readonly outletId: string;
}

export async function seedMerchant(
  db: BitesDb,
  options: { status?: string; open?: boolean; pausedUntil?: Date | null } = {},
): Promise<SeededMerchant> {
  const merchantId = uid("merch");
  const outletId = uid("outlet");
  await db.bitesMerchant.create({
    data: {
      id: merchantId,
      legalName: "Test Kitchen Ltd",
      tradeName: "Test Kitchen",
      cacRc: "RC123456",
      tin: "TIN123456",
      status: options.status ?? "approved",
    },
  });
  await db.outlet.create({
    data: {
      id: outletId,
      merchantId,
      address: "1 Test Street",
      lat: 6.5,
      lng: 3.4,
      open: options.open ?? true,
      pausedUntil: options.pausedUntil ?? null,
    },
  });
  return { merchantId, outletId };
}

export interface SeedGroup {
  readonly name?: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly { readonly name?: string; readonly priceDeltaMinor: number }[];
}

export interface SeededItem {
  readonly itemId: string;
  readonly groups: readonly { readonly groupId: string; readonly optionIds: readonly string[] }[];
}

export async function seedMenuItem(
  db: BitesDb,
  outletId: string,
  options: {
    priceMinor: number;
    currency: string;
    active?: boolean;
    soldOutUntil?: Date | null;
    groups?: readonly SeedGroup[];
  },
): Promise<SeededItem> {
  const itemId = uid("item");
  await db.bitesMenuItem.create({
    data: {
      id: itemId,
      outletId,
      category: "mains",
      name: "Jollof Rice",
      priceMinor: BigInt(options.priceMinor),
      currency: options.currency,
      allergens: [],
      active: options.active ?? true,
      soldOutUntil: options.soldOutUntil ?? null,
    },
  });
  const groups: { groupId: string; optionIds: string[] }[] = [];
  for (const group of options.groups ?? []) {
    const groupId = uid("grp");
    await db.optionGroup.create({
      data: {
        id: groupId,
        itemId,
        name: group.name ?? "Choose",
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
      },
    });
    const optionIds: string[] = [];
    for (const option of group.options) {
      const optionId = uid("opt");
      await db.menuOption.create({
        data: {
          id: optionId,
          groupId,
          name: option.name ?? "Option",
          priceDeltaMinor: BigInt(option.priceDeltaMinor),
        },
      });
      optionIds.push(optionId);
    }
    groups.push({ groupId, optionIds });
  }
  return { itemId, groups };
}

export async function seedWallet(
  db: BitesDb,
  ownerId: string,
  currency: string,
): Promise<string> {
  const walletId = uid("wal");
  await db.wallet.create({
    data: {
      id: walletId,
      ownerType: "rider",
      ownerId,
      currency,
      tier: "tier1",
    },
  });
  return walletId;
}

/** The derived balance of a wallet, read from the ledger view, in minor units. */
export async function walletBalanceMinor(db: BitesDb, walletId: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ balance_minor: bigint }[]>(
    `SELECT balance_minor FROM wallet_balances WHERE wallet_id = $1`,
    walletId,
  );
  const first = rows[0];
  return first === undefined ? 0 : Number(first.balance_minor);
}

/** Ledger lines posted against a specific order (`counterpart_ref = 'bites:<id>'`). */
export async function journalLinesForOrder(db: BitesDb, orderId: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM journal_lines WHERE counterpart_ref = $1`,
    `bites:${orderId}`,
  );
  const first = rows[0];
  return first === undefined ? 0 : Number(first.count);
}

export function ngn(amountMinor: number, currency = "NGN"): Money {
  return money(amountMinor, currency);
}
