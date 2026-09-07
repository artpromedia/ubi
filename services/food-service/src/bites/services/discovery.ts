/**
 * Discovery: the Bites feed and search.
 *
 * Both quote an ETA and a delivery fee per merchant. The fee and the ETA come
 * from city config, never a code literal (CLAUDE.md #1, #5); a true
 * courier-supply-driven ETA needs the courier supply service, which is out of
 * this slice's scope, so the quote is the configured base until that lands.
 *
 * An approved merchant that is closed or paused is shown as unavailable rather
 * than hidden (CLAUDE.md #8). A merchant still in KYB review does not appear at
 * all — it has nothing published to order.
 */
import {
  assertFlagEnabled,
  quotedEtaMinutes,
  type BitesCityConfig,
} from "../city-config.js";
import { MERCHANT_APPROVED } from "./menu.js";

import type { BitesDeps } from "../context.js";

export interface MerchantQuote {
  readonly merchantId: string;
  readonly outletId: string;
  readonly tradeName: string | null;
  readonly rankScore: number;
  readonly etaMinutes: number;
  readonly deliveryFeeMinor: number;
  readonly currency: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

type OutletWithMerchant = {
  id: string;
  open: boolean;
  pausedUntil: Date | null;
  merchantId: string;
  merchant: { tradeName: string | null; rankScore: unknown };
};

function quoteFor(
  outlet: OutletWithMerchant,
  config: BitesCityConfig,
  now: Date,
): MerchantQuote {
  const paused =
    outlet.pausedUntil !== null && outlet.pausedUntil.getTime() > now.getTime();
  const available = outlet.open && !paused;
  const unavailableReason = !outlet.open ? "closed" : paused ? "paused" : null;
  return {
    merchantId: outlet.merchantId,
    outletId: outlet.id,
    tradeName: outlet.merchant.tradeName,
    rankScore: Number(outlet.merchant.rankScore),
    etaMinutes: quotedEtaMinutes(config.policy),
    deliveryFeeMinor: config.policy.deliveryFeeMinor,
    currency: config.city.currency,
    available,
    unavailableReason,
  };
}

export async function feed(
  deps: BitesDeps,
  cityId: string,
  addressId: string,
): Promise<{
  readonly addressId: string;
  readonly merchants: readonly MerchantQuote[];
}> {
  const config = await deps.config.loadForBites(cityId);
  assertFlagEnabled(config.flags, "bites");

  const outlets = await deps.db.outlet.findMany({
    where: { merchant: { status: MERCHANT_APPROVED } },
    include: { merchant: { select: { tradeName: true, rankScore: true } } },
    orderBy: { merchant: { rankScore: "desc" } },
    take: 100,
  });

  const now = deps.now();
  return {
    addressId,
    merchants: outlets.map((outlet) => quoteFor(outlet, config, now)),
  };
}

export interface SearchFilters {
  readonly q: string | undefined;
  readonly openNow: boolean;
  readonly limit: number;
}

export async function search(
  deps: BitesDeps,
  cityId: string,
  filters: SearchFilters,
): Promise<{ readonly merchants: readonly MerchantQuote[] }> {
  const config = await deps.config.loadForBites(cityId);
  assertFlagEnabled(config.flags, "bites");

  const q = filters.q?.trim();
  const outlets = await deps.db.outlet.findMany({
    where: {
      merchant: {
        status: MERCHANT_APPROVED,
        ...(q === undefined || q.length === 0
          ? {}
          : {
              OR: [
                { tradeName: { contains: q, mode: "insensitive" } },
                { legalName: { contains: q, mode: "insensitive" } },
              ],
            }),
      },
      ...(filters.openNow ? { open: true } : {}),
    },
    include: { merchant: { select: { tradeName: true, rankScore: true } } },
    orderBy: { merchant: { rankScore: "desc" } },
    take: filters.limit,
  });

  const now = deps.now();
  const quotes = outlets.map((outlet) => quoteFor(outlet, config, now));
  return {
    merchants: filters.openNow
      ? quotes.filter((quote) => quote.available)
      : quotes,
  };
}
