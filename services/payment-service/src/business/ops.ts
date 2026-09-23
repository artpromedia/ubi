/**
 * The idempotency record, audit row and outbox event every business-budget
 * POST writes — inside the caller's transaction, so none of them can exist
 * without the state change or vice versa (CLAUDE.md #2, #3).
 *
 * `org_budget_ops.idempotency_key` is unique: a replay answers the recorded
 * `result` verbatim, and a replay carrying different money terms
 * (`payload_hash`) is `idempotency_key_reuse` (409). `(reservation_id, op)`
 * is unique too, so a reservation carries at most one reserve, one commit and
 * one release — exactly-once is the database's guarantee, not only the
 * code's.
 */
import {
  CityConfigSchema,
  ContractError,
  money,
  scopedIdempotencyKey,
  type Money,
} from "@ubi/contracts";

import { type BudgetOp, OP_EVENT } from "./model";
import { publishEvent, writeAudit } from "../ledger/audit";
import { dateInZone, rangeWindow, type DayWindow } from "../ledger/day-window";
import { toDbMinor } from "../ledger/minor-units";
import { payloadHashOf } from "../ledger/mp-holds";

import type { Actor, JsonRecord, JsonValue, LedgerTx } from "../ledger/types";

export interface OpOutcome<T> {
  readonly result: T;
  readonly replayed: boolean;
}

export function scopedKey(
  op: BudgetOp,
  actorId: string,
  clientKey: string,
): string {
  return scopedIdempotencyKey(`business.${op}`, actorId, clientKey);
}

export function termsHash(terms: JsonValue): string {
  return payloadHashOf(terms);
}

/**
 * A replay of an op this key already recorded: the original result verbatim,
 * or a refusal when the key now carries different money terms.
 */
export async function replayOf<T>(
  db: LedgerTx,
  key: string,
  hash: string,
): Promise<OpOutcome<T> | null> {
  const op = await db.orgBudgetOp.findUnique({
    where: { idempotencyKey: key },
  });
  if (op === null) {
    return null;
  }
  if (op.payloadHash !== hash) {
    throw new ContractError(
      "idempotency_key_reuse",
      "this idempotency key was already used with different terms",
      { ref: op.id, op: op.op },
    );
  }
  return { result: op.result as T, replayed: true };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export interface RecordOpArgs {
  readonly ref: string;
  readonly op: BudgetOp;
  readonly key: string;
  readonly clientKey: string;
  readonly hash: string;
  readonly organizationId: string;
  readonly budgetAccountId: string | null;
  readonly reservationId: string | null;
  readonly amount: Money;
  readonly entryId: string | null;
  readonly actor: Actor;
  readonly result: JsonRecord;
}

export async function recordOp(
  tx: LedgerTx,
  args: RecordOpArgs,
): Promise<void> {
  await tx.orgBudgetOp.create({
    data: {
      id: args.ref,
      op: args.op,
      organizationId: args.organizationId,
      budgetAccountId: args.budgetAccountId,
      reservationId: args.reservationId,
      idempotencyKey: args.key,
      clientKey: args.clientKey,
      payloadHash: args.hash,
      amountMinor: toDbMinor(args.amount.amountMinor),
      currency: args.amount.currency,
      entryId: args.entryId,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      result: { ...args.result },
    },
  });
}

export interface TrailArgs {
  readonly op: BudgetOp;
  readonly actor: Actor;
  readonly actorType: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly before: JsonRecord | null;
  readonly after: JsonRecord;
  readonly reason?: string | null;
  /** `booking` (a reservation) or `wallet` (funding / a budget). */
  readonly aggregateType: "booking" | "wallet";
  readonly aggregateId: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly cityId: string | null;
  readonly eventKey: string;
  readonly occurredAt: Date;
  /** Ids and amounts only — never PII (CLAUDE.md #12). */
  readonly payload: JsonRecord;
}

/**
 * The audit row and the outbox event. The catalog has no dedicated
 * business-budget names yet, so each op publishes under the generic payment
 * name for the same kind of movement (`OP_EVENT`), disambiguated by
 * `payload.kind = "business_budget"` and `payload.op` — the convention travel
 * payments and marketplace settlement use.
 */
export async function writeTrail(tx: LedgerTx, args: TrailArgs): Promise<void> {
  await writeAudit(tx, {
    actor: args.actor,
    action: args.action,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    before: args.before,
    after: args.after,
    reason: args.reason ?? null,
  });
  await publishEvent(tx, {
    name: OP_EVENT[args.op],
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    fromVersion: args.fromVersion,
    toVersion: args.toVersion,
    actor: args.actor,
    actorType: args.actorType,
    cityId: args.cityId,
    idempotencyKey: args.eventKey,
    occurredAt: args.occurredAt,
    payload: { kind: "business_budget", op: args.op, ...args.payload },
  });
}

/** The event's idempotency key, kept inside the envelope's 64 characters. */
export function eventKeyOf(op: BudgetOp, ref: string): string {
  return `business.${op}:${ref}`.slice(0, 64);
}

// ── Periods ───────────────────────────────────────────────────────────────

/** Mirrors `BUSINESS_PERIOD_PATTERN`. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertPeriod(period: string): string {
  if (!PERIOD_PATTERN.test(period)) {
    throw new ContractError(
      "validation_failed",
      "a budget period is a calendar month, YYYY-MM",
      { period },
    );
  }
  return period;
}

/** The city-local calendar month `instant` falls in. */
export function periodOf(instant: Date, timeZone: string): string {
  return dateInZone(instant, timeZone).slice(0, 7);
}

/** `[start, end)` of the whole city-local month. */
export function periodWindow(period: string, timeZone: string): DayWindow {
  assertPeriod(period);
  const year = Number.parseInt(period.slice(0, 4), 10);
  const month = Number.parseInt(period.slice(5, 7), 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return rangeWindow(
    `${period}-01`,
    `${period}-${String(lastDay).padStart(2, "0")}`,
    timeZone,
  );
}

/**
 * The city's timezone straight from `cities` — NOT through the live-city
 * config provider, which refuses a paused city. Settling and reporting money
 * that was committed while the city was live must keep working after it is
 * paused (a kill switch stops new commitments; it never strands money).
 */
export async function cityTimezone(
  db: LedgerTx,
  cityId: string,
): Promise<string> {
  const city = await db.city.findUnique({
    where: { id: cityId },
    select: { timezone: true },
  });
  if (city === null) {
    throw new ContractError("city_unsupported", "unknown city", { cityId });
  }
  return city.timezone;
}

/**
 * The tax rates of the city's latest ACTIVATED config version, for the
 * included-tax snapshot at commit — read directly for the same reason as
 * `cityTimezone`. No valid version at all is a config outage
 * (`config_unavailable`, retryable), never a silent "no VAT".
 */
export async function activatedTaxRates(
  db: LedgerTx,
  cityId: string,
): Promise<Readonly<Record<string, number>>> {
  const version = await db.cityConfigVersion.findFirst({
    where: { cityId, activatedAt: { not: null } },
    orderBy: [{ activatedAt: "desc" }, { version: "desc" }],
  });
  const parsed =
    version === null ? null : CityConfigSchema.safeParse(version.config);
  if (parsed === null || !parsed.success) {
    throw new ContractError(
      "config_unavailable",
      "the city's tax configuration is unavailable; retry the commit",
      { cityId },
    );
  }
  return parsed.data.taxes;
}

export function assertPositiveMinor(
  amountMinor: number,
  currency: string,
): void {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new ContractError(
      "validation_failed",
      "an amount is a positive integer in minor units with an explicit ISO currency",
      { amountMinor, currency },
    );
  }
}

export function zeroOf(currency: string): Money {
  return money(0, currency);
}
