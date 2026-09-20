// Pure helpers for the R04 stable-order rule: offers keep their arrival order across
// updates (new bids append, withdrawn bids stay in place); an ordering is applied only
// when the rider explicitly toggles a sort, and later arrivals append AFTER that
// snapshot so nothing reshuffles under touch.
import type { MpOfferDto } from "../../api/marketplace";

/** Append newly-seen bidIds to the arrival order; never remove or reorder existing ones. */
export function mergeArrivalOrder(
  order: string[],
  offers: { bidId: string }[],
): string[] {
  const seen = new Set(order);
  const next = order.slice();
  for (const o of offers)
    if (!seen.has(o.bidId)) {
      seen.add(o.bidId);
      next.push(o.bidId);
    }
  return next.length === order.length ? order : next;
}

/**
 * Explicit sort snapshot. Price compares the server amounts; "fastest pickup" puts
 * immediate offers before finishing-trip windows, then by the window's earliest bound
 * (immediate ETAs are server-phrased labels, so arrival order breaks ties).
 */
export function sortOfferIds(
  offers: MpOfferDto[],
  sort: "price" | "eta",
): string[] {
  const idx = new Map(offers.map((o, i) => [o.bidId, i]));
  const byArrival = (a: MpOfferDto, b: MpOfferDto) =>
    (idx.get(a.bidId) ?? 0) - (idx.get(b.bidId) ?? 0);
  const sorted = offers.slice().sort((a, b) => {
    if (sort === "price")
      return (
        a.amountMinor.amountMinor - b.amountMinor.amountMinor || byArrival(a, b)
      );
    const ka = a.kind === "immediate" ? 0 : 1;
    const kb = b.kind === "immediate" ? 0 : 1;
    return (
      ka - kb ||
      (a.pickupWindow?.earliestSec ?? 0) - (b.pickupWindow?.earliestSec ?? 0) ||
      byArrival(a, b)
    );
  });
  return sorted.map((o) => o.bidId);
}

/** Display order: the explicit sort snapshot (if any) with later arrivals appended, else arrival order. */
export function displayOrder(
  arrival: string[],
  sortedSnapshot: string[] | null,
): string[] {
  if (!sortedSnapshot) return arrival;
  const inSnapshot = new Set(sortedSnapshot);
  return [...sortedSnapshot, ...arrival.filter((id) => !inSnapshot.has(id))];
}
