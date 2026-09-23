/**
 * Supplier health honesty (recheck T01, health half).
 *
 * The Duffel/Nuitee adapters have no provider mapping yet: every business
 * operation refuses. Their health used to say `reachable: true` and
 * `liveCallsBlocked: false` the moment a credential was present — a stub
 * supplier shown as live. These tests pin the corrected semantics: health
 * agrees with behavior capability by capability, credentials presence is
 * reported apart from (and never instead of) the missing mapping, and the
 * ops dashboard route renders a stub supplier as not live.
 *
 * This file sets and clears a TRAVEL_SECRET_* variable on purpose — the point
 * is the credential being present — so the turbo env-declaration lint does not
 * apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContractError, money } from "@ubi/contracts";

import {
  createDuffelFlightAdapter,
  createNuiteeStayAdapter,
  httpSupplierHealth,
  NOT_IMPLEMENTED_REASON,
} from "../src/adapters/http-supplier";
import { createApp } from "../src/index";

import {
  closeTestDb,
  headers,
  makeDeps,
  opsActor,
  resetTravel,
  seedCity,
  testDb,
  uid,
} from "./helpers";

import type { ServicingAdapter, SupplierContext } from "../src/adapters/types";

const SECRET_REF = "duffel_health_test";
const SECRET_ENV = `TRAVEL_SECRET_${SECRET_REF.toUpperCase()}`;

const db = testDb();

afterAll(closeTestDb);
afterEach(() => {
  delete process.env[SECRET_ENV];
});

function ctx(withSecretRef = true): SupplierContext {
  return {
    supplierId: uid("sup"),
    config: withSecretRef
      ? { baseUrl: "https://api.example.test", secretRef: SECRET_REF }
      : {},
    now: () => new Date(),
  };
}

/** Every operation of the adapter, called with plausible arguments. */
function operationsOf(
  adapter: ServicingAdapter & { search: unknown; rates?: unknown },
): Record<string, (context: SupplierContext) => Promise<unknown>> {
  const amount = money(10_000, "NGN");
  const ops: Record<string, (context: SupplierContext) => Promise<unknown>> = {
    refreshOffer: async (c) => adapter.refreshOffer(c, "offer_1"),
    book: async (c) =>
      adapter.book(c, {
        ourRef: "tord_1",
        offerRef: "offer_1",
        offerSnapshot: {},
        passengers: [],
        idempotencyKey: "book-key-1",
      }),
    lookup: async (c) => adapter.lookup(c, "tord_1"),
    change: async (c) =>
      adapter.change(c, {
        ourRef: "tord_1",
        supplierRefs: {},
        change: {},
        idempotencyKey: "change-key-1",
      } as never),
    cancel: async (c) =>
      adapter.cancel(c, {
        ourRef: "tord_1",
        supplierRefs: {},
        idempotencyKey: "cancel-key-1",
      } as never),
    refund: async (c) =>
      adapter.refund(c, {
        ourRef: "tord_1",
        supplierRefs: {},
        amount,
        idempotencyKey: "refund-key-1",
      } as never),
    status: async (c) => adapter.status(c, "tord_1"),
    reconcile: async (c) => adapter.reconcile(c, "tord_1"),
  };
  return ops;
}

describe("http supplier adapters report health truthfully", () => {
  it.each([
    ["duffel", createDuffelFlightAdapter] as const,
    ["nuitee", createNuiteeStayAdapter] as const,
  ])(
    "%s: credentials PRESENT still report not reachable, live calls blocked, every capability unimplemented",
    async (name, factory) => {
      process.env[SECRET_ENV] = "a-provisioned-token";
      const context = ctx();
      const health = httpSupplierHealth(context, name);

      expect(health.credentialsPresent).toBe(true);
      expect(health.reachable).toBe(false);
      expect(health.liveCallsBlocked).toBe(true);
      expect(health.implemented).toBe(false);
      expect(health.operational).toBe(false);
      expect(health.reason).toBe(NOT_IMPLEMENTED_REASON);
      expect(health.note).toMatch(/not implemented/);
      expect(health.note).toMatch(/credentials present/);

      const expected = name === "duffel" ? ["search"] : ["search", "rates"];
      expect(Object.keys(health.capabilities).sort()).toEqual(
        [
          ...expected,
          "refreshOffer",
          "book",
          "lookup",
          "change",
          "cancel",
          "refund",
          "status",
          "reconcile",
        ].sort(),
      );
      for (const readiness of Object.values(health.capabilities)) {
        expect(readiness).toEqual({
          implemented: false,
          operational: false,
          reason: NOT_IMPLEMENTED_REASON,
        });
      }

      // The adapter's own providerHealth is the same report.
      const adapter = factory();
      expect(await adapter.providerHealth(context)).toEqual(health);
    },
  );

  it("credentials ABSENT are reported as such — the mapping gap is still the reason", async () => {
    const health = httpSupplierHealth(ctx(false), "duffel");
    expect(health.credentialsPresent).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.liveCallsBlocked).toBe(true);
    expect(health.reason).toBe(NOT_IMPLEMENTED_REASON);
    expect(health.note).toMatch(/credentials not provisioned/);
  });

  it.each([
    ["duffel", createDuffelFlightAdapter] as const,
    ["nuitee", createNuiteeStayAdapter] as const,
  ])(
    "%s: every capability health calls non-operational really refuses, credentials or not",
    async (name, factory) => {
      process.env[SECRET_ENV] = "a-provisioned-token";
      const adapter = factory();
      const context = ctx();
      const health = httpSupplierHealth(context, name);
      const ops = operationsOf(adapter);
      ops.search = async (c) =>
        name === "duffel"
          ? createDuffelFlightAdapter().search(c, {
              from: "LOS",
              to: "ABV",
              departDate: "2026-10-01",
              passengers: 1,
            })
          : createNuiteeStayAdapter().search(c, {
              city: "ABV",
              checkIn: "2026-10-01",
              checkOut: "2026-10-02",
              guests: 1,
            });
      if (name === "nuitee") {
        ops.rates = async (c) =>
          createNuiteeStayAdapter().rates(c, "prop_1", {
            city: "ABV",
            checkIn: "2026-10-01",
            checkOut: "2026-10-02",
            guests: 1,
          });
      }

      for (const [capability, readiness] of Object.entries(
        health.capabilities,
      )) {
        expect(readiness.operational).toBe(false);
        const call = ops[capability];
        expect(call, `no call wired for ${capability}`).toBeDefined();
        const failure = await call?.(context).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(ContractError);
        const error = failure as ContractError;
        expect(error.code).toBe("service_unavailable");
        expect(error.message).toMatch(/not implemented/);
        expect(error.message).not.toMatch(/no credentials/);
        expect(error.details).toMatchObject({
          adapter: name,
          operation: capability,
          implemented: false,
          liveCallsBlocked: true,
          credentialsPresent: true,
        });
      }
    },
  );
});

describe("the ops providers-health route never shows a stub supplier as live", () => {
  beforeEach(() => resetTravel(db));

  it("renders a credentialed Duffel row as not reachable with live calls blocked", async () => {
    process.env[SECRET_ENV] = "a-provisioned-token";
    const cityId = await seedCity(db);
    const supplierId = uid("supD");
    await db.travelSupplier.create({
      data: {
        id: supplierId,
        kind: "flight",
        adapter: "duffel",
        enabled: false,
        config: {
          baseUrl: "https://api.example.test",
          secretRef: SECRET_REF,
        } as never,
      },
    });

    const { deps } = makeDeps(db);
    const res = await createApp(deps).request(
      "/v1/ops/travel/providers/health",
      { headers: headers(opsActor(), cityId) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{
        supplierId: string;
        adapter: string;
        reachable: boolean;
        liveCallsBlocked: boolean;
        note: string | null;
      }>;
    };
    const row = body.providers.find(
      (provider) => provider.supplierId === supplierId,
    );
    expect(row).toMatchObject({
      adapter: "duffel",
      reachable: false,
      liveCallsBlocked: true,
    });
    expect(row?.note).toMatch(/not implemented/);
  });
});
