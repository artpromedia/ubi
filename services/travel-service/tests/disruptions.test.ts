/**
 * Disruptions and ₦0 switching. A free switch is offered ONLY when the
 * disruption is covered under a funded rule; when it is not covered, a switch is
 * refused and the traveller keeps the airline options and the refund path.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import {
  createDisruption,
  getDisruption,
  switchOrder,
  type AlternativeInput,
} from "../src/ops/disruptions";

import {
  closeTestDb,
  idemKey,
  makeDeps,
  resetTravel,
  rider,
  seedCity,
  seedFlightSupplier,
  testDb,
} from "./helpers";

const db = testDb();
afterAll(closeTestDb);
beforeEach(() => resetTravel(db));

const ALT: AlternativeInput = {
  id: "ALT-QI-0316",
  carrier: "Ibom Air",
  flightNumber: "QI 0316",
  departAt: "2026-09-12T10:10:00+01:00",
  arriveAt: "2026-09-12T11:25:00+01:00",
  priceMinor: 15_200_000,
  coveredMinor: 15_200_000,
  customerPaysMinor: 0,
  heldUntil: "2099-01-01T00:00:00Z",
};

async function confirmedOrder() {
  const cityId = await seedCity(db);
  await seedFlightSupplier(db, {
    control: { "AP-P4-7120#saver": { bookOutcome: "confirmed", pnr: "AP7QX2" } },
  });
  const { deps } = makeDeps(db);
  const actor = rider();
  const cart = await createCart(deps, {
    actor,
    cityId,
    items: [{ kind: "flight", offerRef: "AP-P4-7120", fareFamilyId: "saver" }],
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  const result = await checkout(deps, {
    actor,
    cityId,
    cartId: cart.id,
    paymentMethodId: "wallet",
    grantId: "grant_test",
    assuranceMethod: null,
    expectedTotal: null,
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  if (result.kind !== "ok") throw new Error("expected ok");
  return { cityId, deps, actor, orderId: result.orders[0]?.id ?? "" };
}

describe("disruptions", () => {
  it("offers a covered ₦0 switch and completes it under the funded rule", async () => {
    const { cityId, deps, actor, orderId } = await confirmedOrder();
    await createDisruption(deps, {
      actor,
      cityId,
      orderId,
      cause: "airline_cancelled",
      source: "supplier",
      covered: true,
      ruleId: "JP-2026",
      fundedBy: "ubi_protection",
      capMinor: 20_000_000,
      alternatives: [ALT],
      airlineOptions: [],
      refundPath: null,
      correlationId: null,
    });

    const disruption = (await getDisruption(deps, actor, orderId)) as {
      eligibility: { covered: boolean; ruleId: string | null };
      alternatives: unknown[];
    };
    expect(disruption.eligibility.covered).toBe(true);
    expect(disruption.eligibility.ruleId).toBe("JP-2026");
    expect(disruption.alternatives).toHaveLength(1);

    const switched = await switchOrder(deps, {
      actor,
      cityId,
      orderId,
      alternativeId: ALT.id,
      grantId: null,
      correlationId: null,
    });
    expect(switched.state).toBe("ticketed");

    const row = await db.travelDisruption.findFirst({ where: { orderId } });
    expect(row?.resolution).toBe("switched");
  });

  it("refuses a switch when the disruption is not covered", async () => {
    const { cityId, deps, actor, orderId } = await confirmedOrder();
    await createDisruption(deps, {
      actor,
      cityId,
      orderId,
      cause: "airline_cancelled",
      source: "supplier",
      covered: false,
      ruleId: null,
      fundedBy: null,
      capMinor: null,
      alternatives: [ALT],
      airlineOptions: [ALT],
      refundPath: "wallet",
      correlationId: null,
    });

    const disruption = (await getDisruption(deps, actor, orderId)) as {
      eligibility: { covered: boolean };
    };
    expect(disruption.eligibility.covered).toBe(false);

    await expect(
      switchOrder(deps, { actor, cityId, orderId, alternativeId: ALT.id, grantId: null, correlationId: null }),
    ).rejects.toMatchObject({ code: "conflict" });

    const order = await db.travelOrder.findUnique({ where: { id: orderId } });
    expect(order?.state).toBe("disrupted");
  });
});
