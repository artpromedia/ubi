/**
 * ask-service's typed door onto the canonical mandate period allowance
 * (rule #18, recheck A03 / P02).
 *
 * There is ONE allowance mechanism: the `mandate_allowance_reserve` /
 * `mandate_allowance_settle` SQL functions owned by packages/database
 * (migration 20260923100000_grant_mandate_binding) — the guarded UPDATE that
 * user-service's mandate runs use too (user-service mandates/allowance.ts). This
 * module only calls them, inside the caller's transaction, so an unattended
 * marketplace selection reserves budget + one run in the SAME transaction that
 * consumes its grant and persists its execution intent.
 *
 *   reserve  refused unless the mandate is active, unexpired, in the currency,
 *            within its per-run cap, and the period cap + run count still fit
 *            after every concurrent reservation (row-locked guarded UPDATE).
 *   settle   exactly once: commit the actual spend on an award, release the
 *            budget + run on a definitive failure. An ambiguous outcome is left
 *            pending — still counted — until it is reconciled.
 */
import { periodStartOf } from "./mandate-scope";

import type { AskTx } from "./types";

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
  readonly reservationId: string;
  readonly idempotencyKey: string;
  readonly mandateId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly grantId: string;
  readonly now: Date;
}

export interface ReserveResult {
  readonly outcome: ReserveOutcome;
  readonly reservationId: string | null;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function reserveMandateAllowance(
  tx: AskTx,
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
      ${isoDate(periodStartOf(input.now))}::date,
      ${BigInt(input.amountMinor)}::bigint,
      ${input.currency}::text,
      ${input.grantId}::text,
      (${input.now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
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
  readonly actualMinor?: number;
  readonly resultRef?: string | null;
  readonly reasonCode?: string | null;
  readonly now: Date;
}

export async function settleMandateAllowance(
  tx: AskTx,
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
      ${null}::text,
      ${input.reasonCode ?? null}::text,
      (${input.now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
    ) AS outcome`;
  const outcome = rows[0]?.outcome;
  if (outcome === undefined) {
    throw new Error("mandate_allowance_settle returned no outcome");
  }
  return outcome as SettleOutcome;
}
