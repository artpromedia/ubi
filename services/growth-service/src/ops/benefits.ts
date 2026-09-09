/**
 * Rider benefits (CLAUDE.md #26; contracts/openapi/promotions.yaml).
 *
 * The four rider benefit types — fare_discount, fee_waiver, credit,
 * referral_reward — are DISTINCT objects, each carrying its own eligibility,
 * min spend, cap, expiry, stacking, funding party and campaign version. The
 * client renders `adjustments[]`; it never computes an amount. A rider discount
 * is funded by marketing and shown as an adjustment — it never reduces a
 * driver's contracted earnings or a supplier's amount (enforced in the
 * incentives and promotion modules; surfaced here only as a labelled benefit).
 */
import { money, ContractError, type Money } from "@ubi/contracts";

import { assertPermission } from "./roles";

import type { GrowthDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

const RIDER_OFFER_TYPES = ["fare_discount", "fee_waiver", "credit"] as const;

export async function getBenefits(
  deps: GrowthDeps,
  actor: Actor,
): Promise<JsonRecord> {
  assertPermission(actor.role, "benefits.read.self");
  const now = deps.now();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Credits — a promo balance with a per-ride cap and a scope (CLAUDE.md #26).
  const creditRows = await deps.db.userCredit.findMany({
    where: { userId: actor.id, expiresAt: { gte: today } },
    orderBy: { expiresAt: "asc" },
  });
  const credits = creditRows.map((c) => ({
    amount: moneyJson(money(Number(c.amountMinor), c.currency)),
    expiresAt: c.expiresAt.toISOString().slice(0, 10),
    perRideCap:
      c.perRideCapMinor === null
        ? null
        : moneyJson(money(Number(c.perRideCapMinor), c.currency)),
    scope: c.scope,
    restrictions: [] as string[],
  }));

  // Offers — one per active rider-benefit campaign, status derived from the
  // campaign state, the window and the recorded exhaustion timestamp.
  const versions = await deps.db.campaignVersion.findMany({
    where: {
      campaign: {
        benefitType: { in: RIDER_OFFER_TYPES as unknown as string[] },
        state: { in: ["active", "scheduled", "exhausted"] },
      },
    },
    include: { campaign: true, budget: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const offers: JsonRecord[] = [];
  for (const v of versions) {
    const heldForUser = await deps.db.promotionReservation.count({
      where: {
        userId: actor.id,
        campaignVersionId: v.id,
        state: { in: ["reserved", "consumed"] },
      },
    });
    const caps = v.caps as { perUser?: number; minSpend?: { amountMinor?: number } } | null;
    const perUser = caps?.perUser ?? null;
    let status: string;
    let statusAt: string | null = null;
    let reasonCode: string | null = null;
    if (v.budget?.exhaustedAt != null) {
      status = "used_up";
      statusAt = v.budget.exhaustedAt.toISOString();
    } else if (now.getTime() < v.windowStart.getTime()) {
      status = "scheduled";
    } else if (now.getTime() >= v.windowEnd.getTime()) {
      status = "expired";
    } else if (perUser !== null && heldForUser >= perUser) {
      status = "ineligible";
      reasonCode = "cap_reached";
    } else {
      status = "active";
    }
    offers.push({
      id: v.id,
      type: v.campaign.benefitType,
      title: v.campaign.name,
      status,
      statusAt,
      reasonCode,
      rules: {
        market: v.market,
        validFrom: v.windowStart.toISOString(),
        validUntil: v.windowEnd.toISOString(),
        minSpend:
          caps?.minSpend?.amountMinor === undefined
            ? null
            : moneyJson(money(caps.minSpend.amountMinor, v.currency)),
        maxUses: perUser,
        stacking: (v.stacking as { priority?: number } | null)?.priority ?? null,
        fundedBy: (v.funding as { party?: string } | null)?.party ?? null,
      },
      campaignVersionId: v.id,
    });
  }

  const changes = await recentChanges(deps, actor.id);
  return { credits, offers, changes };
}

function moneyJson(m: Money): JsonRecord {
  return { amountMinor: m.amountMinor, currency: m.currency };
}

async function recentChanges(
  deps: GrowthDeps,
  userId: string,
): Promise<JsonRecord[]> {
  const reservations = await deps.db.promotionReservation.findMany({
    where: {
      userId,
      state: { in: ["consumed", "reversed"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return reservations.map((r) => changeView(r));
}

function changeView(r: {
  id: string;
  state: string;
  amountMinor: bigint;
  currency: string;
  updatedAt: Date;
  adjustmentType: string;
  reasonCode: string | null;
  termsRef: string | null;
}): JsonRecord {
  const kind = r.state === "consumed" ? "earned" : r.state === "reversed" ? "reversed" : "expired";
  return {
    id: r.id,
    kind,
    amount: moneyJson(money(Number(r.amountMinor), r.currency)),
    at: r.updatedAt.toISOString(),
    title: r.adjustmentType,
    reasonCode: r.reasonCode,
    termsRef:
      r.termsRef === null
        ? null
        : { title: "Promotions terms", section: r.termsRef, url: null },
    disputable: kind === "reversed",
  };
}

export async function getBenefitChange(
  deps: GrowthDeps,
  actor: Actor,
  changeId: string,
): Promise<JsonRecord> {
  assertPermission(actor.role, "benefits.read.self");
  const r = await deps.db.promotionReservation.findUnique({
    where: { id: changeId },
  });
  if (r === null || r.userId !== actor.id) {
    throw new ContractError("not_found", "no such benefit change", { changeId });
  }
  return changeView(r);
}
