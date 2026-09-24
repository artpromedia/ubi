/**
 * Who funds a fleet driver's 10% marketplace commission (addendum A05 item 3).
 *
 * THE RULE
 *  - DEFAULT: the driver's own wallet. The commission is reserved against the
 *    driver's wallet at bid and captured from it ONCE at selection
 *    (src/ledger/mp-holds.ts) exactly as for any driver — a fleet arrangement
 *    changes nothing about that path;
 *  - OPTIONAL fleet sponsorship is allowed ONLY through an explicit, budgeted,
 *    journaled arrangement: a fleet-funded budget the sponsorship draws on,
 *    refused when exhausted, each draw a linked journal entry;
 *  - NEVER BOTH: exactly one party funds a given commission. A sponsored
 *    commission would be charged to the sponsor INSTEAD OF the driver, never
 *    in addition, and the weekly remittance settlement (./settlement.ts)
 *    never posts a commission line of any kind.
 *
 * TODAY: no sponsorship arrangement exists (no budget store, no consent flow,
 * no fleet authority check), so a request for fleet sponsorship is REFUSED
 * explicitly (`feature_disabled`, reason `fleet_sponsorship_unavailable`) —
 * never silently treated as the driver paying, and never charged to both.
 * Building sponsorship means adding that arrangement first; until then every
 * decision this module returns names the driver's wallet as the one funder.
 */
import { ContractError } from "@ubi/contracts";

export const COMMISSION_FUNDING_SOURCES = [
  "driver_wallet",
  "fleet_sponsorship",
] as const;
export type CommissionFundingSource =
  (typeof COMMISSION_FUNDING_SOURCES)[number];

export interface CommissionFundingRequest {
  readonly source: CommissionFundingSource;
  readonly fleetId?: string | null;
}

/** Exactly one funder, always. */
export interface CommissionFundingDecision {
  readonly source: "driver_wallet";
  readonly funder: { readonly ownerType: "user"; readonly ownerId: string };
  readonly sponsorFleetId: null;
}

export function isCommissionFundingSource(
  value: string,
): value is CommissionFundingSource {
  return (COMMISSION_FUNDING_SOURCES as readonly string[]).includes(value);
}

/**
 * The single funder of a driver's commission. Absent a request, or asked for
 * the driver's wallet, it is the driver. Fleet sponsorship is refused until a
 * budgeted, journaled arrangement exists.
 */
export function resolveCommissionFunding(
  driverId: string,
  request?: CommissionFundingRequest | null,
): CommissionFundingDecision {
  if (request !== undefined && request !== null) {
    if (request.source === "fleet_sponsorship") {
      throw new ContractError(
        "feature_disabled",
        "fleet commission sponsorship is not available: no budgeted, journaled sponsorship arrangement exists, so the driver's wallet funds the commission",
        {
          reason: "fleet_sponsorship_unavailable",
          fleetId: request.fleetId ?? null,
        },
      );
    }
    if (request.source !== "driver_wallet") {
      throw new ContractError(
        "validation_failed",
        "unknown commission funding source",
        { source: String(request.source) },
      );
    }
  }
  return {
    source: "driver_wallet",
    funder: { ownerType: "user", ownerId: driverId },
    sponsorFleetId: null,
  };
}

/**
 * A settlement's lines may never move commission: the 10% was captured per
 * job at selection. Checked before every remittance posting, so a future
 * change cannot slip a second commission line into a settlement.
 */
export function assertNoCommissionLines(
  lines: ReadonlyArray<{ readonly account: string }>,
): void {
  if (lines.some((line) => line.account === "ubi_commission")) {
    throw new ContractError(
      "internal_error",
      "a fleet remittance posting must never touch the UBI commission",
    );
  }
}
