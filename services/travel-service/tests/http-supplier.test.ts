/**
 * Supplier readiness honesty (recheck T01 / P04 "credentials alone cannot make
 * readiness green") and the production refusal of test-only supply.
 *
 * A capability is operational only when it is implemented against a
 * documented endpoint AND its credential is present AND its base URL is
 * permitted AND — when the row opts into `probe` — a lightweight authenticated
 * probe just succeeded. `reachable` is true only after a real provider call.
 * These tests pin that health and behaviour agree capability by capability,
 * that the ops health route carries the same truth, and that production
 * configuration can never select the fixture adapter (boot refusal, runtime
 * refusal).
 *
 * This file sets TRAVEL_SECRET_* and NODE_ENV on purpose — the credential and
 * the environment are the point — so the turbo env-declaration lint does not
 * apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { spawn } from "node:child_process";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { ContractError } from "@ubi/contracts";

import { createDuffelFlightAdapter } from "../src/adapters/duffel";
import { SupplierPreflightError } from "../src/adapters/errors";
import { createNuiteeStayAdapter } from "../src/adapters/liteapi";
import {
  assertProductionSupplyConfig,
  ProductionSupplyConfigError,
} from "../src/adapters/production-guard";
import { resolveFlightAdapter } from "../src/adapters/registry";
import { computeSignature } from "../src/adapters/signature";
import { createApp } from "../src/index";

import {
  closeTestDb,
  headers,
  makeDeps,
  opsActor,
  resetTravel,
  seedCity,
  seedFlightSupplier,
  TEST_DATABASE_URL,
  testDb,
  uid,
} from "./helpers";
import { SupplierStub } from "./supplier-stub";

import type { ServicingAdapter, SupplierContext } from "../src/adapters/types";
import type { JsonRecord } from "../src/ops/types";

const SECRET_REF = "readiness_test";
const SECRET_ENV = `TRAVEL_SECRET_${SECRET_REF.toUpperCase()}`;

const db = testDb();
const stub = new SupplierStub();
const savedNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  await stub.start();
});
afterAll(async () => {
  await stub.stop();
  await closeTestDb();
});
afterEach(() => {
  delete process.env[SECRET_ENV];
  process.env.NODE_ENV = savedNodeEnv;
  stub.reset();
});

function ctx(
  adapter: "duffel" | "nuitee",
  extra: JsonRecord = {},
): SupplierContext {
  return {
    supplierId: uid("sup"),
    config: {
      baseUrl: stub.url,
      bookBaseUrl: stub.url,
      secretRef: SECRET_REF,
      currency: adapter === "duffel" ? "GBP" : "USD",
      guestNationality: "US",
      countryCode: "US",
      paymentMethod: "ACC_CREDIT_CARD",
      timeoutMs: 1_000,
      ...extra,
    },
    now: () => new Date("2026-06-01T00:00:00Z"),
  };
}

/** Every operation of an adapter, called with plausible arguments. */
function operationsOf(
  adapter: ServicingAdapter & { search: unknown; rates?: unknown },
  kind: "duffel" | "nuitee",
): Record<string, (context: SupplierContext) => Promise<unknown>> {
  const ops: Record<string, (context: SupplierContext) => Promise<unknown>> = {
    refreshOffer: async (c) =>
      adapter.refreshOffer(c, kind === "duffel" ? "off_1#fare" : "offer_1"),
    book: async (c) =>
      adapter.book(c, {
        ourRef: "tord_1",
        offerRef: "off_1#fare",
        offerSnapshot: {},
        passengers: [],
        idempotencyKey: "book-key-1",
      }),
    lookup: async (c) => adapter.lookup(c, "tord_1"),
    status: async (c) => adapter.status(c, "tord_1"),
    reconcile: async (c) => adapter.reconcile(c, "tord_1"),
    quoteCancel: async (c) =>
      adapter.quoteCancel!(c, {
        ourRef: "tord_1",
        supplierRefs:
          kind === "duffel" ? { orderRef: "ord_1" } : { bookingRef: "b_1" },
        idempotencyKey: "q-1",
      }),
    cancel: async (c) =>
      adapter.cancel(c, {
        ourRef: "tord_1",
        supplierRefs:
          kind === "duffel" ? { orderRef: "ord_1" } : { bookingRef: "b_1" },
        idempotencyKey: "c-1",
        quoteRef: "ore_1",
      }),
    change: async (c) =>
      adapter.change(c, {
        ourRef: "tord_1",
        offerSnapshot: {},
        alternativeRef: "oco_1",
        idempotencyKey: "ch-1",
      }),
  };
  if (kind === "duffel") {
    const duffel = adapter as ReturnType<typeof createDuffelFlightAdapter>;
    ops.search = async (c) =>
      duffel.search(c, {
        from: "LOS",
        to: "ABV",
        departDate: "2026-10-01",
        passengers: 1,
      });
    ops.changeOffers = async (c) =>
      duffel.changeOffers(c, "ord_1", { removeSliceIds: [], add: [] });
  } else {
    const stay = adapter as ReturnType<typeof createNuiteeStayAdapter>;
    const params = {
      city: "ABV",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      guests: 1,
    };
    ops.search = async (c) => stay.search(c, params);
    ops.rates = async (c) => stay.rates(c, "prop_1", params);
  }
  return ops;
}

describe("readiness: credentials alone never make a supplier operational", () => {
  it.each([
    ["duffel", createDuffelFlightAdapter] as const,
    ["nuitee", createNuiteeStayAdapter] as const,
  ])(
    "%s without credentials: every implemented capability is non-operational and really refuses without calling out",
    async (name, factory) => {
      const adapter = factory();
      const context = ctx(name);
      const health = await adapter.providerHealth(context);
      expect(health).toMatchObject({
        implemented: true,
        operational: false,
        credentialsPresent: false,
        reachable: false,
        liveCallsBlocked: true,
        reason: "credentials_missing",
      });

      const ops = operationsOf(adapter, name);
      for (const [capability, readiness] of Object.entries(
        health.capabilities ?? {},
      )) {
        if (!readiness.implemented) {
          continue; // unsupported capabilities are covered below
        }
        expect(readiness).toEqual({
          implemented: true,
          operational: false,
          reason: "credentials_missing",
        });
        const call = ops[capability];
        expect(call, `no call wired for ${capability}`).toBeDefined();
        const failure = await call?.(context).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure, capability).toBeInstanceOf(SupplierPreflightError);
        expect((failure as SupplierPreflightError).reason).toBe(
          "credentials_missing",
        );
      }
      // Health and behaviour agree: nothing reached the supplier.
      expect(stub.requests).toHaveLength(0);
    },
  );

  it.each([
    ["duffel", createDuffelFlightAdapter, ["refund", "hold"]] as const,
    ["nuitee", createNuiteeStayAdapter, ["change", "refund", "hold"]] as const,
  ])(
    "%s with credentials: implemented capabilities operational, unsupported ones name their alternative, reachability unproven",
    async (name, factory, unsupported) => {
      process.env[SECRET_ENV] = "a-provisioned-token";
      const health = await factory().providerHealth(ctx(name));
      expect(health).toMatchObject({
        implemented: true,
        operational: true,
        credentialsPresent: true,
        liveCallsBlocked: false,
        // No probe configured: no provider call was made, so not "reachable".
        reachable: false,
        probe: "not_run",
      });
      expect(health.note).toMatch(/reachability unproven/);
      for (const capability of unsupported) {
        expect(health.capabilities?.[capability]).toMatchObject({
          implemented: false,
          operational: false,
          reason: "unsupported_by_supplier",
          alternative: expect.any(String),
        });
      }
      expect(stub.requests).toHaveLength(0);
    },
  );

  it("each capability's health names what it would refuse on — a stays row without a payment method cannot book", async () => {
    process.env[SECRET_ENV] = "a-provisioned-token";
    const context = ctx("nuitee", { paymentMethod: undefined });
    const health = await createNuiteeStayAdapter().providerHealth(context);
    expect(health.capabilities?.book).toEqual({
      implemented: true,
      operational: false,
      reason: "payment_method_not_configured",
    });
    expect(health.capabilities?.search?.operational).toBe(true);
    expect(health).toMatchObject({
      operational: false,
      reason: "payment_method_not_configured",
    });
    // …and booking really refuses on exactly that, before any call.
    const failure = await createNuiteeStayAdapter()
      .book(context, {
        ourRef: "tord_1",
        offerRef: "o",
        offerSnapshot: {
          prebookId: "p",
          quoteExpiresAt: "2026-06-01T01:00:00Z",
        },
        passengers: [],
        idempotencyKey: "k",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as SupplierPreflightError).reason).toBe(
      "payment_method_not_configured",
    );

    const noCurrency = await createNuiteeStayAdapter().providerHealth(
      ctx("nuitee", { currency: undefined }),
    );
    expect(noCurrency).toMatchObject({
      operational: false,
      reason: "config_invalid",
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("with a probe configured, readiness follows the probe: a failing probe blocks despite credentials", async () => {
    process.env[SECRET_ENV] = "a-provisioned-token";
    stub.on("GET", /^\/air\/airlines$/, () => ({
      status: 401,
      body: { errors: [{ code: "access_token_not_found" }] },
    }));
    const failing = await createDuffelFlightAdapter().providerHealth(
      ctx("duffel", { probe: true }),
    );
    expect(failing).toMatchObject({
      operational: false,
      reachable: false,
      probe: "failed",
      reason: "probe_failed",
    });
    const [probe] = stub.requestsTo("GET", /^\/air\/airlines$/);
    expect(probe?.query.get("limit")).toBe("1");
    expect(probe?.headers.authorization).toBe("Bearer a-provisioned-token");

    stub.on("GET", /^\/air\/airlines$/, () => ({
      status: 200,
      body: { data: [] },
    }));
    const passing = await createDuffelFlightAdapter().providerHealth(
      ctx("duffel", { probe: true }),
    );
    expect(passing).toMatchObject({
      operational: true,
      reachable: true,
      probe: "ok",
    });

    stub.on("GET", /^\/data\/currencies$/, () => ({
      status: 200,
      body: { data: [] },
    }));
    const stays = await createNuiteeStayAdapter().providerHealth(
      ctx("nuitee", { probe: true }),
    );
    expect(stays).toMatchObject({ operational: true, reachable: true });
    expect(
      stub.requestsTo("GET", /^\/data\/currencies$/)[0]?.headers["x-api-key"],
    ).toBe("a-provisioned-token");
  });

  it("in production an overridden base URL off the official hosts is refused — the token never leaves", async () => {
    process.env[SECRET_ENV] = "a-provisioned-token";
    process.env.NODE_ENV = "production";
    const health = await createDuffelFlightAdapter().providerHealth(
      ctx("duffel"),
    );
    expect(health).toMatchObject({
      operational: false,
      reason: "base_url_not_permitted",
    });
    const failure = await createDuffelFlightAdapter()
      .lookup(ctx("duffel"), "tord_1", { supplierRefs: { orderRef: "ord_1" } })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((failure as SupplierPreflightError).reason).toBe(
      "base_url_not_permitted",
    );
    expect(stub.requests).toHaveLength(0);
  });
});

describe("a test-mode supplier credential never sells in production", () => {
  it.each([
    ["duffel", createDuffelFlightAdapter, "duffel_test_abc123"] as const,
    ["nuitee", createNuiteeStayAdapter, "sand_abc123"] as const,
  ])(
    "%s with a test-mode credential: health is not operational and every capability refuses without calling out",
    async (name, factory, testToken) => {
      process.env[SECRET_ENV] = testToken;
      process.env.NODE_ENV = "production";
      const adapter = factory();
      // No base-URL override: the official hosts, as production runs.
      const context: SupplierContext = {
        ...ctx(name),
        config: {
          ...ctx(name).config,
          baseUrl: undefined,
          bookBaseUrl: undefined,
          probe: true,
        },
      };
      const health = await adapter.providerHealth(context);
      expect(health).toMatchObject({
        operational: false,
        credentialsPresent: true,
        reachable: false,
        liveCallsBlocked: true,
        reason: "test_credentials_in_production",
      });
      const ops = operationsOf(adapter, name);
      for (const [capability, readiness] of Object.entries(
        health.capabilities ?? {},
      )) {
        if (!readiness.implemented) {
          continue;
        }
        expect(readiness.reason, capability).toBe(
          "test_credentials_in_production",
        );
        const failure = await ops[capability]?.(context).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure, capability).toBeInstanceOf(SupplierPreflightError);
        expect((failure as SupplierPreflightError).reason).toBe(
          "test_credentials_in_production",
        );
      }
      // Outside production the same credential is exactly what a sandbox needs.
      process.env.NODE_ENV = "test";
      expect((await adapter.providerHealth(ctx(name))).reason).not.toBe(
        "test_credentials_in_production",
      );
    },
  );
});

describe("the ops providers-health route carries the same readiness truth", () => {
  beforeEach(() => resetTravel(db));

  it("shows implemented / operational / credentialsPresent / capabilities per supplier", async () => {
    const cityId = await seedCity(db);
    const credentialed = uid("supD");
    const bare = uid("supN");
    await db.travelSupplier.create({
      data: {
        id: credentialed,
        kind: "flight",
        adapter: "duffel",
        enabled: false,
        config: {
          baseUrl: stub.url,
          secretRef: SECRET_REF,
          currency: "GBP",
        } as never,
      },
    });
    await db.travelSupplier.create({
      data: {
        id: bare,
        kind: "stay",
        adapter: "nuitee",
        enabled: false,
        config: { currency: "USD", secretRef: "never_provisioned" } as never,
      },
    });
    process.env[SECRET_ENV] = "a-provisioned-token";

    const { deps } = makeDeps(db);
    const res = await createApp(deps).request(
      "/v1/ops/travel/providers/health",
      {
        headers: headers(opsActor(), cityId),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<Record<string, unknown>>;
    };
    const duffel = body.providers.find(
      (row) => row.supplierId === credentialed,
    );
    const nuitee = body.providers.find((row) => row.supplierId === bare);
    expect(duffel).toMatchObject({
      adapter: "duffel",
      kind: "flight",
      implemented: true,
      operational: true,
      credentialsPresent: true,
      reachable: false,
      liveCallsBlocked: false,
      reason: "operational",
      capabilities: {
        book: { implemented: true, operational: true },
        refund: { implemented: false, alternative: "cancel_order" },
      },
    });
    expect(nuitee).toMatchObject({
      adapter: "nuitee",
      implemented: true,
      operational: false,
      credentialsPresent: false,
      liveCallsBlocked: true,
      reason: "credentials_missing",
      capabilities: {
        change: { implemented: false, alternative: "cancel_and_rebook" },
      },
    });
  });
});

describe("the fixture adapter can never be selected in production configuration", () => {
  beforeEach(() => resetTravel(db));

  it("the boot guard refuses any fixture row, enabled or not, and passes live-only configuration", async () => {
    await seedFlightSupplier(db, { enabled: false });
    const refused = await assertProductionSupplyConfig(db, true).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ProductionSupplyConfigError);
    expect((refused as ProductionSupplyConfigError).offending).toHaveLength(1);
    // Outside production the same rows are fine (DEV/TEST).
    await expect(
      assertProductionSupplyConfig(db, false),
    ).resolves.toBeUndefined();

    await resetTravel(db);
    await db.travelSupplier.create({
      data: {
        id: uid("supD"),
        kind: "flight",
        adapter: "duffel",
        enabled: false,
        config: {} as never,
      },
    });
    await expect(
      assertProductionSupplyConfig(db, true),
    ).resolves.toBeUndefined();
  });

  it("resolution refuses a fixture row at runtime in production, and health shows it as not live", async () => {
    const supplierId = await seedFlightSupplier(db);
    const cityId = await seedCity(db);
    process.env.NODE_ENV = "production";
    expect(() =>
      resolveFlightAdapter({
        id: supplierId,
        kind: "flight",
        adapter: "fixture",
        enabled: true,
      }),
    ).toThrow(ContractError);

    const { deps } = makeDeps(db);
    const res = await createApp(deps).request(
      "/v1/ops/travel/providers/health",
      {
        headers: headers(opsActor(), cityId),
      },
    );
    const body = (await res.json()) as {
      providers: Array<Record<string, unknown>>;
    };
    expect(
      body.providers.find((row) => row.supplierId === supplierId),
    ).toMatchObject({
      adapter: "fixture",
      operational: false,
      liveCallsBlocked: true,
      reason: "adapter_unavailable",
    });

    // Its webhook envelope — which drives outcomes without resolving an
    // adapter — is refused too, before verification or any order lookup.
    const envelope = JSON.stringify({
      externalId: uid("wh"),
      type: "booking_confirmed",
      orderRef: "tord_any",
    });
    const hook = await createApp(deps).request(
      `/v1/travel/webhooks/${supplierId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-City-ID": cityId,
          "X-Signature": computeSignature("flight-secret", envelope),
        },
        body: envelope,
      },
    );
    expect(hook.status).toBe(503);
    expect(await db.travelWebhook.count({ where: { supplierId } })).toBe(0);
  });

  it("the real service process refuses to boot in production with a fixture row", async () => {
    await seedFlightSupplier(db, { enabled: false });
    const serviceDir = path.resolve(__dirname, "..");
    const tsx = path.resolve(serviceDir, "node_modules/.bin/tsx");
    const child = spawn(tsx, ["src/index.ts"], {
      cwd: serviceDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        DATABASE_URL: TEST_DATABASE_URL,
        LOG_LEVEL: "fatal",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 45_000);
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code, output).toBe(1);
    expect(output).toMatch(/refusing to start/);
    expect(output).toMatch(/test-only adapter/);
  }, 60_000);
});
