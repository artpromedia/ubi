/**
 * Fixtures for the fleet remittance settlement tests (A05).
 *
 * `FleetServiceDouble` is a faithful double of fleet-service's side of
 * INTERNAL CONTRACT B: a real HTTP server that answers
 * `GET /internal/fleet/settlement-inputs?weekStart=&cityId=` with the
 * contract's exact body, checks `X-Service-Key` in constant time and fails
 * closed (401 for a wrong or missing key, 422 for a bad query). The code
 * under test — payment-service's HTTP consumer, the settlement and the
 * ledger — runs unmodified against it and against real Postgres.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { commissionMinorFor, money } from "@ubi/contracts";

import {
  httpSettlementInputsClient,
  type SettlementInputItem,
  type SettlementInputs,
  type SettlementInputsClient,
} from "../../src/fleet/inputs";
import { addDays } from "../../src/fleet/model";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { captureHold, reserveHold } from "../../src/ledger/mp-holds";
import { postMarketplaceCompletion } from "../../src/ledger/ride-posting";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";
import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  testDb,
  uid,
  type SeededCity,
} from "../ledger/helpers";

import type { WalletDeps } from "../../src/ledger/context";
import type { LedgerDb } from "../../src/ledger/types";

export { closeTestDb, fundWallet, testDb, uid };

export const FLEET_KEY = "fleet-payment-contract-b-test-key-0001";

/** The contract example, transcribed (tests/fleet/fixtures/…example.json). */
export function exampleInputs(): SettlementInputs & { $comment?: string } {
  const raw = readFileSync(
    path.resolve(__dirname, "fixtures/settlement-inputs.example.json"),
    "utf8",
  );
  return JSON.parse(raw) as SettlementInputs & { $comment?: string };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export class FleetServiceDouble {
  private server: Server | undefined;
  private readonly weeks = new Map<string, SettlementInputs>();
  readonly requests: Array<{ cityId: string; weekStart: string }> = [];
  rejected = 0;
  /** Answer every request with this status instead (a fleet-service outage). */
  failWith: number | null = null;
  /** Answer every request with this raw body instead (a broken fleet-service). */
  rawBody: string | null = null;
  /** Answer every request with a 307 to this URL (a hijacked fleet-service). */
  redirectTo: string | null = null;

  constructor(private readonly key: string = FLEET_KEY) {}

  setWeek(cityId: string, inputs: SettlementInputs): void {
    this.weeks.set(`${cityId}|${inputs.weekStart}`, inputs);
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://double");
      const presented = req.headers["x-service-key"];
      const keyOk =
        typeof presented === "string" &&
        presented.length > 0 &&
        timingSafeEqual(digest(presented), digest(this.key));
      if (!keyOk) {
        this.rejected += 1;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "unauthorized", message: "no" }));
        return;
      }
      if (
        req.method !== "GET" ||
        url.pathname !== "/internal/fleet/settlement-inputs"
      ) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      const weekStart = url.searchParams.get("weekStart") ?? "";
      const cityId = url.searchParams.get("cityId") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || cityId.length === 0) {
        res.writeHead(422, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "validation_failed", message: "q" }));
        return;
      }
      this.requests.push({ cityId, weekStart });
      if (this.redirectTo !== null) {
        res.writeHead(307, {
          location: `${this.redirectTo}${url.pathname}${url.search}`,
        });
        res.end();
        return;
      }
      if (this.failWith !== null) {
        res.writeHead(this.failWith, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (this.rawBody !== null) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(this.rawBody);
        return;
      }
      const inputs = this.weeks.get(`${cityId}|${weekStart}`) ?? {
        weekStart,
        weekEnd: addDays(weekStart, 6),
        zone: "Africa/Lagos",
        items: [],
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(inputs));
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === undefined) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}

/** The real HTTP consumer, pointed at a double. */
export function clientFor(
  baseUrl: string,
  serviceKey = FLEET_KEY,
): SettlementInputsClient {
  return httpSettlementInputsClient(() => ({ baseUrl, serviceKey }));
}

/** A live city with the `fleet` flag as given (ON by default here). */
export async function fleetCity(
  db: LedgerDb,
  options: { fleet?: boolean; remittanceCapMinor?: number } = {},
): Promise<SeededCity> {
  const city = await seedCity(db, {
    flags: { wallet_p2p: true, fleet: options.fleet ?? true },
    remittanceCapMinor: options.remittanceCapMinor ?? 100_000_000,
  });
  return city;
}

export function depsAt(db: LedgerDb, now: Date): WalletDeps {
  return makeDeps(db, { now: () => now });
}

export interface ItemOverrides {
  readonly assignmentId?: string;
  readonly fleetId?: string;
  readonly driverId?: string;
  readonly vehicleId?: string;
  readonly termsVersion?: number;
  readonly type?: "weekly_fixed" | "percent_of_net";
  readonly amountMinor?: number | null;
  readonly percent?: number | null;
  readonly currency?: string;
  readonly maxWeeks?: number;
  readonly shift?: number;
  readonly planned?: number;
  readonly unplanned?: number;
  readonly activeFrom?: string;
  readonly activeTo?: string | null;
}

/** A contract-B item (weekly_fixed ₦25 000 over 60 signed hours by default). */
export function item(overrides: ItemOverrides = {}): SettlementInputItem {
  const type = overrides.type ?? "weekly_fixed";
  return {
    assignmentId: overrides.assignmentId ?? uid("asg"),
    fleetId: overrides.fleetId ?? uid("flt"),
    driverId: overrides.driverId ?? uid("drv"),
    vehicleId: overrides.vehicleId ?? uid("veh"),
    termsVersion: overrides.termsVersion ?? 1,
    terms: {
      type,
      amountMinor:
        overrides.amountMinor !== undefined
          ? overrides.amountMinor
          : type === "weekly_fixed"
            ? 2_500_000
            : null,
      currency: overrides.currency ?? "NGN",
      percent:
        overrides.percent !== undefined
          ? overrides.percent
          : type === "percent_of_net"
            ? 20
            : null,
      shortfall: {
        policy: "carry_forward",
        maxWeeks: overrides.maxWeeks ?? 4,
      },
    },
    shiftHoursInWeek: overrides.shift ?? 60,
    plannedMaintenanceHoursInWeek: overrides.planned ?? 0,
    unplannedOffRoadHoursInWeek: overrides.unplanned ?? 0,
    activeFrom: overrides.activeFrom ?? "2026-01-05T00:00:00Z",
    activeTo: overrides.activeTo ?? null,
  };
}

export function weekOf(
  weekStart: string,
  items: readonly SettlementInputItem[],
): SettlementInputs {
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    zone: "Africa/Lagos",
    items: [...items],
  };
}

/** The driver's marketplace wallet (owner type `user`), funded. */
export async function driverWallet(
  db: LedgerDb,
  city: SeededCity,
  driverId: string,
  fundMinor = 0,
): Promise<WalletRecord> {
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const ensured = await ensureWallet(tx, "user", driverId, config.city);
    return ensured;
  });
  if (fundMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, fundMinor);
  }
  return wallet;
}

/**
 * A real marketplace job for the driver at instant `at`, through the
 * production code: the 10% hold reserved and captured ONCE at selection
 * (`captureHold`, driver wallet → ubi_commission), then the completion
 * (`postMarketplaceCompletion`, rider wallet → driver wallet, full fare; the
 * tip on its own `tips` lines).
 */
export async function jobAt(
  db: LedgerDb,
  city: SeededCity,
  driverId: string,
  driverWalletId: string,
  fareMinor: number,
  at: Date,
  tipMinor = 0,
): Promise<{ readonly awardId: string; readonly commissionMinor: number }> {
  const deps = depsAt(db, at);
  const commissionMinor = commissionMinorFor(fareMinor);
  const reserved = await reserveHold(
    deps,
    {
      driverId,
      bidRef: uid("bid"),
      requestRef: uid("req"),
      amountMinor: commissionMinor,
      baseMinor: fareMinor,
      currency: city.currency,
      policyVersion: 1,
      cityId: city.cityId,
    },
    uid("idem"),
  );
  const awardId = uid("awd");
  await captureHold(
    deps,
    reserved.hold.reservationId,
    { awardId, expectedAmountMinor: money(commissionMinor, city.currency) },
    uid("idem"),
  );
  const rider = await driverWallet(
    db,
    city,
    uid("rider"),
    fareMinor + tipMinor,
  );
  await db.$transaction(async (tx) => {
    const completed = await postMarketplaceCompletion(tx, {
      rideId: uid("ride"),
      awardId,
      method: "wallet",
      riderWalletId: rider.id,
      driverWalletId,
      fareMinor,
      tipMinor,
      currency: city.currency,
      occurredAt: at,
      idempotencyKey: uid("idem"),
    });
    return completed;
  });
  return { awardId, commissionMinor };
}
