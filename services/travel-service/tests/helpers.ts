/**
 * Fixtures and wiring for the travel-service tests.
 *
 * These run against a REAL PostgreSQL database: the per-item order rows, the
 * transactional outbox, the unique idempotency keys that make a replay a replay,
 * and the (supplier_id, external_id) webhook dedupe index are all enforced by
 * Postgres, not by a mock's memory.
 *
 * The supply "provider" is the deterministic fixture adapter, driven entirely by
 * the `travel_suppliers.config` seeded here — the README cast (Air Peace P4 7120,
 * Ibom Air QI 0312/0316, Transcorp Hilton, Fraser Suites). The one fake in these
 * tests is the payment port, which lives here and nowhere near `src/`.
 */
import { PrismaClient } from "@prisma/client";

import { money } from "@ubi/contracts";

import { createCityConfigProvider } from "../src/ops/config";

import type { TravelDeps } from "../src/ops/context";
import type { PaymentPort, PaymentRequest, PaymentResult } from "../src/ports/payment-port";
import type { JsonRecord, TravelDb } from "../src/ops/types";

export const TEST_DATABASE_URL =
  process.env.TRAVEL_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_travel_test";

let client: PrismaClient | undefined;

export function testDb(): TravelDb {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
      log: ["error"],
    });
  }
  return client as unknown as TravelDb;
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

/**
 * Removes every travel row so each test starts from an empty catalog. Sequential
 * file execution (fileParallelism:false) means one test's suppliers never leak
 * into another's `pickSupplier`.
 */
export async function resetTravel(db: TravelDb): Promise<void> {
  await db.rideReservationLink.deleteMany({});
  await db.travelDocument.deleteMany({});
  await db.travelOrderEvent.deleteMany({});
  await db.travelSettlement.deleteMany({});
  await db.travelDisruption.deleteMany({});
  await db.travelRefund.deleteMany({});
  await db.travelWebhook.deleteMany({});
  await db.travelOrder.deleteMany({});
  await db.travelCart.deleteMany({});
  await db.travelSearch.deleteMany({});
  await db.travelCapabilitiesLog.deleteMany({});
  await db.travelCommercialRate.deleteMany({});
  await db.travelTrip.deleteMany({});
  await db.travelSupplier.deleteMany({});
  await db.outboxEvent.deleteMany({});
}

// ---------------------------------------------------------------------------
// City fixture
// ---------------------------------------------------------------------------

export interface SeedCityOptions {
  readonly flags?: Record<string, boolean>;
}

export async function seedCity(
  db: TravelDb,
  options: SeedCityOptions = {},
): Promise<string> {
  const cityId = uid("city");
  const config: Record<string, unknown> = {
    cityId,
    version: 1,
    currency: "NGN",
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
    cancelPolicy: { riderFeeAfterAssignMinor: 30_000, driverFeeMinor: 0, freeWindowSec: 120 },
    pinRequired: true,
    quoteTtlSec: 120,
    offerTtlSec: 20,
    matchingRings: [{ radiusMeters: 1500, maxCandidates: 8 }],
    arrivedGeofenceMeters: 120,
    maxPinAttempts: 3,
    paymentMethods: [{ id: "wallet", available: true }],
    kycTiers: [
      { tier: "tier1", dailyOutMinor: 5_000_000, singleTransferMinor: 2_000_000, balanceCapMinor: 30_000_000 },
    ],
    serviceFeePct: 20,
    remittanceCapMinor: 1_000_000,
    reservationFreeReleaseSec: 900,
    airport: {
      codes: ["LOS", "ABV"],
      arrivalBufferMin: 45,
      checkInCutoffMin: 60,
      trafficBufferMin: 30,
      doors: { LOS: "D" },
    },
    taxes: { vat: 7.5 },
  };

  await db.city.create({
    data: { id: cityId, name: cityId, country: "NG", timezone: "Africa/Lagos", active: true },
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

  const flags = options.flags ?? {
    flights_booking: true,
    stays_booking: true,
    reservations: true,
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

// ---------------------------------------------------------------------------
// Supplier fixtures (the README cast lives in config, not in src)
// ---------------------------------------------------------------------------

const FLIGHT_CATALOG = {
  flights: [
    {
      offerRef: "AP-P4-7120",
      carrier: "Air Peace",
      flightNumber: "P4 7120",
      from: "LOS",
      to: "ABV",
      departAt: "2026-09-12T06:45:00+01:00",
      arriveAt: "2026-09-12T08:00:00+01:00",
      durationMin: 75,
      stops: 0,
      fareFamilies: [
        {
          id: "saver",
          name: "Saver",
          priceMinor: 14_850_000,
          baseMinor: 14_010_000,
          taxesMinor: 840_000,
          baggage: "20 kg checked",
          changeRule: "change ₦15,000 + fare difference",
          refundRule: "non-refundable (taxes refundable)",
          protectionOffered: true,
          seatsLeft: 5,
        },
      ],
      capabilities: {
        holdSupported: false,
        merchantOfRecord: "ubi",
        changeSupported: true,
        refundSupported: false,
        currency: "NGN",
      },
    },
    {
      offerRef: "QI-0312",
      carrier: "Ibom Air",
      flightNumber: "QI 0312",
      from: "LOS",
      to: "ABV",
      departAt: "2026-09-12T07:10:00+01:00",
      arriveAt: "2026-09-12T08:25:00+01:00",
      durationMin: 75,
      stops: 0,
      fareFamilies: [
        {
          id: "eco",
          name: "Economy",
          priceMinor: 13_900_000,
          taxesMinor: 790_000,
          baggage: "20 kg checked",
          changeRule: "change ₦12,000 + fare difference",
          refundRule: "partially refundable",
        },
      ],
      capabilities: {
        holdSupported: true,
        holdExpiresAt: "2026-09-10T00:00:00Z",
        merchantOfRecord: "supplier",
        changeSupported: true,
        refundSupported: true,
        currency: "NGN",
      },
    },
  ],
};

const STAY_CATALOG = {
  properties: [
    { id: "transcorp", name: "Transcorp Hilton", area: "Maitama", distanceKm: 2.1, fromPriceMinor: 37_000_000 },
    { id: "fraser", name: "Fraser Suites", area: "Central Area", distanceKm: 3.4, fromPriceMinor: 41_260_000 },
  ],
  rates: [
    {
      id: "transcorp-king",
      propertyId: "transcorp",
      roomName: "King Deluxe",
      board: "breakfast included",
      payNowMinor: 37_000_000,
      cancellation: { freeUntil: "2026-09-11T12:00:00+01:00", penaltyAfter: "one night charged" },
      capabilities: {
        holdSupported: false,
        merchantOfRecord: "ubi",
        changeSupported: false,
        refundSupported: true,
        currency: "NGN",
        payAtProperty: false,
      },
    },
    {
      id: "fraser-suite",
      propertyId: "fraser",
      roomName: "One-Bedroom Suite",
      board: "room only",
      payNowMinor: 41_260_000,
      supplierPriceMinor: 26_200,
      supplierCurrency: "USD",
      fxRate: 1574.8,
      fxLockedUntil: "2026-09-10T00:00:00Z",
      cancellation: { freeUntil: "2026-09-10T12:00:00+01:00", penaltyAfter: "first night charged" },
      capabilities: {
        holdSupported: false,
        merchantOfRecord: "supplier",
        changeSupported: false,
        refundSupported: true,
        currency: "NGN",
        payAtProperty: true,
      },
    },
  ],
};

export interface SeedSupplierOptions {
  readonly control?: Record<string, JsonRecord>;
  readonly cacheSeconds?: number;
  readonly enabled?: boolean;
}

export async function seedFlightSupplier(
  db: TravelDb,
  options: SeedSupplierOptions = {},
): Promise<string> {
  const id = uid("supF");
  await db.travelSupplier.create({
    data: {
      id,
      kind: "flight",
      adapter: "fixture",
      enabled: options.enabled ?? true,
      config: {
        currency: "NGN",
        webhookSecret: "flight-secret",
        cacheSeconds: options.cacheSeconds ?? 600,
        catalog: FLIGHT_CATALOG,
        control: options.control ?? {},
      } as never,
    },
  });
  return id;
}

export async function seedStaySupplier(
  db: TravelDb,
  options: SeedSupplierOptions = {},
): Promise<string> {
  const id = uid("supS");
  await db.travelSupplier.create({
    data: {
      id,
      kind: "stay",
      adapter: "fixture",
      enabled: options.enabled ?? true,
      config: {
        currency: "NGN",
        webhookSecret: "stay-secret",
        cacheSeconds: options.cacheSeconds ?? 1800,
        catalog: STAY_CATALOG,
        control: options.control ?? {},
      } as never,
    },
  });
  return id;
}

/** Merges control entries into a supplier's config — used to simulate the supplier
 *  later knowing a booking under UBI's own reference (reconcile), or a reprice. */
export async function setControl(
  db: TravelDb,
  supplierId: string,
  key: string,
  control: JsonRecord,
): Promise<void> {
  const supplier = await db.travelSupplier.findUnique({ where: { id: supplierId } });
  if (supplier === null) throw new Error("no such supplier");
  const config = (supplier.config ?? {}) as Record<string, unknown>;
  const existing = (config.control ?? {}) as Record<string, unknown>;
  const merged = { ...config, control: { ...existing, [key]: control } };
  await db.travelSupplier.update({
    where: { id: supplierId },
    data: { config: merged as never },
  });
}

// ---------------------------------------------------------------------------
// Fake payment port — tests only
// ---------------------------------------------------------------------------

export interface PaymentCall {
  readonly op: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
}

export class FakePayment implements PaymentPort {
  readonly calls: PaymentCall[] = [];
  private readonly refs = new Map<string, string>();

  private record(op: string, request: PaymentRequest, entry: boolean): PaymentResult {
    this.calls.push({
      op,
      orderId: request.orderId,
      amountMinor: request.amount.amountMinor,
      idempotencyKey: request.idempotencyKey,
    });
    const seen = this.refs.get(request.idempotencyKey);
    if (seen !== undefined) {
      return {
        ref: seen,
        entryId: entry ? `je_${seen}` : null,
        amount: request.amount,
        replayed: true,
      };
    }
    const ref = `${op}_${this.refs.size + 1}_${Math.abs(hash(request.idempotencyKey))}`;
    this.refs.set(request.idempotencyKey, ref);
    return { ref, entryId: entry ? `je_${ref}` : null, amount: request.amount, replayed: false };
  }

  async authorize(request: PaymentRequest): Promise<PaymentResult> {
    return this.record("authorize", request, false);
  }
  async capture(request: PaymentRequest): Promise<PaymentResult> {
    return this.record("capture", request, true);
  }
  async release(request: PaymentRequest): Promise<PaymentResult> {
    return this.record("release", request, false);
  }
  async refund(request: PaymentRequest): Promise<PaymentResult> {
    return this.record("refund", request, true);
  }

  countOp(op: string): number {
    return this.calls.filter((call) => call.op === op).length;
  }
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Deps + headers
// ---------------------------------------------------------------------------

export interface DepsOptions {
  readonly payment?: PaymentPort;
  readonly now?: () => Date;
}

export function makeDeps(db: TravelDb, options: DepsOptions = {}): {
  deps: TravelDeps;
  payment: FakePayment;
} {
  const payment = options.payment ?? new FakePayment();
  const deps: TravelDeps = {
    db,
    config: createCityConfigProvider(db),
    payment,
    now: options.now ?? (() => new Date()),
  };
  return { deps, payment: payment as FakePayment };
}

export function rider(): { id: string; role: string } {
  return { id: uid("rider"), role: "rider" };
}

export function opsActor(): { id: string; role: string } {
  return { id: uid("ops"), role: "travel_ops" };
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

export { money };
