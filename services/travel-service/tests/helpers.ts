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
 * tests is the payment port, which lives here and nowhere near `src/`. The
 * airport-transfer suites reach ride-service through the REAL HTTP ride port
 * over a socket, against tests/ride-stub.ts (which verifies the signed identity
 * with ride-service's algorithm); every other suite gets UNWIRED_RIDES, which
 * answers nothing.
 */
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { ContractError, money } from "@ubi/contracts";

import { createCityConfigProvider } from "../src/ops/config";
import { RideUnavailableError } from "../src/ports/ride-port";

import type { TravelDeps } from "../src/ops/context";
import type {
  PaymentPort,
  PaymentRequest,
  PaymentResult,
  PaymentStatus,
} from "../src/ports/payment-port";
import type { JsonRecord, TravelDb } from "../src/ops/types";
import type { RidePort } from "../src/ports/ride-port";

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
  await db.airportTransferAction.deleteMany({});
  await db.airportTransfer.deleteMany({});
  await db.travelFlightStatusEvent.deleteMany({});
  await db.auditLog.deleteMany({ where: { subjectType: "airport_transfer" } });
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
  /**
   * Include a marketplace policy with a Book for Later block (the values
   * ride-service's own fixtures use) — what an airport transfer needs.
   */
  readonly marketplace?: boolean;
}

const FARE_BOUNDS = {
  absoluteFloorMinor: 80_000,
  costFloorMinor: 60_000,
  floorBpsOfSuggested: 7_000,
  ceilingBpsOfSuggested: 20_000,
};

const RATE_BOUNDS = { maxPerKmMinor: 50_000, maxMinimumTripFareMinor: 400_000 };

/** A MarketplacePolicySchema-valid policy; test data, never a production default. */
export const MARKETPLACE_POLICY = {
  policyVersion: 3,
  commissionBps: 1_000,
  commissionRounding: "half_up",
  fareBounds: { "ride:go": FARE_BOUNDS, "ride:comfort": FARE_BOUNDS },
  searchEnvelope: {
    initialRadiusMeters: 3_000,
    maxRadiusMeters: 9_000,
    initialPickupEtaSec: 600,
    maxPickupEtaSec: 1_500,
    expandAfterSec: 30,
    minOffersBeforeExpand: 2,
    expansionSteps: 3,
  },
  stationary: {
    minDwellSec: 60,
    maxSpeedMps: 1.5,
    maxLocationAgeSec: 120,
    maxAccuracyMeters: 50,
    motionCloseSec: 20,
  },
  finishingTrip: {
    maxRemainingSec: 600,
    completionBufferSec: 120,
    uncertaintyBufferSec: 60,
    corridorMaxBearingDeltaDeg: 90,
  },
  bids: {
    bidExpirySec: 120,
    requestExpirySec: 600,
    revisionCooldownSec: 15,
    maxLiveBidsPerDriver: 3,
    maxOpenRequestsPerRequester: 2,
  },
  queue: { pickupWindowToleranceSec: 300 },
  rateProfileBounds: { "ride:go": RATE_BOUNDS, "ride:comfort": RATE_BOUNDS },
  scheduling: {
    scheduledRequests: {
      publishLeadSec: 1_800,
      minLeadSec: 3_600,
      maxHorizonSec: 1_209_600,
      defaultWindowSec: 600,
      minWindowSec: 300,
      maxWindowSec: 1_800,
      reminderOffsetsSec: [43_200, 3_600],
      maxPendingPerRequester: 10,
    },
  },
};

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
    paymentMethods: [{ id: "wallet", available: true }],
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
      codes: ["LOS", "ABV"],
      arrivalBufferMin: 45,
      checkInCutoffMin: 60,
      trafficBufferMin: 30,
      doors: { LOS: "D" },
    },
    taxes: { vat: 7.5 },
    ...(options.marketplace === true
      ? { marketplace: MARKETPLACE_POLICY }
      : {}),
  };

  await db.city.create({
    data: {
      id: cityId,
      name: cityId,
      country: "NG",
      timezone: "Africa/Lagos",
      active: true,
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
    {
      id: "transcorp",
      name: "Transcorp Hilton",
      area: "Maitama",
      distanceKm: 2.1,
      fromPriceMinor: 37_000_000,
    },
    {
      id: "fraser",
      name: "Fraser Suites",
      area: "Central Area",
      distanceKm: 3.4,
      fromPriceMinor: 41_260_000,
    },
  ],
  rates: [
    {
      id: "transcorp-king",
      propertyId: "transcorp",
      roomName: "King Deluxe",
      board: "breakfast included",
      payNowMinor: 37_000_000,
      cancellation: {
        freeUntil: "2026-09-11T12:00:00+01:00",
        penaltyAfter: "one night charged",
      },
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
      cancellation: {
        freeUntil: "2026-09-10T12:00:00+01:00",
        penaltyAfter: "first night charged",
      },
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
  const supplier = await db.travelSupplier.findUnique({
    where: { id: supplierId },
  });
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
//
// It mirrors payment-service's /v1/finance/travel item semantics (see
// services/payment-service/src/finance/travel.ts) closely enough that the
// travel flows cannot pass here and fail there: one item per order, a replay
// under the SAME key answers the original posting, a second capture under a
// DIFFERENT key is a 409 `illegal_transition`, and `status()` reads back what
// was recorded. `failNext` injects the two ambiguities a network can cause —
// a response lost AFTER the posting applied, and no answer BEFORE it applied —
// with the exact error shapes the HTTP port raises. The real payment-service
// is exercised in payment-port.test.ts.

export interface PaymentCall {
  readonly op: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
}

type FakeOp = "authorize" | "capture" | "release" | "refund";
type FaultMode = "lose_response" | "no_answer";

interface FakeItem {
  itemId: string;
  orderId: string;
  state:
    | "authorized"
    | "captured"
    | "released"
    | "partially_refunded"
    | "refunded";
  currency: string;
  authorizedMinor: number;
  capturedMinor: number;
  refundedMinor: number;
  captureEntryId: string | null;
}

interface FakeRecordedOp {
  ref: string;
  op: FakeOp;
  clientKey: string;
  amountMinor: number;
  entryId: string | null;
  createdAt: string;
}

function unknownOutcome(op: string, orderId: string): ContractError {
  return new ContractError(
    "service_unavailable",
    `payment-service did not answer; whether the ${op} happened is unknown`,
    { op, orderId, outcome: "unknown" },
  );
}

function refused(status: number, code: string, op: string): ContractError {
  return new ContractError(
    "service_unavailable",
    `payment-service could not ${op} this order`,
    { status, paymentCode: code },
  );
}

export class FakePayment implements PaymentPort {
  readonly calls: PaymentCall[] = [];
  private readonly byKey = new Map<string, PaymentResult>();
  private readonly items = new Map<string, FakeItem>();
  private readonly log = new Map<string, FakeRecordedOp[]>();
  private readonly faults: { op: FakeOp; mode: FaultMode }[] = [];
  private sequence = 0;

  /** The next `op` call fails with `mode` (once). */
  failNext(op: FakeOp, mode: FaultMode): void {
    this.faults.push({ op, mode });
  }

  private takeFault(op: FakeOp): FaultMode | null {
    const index = this.faults.findIndex((fault) => fault.op === op);
    if (index === -1) return null;
    const [fault] = this.faults.splice(index, 1);
    return fault?.mode ?? null;
  }

  private apply(op: FakeOp, request: PaymentRequest): PaymentResult {
    const keyed = `${op}:${request.idempotencyKey}`;
    const seen = this.byKey.get(keyed);
    if (seen !== undefined) {
      return { ...seen, replayed: true };
    }
    const amount = request.amount.amountMinor;
    let item = this.items.get(request.orderId);
    let entryId: string | null = null;
    if (op === "authorize") {
      if (item !== undefined) throw refused(409, "conflict", op);
      item = {
        itemId: `tpi_${request.orderId}`,
        orderId: request.orderId,
        state: "authorized",
        currency: request.amount.currency,
        authorizedMinor: amount,
        capturedMinor: 0,
        refundedMinor: 0,
        captureEntryId: null,
      };
      this.items.set(request.orderId, item);
    } else {
      if (item === undefined) throw refused(404, "not_found", op);
      if (op === "capture") {
        if (item.state !== "authorized")
          throw refused(409, "illegal_transition", op);
        if (amount > item.authorizedMinor) throw refused(409, "conflict", op);
        entryId = `je_cap_${request.orderId}`;
        item.state = "captured";
        item.capturedMinor = amount;
        item.captureEntryId = entryId;
      } else if (op === "release") {
        if (item.state !== "authorized")
          throw refused(409, "illegal_transition", op);
        if (amount !== item.authorizedMinor) throw refused(409, "conflict", op);
        item.state = "released";
      } else {
        if (item.state !== "captured" && item.state !== "partially_refunded") {
          throw refused(409, "illegal_transition", op);
        }
        if (amount > item.capturedMinor - item.refundedMinor) {
          throw refused(409, "conflict", op);
        }
        item.refundedMinor += amount;
        item.state =
          item.refundedMinor === item.capturedMinor
            ? "refunded"
            : "partially_refunded";
        entryId = `je_ref_${this.sequence + 1}`;
      }
    }
    this.sequence += 1;
    const ref = `${op}_${this.sequence}_${Math.abs(hash(request.idempotencyKey))}`;
    const result: PaymentResult = {
      ref,
      entryId,
      amount: request.amount,
      replayed: false,
    };
    this.byKey.set(keyed, result);
    const entries = this.log.get(request.orderId) ?? [];
    entries.push({
      ref,
      op,
      clientKey: request.idempotencyKey,
      amountMinor: amount,
      entryId,
      createdAt: new Date().toISOString(),
    });
    this.log.set(request.orderId, entries);
    return result;
  }

  private call(op: FakeOp, request: PaymentRequest): PaymentResult {
    this.calls.push({
      op,
      orderId: request.orderId,
      amountMinor: request.amount.amountMinor,
      idempotencyKey: request.idempotencyKey,
    });
    const fault = this.takeFault(op);
    if (fault === "no_answer") {
      throw unknownOutcome(op, request.orderId);
    }
    const result = this.apply(op, request);
    if (fault === "lose_response") {
      throw unknownOutcome(op, request.orderId);
    }
    return result;
  }

  async authorize(request: PaymentRequest): Promise<PaymentResult> {
    return this.call("authorize", request);
  }
  async capture(request: PaymentRequest): Promise<PaymentResult> {
    return this.call("capture", request);
  }
  async release(request: PaymentRequest): Promise<PaymentResult> {
    return this.call("release", request);
  }
  async refund(request: PaymentRequest): Promise<PaymentResult> {
    return this.call("refund", request);
  }

  async status(orderId: string): Promise<PaymentStatus | null> {
    const item = this.items.get(orderId);
    if (item === undefined) return null;
    const m = (amountMinor: number) => ({
      amountMinor,
      currency: item.currency,
    });
    return {
      item: {
        itemId: item.itemId,
        orderId,
        state: item.state,
        authorized: m(item.authorizedMinor),
        captured: m(item.capturedMinor),
        refunded: m(item.refundedMinor),
        refundable: m(item.capturedMinor - item.refundedMinor),
        captureEntryId: item.captureEntryId,
      },
      ops: (this.log.get(orderId) ?? []).map((op) => ({
        ref: op.ref,
        op: op.op,
        clientKey: op.clientKey,
        amount: m(op.amountMinor),
        entryId: op.entryId,
        createdAt: op.createdAt,
      })),
    };
  }

  /** Calls made for `op`, replays and failed attempts included. */
  countOp(op: string): number {
    return this.calls.filter((call) => call.op === op).length;
  }

  /** Postings that actually moved state for `op` (replays excluded). */
  appliedOps(orderId: string, op: FakeOp): number {
    return (this.log.get(orderId) ?? []).filter((entry) => entry.op === op)
      .length;
  }

  /** The item state payment-service would report. */
  itemState(orderId: string): string | null {
    return this.items.get(orderId)?.state ?? null;
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
  readonly rides?: RidePort;
  readonly now?: () => Date;
}

/**
 * The ride port suites that never reach ride-service get: every call is an
 * honest "unavailable" (the outcome-unknown error the HTTP port raises), so a
 * stray call can never look like a ride-service answer.
 */
export const UNWIRED_RIDES: RidePort = {
  quote: unwired,
  createScheduledRequest: unwired,
  getScheduledRequest: unwired,
  cancelScheduledRequest: unwired,
  approveScheduledRequest: unwired,
  cancelRequest: unwired,
};

function unwired(): Promise<never> {
  return Promise.reject(
    new RideUnavailableError(
      "ride-service is not wired in this test",
      "ride_unreachable",
    ),
  );
}

export function makeDeps(
  db: TravelDb,
  options: DepsOptions = {},
): {
  deps: TravelDeps;
  payment: FakePayment;
} {
  const payment = options.payment ?? new FakePayment();
  const deps: TravelDeps = {
    db,
    config: createCityConfigProvider(db),
    payment,
    rides: options.rides ?? UNWIRED_RIDES,
    now: options.now ?? (() => new Date()),
  };
  return { deps, payment: payment as FakePayment };
}

export function rider(): { id: string; role: string } {
  return { id: uid("rider"), role: "rider" };
}

/** A rider whose id is a UUID — the only user id ride-service accepts. */
export function uuidRider(): { id: string; role: string } {
  return { id: randomUUID(), role: "rider" };
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
