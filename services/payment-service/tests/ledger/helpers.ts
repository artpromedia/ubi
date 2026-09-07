/**
 * Test fixtures and wiring for the wallet ledger.
 *
 * These tests run against a real PostgreSQL database because most of what they
 * assert — the deferred double-entry trigger, transaction rollback, unique
 * idempotency keys, row locks — only exists in the database. Fixtures live here
 * and nowhere near `src/`.
 */
import { money } from "@ubi/contracts";
import { PrismaClient } from "@prisma/client";

import type { WalletDeps } from "../../src/ledger/context";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { createPrismaDirectory } from "../../src/ledger/directory";
import type {
  BankPayoutRequest,
  BankRailProvider,
  NameEnquiryRequest,
  TopupCaptureRequest,
  TopupProvider,
} from "../../src/ledger/providers";
import { postEntry } from "../../src/ledger/post-entry";
import type { LedgerDb } from "../../src/ledger/types";

export const TEST_DATABASE_URL =
  process.env.WALLET_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_wallet_test";

let client: PrismaClient | undefined;

export function testDb(): LedgerDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as LedgerDb;
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

export interface WalletPolicyOverrides {
  readonly velocityWindowMinutes?: number;
  readonly velocityMaxTransfers?: number;
  readonly velocityMaxAmountMinor?: number;
  readonly newRecipientHoldAboveMinor?: number;
  readonly pinLockMinutes?: number;
  readonly pinResetCoolingMinutes?: number;
  readonly pinResetCoolingCapMinor?: number;
  readonly returnRequestWindowHours?: number;
  readonly disputeWindowHours?: number;
  readonly nipReversalWindowHours?: number;
  readonly riskReviewSlaMinutes?: number;
  readonly reconBreakSlaHours?: number;
}

export interface SeedCityOptions {
  readonly currency?: string;
  readonly timezone?: string;
  readonly serviceFeePct?: number;
  readonly maxPinAttempts?: number;
  readonly dailyOutMinor?: number;
  readonly singleTransferMinor?: number;
  readonly balanceCapMinor?: number | null;
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly policy?: WalletPolicyOverrides;
  readonly omitWalletPolicy?: boolean;
}

export interface SeededCity {
  readonly cityId: string;
  readonly currency: string;
  readonly timezone: string;
}

/**
 * A city whose config carries everything the wallet reads: currency, tiers,
 * service fee, PIN policy and the wallet policy block.
 */
export async function seedCity(
  db: LedgerDb,
  options: SeedCityOptions = {},
): Promise<SeededCity> {
  const cityId = uid("city");
  const currency = options.currency ?? "NGN";
  const timezone = options.timezone ?? "Africa/Lagos";

  const config: Record<string, unknown> = {
    cityId,
    version: 1,
    currency,
    currencyFractionDigits: 2,
    locale: "en-NG",
    timezone,
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
    maxPinAttempts: options.maxPinAttempts ?? 3,
    paymentMethods: [
      { id: "wallet", available: true },
      { id: "card", available: true },
      { id: "cash", available: true },
      { id: "bank_transfer", available: false, reason: "not enabled in this city yet" },
    ],
    kycTiers: [
      {
        tier: "tier1",
        dailyOutMinor: options.dailyOutMinor ?? 5_000_000,
        singleTransferMinor: options.singleTransferMinor ?? 2_000_000,
        balanceCapMinor:
          options.balanceCapMinor === undefined ? 30_000_000 : options.balanceCapMinor,
      },
      {
        tier: "tier2",
        dailyOutMinor: 50_000_000,
        singleTransferMinor: 20_000_000,
        balanceCapMinor: null,
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

  if (!options.omitWalletPolicy) {
    config.walletPolicy = {
      velocityWindowMinutes: options.policy?.velocityWindowMinutes ?? 60,
      velocityMaxTransfers: options.policy?.velocityMaxTransfers ?? 20,
      velocityMaxAmountMinor: options.policy?.velocityMaxAmountMinor ?? 100_000_000,
      newRecipientHoldAboveMinor:
        options.policy?.newRecipientHoldAboveMinor ?? 100_000_000,
      pinLockMinutes: options.policy?.pinLockMinutes ?? 30,
      pinResetCoolingMinutes: options.policy?.pinResetCoolingMinutes ?? 120,
      pinResetCoolingCapMinor: options.policy?.pinResetCoolingCapMinor ?? 500_000,
      returnRequestWindowHours: options.policy?.returnRequestWindowHours ?? 48,
      disputeWindowHours: options.policy?.disputeWindowHours ?? 48,
      nipReversalWindowHours: options.policy?.nipReversalWindowHours ?? 24,
      riskReviewSlaMinutes: options.policy?.riskReviewSlaMinutes ?? 60,
      reconBreakSlaHours: options.policy?.reconBreakSlaHours ?? 24,
    };
  }

  await db.city.create({
    data: { id: cityId, name: cityId, country: "NG", timezone, active: true },
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

  const flags = options.flags ?? { wallet_p2p: true, wallet_nip: true, tips: true };
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

  return { cityId, currency, timezone };
}

export interface SeededUser {
  readonly id: string;
  readonly phone: string;
  readonly displayName: string;
}

export async function seedUser(db: LedgerDb, name = "Ada"): Promise<SeededUser> {
  counter += 1;
  const suffix = uid("u").replace(/[^a-z0-9]/gi, "");
  // A real E.164 number: the directory only resolves recipients by one.
  const digits = [
    String(Date.now() % 1_000_000).padStart(6, "0"),
    String(process.pid % 1_000).padStart(3, "0"),
    String(counter % 1_000).padStart(3, "0"),
  ].join("");
  const phone = `+234${digits}`;
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      phone,
      passwordHash: "not-a-real-hash",
      firstName: name,
      lastName: "Tester",
      country: "NG",
      status: "ACTIVE",
    },
  });
  return { id: user.id, phone, displayName: `${name} Tester` };
}

/** Records every call so a test can prove the compensation actually happened. */
export class RecordingTopupRail implements TopupProvider {
  readonly captures: TopupCaptureRequest[] = [];
  readonly refunds: string[] = [];

  constructor(private readonly failCapture = false) {}

  async capture(request: TopupCaptureRequest): Promise<{ pspRef: string }> {
    if (this.failCapture) {
      throw new Error("rail refused the capture");
    }
    this.captures.push(request);
    return { pspRef: `psp_${this.captures.length}_${request.idempotencyKey.slice(-8)}` };
  }

  async refund(pspRef: string): Promise<void> {
    this.refunds.push(pspRef);
  }
}

export class RecordingBankRail implements BankRailProvider {
  readonly payouts: BankPayoutRequest[] = [];
  private sessions = 0;

  constructor(private readonly accountName: string | null = "Bola Recipient") {}

  async nameEnquiry(
    request: NameEnquiryRequest,
  ): Promise<{ accountName: string; sessionId: string } | null> {
    if (this.accountName === null) {
      return null;
    }
    this.sessions += 1;
    return {
      accountName: this.accountName,
      sessionId: `sess_${request.accountNumber}_${this.sessions}_${uid("s")}`,
    };
  }

  async sendPayout(request: BankPayoutRequest): Promise<{ sessionId: string }> {
    this.payouts.push(request);
    return { sessionId: request.idempotencyKey };
  }
}

export interface DepsOptions {
  readonly bankRail?: BankRailProvider | null;
  readonly topupRail?: TopupProvider | null;
  readonly now?: () => Date;
}

export function makeDeps(db: LedgerDb, options: DepsOptions = {}): WalletDeps {
  return {
    db,
    config: createCityConfigProvider(db),
    directory: createPrismaDirectory(db),
    bankRail: options.bankRail ?? null,
    topupRail: options.topupRail ?? null,
    now: options.now ?? (() => new Date()),
  };
}

/** Puts money in a wallet the way a top-up would, so tests start from a real balance. */
export async function fundWallet(
  db: LedgerDb,
  walletId: string,
  currency: string,
  amountMinor: number,
): Promise<void> {
  await db.$transaction((tx) =>
    postEntry(tx, {
      kind: "topup",
      reference: `topup:${uid("seed")}`,
      occurredAt: new Date(),
      lines: [
        {
          account: "psp_settlement",
          amount: money(-amountMinor, currency),
          counterpartRef: `wallet:${walletId}`,
        },
        {
          account: "wallet",
          walletId,
          amount: money(amountMinor, currency),
          counterpartRef: `topup:${walletId}`,
        },
      ],
    }),
  );
}
