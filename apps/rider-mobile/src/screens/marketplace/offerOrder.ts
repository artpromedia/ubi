// Pure helpers for the R04 stable-order rule: offers keep their arrival order across
// updates (new bids append, withdrawn bids stay in place); an ordering is applied only
// when the rider explicitly picks a sort — the SERVER's order at that moment (A06 part A:
// `GET /v1/mp/requests/:id?sort=`, never a client ranking) — and later arrivals append
// AFTER that snapshot so nothing reshuffles under touch.

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

/** Display order: the explicit sort snapshot (if any) with later arrivals appended, else arrival order. */
export function displayOrder(
  arrival: string[],
  sortedSnapshot: string[] | null,
): string[] {
  if (!sortedSnapshot) return arrival;
  const inSnapshot = new Set(sortedSnapshot);
  return [...sortedSnapshot, ...arrival.filter((id) => !inSnapshot.has(id))];
}
