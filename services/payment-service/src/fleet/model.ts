/**
 * Fleet remittance settlement (A05) — the closed vocabularies, keys and
 * ledger references of payment-service's side of the fleet vertical.
 *
 * fleet-service owns fleets, assignments and signed terms; payment-service
 * owns the MONEY: it reads each week's settlement inputs through internal
 * contract B (./inputs.ts) and journals the remittance on the canonical
 * ledger (./settlement.ts). The build decisions are
 * docs/design/FLEET_CALENDAR_DECISIONS.md (Q2 pro-rata, Q7 no driver net for
 * fleets, Q8 breakdowns are not pro-rated), which win over the design
 * handoff in docs/launch-readiness/handoff-fleet-calendar/.
 */
import { createHash } from "node:crypto";

import { ContractError, type FlagKey } from "@ubi/contracts";

import type { Actor } from "../ledger/types";

/** The deny-by-default city flag the whole fleet vertical rides on. */
export const FLEET_FLAG: FlagKey = "fleet";

/** Wallet owner type of a fleet's remittance wallet (created on first use). */
export const FLEET_WALLET_OWNER = "fleet" as const;

/** The audited principal of a settlement the sweep runs on its own. */
export const FLEET_SETTLEMENT_ACTOR: Actor = {
  id: "fleet-settlement",
  role: "service",
};

/** The carry-forward memorandum account (src/ledger/accounts.ts). */
export const CARRY_ACCOUNT = "fleet_remittance_carry" as const;

/** Outbox subject of every remittance record: fleet-service's assignment. */
export const REMITTANCE_AGGREGATE = "assignment" as const;

/** Catalog event names (packages/contracts events.ts, "fleet (slice 10)"). */
export const REMITTANCE_EVENTS = {
  applied: "remittance.applied",
  shortfall: "remittance.shortfall",
  carried: "remittance.carried",
} as const;

/** `payload.kind` of every remittance event, so consumers can filter. */
export const REMITTANCE_EVENT_KIND = "fleet_remittance" as const;

// ── Identifiers ────────────────────────────────────────────────────────────

/**
 * Ids that travel inside composite ledger references may not carry the `:`
 * separator (the same rule as src/ledger/mp-amendment-refs.ts), so one
 * fleet's or driver's prefix scan can never pick up another's lines.
 */
const LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isLinkId(value: string): boolean {
  return LINK_ID_PATTERN.test(value);
}

/** A settlement week is named by its Monday, `YYYY-MM-DD` (contract B). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = utcDate(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Calendar arithmetic on a local date; the timezone never enters it. */
export function addDays(isoDate: string, days: number): string {
  const date = utcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isMonday(isoDate: string): boolean {
  return isIsoDate(isoDate) && utcDate(isoDate).getUTCDay() === 1;
}

/** Whole weeks from `from` to `to` (both Mondays); negative when `to` is earlier. */
export function weeksBetween(from: string, to: string): number {
  const days = (utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000;
  return Math.round(days / 7);
}

export function assertWeekStart(weekStart: string): string {
  if (!isMonday(weekStart)) {
    throw new ContractError(
      "validation_failed",
      "a settlement week is named by its Monday, YYYY-MM-DD",
      { weekStart },
    );
  }
  return weekStart;
}

// ── Keys and references ────────────────────────────────────────────────────

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 40);
}

/** The settlement's journal idempotency key: one entry per (assignment, week). */
export function settlementEntryKey(
  assignmentId: string,
  weekStart: string,
): string {
  return `fleet.remittance:${assignmentId}:${weekStart}`;
}

/** The settlement entry's `reference` and its money lines' counterpart. */
export function settlementReference(
  assignmentId: string,
  weekStart: string,
): string {
  return `fleet_remittance:${assignmentId}:${weekStart}`;
}

/** The n-th linked adjustment of a closed week: its journal idempotency key. */
export function adjustmentEntryKey(
  assignmentId: string,
  closedWeek: string,
  sequence: number,
): string {
  return `fleet.remittance.adjust:${assignmentId}:${closedWeek}:${sequence}`;
}

export function adjustmentReference(
  assignmentId: string,
  closedWeek: string,
  sequence: number,
): string {
  return `fleet_remittance_adjustment:${assignmentId}:${closedWeek}:${sequence}`;
}

/**
 * The durable record of a settled (assignment, week) is its outbox event —
 * the convention src/ledger/mp-settlement.ts set (every outcome writes one,
 * even a week that moved no money). The envelope caps idempotency keys at 64
 * characters, so the pair is hashed.
 */
export function settlementEventKey(
  assignmentId: string,
  weekStart: string,
): string {
  return `fleet.remit:${shortHash(`${assignmentId}|${weekStart}`)}`;
}

export function adjustmentEventKey(
  assignmentId: string,
  closedWeek: string,
  sequence: number,
): string {
  return `fleet.radj:${shortHash(`${assignmentId}|${closedWeek}|${sequence}`)}`;
}

/** Every carry line of one fleet + driver pair starts with this. */
export function carryPairPrefix(fleetId: string, driverId: string): string {
  return `fleet_carry:${fleetId}:${driverId}:`;
}

/** The driver's side of the carry for one origin week. */
export function carryOwedRef(
  fleetId: string,
  driverId: string,
  originWeek: string,
): string {
  return `${carryPairPrefix(fleetId, driverId)}owed:${originWeek}`;
}

/** The fleet's (contra) side of the carry for one origin week. */
export function carryFleetRef(
  fleetId: string,
  driverId: string,
  originWeek: string,
): string {
  return `${carryPairPrefix(fleetId, driverId)}fleet:${originWeek}`;
}

/** The origin week of an `owed` carry ref, or null for any other ref. */
export function originOfOwedRef(
  fleetId: string,
  driverId: string,
  ref: string,
): string | null {
  const prefix = `${carryPairPrefix(fleetId, driverId)}owed:`;
  if (!ref.startsWith(prefix)) {
    return null;
  }
  const origin = ref.slice(prefix.length);
  return isIsoDate(origin) ? origin : null;
}

/**
 * The outbox `toVersion` of a remittance event, so the relay (which orders an
 * aggregate's rows by `to_version`) publishes an assignment's records in week
 * order: slot 0 `applied`, 1 `shortfall`, 2 `carried` of week W; a linked
 * adjustment carried to week W' takes the last slot BEFORE W' (it is recorded
 * before W' settles). Weeks are counted from Monday 2000-01-03.
 */
export function remittanceEventVersion(
  weekStart: string,
  slot: 0 | 1 | 2 | 3,
): number {
  const ordinal = weeksBetween("2000-01-03", weekStart);
  return slot === 3 ? ordinal * 4 - 1 : ordinal * 4 + slot;
}

/** Serializes every money decision for one fleet + driver pair. */
export function pairLockKey(fleetId: string, driverId: string): string {
  return `fleet_remittance:${fleetId}:${driverId}`;
}
