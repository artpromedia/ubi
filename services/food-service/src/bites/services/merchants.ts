/**
 * Merchant onboarding, KYB review, and the merchant console writes.
 *
 * Identity model: the authenticated merchant principal (`X-User-ID` with role
 * `merchant`) is the merchant. Their `BitesMerchant.id` equals that principal
 * id, so every console action is scoped to the caller's own merchant and can
 * never be redirected to another business by a request body (CLAUDE.md #1, #6).
 *
 * A menu may be built while KYB is still in review, but it is never published:
 * an item created before approval is inactive, and it cannot be activated until
 * the merchant is approved (slice 05 guard: "menu can be built before approval,
 * never published").
 */
import { ContractError } from "@ubi/contracts";

import { auditedTransaction } from "../audit.js";
import { assertFlagEnabled } from "../city-config.js";
import { generateId } from "../lib/ids.js";
import { actorTypeFor, assertPermission } from "../roles.js";
import { MERCHANT_APPROVED } from "./menu.js";

import type { OutboxInput } from "../audit.js";
import type { BitesDeps } from "../context.js";
import type { Actor, JsonRecord } from "../lib/types.js";

const STATUS_PENDING = "pending_review";
const STATUS_REJECTED = "rejected";

export interface ApplyMerchantParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly legalName: string;
  readonly tradeName: string;
  readonly cacRc: string;
  readonly tin: string;
  /** Owner identity inputs. The raw NIN is never stored or logged (CLAUDE.md #6, #12). */
  readonly ownerNin: string;
  readonly ownerSelfieRef: string;
  /** A biometric score, never the image itself (CLAUDE.md #6). */
  readonly ownerSelfieScore?: number;
  readonly hygienePermitRef: string;
  readonly permitExpiry: Date | null;
  readonly outlet: {
    readonly address: string;
    readonly lat: number;
    readonly lng: number;
    readonly hours: JsonRecord | null;
  };
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface MerchantView {
  readonly merchantId: string;
  readonly status: string;
  readonly tradeName: string | null;
  readonly approvedAt: string | null;
  readonly outletIds: readonly string[];
}

/**
 * A merchant applies to sell on Bites. Idempotent on the principal: a second
 * application by the same merchant returns the existing merchant rather than
 * creating a duplicate.
 */
export async function applyMerchant(
  deps: BitesDeps,
  params: ApplyMerchantParams,
): Promise<MerchantView> {
  assertPermission(params.actor.role, "merchant.apply");
  const { flags } = await deps.config.load(params.cityId);
  assertFlagEnabled(flags, "bites");

  const merchantId = params.actor.id;
  const existing = await deps.db.bitesMerchant.findUnique({
    where: { id: merchantId },
    include: { outlets: true },
  });
  if (existing !== null) {
    return toMerchantView(
      existing,
      existing.outlets.map((o) => o.id),
    );
  }

  const outletId = generateId("outlet");
  const kybId = generateId("kyb");
  const checks: JsonRecord = {
    cacProvided: params.cacRc.length > 0,
    tinProvided: params.tin.length > 0,
    ninProvided: params.ownerNin.length > 0,
    selfieProvided: params.ownerSelfieRef.length > 0,
    selfieScore: params.ownerSelfieScore ?? null,
    hygienePermitProvided: params.hygienePermitRef.length > 0,
  };

  return auditedTransaction(deps.db, async (tx) => {
    const merchant = await tx.bitesMerchant.create({
      data: {
        id: merchantId,
        legalName: params.legalName,
        tradeName: params.tradeName,
        cacRc: params.cacRc,
        tin: params.tin,
        status: STATUS_PENDING,
      },
    });
    await tx.outlet.create({
      data: {
        id: outletId,
        merchantId,
        address: params.outlet.address,
        lat: params.outlet.lat,
        lng: params.outlet.lng,
        hours: params.outlet.hours ?? undefined,
        open: true,
      },
    });
    await tx.merchantKyb.create({
      data: {
        id: kybId,
        merchantId,
        checks,
        permitFile: params.hygienePermitRef,
        permitExpiry: params.permitExpiry ?? undefined,
      },
    });

    const event: OutboxInput = {
      name: "merchant.applied",
      aggregateType: "merchant",
      aggregateId: merchantId,
      fromVersion: null,
      toVersion: 1,
      actor: params.actor,
      actorType: actorTypeFor(params.actor.role),
      cityId: params.cityId,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      occurredAt: deps.now(),
      payload: { merchantId, outletId, checks },
    };

    return {
      result: toMerchantView(merchant, [outletId]),
      audit: {
        actor: params.actor,
        action: "bites.merchant.applied",
        subjectType: "merchant",
        subjectId: merchantId,
        reason: null,
        after: { status: STATUS_PENDING },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });
}

export interface ReviewMerchantParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly merchantId: string;
  readonly decision: "approve" | "reject";
  readonly reason: string;
  readonly correlationId: string | null;
}

/** Ops decides a KYB application. Approval publishes nothing itself — it only
 * unlocks the merchant to publish its own menu. */
export async function reviewMerchant(
  deps: BitesDeps,
  params: ReviewMerchantParams,
): Promise<MerchantView> {
  assertPermission(params.actor.role, "merchant.review");

  const merchant = await deps.db.bitesMerchant.findUnique({
    where: { id: params.merchantId },
    include: {
      outlets: true,
      kyb: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (merchant === null) {
    throw new ContractError("not_found", "no such merchant");
  }
  if (merchant.status !== STATUS_PENDING) {
    throw new ContractError(
      "conflict",
      "that application is not awaiting review",
      {
        status: merchant.status,
      },
    );
  }

  const approve = params.decision === "approve";
  const nextStatus = approve ? MERCHANT_APPROVED : STATUS_REJECTED;
  const kybRow = merchant.kyb[0];
  const now = deps.now();

  return auditedTransaction(deps.db, async (tx) => {
    const updated = await tx.bitesMerchant.update({
      where: { id: params.merchantId },
      data: { status: nextStatus, approvedAt: approve ? now : null },
    });
    if (kybRow !== undefined) {
      await tx.merchantKyb.update({
        where: { id: kybRow.id },
        data: { reviewedBy: params.actor.id, decision: params.decision },
      });
    }

    const event: OutboxInput = {
      name: approve ? "merchant.approved" : "merchant.fix_requested",
      aggregateType: "merchant",
      aggregateId: params.merchantId,
      fromVersion: 1,
      toVersion: 2,
      actor: params.actor,
      actorType: actorTypeFor(params.actor.role),
      cityId: params.cityId,
      idempotencyKey: `merchant.review:${params.merchantId}:${params.decision}`,
      correlationId: params.correlationId,
      occurredAt: now,
      payload: { merchantId: params.merchantId, decision: params.decision },
    };

    return {
      result: toMerchantView(
        updated,
        merchant.outlets.map((o) => o.id),
      ),
      audit: {
        actor: params.actor,
        action: `bites.merchant.${params.decision}`,
        subjectType: "merchant",
        subjectId: params.merchantId,
        reason: params.reason,
        before: { status: merchant.status },
        after: { status: nextStatus },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

function assertOwnsMerchant(actor: Actor, merchantId: string): void {
  assertPermission(actor.role, "merchant.manage");
  if (actor.role === "ops_admin") {
    return;
  }
  if (actor.id !== merchantId) {
    throw new ContractError(
      "forbidden",
      "you may only manage your own business",
    );
  }
}

async function loadOwnedOutlet(
  deps: BitesDeps,
  actor: Actor,
  outletId: string,
): Promise<{ outletId: string; merchantId: string }> {
  const outlet = await deps.db.outlet.findUnique({ where: { id: outletId } });
  if (outlet === null) {
    throw new ContractError("not_found", "no such outlet");
  }
  assertOwnsMerchant(actor, outlet.merchantId);
  return { outletId: outlet.id, merchantId: outlet.merchantId };
}

// ---------------------------------------------------------------------------
// Outlets & menu building
// ---------------------------------------------------------------------------

export interface CreateOutletParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly merchantId: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly hours: JsonRecord | null;
  readonly correlationId: string | null;
}

export async function createOutlet(
  deps: BitesDeps,
  params: CreateOutletParams,
): Promise<{ readonly outletId: string }> {
  assertOwnsMerchant(params.actor, params.merchantId);
  const outletId = generateId("outlet");
  return auditedTransaction(deps.db, async (tx) => {
    await tx.outlet.create({
      data: {
        id: outletId,
        merchantId: params.merchantId,
        address: params.address,
        lat: params.lat,
        lng: params.lng,
        hours: params.hours ?? undefined,
        open: true,
      },
    });
    return {
      result: { outletId },
      audit: {
        actor: params.actor,
        action: "bites.outlet.created",
        subjectType: "outlet",
        subjectId: outletId,
        after: { merchantId: params.merchantId },
        correlationId: params.correlationId,
      },
    };
  });
}

export interface OptionGroupInput {
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly {
    readonly name: string;
    readonly priceDeltaMinor: number;
  }[];
}

export interface CreateMenuItemParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly outletId: string;
  readonly category: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly allergens: readonly string[];
  readonly photoRef: string | null;
  readonly optionGroups: readonly OptionGroupInput[];
  readonly correlationId: string | null;
}

export interface MenuItemCreated {
  readonly itemId: string;
  readonly active: boolean;
  readonly currency: string;
}

/**
 * Builds a menu item with its option groups. The currency is taken from city
 * config, never the request (CLAUDE.md #5); the merchant's own `priceMinor` is
 * kept. The item is published (active) only if the merchant is already
 * approved — otherwise it is built but stays unpublished.
 */
export async function createMenuItem(
  deps: BitesDeps,
  params: CreateMenuItemParams,
): Promise<MenuItemCreated> {
  const { outletId, merchantId } = await loadOwnedOutlet(
    deps,
    params.actor,
    params.outletId,
  );
  const { city } = await deps.config.loadForBites(params.cityId);

  const merchant = await deps.db.bitesMerchant.findUnique({
    where: { id: merchantId },
  });
  if (merchant === null) {
    throw new ContractError("not_found", "no such merchant");
  }
  const active = merchant.status === MERCHANT_APPROVED;

  const itemId = generateId("item");
  return auditedTransaction(deps.db, async (tx) => {
    await tx.bitesMenuItem.create({
      data: {
        id: itemId,
        outletId,
        category: params.category,
        name: params.name,
        description: params.description,
        priceMinor: BigInt(params.priceMinor),
        currency: city.currency,
        allergens: [...params.allergens],
        photoRef: params.photoRef,
        active,
      },
    });
    for (const group of params.optionGroups) {
      const groupId = generateId("optgrp");
      await tx.optionGroup.create({
        data: {
          id: groupId,
          itemId,
          name: group.name,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
        },
      });
      for (const option of group.options) {
        await tx.menuOption.create({
          data: {
            id: generateId("opt"),
            groupId,
            name: option.name,
            priceDeltaMinor: BigInt(option.priceDeltaMinor),
          },
        });
      }
    }
    return {
      result: { itemId, active, currency: city.currency },
      audit: {
        actor: params.actor,
        action: "bites.menu_item.created",
        subjectType: "menu_item",
        subjectId: itemId,
        after: { outletId, active, priceMinor: params.priceMinor },
        correlationId: params.correlationId,
      },
    };
  });
}

export interface AvailabilityParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly itemId: string;
  readonly action: "sold_out" | "available" | "activate" | "deactivate";
  readonly soldOutUntil: Date | null;
  readonly correlationId: string | null;
}

/** The console availability toggle: sell out / restore an item, publish / unpublish it. */
export async function setAvailability(
  deps: BitesDeps,
  params: AvailabilityParams,
): Promise<{
  readonly itemId: string;
  readonly active: boolean;
  readonly soldOut: boolean;
}> {
  const item = await deps.db.bitesMenuItem.findUnique({
    where: { id: params.itemId },
    include: { outlet: true },
  });
  if (item === null) {
    throw new ContractError("not_found", "no such menu item");
  }
  assertOwnsMerchant(params.actor, item.outlet.merchantId);

  const merchant = await deps.db.bitesMerchant.findUnique({
    where: { id: item.outlet.merchantId },
  });
  if (merchant === null) {
    throw new ContractError("not_found", "no such merchant");
  }

  const now = deps.now();
  let active = item.active;
  let soldOutUntil = item.soldOutUntil;
  const events: OutboxInput[] = [];

  switch (params.action) {
    case "sold_out": {
      soldOutUntil =
        params.soldOutUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
      events.push(
        availabilityEvent(
          deps,
          params,
          item.outlet.merchantId,
          "menu.item_unavailable",
          {
            itemId: params.itemId,
            soldOutUntil: soldOutUntil.toISOString(),
          },
        ),
      );
      break;
    }
    case "available": {
      soldOutUntil = null;
      break;
    }
    case "activate": {
      if (merchant.status !== MERCHANT_APPROVED) {
        // Publishing before approval is exactly what the guard forbids.
        throw new ContractError(
          "conflict",
          "a menu cannot be published before the merchant is approved",
          { merchantId: item.outlet.merchantId, status: merchant.status },
        );
      }
      active = true;
      break;
    }
    case "deactivate": {
      active = false;
      break;
    }
    default:
      throw new ContractError(
        "validation_failed",
        "unknown availability action",
      );
  }

  return auditedTransaction(deps.db, async (tx) => {
    await tx.bitesMenuItem.update({
      where: { id: params.itemId },
      data: { active, soldOutUntil: soldOutUntil ?? null },
    });
    return {
      result: {
        itemId: params.itemId,
        active,
        soldOut:
          soldOutUntil !== null && soldOutUntil.getTime() > now.getTime(),
      },
      audit: {
        actor: params.actor,
        action: `bites.menu_item.${params.action}`,
        subjectType: "menu_item",
        subjectId: params.itemId,
        before: { active: item.active, soldOut: item.soldOutUntil !== null },
        after: { active, soldOut: soldOutUntil !== null },
        correlationId: params.correlationId,
      },
      events,
    };
  });
}

function availabilityEvent(
  deps: BitesDeps,
  params: AvailabilityParams,
  merchantId: string,
  name: string,
  payload: JsonRecord,
): OutboxInput {
  return {
    name,
    aggregateType: "menu_item",
    aggregateId: params.itemId,
    fromVersion: null,
    toVersion: 1,
    actor: params.actor,
    actorType: actorTypeFor(params.actor.role),
    cityId: params.cityId,
    idempotencyKey: `${name}:${params.itemId}:${deps.now().getTime()}`,
    correlationId: params.correlationId,
    occurredAt: deps.now(),
    payload: { merchantId, ...payload },
  };
}

export interface PauseStoreParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly outletId: string;
  readonly pausedUntil: Date;
  readonly correlationId: string | null;
}

export async function pauseStore(
  deps: BitesDeps,
  params: PauseStoreParams,
): Promise<{ readonly outletId: string; readonly pausedUntil: string }> {
  const { outletId, merchantId } = await loadOwnedOutlet(
    deps,
    params.actor,
    params.outletId,
  );
  return auditedTransaction(deps.db, async (tx) => {
    await tx.outlet.update({
      where: { id: outletId },
      data: { pausedUntil: params.pausedUntil },
    });
    const event: OutboxInput = {
      name: "store.paused",
      aggregateType: "outlet",
      aggregateId: outletId,
      fromVersion: null,
      toVersion: 1,
      actor: params.actor,
      actorType: actorTypeFor(params.actor.role),
      cityId: params.cityId,
      idempotencyKey: `store.paused:${outletId}:${params.pausedUntil.getTime()}`,
      correlationId: params.correlationId,
      occurredAt: deps.now(),
      payload: {
        merchantId,
        outletId,
        pausedUntil: params.pausedUntil.toISOString(),
      },
    };
    return {
      result: { outletId, pausedUntil: params.pausedUntil.toISOString() },
      audit: {
        actor: params.actor,
        action: "bites.store.paused",
        subjectType: "outlet",
        subjectId: outletId,
        after: { pausedUntil: params.pausedUntil.toISOString() },
        correlationId: params.correlationId,
      },
      events: [event],
    };
  });
}

// ---------------------------------------------------------------------------
// Console reads
// ---------------------------------------------------------------------------

export interface MerchantOrderRow {
  readonly orderId: string;
  readonly outletId: string;
  readonly status: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

export async function listMerchantOrders(
  deps: BitesDeps,
  actor: Actor,
  merchantId: string,
  filters: { readonly status?: string; readonly limit: number },
): Promise<readonly MerchantOrderRow[]> {
  assertOwnsMerchant(actor, merchantId);
  const outlets = await deps.db.outlet.findMany({
    where: { merchantId },
    select: { id: true },
  });
  const outletIds = outlets.map((o) => o.id);
  const orders = await deps.db.bitesOrder.findMany({
    where: {
      outletId: { in: outletIds },
      ...(filters.status === undefined ? {} : { status: filters.status }),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
  return orders.map((order) => {
    const totals = order.totals as { totalMinor?: unknown } | null;
    const totalMinor =
      totals !== null && typeof totals.totalMinor === "number"
        ? totals.totalMinor
        : 0;
    return {
      orderId: order.id,
      outletId: order.outletId,
      status: order.status,
      totalMinor,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
    };
  });
}

export interface PayoutRow {
  readonly id: string;
  readonly weekStart: string;
  readonly grossMinor: number;
  readonly feesMinor: number;
  readonly refundsMinor: number;
  readonly netMinor: number;
  readonly currency: string;
  readonly status: string;
}

export async function getPayouts(
  deps: BitesDeps,
  actor: Actor,
  merchantId: string,
): Promise<readonly PayoutRow[]> {
  assertOwnsMerchant(actor, merchantId);
  const payouts = await deps.db.merchantPayout.findMany({
    where: { merchantId },
    orderBy: { weekStart: "desc" },
  });
  return payouts.map((payout) => ({
    id: payout.id,
    weekStart: payout.weekStart.toISOString().slice(0, 10),
    grossMinor: Number(payout.grossMinor),
    feesMinor: Number(payout.feesMinor),
    refundsMinor: Number(payout.refundsMinor),
    netMinor: Number(payout.netMinor),
    currency: payout.currency,
    status: payout.status,
  }));
}

function toMerchantView(
  merchant: {
    id: string;
    status: string;
    tradeName: string | null;
    approvedAt: Date | null;
  },
  outletIds: readonly string[],
): MerchantView {
  return {
    merchantId: merchant.id,
    status: merchant.status,
    tradeName: merchant.tradeName,
    approvedAt:
      merchant.approvedAt === null ? null : merchant.approvedAt.toISOString(),
    outletIds,
  };
}
