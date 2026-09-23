/**
 * The keys and ledger references that link a post-award AMENDMENT's money to
 * the award it amends (A02 item 5).
 *
 * An amendment never edits the award's original rows: every money change it
 * makes is a new, linked record keyed by (the award's record, amendmentId):
 *
 *  - a commission INCREMENT is its own `mp_commission_holds` row whose bid
 *    ref is `mpdelta:<captured reservation id>:<amendmentId>` — unique, so an
 *    amendment can reserve at most one increment, ever;
 *  - a commission DECREMENT is a linked partial-reversal journal entry whose
 *    idempotency key is scoped to the same pair;
 *  - a rider funding adjustment is its own `mp_rider_reservations` row whose
 *    award key is `amendment:<awardId>:<amendmentId>` — unique, so an
 *    amendment adjusts an award's funding at most once, ever.
 *
 * The ids that travel inside those composite keys may not carry the `:`
 * separator, so a prefix scan for one award can never pick up another's rows.
 */
import { ContractError } from "@ubi/contracts";

import { fromNullableDbMinor } from "./minor-units";

import type { EntryKind } from "./accounts";
import type { LedgerTx } from "./types";

/**
 * Ride-service ids are `<prefix>_<base64url>` or UUIDs; both fit. Anything
 * else — in particular a `:` — is refused before it can reach a key.
 */
const LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function assertLinkId(
  field: "amendmentId" | "awardId",
  value: string,
): void {
  if (!LINK_ID_PATTERN.test(value)) {
    throw new ContractError(
      "validation_failed",
      `${field} must be 1-128 characters of letters, digits, '_', '.' or '-'`,
      { field },
    );
  }
}

/**
 * Prisma's `startsWith` becomes `LIKE '<value>%'` WITHOUT escaping the
 * value, so the `_` every generated id carries (`mph_…`, `awd_…`, base64url)
 * would match ANY character — award `awd_x` would pick up award `awdQx`'s
 * rows. Every prefix handed to `startsWith` goes through this: `\`, `%` and
 * `_` are escaped with Postgres's default LIKE escape character.
 */
export function likePrefixLiteral(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ── Commission deltas ──────────────────────────────────────────────────────

const COMMISSION_DELTA_PREFIX = "mpdelta:";

/** The bid ref of an amendment's commission increment row. */
export function commissionDeltaBidRef(
  reservationId: string,
  amendmentId: string,
): string {
  return `${COMMISSION_DELTA_PREFIX}${reservationId}:${amendmentId}`;
}

/**
 * Every increment row of one captured reservation starts with this. The
 * value is LIKE-escaped: it is only for a Prisma `startsWith` filter.
 */
export function commissionDeltaPrefix(reservationId: string): string {
  return likePrefixLiteral(`${COMMISSION_DELTA_PREFIX}${reservationId}:`);
}

/**
 * True for an amendment increment row. The generic hold operations refuse
 * these: an increment is reserved, captured and released only through the
 * amendment operations, which check it against the award's captured total.
 */
export function isCommissionDeltaBidRef(bidRef: string): boolean {
  return bidRef.startsWith(COMMISSION_DELTA_PREFIX);
}

/** Counterpart ref on both lines of an increment capture. */
export function deltaCaptureCounterpartRef(
  awardId: string,
  amendmentId: string,
): string {
  return `award:${awardId}:amendment:${amendmentId}`;
}

/** Counterpart ref on both lines of a decrement's partial reversal. */
export function deltaRefundCounterpartRef(
  awardId: string,
  amendmentId: string,
): string {
  return `award:${awardId}:amendment:${amendmentId}:refund`;
}

/** The entry kinds that move an award's commission, and nothing else. */
const COMMISSION_ENTRY_KINDS: readonly EntryKind[] = [
  "mp_commission_capture",
  "mp_commission_reversal",
  "mp_commission_delta_capture",
  "mp_commission_delta_refund",
];

/**
 * The commission captured for an award TO DATE, derived from the journal —
 * never from a stored figure (CLAUDE.md #4): the original capture, plus every
 * captured increment, minus every partial reversal and any full reversal.
 *
 * It reads the DRIVER-WALLET side of those entries (the wallet index keeps
 * the scan to one driver's lines); every commission entry is a two-line
 * wallet ↔ `ubi_commission` movement carrying the same counterpart ref on
 * both lines, so the wallet side is the exact negative of the fee side.
 * Callers read it under the driver wallet's row lock, which serialises every
 * operation that could move it.
 */
export async function capturedCommissionMinor(
  tx: LedgerTx,
  walletId: string,
  awardId: string,
  currency: string,
): Promise<number> {
  const result = await tx.journalLine.aggregate({
    _sum: { amountMinor: true },
    where: {
      walletId,
      currency,
      account: "wallet",
      entry: { kind: { in: [...COMMISSION_ENTRY_KINDS] } },
      OR: [
        { counterpartRef: `award:${awardId}` },
        { counterpartRef: `award:${awardId}:reversal` },
        {
          counterpartRef: {
            startsWith: likePrefixLiteral(`award:${awardId}:amendment:`),
          },
        },
      ],
    },
  });
  // Wallet lines of a capture are debits (negative); the fee taken is their negation.
  return -fromNullableDbMinor(result._sum.amountMinor);
}

// ── Rider funding adjustments ──────────────────────────────────────────────

const FUNDING_ADJUSTMENT_PREFIX = "amendment:";

/** The award key of an amendment's rider funding adjustment row. */
export function fundingAdjustmentKey(
  awardId: string,
  amendmentId: string,
): string {
  return `${FUNDING_ADJUSTMENT_PREFIX}${awardId}:${amendmentId}`;
}

/**
 * True for an amendment adjustment's award key. Authorization refuses these
 * as award ids, so no reservation can squat an amendment's unique key.
 */
export function isFundingAdjustmentKey(awardId: string): boolean {
  return awardId.startsWith(FUNDING_ADJUSTMENT_PREFIX);
}

/**
 * Every adjustment row of one award starts with this. The value is
 * LIKE-escaped: it is only for a Prisma `startsWith` filter.
 */
export function fundingAdjustmentPrefix(awardId: string): string {
  return likePrefixLiteral(`${FUNDING_ADJUSTMENT_PREFIX}${awardId}:`);
}

/**
 * Adjustment row statuses. A top-up is `reserved` until its amendment
 * commits, then `committed`; a partial release is born `committed` (it is
 * only ever recorded at commit). Both encumber the rider's wallet until the
 * award settles (`consumed`) or is abandoned (`released`).
 */
export const FUNDING_ADJUSTMENT_OPEN = "reserved" as const;
export const FUNDING_ADJUSTMENT_COMMITTED = "committed" as const;
