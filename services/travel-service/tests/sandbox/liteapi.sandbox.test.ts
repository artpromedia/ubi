/**
 * LiteAPI SANDBOX integration (https://docs.liteapi.travel — sandbox keys are
 * `sand_…`; `ACC_CREDIT_CARD` simulates payment without a charge).
 *
 * Runs only with LITEAPI_TEST_KEY and network access; otherwise the suite is
 * skipped with that reason. Rates → prebook → book on our client reference →
 * lookup by it → cancellation quote → cancel, against the real sandbox.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNuiteeStayAdapter } from "../../src/adapters/liteapi";

import type {
  AdapterOffer,
  StaySearchParams,
  SupplierContext,
} from "../../src/adapters/types";

const KEY = process.env.LITEAPI_TEST_KEY;
const SECRET_ENV = "TRAVEL_SECRET_LITEAPI_SANDBOX";

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(KEY === undefined || KEY === "")(
  "LiteAPI sandbox (needs LITEAPI_TEST_KEY)",
  () => {
    const ctx: SupplierContext = {
      supplierId: "sup_liteapi_sandbox",
      config: {
        secretRef: "liteapi_sandbox",
        currency: "USD",
        guestNationality: "US",
        countryCode: "IT",
        paymentMethod: "ACC_CREDIT_CARD",
        timeoutMs: 30_000,
        bookTimeoutMs: 90_000,
      },
      now: () => new Date(),
    };
    const params: StaySearchParams = {
      city: "Rome",
      checkIn: daysFromNow(60),
      checkOut: daysFromNow(62),
      guests: 2,
    };
    const adapter = createNuiteeStayAdapter();
    const ourRef = `tord_sandbox_${Date.now().toString(36)}`;
    let rate: AdapterOffer | undefined;
    let bookingRef: string | undefined;

    beforeAll(() => {
      process.env[SECRET_ENV] = KEY;
    });
    afterAll(() => {
      delete process.env[SECRET_ENV];
    });

    it("health is operational with a passing probe", async () => {
      const health = await adapter.providerHealth({
        ...ctx,
        config: { ...ctx.config, probe: true },
      });
      expect(health).toMatchObject({ operational: true, reachable: true });
    });

    it("finds properties and room rates with exact minor-unit prices", async () => {
      const search = await adapter.search(ctx, params);
      expect(search.offers.length).toBeGreaterThan(0);
      for (const property of search.offers.slice(0, 5)) {
        const rates = await adapter.rates(ctx, property.offerRef, params);
        rate =
          rates.find((candidate) => candidate.capabilities.refundSupported) ??
          rates[0];
        if (rate !== undefined) break;
      }
      expect(rate).toBeDefined();
      expect(Number.isInteger(rate?.price.amountMinor)).toBe(true);
    });

    it("prebooks, books on our client reference and finds it by that reference", async () => {
      if (rate === undefined) throw new Error("no rate");
      const validation = await adapter.refreshOffer(ctx, rate.offerRef);
      expect(validation.offer.snapshot.prebookId).toEqual(expect.any(String));
      const booked = await adapter.book(ctx, {
        ourRef,
        offerRef: rate.offerRef,
        offerSnapshot: validation.offer.snapshot,
        passengers: [
          {
            givenNames: "Sunny",
            surname: "Mars",
            email: "s.mars@example.com",
            phone: "+2348012345678",
            dateOfBirth: "1990-01-01",
          },
        ],
        idempotencyKey: `${ourRef}:book`,
      });
      expect(booked.outcome).toBe("confirmed");
      bookingRef = booked.supplierRefs.bookingRef;
      const found = await adapter.lookup(ctx, ourRef);
      expect(found).toMatchObject({
        found: true,
        supplierRefs: { bookingRef },
      });
    });

    it("quotes the live cancellation penalty and cancels with that consent", async () => {
      if (bookingRef === undefined) throw new Error("no booking");
      const quote = await adapter.quoteCancel!(ctx, {
        ourRef,
        supplierRefs: { bookingRef },
        idempotencyKey: `${ourRef}:cq`,
      });
      const cancelled = await adapter.cancel(ctx, {
        ourRef,
        supplierRefs: { bookingRef },
        idempotencyKey: `${ourRef}:c`,
        acceptedPenalty: quote.penalty,
      });
      expect(cancelled.accepted).toBe(true);
    });
  },
);
