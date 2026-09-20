/**
 * The `/v1/wallet/mp` HTTP surface (routes/mp-holds.ts): who may call what,
 * and the wire shapes of contracts/openapi/marketplace.yaml.
 *
 * The money semantics live in mp-holds.test.ts / mp-settlement.test.ts; this
 * file pins the route layer — the service-key guard fails CLOSED, both
 * overview variants exist for their two different callers, and the request
 * bodies are the contract's.
 *
 * This file sets and clears INTERNAL_SERVICE_KEY on purpose — the fail-closed
 * test IS about the unset variable — so the turbo env-declaration lint does
 * not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { money } from "@ubi/contracts";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeededCity,
} from "./helpers";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { reserveHold } from "../../src/ledger/mp-holds";
import { ensureWallet, type WalletRecord } from "../../src/ledger/wallets";
import { createMpHoldRoutes } from "../../src/routes/mp-holds";


const db = testDb();
const deps = makeDeps(db);
const app = createMpHoldRoutes(deps);

const INTERNAL_KEY = "mp-routes-test-internal-key";
let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.INTERNAL_SERVICE_KEY;
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
});

const createdWalletIds: string[] = [];

afterAll(async () => {
  if (savedKey === undefined) {
    delete process.env.INTERNAL_SERVICE_KEY;
  } else {
    process.env.INTERNAL_SERVICE_KEY = savedKey;
  }
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: createdWalletIds } },
  });
  await closeTestDb();
});

interface Party {
  readonly city: SeededCity;
  readonly userId: string;
  readonly wallet: WalletRecord;
}

async function fundedDriver(amountMinor: number): Promise<Party> {
  const city = await seedCity(db);
  const user = await seedUser(db, "Driver");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) => {
    const created = await ensureWallet(tx, "user", user.id, config.city);
    return created;
  });
  createdWalletIds.push(wallet.id);
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { city, userId: user.id, wallet };
}

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "X-Service-Key": INTERNAL_KEY,
    "Idempotency-Key": uid("idem"),
    ...extra,
  };
}

function reserveBody(party: Party, commissionMinor: number) {
  return {
    driverId: party.userId,
    bidId: uid("bid"),
    requestId: uid("req"),
    amountMinor: money(commissionMinor, party.city.currency),
    baseMinor: money(commissionMinor * 10, party.city.currency),
    policyVersion: 1,
    cityId: party.city.cityId,
  };
}

describe("the internal service-key guard", () => {
  it("refuses a request without the key, and one with the wrong key", async () => {
    const driver = await fundedDriver(1_000_00);

    const noKey = await app.request("/holds/reserve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": uid("idem"),
      },
      body: JSON.stringify(reserveBody(driver, 100_00)),
    });
    expect(noKey.status).toBe(403);

    const wrongKey = await app.request("/holds/reserve", {
      method: "POST",
      headers: serviceHeaders({ "X-Service-Key": "not-the-key" }),
      body: JSON.stringify(reserveBody(driver, 100_00)),
    });
    expect(wrongKey.status).toBe(403);
  });

  it("fails CLOSED when INTERNAL_SERVICE_KEY is unset or empty", async () => {
    const driver = await fundedDriver(1_000_00);
    const attempt = async (): Promise<Response> => {
      // No X-Service-Key — the exact shape the gateway forwards after
      // stripping the header. Under the old `!==` guard this matched an
      // unset env var (`undefined !== undefined` is false) and the money
      // endpoint answered without any credential.
      const response = await app.request("/holds/reserve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": uid("idem"),
        },
        body: JSON.stringify(reserveBody(driver, 100_00)),
      });
      return response;
    };

    delete process.env.INTERNAL_SERVICE_KEY;
    try {
      expect((await attempt()).status).toBe(403);
      process.env.INTERNAL_SERVICE_KEY = "";
      expect((await attempt()).status).toBe(403);
    } finally {
      process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    }
    // Nothing was reserved through the mis-provisioned window.
    expect(
      await db.mpCommissionHold.count({ where: { walletId: driver.wallet.id } }),
    ).toBe(0);
  });
});

describe("GET /overview (the driver's own wallet)", () => {
  it("accepts the city as a query parameter", async () => {
    const driver = await fundedDriver(1_000_00);
    const response = await app.request(
      `/overview?cityId=${encodeURIComponent(driver.city.cityId)}`,
      { headers: { "X-User-ID": driver.userId } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.clearedMinor).toEqual(money(1_000_00, driver.city.currency));
    expect(body.spendableMinor).toEqual(money(1_000_00, driver.city.currency));
  });

  it("accepts the city as an X-City-ID header", async () => {
    const driver = await fundedDriver(500_00);
    const response = await app.request("/overview", {
      headers: { "X-User-ID": driver.userId, "X-City-ID": driver.city.cityId },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.clearedMinor).toEqual(money(500_00, driver.city.currency));
  });

  it("still refuses a request that names no city at all", async () => {
    const driver = await fundedDriver(0);
    const response = await app.request("/overview", {
      headers: { "X-User-ID": driver.userId },
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("city_unsupported");
  });
});

describe("GET /holds/overview (the engine names the driver)", () => {
  it("returns the named driver's overview under the service key", async () => {
    const driver = await fundedDriver(1_000_00);
    await reserveHold(
      deps,
      {
        driverId: driver.userId,
        bidRef: uid("bid"),
        requestRef: uid("req"),
        amountMinor: 300_00,
        baseMinor: 3_000_00,
        currency: driver.city.currency,
        policyVersion: 1,
        cityId: driver.city.cityId,
      },
      uid("idem"),
    );

    const response = await app.request(
      `/holds/overview?driverId=${encodeURIComponent(driver.userId)}&cityId=${encodeURIComponent(driver.city.cityId)}`,
      { headers: { "X-Service-Key": INTERNAL_KEY } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      clearedMinor: unknown;
      heldMinor: unknown;
      spendableMinor: unknown;
      holds: unknown[];
    };
    expect(body.clearedMinor).toEqual(money(1_000_00, driver.city.currency));
    expect(body.heldMinor).toEqual(money(300_00, driver.city.currency));
    expect(body.spendableMinor).toEqual(money(700_00, driver.city.currency));
    expect(body.holds).toHaveLength(1);
  });

  it("is service-only and insists on both query parameters", async () => {
    const driver = await fundedDriver(0);

    const noKey = await app.request(
      `/holds/overview?driverId=${driver.userId}&cityId=${driver.city.cityId}`,
    );
    expect(noKey.status).toBe(403);

    const noDriver = await app.request(
      `/holds/overview?cityId=${driver.city.cityId}`,
      { headers: { "X-Service-Key": INTERNAL_KEY } },
    );
    expect(noDriver.status).toBe(422);

    const noCity = await app.request(
      `/holds/overview?driverId=${driver.userId}`,
      { headers: { "X-Service-Key": INTERNAL_KEY } },
    );
    expect(noCity.status).toBe(422);
  });
});

describe("POST /holds/:id/capture wire shape", () => {
  it("requires the award's pinned expectedAmountMinor as Money", async () => {
    const driver = await fundedDriver(1_000_00);
    const reserve = await app.request("/holds/reserve", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(reserveBody(driver, 500_00)),
    });
    expect(reserve.status).toBe(201);
    const hold = (await reserve.json()) as { reservationId: string };

    // The old body — awardId alone — is no longer a legal capture.
    const legacy = await app.request(
      `/holds/${hold.reservationId}/capture`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ awardId: uid("awd") }),
      },
    );
    expect(legacy.status).toBe(422);

    const awardId = uid("awd");
    const captured = await app.request(
      `/holds/${hold.reservationId}/capture`,
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          awardId,
          expectedAmountMinor: money(500_00, driver.city.currency),
        }),
      },
    );
    expect(captured.status).toBe(200);
    const body = (await captured.json()) as {
      hold: { state: string };
      receiptId: string;
      journalEntryId: string;
    };
    expect(body.hold.state).toBe("captured");
    expect(body.receiptId).toBeTruthy();
  });

  it("refuses Money bodies whose currencies disagree", async () => {
    const driver = await fundedDriver(1_000_00);
    const response = await app.request("/holds/reserve", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        ...reserveBody(driver, 500_00),
        baseMinor: money(5_000_00, "GHS"),
      }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });
});

describe("POST /settlements", () => {
  async function settlementScenario() {
    const city = await seedCity(db);
    const riderUser = await seedUser(db, "Rider");
    const driverUser = await seedUser(db, "Driver");
    const config = await createCityConfigProvider(db).load(city.cityId);
    const riderWallet = await db.$transaction(async (tx) => {
      const created = await ensureWallet(tx, "user", riderUser.id, config.city);
      return created;
    });
    const driverWallet = await db.$transaction(async (tx) => {
      const created = await ensureWallet(
        tx,
        "user",
        driverUser.id,
        config.city,
      );
      return created;
    });
    createdWalletIds.push(riderWallet.id, driverWallet.id);
    await fundWallet(db, riderWallet.id, city.currency, 10_000_00);
    return { city, riderUser, driverUser, riderWallet, driverWallet };
  }

  it("settles a wallet trip per the OpenAPI shape", async () => {
    const s = await settlementScenario();
    const body = {
      awardId: uid("awd"),
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: s.riderUser.id,
      driverId: s.driverUser.id,
      fareMinor: money(5_000_00, s.city.currency),
      method: "wallet",
      cityId: s.city.cityId,
    };
    const response = await app.request("/settlements", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      settled: boolean;
      method: string;
      journalEntryId?: string;
    };
    expect(result.settled).toBe(true);
    expect(result.method).toBe("wallet");
    expect(result.journalEntryId).toBeTruthy();

    // Replays through the wire return the same outcome.
    const replay = await app.request("/settlements", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect(
      ((await replay.json()) as { journalEntryId?: string }).journalEntryId,
    ).toBe(result.journalEntryId);
  });

  it("answers {settled:true, method:'cash'} for a cash trip that posts nothing", async () => {
    const s = await settlementScenario();
    const response = await app.request("/settlements", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        awardId: uid("awd"),
        executionRef: { service: "ride", id: uid("ride") },
        requesterId: s.riderUser.id,
        driverId: s.driverUser.id,
        fareMinor: money(5_000_00, s.city.currency),
        method: "cash",
        cityId: s.city.cityId,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settled: true, method: "cash" });
  });

  it("is internal-only and requires an Idempotency-Key", async () => {
    const s = await settlementScenario();
    const body = JSON.stringify({
      awardId: uid("awd"),
      executionRef: { service: "ride", id: uid("ride") },
      requesterId: s.riderUser.id,
      driverId: s.driverUser.id,
      fareMinor: money(5_000_00, s.city.currency),
      method: "wallet",
      cityId: s.city.cityId,
    });

    const noKey = await app.request("/settlements", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": uid("idem"),
      },
      body,
    });
    expect(noKey.status).toBe(403);

    const noIdem = await app.request("/settlements", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Key": INTERNAL_KEY,
      },
      body,
    });
    expect(noIdem.status).toBe(422);
  });
});
