/**
 * Webhooks: verified, deduped, idempotent. A duplicate callback is a no-op; a
 * valid ticketing callback moves a confirmed order to ticketed; a bad signature
 * never advances anything.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { computeSignature } from "../src/adapters/signature";
import { createCart } from "../src/ops/carts";
import { checkout } from "../src/ops/checkout";
import { receiveWebhook, type WebhookEnvelope } from "../src/ops/webhooks";

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

async function confirmedFlightOrder(): Promise<{
  cityId: string;
  supplierId: string;
  orderId: string;
  deps: ReturnType<typeof makeDeps>["deps"];
}> {
  const cityId = await seedCity(db);
  const supplierId = await seedFlightSupplier(db, {
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
  return { cityId, supplierId, orderId: result.orders[0]?.id ?? "", deps };
}

function signed(secret: string, envelope: WebhookEnvelope): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(envelope);
  return { rawBody, signature: computeSignature(secret, rawBody) };
}

describe("webhooks", () => {
  it("verifies a signature and moves a confirmed flight to ticketed", async () => {
    const { cityId, supplierId, orderId, deps } = await confirmedFlightOrder();
    const envelope: WebhookEnvelope = {
      externalId: "wh-ticket-1",
      type: "ticket_issued",
      orderRef: orderId,
      supplierRefs: { pnr: "AP7QX2", ticketNumbers: ["0572101234567"] },
    };
    const { rawBody, signature } = signed("flight-secret", envelope);
    const outcome = await receiveWebhook(deps, { supplierId, cityId, rawBody, signature, envelope });
    expect(outcome.result).toBe("processed");

    const order = await db.travelOrder.findUnique({ where: { id: orderId } });
    expect(order?.state).toBe("ticketed");
    const docs = await db.travelDocument.count({ where: { orderId } });
    expect(docs).toBe(1);
  });

  it("treats a duplicate callback as a no-op", async () => {
    const { cityId, supplierId, orderId, deps } = await confirmedFlightOrder();
    const envelope: WebhookEnvelope = {
      externalId: "wh-ticket-dup",
      type: "ticket_issued",
      orderRef: orderId,
      supplierRefs: { pnr: "AP7QX2", ticketNumbers: ["0572101234567"] },
    };
    const { rawBody, signature } = signed("flight-secret", envelope);

    const first = await receiveWebhook(deps, { supplierId, cityId, rawBody, signature, envelope });
    expect(first.result).toBe("processed");
    const eventsAfterFirst = await db.travelOrderEvent.count({ where: { orderId } });

    const second = await receiveWebhook(deps, { supplierId, cityId, rawBody, signature, envelope });
    expect(second.result).toBe("duplicate");

    const eventsAfterSecond = await db.travelOrderEvent.count({ where: { orderId } });
    expect(eventsAfterSecond).toBe(eventsAfterFirst);
    const docs = await db.travelDocument.count({ where: { orderId } });
    expect(docs).toBe(1); // not doubled
  });

  it("rejects a callback whose signature does not match and advances nothing", async () => {
    const { cityId, supplierId, orderId, deps } = await confirmedFlightOrder();
    const envelope: WebhookEnvelope = {
      externalId: "wh-bad-sig",
      type: "ticket_issued",
      orderRef: orderId,
      supplierRefs: { ticketNumbers: ["0572109999999"] },
    };
    const rawBody = JSON.stringify(envelope);
    const outcome = await receiveWebhook(deps, {
      supplierId,
      cityId,
      rawBody,
      signature: "deadbeef",
      envelope,
    });
    expect(outcome.result).toBe("rejected");

    const order = await db.travelOrder.findUnique({ where: { id: orderId } });
    expect(order?.state).toBe("confirmed"); // unchanged
    const row = await db.travelWebhook.findFirst({ where: { externalId: "wh-bad-sig" } });
    expect(row?.signatureOk).toBe(false);
    expect(row?.processedAt).toBeNull();
  });
});
