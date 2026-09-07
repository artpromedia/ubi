/**
 * Onboarding integration tests: a merchant applies, builds a menu while still in
 * review, and cannot publish it until ops approves. After approval the merchant
 * publishes and the item becomes visible on the public menu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import { getConsoleMenu, getPublicMenu } from "../../src/bites/services/menu";
import {
  applyMerchant,
  createMenuItem,
  reviewMerchant,
  setAvailability,
} from "../../src/bites/services/merchants";
import {
  closeTestDb,
  FakePayments,
  idemKey,
  makeDeps,
  seedCity,
  testDb,
  uid,
  type Clock,
} from "./helpers";

import type { Actor, BitesDb } from "../../src/bites/lib/types";

let db: BitesDb;
const clock: Clock = { t: new Date("2026-02-01T09:00:00Z") };

beforeAll(() => {
  db = testDb();
});
afterAll(async () => {
  await closeTestDb();
});

function deps() {
  return makeDeps(db, new FakePayments(db), clock);
}

async function apply(cityId: string, merchantId: string): Promise<Actor> {
  const merchant: Actor = { id: merchantId, role: "merchant" };
  await applyMerchant(deps(), {
    actor: merchant,
    cityId,
    legalName: "Mama Put Ltd",
    tradeName: "Mama Put",
    cacRc: "RC777",
    tin: "TIN777",
    ownerNin: "12345678901",
    ownerSelfieRef: "selfie-ref-key",
    ownerSelfieScore: 0.98,
    hygienePermitRef: "permit-ref-key",
    permitExpiry: new Date("2027-01-01T00:00:00Z"),
    outlet: { address: "2 Market Rd", lat: 6.5, lng: 3.4, hours: null },
    idempotencyKey: idemKey(),
    correlationId: null,
  });
  return merchant;
}

describe("merchant onboarding", () => {
  it("stores no raw NIN and records only a biometric score in KYB checks", async () => {
    const { cityId } = await seedCity(db);
    const merchantId = uid("merch");
    await apply(cityId, merchantId);
    const kyb = await db.merchantKyb.findFirst({ where: { merchantId } });
    const checks = kyb?.checks as Record<string, unknown> | null;
    expect(checks?.ninProvided).toBe(true);
    expect(checks?.selfieScore).toBe(0.98);
    // The raw NIN is never persisted.
    expect(JSON.stringify(checks)).not.toContain("12345678901");
    const applied = await db.outboxEvent.findFirst({
      where: { aggregateId: merchantId, name: "merchant.applied" },
    });
    expect(applied).not.toBeNull();
  });

  it("is idempotent on the principal: re-applying returns the same merchant", async () => {
    const { cityId } = await seedCity(db);
    const merchantId = uid("merch");
    await apply(cityId, merchantId);
    await apply(cityId, merchantId);
    const count = await db.bitesMerchant.count({ where: { id: merchantId } });
    expect(count).toBe(1);
    const outlets = await db.outlet.count({ where: { merchantId } });
    expect(outlets).toBe(1);
  });

  it("builds a menu before approval but never publishes it", async () => {
    const { cityId, currency } = await seedCity(db);
    const merchantId = uid("merch");
    const merchant = await apply(cityId, merchantId);
    const merchantRow = await db.bitesMerchant.findUnique({
      where: { id: merchantId },
      include: { outlets: true },
    });
    const outletId = merchantRow?.outlets[0]?.id ?? "";

    const created = await createMenuItem(deps(), {
      actor: merchant,
      cityId,
      outletId,
      category: "mains",
      name: "Amala",
      description: null,
      priceMinor: 180_000,
      allergens: [],
      photoRef: null,
      optionGroups: [],
      correlationId: null,
    });
    // Built, but unpublished, and priced in the city currency (not a client value).
    expect(created.active).toBe(false);
    expect(created.currency).toBe(currency);

    // Public menu does not show an unapproved merchant at all.
    await expect(getPublicMenu(deps(), cityId, merchantId)).rejects.toBeInstanceOf(
      ContractError,
    );

    // The merchant can see their own draft menu.
    const console = await getConsoleMenu(deps(), merchant, merchantId);
    expect(console.outlets[0]?.items[0]?.active).toBe(false);

    // Publishing before approval is refused.
    await expect(
      setAvailability(deps(), {
        actor: merchant,
        cityId,
        itemId: created.itemId,
        action: "activate",
        soldOutUntil: null,
        correlationId: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets the merchant publish once approved, and the item becomes visible", async () => {
    const { cityId } = await seedCity(db);
    const merchantId = uid("merch");
    const merchant = await apply(cityId, merchantId);
    const merchantRow = await db.bitesMerchant.findUnique({
      where: { id: merchantId },
      include: { outlets: true },
    });
    const outletId = merchantRow?.outlets[0]?.id ?? "";
    const built = await createMenuItem(deps(), {
      actor: merchant,
      cityId,
      outletId,
      category: "mains",
      name: "Egusi",
      description: null,
      priceMinor: 200_000,
      allergens: [],
      photoRef: null,
      optionGroups: [],
      correlationId: null,
    });

    // Ops approves.
    const reviewer: Actor = { id: uid("reviewer"), role: "reviewer" };
    const approved = await reviewMerchant(deps(), {
      actor: reviewer,
      cityId,
      merchantId,
      decision: "approve",
      reason: "documents verified",
      correlationId: null,
    });
    expect(approved.status).toBe("approved");
    const approvedEvent = await db.outboxEvent.findFirst({
      where: { aggregateId: merchantId, name: "merchant.approved" },
    });
    expect(approvedEvent).not.toBeNull();

    // Approval alone does not publish the pre-built item.
    const beforePublish = await getPublicMenu(deps(), cityId, merchantId);
    expect(beforePublish.outlets[0]?.items ?? []).toHaveLength(0);

    // The merchant publishes it, and now it is on the public menu.
    await setAvailability(deps(), {
      actor: merchant,
      cityId,
      itemId: built.itemId,
      action: "activate",
      soldOutUntil: null,
      correlationId: null,
    });
    const published = await getPublicMenu(deps(), cityId, merchantId);
    expect(published.outlets[0]?.items.map((i) => i.id)).toContain(built.itemId);

    // An item created after approval is published immediately.
    const later = await createMenuItem(deps(), {
      actor: merchant,
      cityId,
      outletId,
      category: "sides",
      name: "Moimoi",
      description: null,
      priceMinor: 50_000,
      allergens: [],
      photoRef: null,
      optionGroups: [],
      correlationId: null,
    });
    expect(later.active).toBe(true);
  });
});
