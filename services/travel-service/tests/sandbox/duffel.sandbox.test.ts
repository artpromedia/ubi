/**
 * Duffel TEST-MODE integration (https://duffel.com/docs/api/overview/test-mode).
 *
 * Runs only with DUFFEL_TEST_TOKEN (a `duffel_test_…` token) and network
 * access; otherwise the suite is skipped with that reason. It exercises the
 * adapter against the real API on the official host — search, revalidate,
 * book (test-mode balance), look the order up by our reference, quote a
 * pending cancellation and confirm it — so a drift between Duffel's live
 * behaviour and the documented shapes fails here.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDuffelFlightAdapter } from "../../src/adapters/duffel";

import type { AdapterOffer, SupplierContext } from "../../src/adapters/types";

const TOKEN = process.env.DUFFEL_TEST_TOKEN;
const SECRET_ENV = "TRAVEL_SECRET_DUFFEL_SANDBOX";

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(TOKEN === undefined || TOKEN === "")(
  "Duffel sandbox (needs DUFFEL_TEST_TOKEN)",
  () => {
    const ctx: SupplierContext = {
      supplierId: "sup_duffel_sandbox",
      config: {
        secretRef: "duffel_sandbox",
        timeoutMs: 30_000,
        bookTimeoutMs: 90_000,
      },
      now: () => new Date(),
    };
    const adapter = createDuffelFlightAdapter();
    const ourRef = `tord_sandbox_${Date.now().toString(36)}`;
    let offer: AdapterOffer | undefined;
    let orderRef: string | undefined;

    beforeAll(() => {
      process.env[SECRET_ENV] = TOKEN;
    });
    afterAll(() => {
      delete process.env[SECRET_ENV];
    });

    it("health is operational with a passing probe", async () => {
      const health = await adapter.providerHealth({
        ...ctx,
        config: { ...ctx.config, probe: true },
      });
      expect(health).toMatchObject({
        operational: true,
        reachable: true,
        probe: "ok",
      });
    });

    it("searches test-mode inventory and parses real offers exactly", async () => {
      const result = await adapter.search(ctx, {
        from: "LHR",
        to: "JFK",
        departDate: daysFromNow(45),
        passengers: 1,
      });
      expect(result.offers.length).toBeGreaterThan(0);
      for (const candidate of result.offers) {
        expect(Number.isInteger(candidate.price.amountMinor)).toBe(true);
        expect(candidate.snapshot.departAtUtc).toMatch(/Z$/);
      }
      offer =
        result.offers.find(
          (candidate) => candidate.snapshot.documentsRequired === false,
        ) ?? result.offers[0];
    });

    it("revalidates, books on our reference, and finds the order by it", async () => {
      if (offer === undefined) throw new Error("no offer from search");
      const validation = await adapter.refreshOffer(ctx, offer.offerRef);
      expect(validation.available).toBe(true);
      const booked = await adapter.book(ctx, {
        ourRef,
        offerRef: offer.offerRef,
        offerSnapshot: validation.offer.snapshot,
        passengers: [
          {
            title: "mrs",
            givenNames: "Amelia",
            surname: "Earhart",
            gender: "f",
            email: "amelia@example.com",
            phone: "+442080160509",
            dateOfBirth: "1987-07-24",
          },
        ],
        idempotencyKey: `${ourRef}:book`,
      });
      expect(["confirmed", "supplier_pending"]).toContain(booked.outcome);
      orderRef = booked.supplierRefs.orderRef;
      const found = await adapter.lookup(ctx, ourRef, {
        supplierOfferRef: validation.offer.supplierOfferRef ?? null,
        offerSnapshot: validation.offer.snapshot,
        ...(orderRef === undefined ? {} : { supplierRefs: { orderRef } }),
      });
      expect(found.found).toBe(true);
      orderRef = found.supplierRefs.orderRef ?? orderRef;
    });

    it("quotes a pending cancellation, then confirms exactly that one", async () => {
      if (orderRef === undefined) throw new Error("no order booked");
      const quote = await adapter.quoteCancel!(ctx, {
        ourRef,
        supplierRefs: { orderRef },
        idempotencyKey: `${ourRef}:cq`,
      });
      expect(quote.quoteRef).toMatch(/^ore_/);
      const cancelled = await adapter.cancel(ctx, {
        ourRef,
        supplierRefs: { orderRef },
        idempotencyKey: `${ourRef}:c`,
        quoteRef: quote.quoteRef,
        acceptedPenalty: quote.penalty,
      });
      expect(cancelled.accepted).toBe(true);
    });
  },
);
