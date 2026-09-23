/**
 * The mandate period allowance (CLAUDE.md #18) — user-service's typed door onto
 * the ONE canonical mechanism: the `mandate_allowance_reserve` /
 * `mandate_allowance_settle` SQL functions owned by packages/database
 * (migration 20260923100000_grant_mandate_binding).
 *
 * The mechanism is the guarded UPDATE this module's predecessor
 * (`run.ts reserveAllowance`) ran inline, moved into the database unchanged in
 * its semantics so every caller runs it inside its own transaction: mandate
 * runs here, and ask-service's unattended marketplace selections, reserve and
 * settle through the same functions and can never drift apart.
 *
 *   reserve  budget + one run for the period. The mandate row is read FOR
 *            SHARE and status / expiry / currency / per-run cap are re-checked
 *            under that lock; the period cap and run count are re-checked by one
 *            guarded UPDATE under the allowance row lock. Concurrent reservations
 *            of one mandate serialise there, so the caps cannot be exceeded.
 *   settle   exactly once, guarded by `status = 'pending'`: `commit` records the
 *            actual spend, `release` returns budget + run. A replay is a no-op.
 */
import { isoDate } from "./serialize";

import type { Tx } from "../identity/audit";

export type ReserveOutcome =
  | "reserved"
  | "replayed"
  | "mandate_not_found"
  | "mandate_paused"
  | "mandate_revoked"
  | "mandate_expired"
  | "currency_mismatch"
  | "price_above_cap"
  | "allowance_exhausted";

const RESERVE_OUTCOMES: ReadonlySet<string> = new Set<ReserveOutcome>([
  "reserved",
  "replayed",
  "mandate_not_found",
  "mandate_paused",
  "mandate_revoked",
  "mandate_expired",
  "currency_mismatch",
  "price_above_cap",
  "allowance_exhausted",
]);

export interface ReserveInput {
  /** The new reservation's id (ignored on a replay). */
  readonly reservationId: string;
  /** Unique per reservation; a replay returns the original reservation. */
  readonly idempotencyKey: string;
  readonly mandateId: string;
  /** The period's UTC first-of-month (`mandates.ts currentPeriodStart`). */
  readonly periodStart: Date;
  readonly amountMinor: number;
  readonly currency: string;
  readonly grantId: string | null;
  readonly now: Date;
}

export interface ReserveResult {
  readonly outcome: ReserveOutcome;
  /** Set for `reserved` and `replayed`. */
  readonly reservationId: string | null;
}

/** UTC `timestamp(3)` literal, matching how Prisma writes DateTime columns. */
function utc(now: Date): string {
  return now.toISOString();
}

export async function reserveAllowance(
  tx: Tx,
  input: ReserveInput,
): Promise<ReserveResult> {
  const rows = await tx.$queryRaw<
    { r_outcome: string; r_reservation_id: string | null }[]
  >`
    SELECT r_outcome, r_reservation_id
    FROM mandate_allowance_reserve(
      ${input.reservationId}::text,
      ${input.idempotencyKey}::text,
      ${input.mandateId}::text,
      ${isoDate(input.periodStart)}::date,
      ${BigInt(input.amountMinor)}::bigint,
      ${input.currency}::text,
      ${input.grantId}::text,
      (${utc(input.now)}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
    )`;
  const row = rows[0];
  if (row === undefined || !RESERVE_OUTCOMES.has(row.r_outcome)) {
    throw new Error("mandate_allowance_reserve returned no outcome");
  }
  return {
    outcome: row.r_outcome as ReserveOutcome,
    reservationId: row.r_reservation_id,
  };
}

export type SettleOutcome =
  | "committed"
  | "released"
  | "already_committed"
  | "already_released"
  | "not_found";

export interface SettleInput {
  readonly reservationId: string;
  readonly action: "commit" | "release";
  /** The actual spend; required for `commit`. */
  readonly actualMinor?: number;
  readonly resultRef?: string | null;
  /** Back-fills a reservation made before its grant existed. */
  readonly grantId?: string | null;
  readonly reasonCode?: string | null;
  readonly now: Date;
}

export async function settleAllowance(
  tx: Tx,
  input: SettleInput,
): Promise<SettleOutcome> {
  const actual =
    input.actualMinor === undefined ? null : BigInt(input.actualMinor);
  const rows = await tx.$queryRaw<{ outcome: string }[]>`
    SELECT mandate_allowance_settle(
      ${input.reservationId}::text,
      ${input.action}::text,
      ${actual}::bigint,
      ${input.resultRef ?? null}::text,
      ${input.grantId ?? null}::text,
      ${input.reasonCode ?? null}::text,
      (${utc(input.now)}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
    ) AS outcome`;
  const outcome = rows[0]?.outcome;
  if (outcome === undefined) {
    throw new Error("mandate_allowance_settle returned no outcome");
  }
  return outcome as SettleOutcome;
}
