/**
 * The remittance arithmetic — pure, integer, and the only place it lives.
 *
 * Money is integer minor units and hours are contract B's decimal hours with
 * at most two decimal places, so every hour figure is converted ONCE to an
 * integer number of hundredths of an hour ("centi-hours") and all division
 * happens in BigInt. No float ever touches an amount.
 *
 * Q2 (decided, docs/design/FLEET_CALENDAR_DECISIONS.md): a `weekly_fixed`
 * remittance is pro-rated for the signed shift hours the fleet itself took
 * away with PLANNED maintenance:
 *
 *     due = floor(amountMinor × max(0, shift − planned) / shift)   when shift > 0
 *     due = 0                                                       when shift = 0
 *
 * ROUNDING: floor (the quotient is never negative, so floor is truncation).
 * The fractional minor unit a pro-rata leaves stays with the DRIVER — the
 * fleet never receives more than the exact pro-rata share. A zero-shift week
 * has no signed shift hours for the arrangement to be earned against, so
 * nothing is due (there is no pro-rata basis to divide by).
 *
 * THE WEEK'S BASIS when a signed arrangement is SUPERSEDED mid-week (a
 * material change — terms, shift or vehicle — re-signed by the driver):
 * fleet-service reports the old and the new version as two contract-B items
 * whose active windows meet (`activeTo` of one = `activeFrom` of the next),
 * each with only its own part of the week's signed shift hours. A weekly
 * amount prices the WHOLE week's signed shift, so each version is owed its
 * share of it — the Q2 basis is the week's signed shift hours across the
 * chain, not one version's part:
 *
 *     due = floor(amountMinor × max(0, shift − planned) / weekBasis)
 *
 * where `weekBasis` = Σ shift of the chain (≥ this item's shift). For an
 * arrangement that stands alone in the week, weekBasis = shift and this is
 * exactly the Q2 formula above. Without it, a mid-week change would charge
 * two full weekly amounts for one week.
 *
 * Q8 (decided): UNPLANNED off-road hours (breakdowns, driver reports) are NOT
 * deducted — the terms' shortfall / carry-forward rule applies instead. They
 * are an input only so the snapshot records them.
 *
 * `percent_of_net`: due = floor(net × percentBps / 10 000) on the driver's
 * net for the week read from the ledger (nothing to pro-rate: a week with
 * less driving already earns less). A week with no positive net owes nothing.
 */
import { ContractError } from "@ubi/contracts";

/** Decimal hours (≤ 2 dp) as integer hundredths of an hour. */
export function centiHours(hours: number): number {
  const centi = Math.round(hours * 100);
  if (
    !Number.isFinite(hours) ||
    hours < 0 ||
    Math.abs(hours * 100 - centi) > 1e-6
  ) {
    throw new ContractError(
      "validation_failed",
      "hours are nonnegative decimal hours with at most two decimal places",
      { hours },
    );
  }
  return centi;
}

/** A percent (≤ 2 dp, 0 < p ≤ 100) as integer basis points. */
export function percentBps(percent: number): number {
  const bps = Math.round(percent * 100);
  if (
    !Number.isFinite(percent) ||
    bps <= 0 ||
    bps > 10_000 ||
    Math.abs(percent * 100 - bps) > 1e-6
  ) {
    throw new ContractError(
      "validation_failed",
      "a remittance percent is between 0 and 100 with at most two decimal places",
      { percent },
    );
  }
  return bps;
}

function assertMinor(amountMinor: number, field: string): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new ContractError(
      "validation_failed",
      `${field} must be an integer number of minor units`,
      { [field]: amountMinor },
    );
  }
}

/**
 * Q2: the weekly_fixed remittance for the week, pro-rated for planned
 * maintenance — over the week's signed-shift basis (this item's own shift
 * unless a mid-week supersession split the week; see the header).
 */
export function proRataRemittanceMinor(
  amountMinor: number,
  shiftCenti: number,
  plannedCenti: number,
  weekBasisCenti: number = shiftCenti,
): number {
  assertMinor(amountMinor, "amountMinor");
  if (
    amountMinor < 0 ||
    shiftCenti < 0 ||
    plannedCenti < 0 ||
    weekBasisCenti < shiftCenti
  ) {
    throw new ContractError(
      "validation_failed",
      "remittance inputs are never negative, and the week's basis includes this shift",
    );
  }
  if (shiftCenti === 0) {
    return 0;
  }
  const worked = Math.max(0, shiftCenti - plannedCenti);
  return Number(
    (BigInt(amountMinor) * BigInt(worked)) / BigInt(weekBasisCenti),
  );
}

/** percent_of_net: the percent of a positive weekly net, floored. */
export function percentOfNetMinor(netMinor: number, bps: number): number {
  assertMinor(netMinor, "netMinor");
  if (netMinor <= 0) {
    return 0;
  }
  return Number((BigInt(netMinor) * BigInt(bps)) / 10_000n);
}

/** One origin week's signed carry balance (positive = the driver owes the fleet). */
export interface OriginBalance {
  readonly origin: string;
  readonly amountMinor: number;
}

/**
 * Where an outstanding total sits after a week's collection, by origin week.
 *
 * Payments are applied OLDEST FIRST (a shortfall is paid down in the order it
 * arose, so the least is ever lost to the carry-forward cap), which leaves
 * any remainder on the NEWEST claims. Credits (negative origins, from a
 * closed week later found over-charged) are netted before any claim is left
 * outstanding; a remaining credit stays on the newest credit origins.
 *
 * `claims` must already include this week's due at its own origin. Returns
 * the post-settlement balance for every origin passed in.
 */
export function allocateOutstanding(
  claims: readonly OriginBalance[],
  remainingMinor: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const claim of claims) {
    result.set(claim.origin, 0);
  }
  const newestFirst = [...claims].sort((a, b) =>
    b.origin.localeCompare(a.origin),
  );
  let left = remainingMinor;
  if (left > 0) {
    for (const claim of newestFirst) {
      if (left === 0) {
        break;
      }
      if (claim.amountMinor > 0) {
        const kept = Math.min(claim.amountMinor, left);
        result.set(claim.origin, kept);
        left -= kept;
      }
    }
  } else if (left < 0) {
    for (const claim of newestFirst) {
      if (left === 0) {
        break;
      }
      if (claim.amountMinor < 0) {
        const kept = Math.max(claim.amountMinor, left);
        result.set(claim.origin, kept);
        left -= kept;
      }
    }
  }
  if (left !== 0) {
    // Unreachable: the remainder never exceeds what the claims add up to.
    throw new ContractError(
      "internal_error",
      "carry-forward allocation did not account for the whole remainder",
      { remainingMinor, unallocatedMinor: left },
    );
  }
  return result;
}
