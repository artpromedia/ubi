/**
 * Promotion recon (CLAUDE.md #4; contracts/openapi/growth-ops.yaml).
 *
 * For each campaign version it lines up promised vs reserved vs consumed vs
 * reversed, from two independent sources: the running `campaign_budgets`
 * counters, and the sum of the `promotion_reservations` rows. The difference
 * between them is the "unexplained" figure. A day cannot close while any
 * version's unexplained ≠ 0 — the same rule the finance ledger recon uses
 * (`recon_unexplained`).
 */
import type { GrowthDeps } from "./context";
import type { Actor, JsonRecord } from "./types";

import { assertPermission } from "./roles";

export async function reconForDate(
  deps: GrowthDeps,
  actor: Actor,
  date: string,
): Promise<JsonRecord> {
  assertPermission(actor.role, "recon.read");

  const budgets = await deps.db.campaignBudget.findMany({
    include: { campaignVersion: true },
    take: 500,
  });

  const versions: JsonRecord[] = [];
  let totalUnexplained = 0;

  for (const b of budgets) {
    const sums = await deps.db.promotionReservation.groupBy({
      by: ["state"],
      where: { campaignVersionId: b.campaignVersionId },
      _sum: { amountMinor: true },
    });
    const byState: Record<string, number> = {
      reserved: 0,
      consumed: 0,
      released: 0,
      reversed: 0,
    };
    for (const s of sums) {
      byState[s.state] = Number(s._sum.amountMinor ?? 0n);
    }
    const reservedRows = byState.reserved ?? 0;
    const consumedRows = byState.consumed ?? 0;
    const reversedRows = byState.reversed ?? 0;

    // The counters must equal the row sums, allowing for reversed netting.
    const unexplained =
      Number(b.reservedMinor) - reservedRows +
      (Number(b.consumedMinor) - (consumedRows - reversedRows)) +
      (Number(b.reversedMinor) - reversedRows);
    totalUnexplained += Math.abs(unexplained);

    versions.push({
      campaignVersionId: b.campaignVersionId,
      currency: b.campaignVersion.currency,
      promisedMinor: reservedRows + consumedRows,
      reservedMinor: Number(b.reservedMinor),
      consumedMinor: Number(b.consumedMinor),
      reversedMinor: Number(b.reversedMinor),
      exhaustedAt: b.exhaustedAt?.toISOString() ?? null,
      unexplainedMinor: unexplained,
    });
  }

  return {
    date,
    versions,
    unexplainedMinor: totalUnexplained,
    canClose: totalUnexplained === 0,
  };
}
