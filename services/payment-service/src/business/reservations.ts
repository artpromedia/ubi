/**
 * Business booking reservations against a cost centre's monthly budget
 * (A06 part C) — the internal API ride-service calls at
 * `/v1/finance/business` (./routes.ts), and the booking reads the
 * organization's people get at `/v1/business`.
 *
 * The rules:
 *  - RESERVE is atomic. It takes the budget account's row lock, re-reads the
 *    available amount (journal-derived balance − live reservations) under it,
 *    and inserts the reservation in the same transaction — so concurrent
 *    bookings serialize per budget and can never overspend it. A booking the
 *    budget cannot cover is REFUSED (`insufficient_spendable`); nothing is
 *    deferred, queued or put on credit;
 *  - authority is derived, not asserted: the booker and traveller ride-service
 *    names are checked against ACTIVE memberships read `FOR SHARE` inside the
 *    reservation's transaction, and the policy (per-trip cap, services,
 *    classes, currency) is evaluated there too (./authority.ts);
 *  - exactly once, by booking reference: one reservation per `bookingRef`
 *    ever; a reserve with the same terms under any key answers the original
 *    result, with different terms it is a `conflict`; a key reused with
 *    different terms is `idempotency_key_reuse`. At most one commit and one
 *    release per reservation (unique index), and the commit's journal entry
 *    carries an idempotency key naming the reservation, so it cannot post
 *    twice;
 *  - COMMIT posts ONE entry for the ACTUAL amount (budget wallet →
 *    `business_clearing`), never more than was reserved; the unused remainder
 *    is freed by the same transaction. The taxes INCLUDED in it at the trip
 *    city's configured rates are snapshotted on the row for the statement;
 *  - COMMIT also PAYS THE DRIVER, in the same transaction, out of
 *    `business_clearing`: the FULL committed fare to the awarded driver's
 *    wallet (./payouts.ts). The 10% was captured from that driver at
 *    selection and is never charged again — so the driver nets the fare less
 *    that one commission, and the organization is never charged it. With no
 *    captured award hold yet the commit stands and the payout is pending,
 *    retried by POST /payouts and the sweep;
 *  - a RESERVE TOP-UP (`increaseReservation`) raises an ACTIVE reservation
 *    for an approved fare increase or paid waiting: under the same budget
 *    row lock as a reserve, refused without available budget (no credit),
 *    within the per-trip cap, once per `reasonRef`, audited and evented;
 *  - RELEASE frees the reservation without moving money. Who may cancel is
 *    the payer / passenger split in the contract (`BUSINESS_CANCEL_RIGHTS`):
 *    the traveller (their own trip), the booker (their booking, while still a
 *    booking member), an owner/admin, or the system (no award). ride-service
 *    decides WHEN in the trip a cancel is allowed; this module decides WHO;
 *  - `business_travel` gates NEW reservations only. Commit and release always
 *    work — a kill switch must not strand money mid-trip;
 *  - the organization's budget is the RIDER-side funding of the trip. Nothing
 *    here touches a driver's commission hold or `ubi_commission`: the 10% is
 *    reserved at bid and captured once at selection as for any marketplace
 *    trip.
 */
import {
  ContractError,
  money,
  type Money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import {
  activeRole,
  assertBusinessTravelOn,
  businessTravelOn,
  evaluatePolicy,
  loadOrganization,
  requireOrgRole,
} from "./authority";
import { budgetView, lockBudgetAccount } from "./budgets";
import {
  BUSINESS_SERVICE_ACTOR,
  type CancelParty,
  isCancelParty,
  ORG_ADMIN_ROLES,
  ORG_BOOKER_ROLES,
  refusal,
  type RefusalReason,
  type ReservationState,
  RESERVATION_STATES,
} from "./model";
import {
  activatedTaxRates,
  assertPositiveMinor,
  eventKeyOf,
  isUniqueViolation,
  type OpOutcome,
  periodOf,
  recordOp,
  replayOf,
  scopedKey,
  termsHash,
  writeTrail,
} from "./ops";
import { payOutInTx } from "./payouts";
import { fromDbMinor, toDbMinor } from "../ledger/minor-units";
import { postEntry } from "../ledger/post-entry";
import { generateId } from "../lib/utils";

import type { WalletDeps } from "../ledger/context";
import type { Actor, JsonRecord, LedgerTx } from "../ledger/types";
import type {
  OrgBudgetAccount,
  OrgBudgetReservation,
  Prisma,
} from "@prisma/client/index";

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export type TaxLine = {
  readonly code: string;
  readonly rateBps: number;
  readonly amountMinor: number;
};

export type ReservationView = {
  readonly reservationId: string;
  readonly bookingRef: string;
  readonly organizationId: string;
  readonly costCentreId: string;
  readonly budgetId: string;
  readonly period: string;
  readonly bookerId: string;
  readonly travellerId: string;
  readonly service: string;
  readonly vehicleClass: string;
  readonly expenseCategory: string | null;
  readonly state: ReservationState;
  readonly reserved: MoneyView;
  readonly committed: MoneyView | null;
  readonly taxes: readonly TaxLine[];
  readonly commitEntryId: string | null;
  readonly policyVersion: number;
  readonly releaseReason: string | null;
  readonly releasedBy: CancelParty | null;
  readonly createdAt: string;
  readonly committedAt: string | null;
  readonly releasedAt: string | null;
};

/** What reserve / commit / release answer, and what a replay answers verbatim. */
export type BudgetOpResult = {
  readonly ref: string;
  readonly op: "reserve" | "commit" | "release";
  readonly entryId: string | null;
  readonly amount: MoneyView;
  readonly reservation: ReservationView;
};

type ReservationRow = OrgBudgetReservation & {
  readonly budgetAccount: Pick<OrgBudgetAccount, "period">;
};

function stateOf(row: OrgBudgetReservation): ReservationState {
  if (!(RESERVATION_STATES as readonly string[]).includes(row.state)) {
    // The CHECK constraint makes this unreachable.
    throw new ContractError(
      "internal_error",
      "business reservation is in an unknown state",
      { reservationId: row.id, state: row.state },
    );
  }
  return row.state as ReservationState;
}

/** The tax snapshot on a committed reservation (`[]` when none). */
export function taxLinesOf(value: Prisma.JsonValue | null): TaxLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }
    const line = item as Record<string, unknown>;
    return typeof line.code === "string" &&
      typeof line.rateBps === "number" &&
      typeof line.amountMinor === "number"
      ? [
          {
            code: line.code,
            rateBps: line.rateBps,
            amountMinor: line.amountMinor,
          },
        ]
      : [];
  });
}

export function reservationView(row: ReservationRow): ReservationView {
  const releasedBy =
    row.releasedByRole !== null && isCancelParty(row.releasedByRole)
      ? row.releasedByRole
      : null;
  return {
    reservationId: row.id,
    bookingRef: row.bookingRef,
    organizationId: row.organizationId,
    costCentreId: row.costCentreId,
    budgetId: row.budgetAccountId,
    period: row.budgetAccount.period,
    bookerId: row.bookerId,
    travellerId: row.travellerId,
    service: row.service,
    vehicleClass: row.vehicleClass,
    expenseCategory: row.expenseCategory,
    state: stateOf(row),
    reserved: money(fromDbMinor(row.reservedMinor), row.currency),
    committed:
      row.committedMinor === null
        ? null
        : money(fromDbMinor(row.committedMinor), row.currency),
    taxes: taxLinesOf(row.taxLines),
    commitEntryId: row.commitEntryId,
    policyVersion: row.policyVersion,
    releaseReason: row.releaseReason,
    releasedBy,
    createdAt: row.createdAt.toISOString(),
    committedAt:
      row.committedAt === null ? null : row.committedAt.toISOString(),
    releasedAt: row.releasedAt === null ? null : row.releasedAt.toISOString(),
  };
}

const WITH_PERIOD = { budgetAccount: { select: { period: true } } } as const;

// ── Taxes ─────────────────────────────────────────────────────────────────

/** A configured percentage as basis points; anything but a clean rate is skipped. */
function taxRateBps(percent: number): number | null {
  const bps = Math.round(percent * 100);
  if (bps <= 0 || bps >= 10_000 || Math.abs(bps - percent * 100) > 1e-6) {
    return null;
  }
  return bps;
}

/**
 * The taxes INCLUDED in a total at the configured rates — each tax's share
 * is total × rate / (1 + Σ rates), rounded half-up to the minor unit, exactly
 * as ride-service itemises a rider receipt. Nothing is ever added on top; no
 * configured rate ⇒ no lines.
 */
export function includedTaxes(
  taxes: Readonly<Record<string, number>>,
  totalMinor: number,
): TaxLine[] {
  const rates = Object.keys(taxes)
    .sort()
    .flatMap((code) => {
      const bps = taxRateBps(taxes[code] ?? 0);
      return bps === null ? [] : [{ code, bps }];
    });
  if (rates.length === 0) {
    return [];
  }
  const denominator = BigInt(
    10_000 + rates.reduce((sum, rate) => sum + rate.bps, 0),
  );
  const total = BigInt(totalMinor);
  return rates.map((rate) => ({
    code: rate.code,
    rateBps: rate.bps,
    amountMinor: Number(
      (total * BigInt(rate.bps) * 2n + denominator) / (2n * denominator),
    ),
  }));
}

// ── Inputs ────────────────────────────────────────────────────────────────

export interface BookingTermsInput {
  readonly bookingRef: string;
  readonly organizationId: string;
  readonly costCentreId?: string | undefined;
  readonly bookerId: string;
  readonly travellerId: string;
  readonly service: string;
  readonly vehicleClass: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly expenseCategory?: string | undefined;
  /** The trip's city (X-City-ID): its flag, timezone and tax rates apply. */
  readonly cityId: string;
}

export interface CommitInput {
  readonly bookingRef: string;
  readonly actualMinor: number;
  readonly currency: string;
}

export interface ReleaseInput {
  readonly bookingRef: string;
  readonly cancelledBy: {
    readonly party: CancelParty;
    readonly userId: string | null;
  };
  readonly reason: string;
}

function reserveTerms(input: BookingTermsInput): JsonRecord {
  return {
    op: "reserve",
    bookingRef: input.bookingRef,
    organizationId: input.organizationId,
    costCentreId: input.costCentreId ?? null,
    bookerId: input.bookerId,
    travellerId: input.travellerId,
    service: input.service,
    vehicleClass: input.vehicleClass,
    amountMinor: input.amountMinor,
    currency: input.currency,
    expenseCategory: input.expenseCategory ?? null,
    cityId: input.cityId,
  };
}

// ── Policy check (read-only) ──────────────────────────────────────────────

export type PolicyCheckResult = {
  readonly allowed: boolean;
  readonly reasons: readonly RefusalReason[];
  readonly costCentreId: string | null;
  readonly budgetId: string | null;
  readonly available: MoneyView | null;
  readonly policyVersion: number | null;
};

/**
 * Would this booking be accepted right now? Every reason it would not, in
 * the order a reservation would meet them. Read-only and advisory: ride-
 * service shows it at quote time so an out-of-policy option is offered as
 * unavailable, and the reservation re-decides everything atomically.
 */
export async function checkPolicy(
  deps: WalletDeps,
  input: BookingTermsInput,
): Promise<PolicyCheckResult> {
  const now = deps.now();
  const org = await loadOrganization(deps.db, input.organizationId);
  if (org === null) {
    throw new ContractError("not_found", "no such organization");
  }
  const { city, flags } = await deps.config.load(input.cityId);
  const reasons: RefusalReason[] = [];
  if (!businessTravelOn(flags)) {
    reasons.push("feature_disabled");
  }
  const verdict = await evaluatePolicy(deps.db, org, input, { share: false });
  reasons.push(...verdict.reasons);

  let budgetId: string | null = null;
  let available: Money | null = null;
  if (verdict.costCentre !== null) {
    const account = await deps.db.orgBudgetAccount.findUnique({
      where: {
        costCentreId_period: {
          costCentreId: verdict.costCentre.id,
          period: periodOf(now, city.timezone),
        },
      },
    });
    if (account === null) {
      reasons.push("no_budget_for_period");
    } else {
      const view = await budgetView(deps.db, account);
      budgetId = account.id;
      available = view.available;
      if (view.available.amountMinor < input.amountMinor) {
        reasons.push("budget_insufficient");
      }
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    costCentreId: verdict.costCentre?.id ?? null,
    budgetId,
    available,
    policyVersion: org.policyVersion,
  };
}

// ── Replay helpers ────────────────────────────────────────────────────────

/**
 * The booking-reference half of idempotency: a reservation already exists
 * for this booking. Same terms ⇒ the reserve's recorded result (a replay,
 * whatever key it came with); different terms ⇒ a conflict.
 */
async function replayReserveByRef(
  db: LedgerTx,
  bookingRef: string,
  hash: string,
): Promise<OpOutcome<BudgetOpResult> | null> {
  const row = await db.orgBudgetReservation.findUnique({
    where: { bookingRef },
    include: WITH_PERIOD,
  });
  if (row === null) {
    return null;
  }
  if (row.termsHash !== hash) {
    throw new ContractError(
      "conflict",
      "this booking already has a budget reservation with different terms",
      { bookingRef, reservation: reservationView(row) },
    );
  }
  const op = await db.orgBudgetOp.findUnique({
    where: { reservationId_op: { reservationId: row.id, op: "reserve" } },
  });
  if (op === null) {
    throw new ContractError(
      "internal_error",
      "a business reservation has no reserve record",
      { reservationId: row.id },
    );
  }
  return { result: op.result as unknown as BudgetOpResult, replayed: true };
}

/**
 * The reservation's one commit (or release), if it already happened: the
 * recorded result when the terms match, else a refusal carrying the
 * reservation as it stands.
 */
async function replayTerminalOp(
  db: LedgerTx,
  reservation: ReservationRow,
  op: "commit" | "release",
  hash: string,
): Promise<OpOutcome<BudgetOpResult> | null> {
  const recorded = await db.orgBudgetOp.findUnique({
    where: { reservationId_op: { reservationId: reservation.id, op } },
  });
  if (recorded === null) {
    return null;
  }
  if (recorded.payloadHash !== hash) {
    throw new ContractError(
      op === "commit" ? "conflict" : "illegal_transition",
      op === "commit"
        ? "this booking was already committed with different terms"
        : "this booking's reservation was already released",
      {
        bookingRef: reservation.bookingRef,
        reservation: reservationView(reservation),
      },
    );
  }
  return {
    result: recorded.result as unknown as BudgetOpResult,
    replayed: true,
  };
}

async function requireReservation(
  db: LedgerTx,
  bookingRef: string,
): Promise<ReservationRow> {
  const row = await db.orgBudgetReservation.findUnique({
    where: { bookingRef },
    include: WITH_PERIOD,
  });
  if (row === null) {
    throw new ContractError(
      "not_found",
      "this booking has no business budget reservation",
      { bookingRef },
    );
  }
  return row;
}

/** Locks the reservation row. Always AFTER its budget account's lock. */
async function lockReservation(
  tx: LedgerTx,
  reservationId: string,
): Promise<ReservationRow> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM org_budget_reservations WHERE id = ${reservationId} FOR UPDATE
  `;
  const row = await tx.orgBudgetReservation.findUnique({
    where: { id: reservationId },
    include: WITH_PERIOD,
  });
  if (row === null) {
    throw new ContractError("not_found", "business reservation not found", {
      reservationId,
    });
  }
  return row;
}

function assertReserved(row: ReservationRow): void {
  if (stateOf(row) !== "reserved") {
    throw new ContractError(
      "illegal_transition",
      `this booking's reservation is already ${row.state}`,
      { bookingRef: row.bookingRef, reservation: reservationView(row) },
    );
  }
}

// ── Reserve ───────────────────────────────────────────────────────────────

export async function reserveBudget(
  deps: WalletDeps,
  input: BookingTermsInput,
  clientKey: string,
): Promise<OpOutcome<BudgetOpResult>> {
  const now = deps.now();
  const actor = BUSINESS_SERVICE_ACTOR;
  const key = scopedKey("reserve", actor.id, clientKey);
  const hash = termsHash(reserveTerms(input));

  const prior = await replayOf<BudgetOpResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  const byRef = await replayReserveByRef(deps.db, input.bookingRef, hash);
  if (byRef !== null) {
    return byRef;
  }
  assertPositiveMinor(input.amountMinor, input.currency);
  const { city, flags } = await deps.config.load(input.cityId);
  assertBusinessTravelOn(flags, input.cityId);

  try {
    return await deps.db.$transaction(async (tx) => {
      const org = await loadOrganization(tx, input.organizationId);
      if (org === null) {
        throw new ContractError("not_found", "no such organization");
      }
      const verdict = await evaluatePolicy(tx, org, input, { share: true });
      const [first] = verdict.reasons;
      if (first !== undefined || verdict.costCentre === null) {
        throw refusal(first ?? "cost_centre_invalid", {
          reasons: verdict.reasons,
        });
      }

      const period = periodOf(now, city.timezone);
      const account = await tx.orgBudgetAccount.findUnique({
        where: {
          costCentreId_period: { costCentreId: verdict.costCentre.id, period },
        },
      });
      if (account === null) {
        throw refusal("no_budget_for_period", {
          costCentreId: verdict.costCentre.id,
          period,
        });
      }
      const locked = await lockBudgetAccount(tx, account.id);

      // Under the lock: a rival with this key or this booking may have won.
      const raced = await replayOf<BudgetOpResult>(tx, key, hash);
      if (raced !== null) {
        return raced;
      }
      const rival = await replayReserveByRef(tx, input.bookingRef, hash);
      if (rival !== null) {
        return rival;
      }

      const budget = await budgetView(tx, locked);
      if (budget.available.amountMinor < input.amountMinor) {
        throw refusal("budget_insufficient", {
          budgetId: locked.id,
          availableMinor: budget.available.amountMinor,
          requiredMinor: input.amountMinor,
        });
      }

      const created = await tx.orgBudgetReservation.create({
        data: {
          id: generateId("obr"),
          bookingRef: input.bookingRef,
          budgetAccountId: locked.id,
          organizationId: org.id,
          costCentreId: verdict.costCentre.id,
          walletId: locked.walletId,
          bookerId: input.bookerId,
          travellerId: input.travellerId,
          service: input.service,
          vehicleClass: input.vehicleClass,
          expenseCategory: input.expenseCategory ?? null,
          cityId: input.cityId,
          currency: org.currency,
          reservedMinor: toDbMinor(input.amountMinor),
          state: "reserved",
          termsHash: hash,
          policyVersion: org.policyVersion,
        },
        include: WITH_PERIOD,
      });

      const ref = generateId("obo");
      const amount = money(input.amountMinor, org.currency);
      const result: BudgetOpResult = {
        ref,
        op: "reserve",
        entryId: null,
        amount,
        reservation: reservationView(created),
      };
      await recordOp(tx, {
        ref,
        op: "reserve",
        key,
        clientKey,
        hash,
        organizationId: org.id,
        budgetAccountId: locked.id,
        reservationId: created.id,
        amount,
        entryId: null,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op: "reserve",
        actor,
        actorType: "system",
        action: "business.booking.reserved",
        subjectType: "org_budget_reservation",
        subjectId: created.id,
        before: null,
        after: {
          state: "reserved",
          bookingRef: created.bookingRef,
          organizationId: org.id,
          budgetId: locked.id,
          costCentreId: created.costCentreId,
          bookerId: created.bookerId,
          travellerId: created.travellerId,
          reservedMinor: input.amountMinor,
          currency: org.currency,
          policyVersion: org.policyVersion,
          availableBeforeMinor: budget.available.amountMinor,
        },
        aggregateType: "booking",
        aggregateId: created.id,
        fromVersion: null,
        toVersion: created.version,
        cityId: input.cityId,
        eventKey: eventKeyOf("reserve", created.id),
        occurredAt: now,
        payload: {
          organizationId: org.id,
          reservationId: created.id,
          bookingRef: created.bookingRef,
          budgetId: locked.id,
          costCentreId: created.costCentreId,
          bookerId: created.bookerId,
          travellerId: created.travellerId,
          state: "reserved",
          amountMinor: input.amountMinor,
          currency: org.currency,
        },
      });
      return { result, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner =
        (await replayOf<BudgetOpResult>(deps.db, key, hash)) ??
        (await replayReserveByRef(deps.db, input.bookingRef, hash));
      if (winner !== null) {
        return winner;
      }
    }
    throw error;
  }
}

// ── Commit ────────────────────────────────────────────────────────────────

export async function commitBudget(
  deps: WalletDeps,
  input: CommitInput,
  clientKey: string,
): Promise<OpOutcome<BudgetOpResult>> {
  const now = deps.now();
  const actor = BUSINESS_SERVICE_ACTOR;
  const key = scopedKey("commit", actor.id, clientKey);
  const hash = termsHash({
    op: "commit",
    bookingRef: input.bookingRef,
    actualMinor: input.actualMinor,
    currency: input.currency,
  });

  const prior = await replayOf<BudgetOpResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  const reservation = await requireReservation(deps.db, input.bookingRef);
  const done = await replayTerminalOp(deps.db, reservation, "commit", hash);
  if (done !== null) {
    return done;
  }
  assertPositiveMinor(input.actualMinor, input.currency);
  // The trip city's configured tax rates, for the included-tax snapshot —
  // read without the live-city gate, so a paused city still settles.
  const taxRates = await activatedTaxRates(deps.db, reservation.cityId);

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockBudgetAccount(tx, reservation.budgetAccountId);
      const row = await lockReservation(tx, reservation.id);
      const raced =
        (await replayOf<BudgetOpResult>(tx, key, hash)) ??
        (await replayTerminalOp(tx, row, "commit", hash));
      if (raced !== null) {
        return raced;
      }
      assertReserved(row);
      if (input.currency !== row.currency) {
        throw refusal("currency_mismatch", {
          reservationCurrency: row.currency,
          requestCurrency: input.currency,
        });
      }
      const reservedMinor = fromDbMinor(row.reservedMinor);
      if (input.actualMinor > reservedMinor) {
        throw new ContractError(
          "conflict",
          "a commit cannot exceed the reservation — the budget was never asked for more",
          {
            bookingRef: row.bookingRef,
            reservedMinor,
            actualMinor: input.actualMinor,
          },
        );
      }

      const taxes = includedTaxes(taxRates, input.actualMinor);
      const bookingRef = `business_booking:${row.bookingRef}`;
      const entry = await postEntry(tx, {
        kind: "business_trip_commit",
        reference: bookingRef,
        occurredAt: now,
        // Names the reservation: the database refuses a second commit entry.
        idempotencyKey: `business.commit:${row.id}`,
        description: "business trip committed",
        lines: [
          {
            account: "wallet",
            walletId: row.walletId,
            amount: money(-input.actualMinor, row.currency),
            counterpartRef: bookingRef,
          },
          {
            account: "business_clearing",
            amount: money(input.actualMinor, row.currency),
            counterpartRef: bookingRef,
          },
        ],
      });
      const updated = await tx.orgBudgetReservation.update({
        where: { id: row.id },
        data: {
          state: "committed",
          committedMinor: toDbMinor(input.actualMinor),
          commitEntryId: entry.id,
          taxLines: taxes,
          committedAt: now,
          version: { increment: 1 },
        },
        include: WITH_PERIOD,
      });

      const ref = generateId("obo");
      const amount = money(input.actualMinor, row.currency);
      const result: BudgetOpResult = {
        ref,
        op: "commit",
        entryId: entry.id,
        amount,
        reservation: reservationView(updated),
      };
      await recordOp(tx, {
        ref,
        op: "commit",
        key,
        clientKey,
        hash,
        organizationId: row.organizationId,
        budgetAccountId: row.budgetAccountId,
        reservationId: row.id,
        amount,
        entryId: entry.id,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op: "commit",
        actor,
        actorType: "system",
        action: "business.booking.committed",
        subjectType: "org_budget_reservation",
        subjectId: row.id,
        before: { state: row.state, reservedMinor },
        after: {
          state: "committed",
          committedMinor: input.actualMinor,
          freedMinor: reservedMinor - input.actualMinor,
          entryId: entry.id,
          taxMinor: taxes.reduce((sum, line) => sum + line.amountMinor, 0),
        },
        aggregateType: "booking",
        aggregateId: row.id,
        fromVersion: row.version,
        toVersion: updated.version,
        cityId: row.cityId,
        eventKey: eventKeyOf("commit", row.id),
        occurredAt: now,
        payload: {
          organizationId: row.organizationId,
          reservationId: row.id,
          bookingRef: row.bookingRef,
          budgetId: row.budgetAccountId,
          state: "committed",
          amountMinor: input.actualMinor,
          currency: row.currency,
          entryId: entry.id,
        },
      });
      // The driver's side, from business_clearing, in this same transaction
      // (./payouts.ts). Never a commission line; pending when the award's
      // captured hold is not there yet.
      await payOutInTx(tx, updated, now);
      return { result, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await replayOf<BudgetOpResult>(deps.db, key, hash);
      if (winner !== null) {
        return winner;
      }
      const fresh = await requireReservation(deps.db, input.bookingRef);
      const recorded = await replayTerminalOp(deps.db, fresh, "commit", hash);
      if (recorded !== null) {
        return recorded;
      }
    }
    throw error;
  }
}

// ── Reserve top-up ────────────────────────────────────────────────────────

/**
 * Why an ACTIVE reservation may grow: an amendment that raised the fare and
 * that both parties approved, or paid waiting time — each named by the id
 * ride-service holds for it (`reasonRef`), so one approval can raise the
 * reservation once, whatever the retries.
 */
export const RESERVE_INCREASE_REASONS = [
  "fare_increase",
  "paid_waiting",
] as const;
export type ReserveIncreaseReason = (typeof RESERVE_INCREASE_REASONS)[number];

export interface IncreaseInput {
  readonly bookingRef: string;
  /** The INCREASE, not the new total — a positive integer in minor units. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: ReserveIncreaseReason;
  readonly reasonRef: string;
}

/** The op result, plus what the reservation was and is now. */
export type IncreaseResult = BudgetOpResult & {
  readonly increase: {
    readonly reason: ReserveIncreaseReason;
    readonly reasonRef: string;
    readonly previousReserved: MoneyView;
    readonly reserved: MoneyView;
  };
};

function increaseTermsHash(input: IncreaseInput): string {
  return termsHash({
    op: "reserve_increase",
    bookingRef: input.bookingRef,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason: input.reason,
    reasonRef: input.reasonRef,
  });
}

/**
 * The top-up ops of one reservation. Each is an `org_budget_ops` row with
 * op `reserve` and NO reservation column (that column's unique index holds
 * the reservation's ONE original reserve), found through the reservation id
 * its recorded result names.
 */
function increaseOpsWhere(reservation: {
  readonly id: string;
  readonly budgetAccountId: string;
}): Prisma.OrgBudgetOpWhereInput {
  return {
    op: "reserve",
    reservationId: null,
    budgetAccountId: reservation.budgetAccountId,
    result: { path: ["reservation", "reservationId"], equals: reservation.id },
  };
}

/**
 * The reasonRef half of idempotency: this approval already raised the
 * reservation. Same terms ⇒ the recorded result; other terms ⇒ a conflict.
 */
async function replayIncreaseByRef(
  db: LedgerTx,
  reservation: { readonly id: string; readonly budgetAccountId: string },
  reasonRef: string,
  hash: string,
): Promise<OpOutcome<IncreaseResult> | null> {
  const op = await db.orgBudgetOp.findFirst({
    where: {
      AND: [
        increaseOpsWhere(reservation),
        { result: { path: ["increase", "reasonRef"], equals: reasonRef } },
      ],
    },
  });
  if (op === null) {
    return null;
  }
  if (op.payloadHash !== hash) {
    throw new ContractError(
      "conflict",
      "this approval already raised the reservation with different terms",
      { reasonRef, ref: op.id },
    );
  }
  return { result: op.result as unknown as IncreaseResult, replayed: true };
}

/**
 * RESERVE TOP-UP — raises an ACTIVE (`reserved`) business reservation by an
 * approved amount, so ride-service can commit a trip whose total grew (an
 * approved fare increase, paid waiting) without ever committing more than
 * the organization reserved. The rules are the reserve's:
 *  - atomic against the budget: the budget account's row lock, then the
 *    reservation's; the available amount is re-read under it, so concurrent
 *    reserves and top-ups serialize per budget and can never overspend it;
 *  - REFUSED (`insufficient_spendable`, reason `budget_insufficient`) when
 *    the budget cannot cover it — nothing is deferred or put on credit;
 *  - the organization must still be active, the new total within its
 *    per-trip cap and in its currency;
 *  - exactly once per Idempotency-Key AND per `reasonRef`;
 *  - `business_travel` gates it like a new reservation (it is new spend);
 *  - audited and evented (`transfer.held`, `payload.op = "reserve"`,
 *    `payload.increase = true`).
 * No journal movement: like the reservation itself, the top-up only lowers
 * what the budget has available until commit or release.
 */
export async function increaseReservation(
  deps: WalletDeps,
  input: IncreaseInput,
  clientKey: string,
): Promise<OpOutcome<IncreaseResult>> {
  const now = deps.now();
  const actor = BUSINESS_SERVICE_ACTOR;
  const key = scopedIdempotencyKey(
    "business.reserve_increase",
    actor.id,
    clientKey,
  );
  const hash = increaseTermsHash(input);

  const prior = await replayOf<IncreaseResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  const reservation = await requireReservation(deps.db, input.bookingRef);
  const byRef = await replayIncreaseByRef(
    deps.db,
    reservation,
    input.reasonRef,
    hash,
  );
  if (byRef !== null) {
    return byRef;
  }
  assertPositiveMinor(input.amountMinor, input.currency);
  const { flags } = await deps.config.load(reservation.cityId);
  assertBusinessTravelOn(flags, reservation.cityId);

  try {
    return await deps.db.$transaction(async (tx) => {
      const locked = await lockBudgetAccount(tx, reservation.budgetAccountId);
      const row = await lockReservation(tx, reservation.id);
      const raced =
        (await replayOf<IncreaseResult>(tx, key, hash)) ??
        (await replayIncreaseByRef(tx, row, input.reasonRef, hash));
      if (raced !== null) {
        return raced;
      }
      assertReserved(row);
      if (input.currency !== row.currency) {
        throw refusal("currency_mismatch", {
          reservationCurrency: row.currency,
          requestCurrency: input.currency,
        });
      }
      const org = await loadOrganization(tx, row.organizationId);
      if (org === null) {
        throw new ContractError("not_found", "no such organization");
      }
      if (org.status !== "active") {
        throw refusal("organization_not_active");
      }
      const previousMinor = fromDbMinor(row.reservedMinor);
      const nextMinor = previousMinor + input.amountMinor;
      if (nextMinor > org.tripCapMinor) {
        throw refusal("trip_cap_exceeded", {
          tripCapMinor: org.tripCapMinor,
          requestedTotalMinor: nextMinor,
        });
      }
      const budget = await budgetView(tx, locked);
      if (budget.available.amountMinor < input.amountMinor) {
        throw refusal("budget_insufficient", {
          budgetId: locked.id,
          availableMinor: budget.available.amountMinor,
          requiredMinor: input.amountMinor,
        });
      }

      const updated = await tx.orgBudgetReservation.update({
        where: { id: row.id },
        data: {
          reservedMinor: toDbMinor(nextMinor),
          version: { increment: 1 },
        },
        include: WITH_PERIOD,
      });

      const ref = generateId("obo");
      const amount = money(input.amountMinor, row.currency);
      const result: IncreaseResult = {
        ref,
        op: "reserve",
        entryId: null,
        amount,
        reservation: reservationView(updated),
        increase: {
          reason: input.reason,
          reasonRef: input.reasonRef,
          previousReserved: money(previousMinor, row.currency),
          reserved: money(nextMinor, row.currency),
        },
      };
      await recordOp(tx, {
        ref,
        op: "reserve",
        key,
        clientKey,
        hash,
        organizationId: row.organizationId,
        budgetAccountId: locked.id,
        // Deliberately null: see `increaseOpsWhere`.
        reservationId: null,
        amount,
        entryId: null,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op: "reserve",
        actor,
        actorType: "system",
        action: "business.booking.reserve_increased",
        subjectType: "org_budget_reservation",
        subjectId: row.id,
        before: { state: row.state, reservedMinor: previousMinor },
        after: {
          state: "reserved",
          reservedMinor: nextMinor,
          increaseMinor: input.amountMinor,
          reason: input.reason,
          reasonRef: input.reasonRef,
          budgetId: locked.id,
          availableBeforeMinor: budget.available.amountMinor,
        },
        aggregateType: "booking",
        aggregateId: row.id,
        fromVersion: row.version,
        toVersion: updated.version,
        cityId: row.cityId,
        eventKey: eventKeyOf("reserve", ref),
        occurredAt: now,
        payload: {
          organizationId: row.organizationId,
          reservationId: row.id,
          bookingRef: row.bookingRef,
          budgetId: locked.id,
          state: "reserved",
          increase: true,
          reason: input.reason,
          amountMinor: input.amountMinor,
          reservedMinor: nextMinor,
          currency: row.currency,
        },
      });
      return { result, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner =
        (await replayOf<IncreaseResult>(deps.db, key, hash)) ??
        (await replayIncreaseByRef(
          deps.db,
          reservation,
          input.reasonRef,
          hash,
        ));
      if (winner !== null) {
        return winner;
      }
    }
    throw error;
  }
}

// ── Release ───────────────────────────────────────────────────────────────

/**
 * The IDENTITY half of the cancel rights (`BUSINESS_CANCEL_RIGHTS`): the
 * named party must really be that party for this booking, right now.
 */
async function assertMayCancel(
  tx: LedgerTx,
  row: ReservationRow,
  cancelledBy: ReleaseInput["cancelledBy"],
): Promise<void> {
  const { party, userId } = cancelledBy;
  if (party === "system") {
    if (userId !== null) {
      throw new ContractError(
        "validation_failed",
        "a system release names no user",
      );
    }
    return;
  }
  if (userId === null) {
    throw new ContractError(
      "validation_failed",
      "a traveller, booker or admin release must name the user",
    );
  }
  let allowed = false;
  if (party === "traveller") {
    // The passenger can always cancel their own trip — even after leaving the
    // organization.
    allowed = userId === row.travellerId;
  } else if (party === "booker") {
    const membership = await activeRole(tx, row.organizationId, userId);
    allowed =
      userId === row.bookerId &&
      membership !== null &&
      (ORG_BOOKER_ROLES.includes(membership.role) ||
        userId === row.travellerId);
  } else {
    const membership = await activeRole(tx, row.organizationId, userId);
    allowed = membership !== null && ORG_ADMIN_ROLES.includes(membership.role);
  }
  if (!allowed) {
    throw new ContractError(
      "forbidden",
      "that party may not cancel this business booking",
      { reason: "cancel_not_permitted", party },
    );
  }
}

export async function releaseBudget(
  deps: WalletDeps,
  input: ReleaseInput,
  clientKey: string,
): Promise<OpOutcome<BudgetOpResult>> {
  const now = deps.now();
  const actor = BUSINESS_SERVICE_ACTOR;
  const key = scopedKey("release", actor.id, clientKey);
  const hash = termsHash({
    op: "release",
    bookingRef: input.bookingRef,
    party: input.cancelledBy.party,
    userId: input.cancelledBy.userId,
  });

  const prior = await replayOf<BudgetOpResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  const reservation = await requireReservation(deps.db, input.bookingRef);
  const done = await replayTerminalOp(deps.db, reservation, "release", hash);
  if (done !== null) {
    return done;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockBudgetAccount(tx, reservation.budgetAccountId);
      const row = await lockReservation(tx, reservation.id);
      const raced =
        (await replayOf<BudgetOpResult>(tx, key, hash)) ??
        (await replayTerminalOp(tx, row, "release", hash));
      if (raced !== null) {
        return raced;
      }
      assertReserved(row);
      await assertMayCancel(tx, row, input.cancelledBy);

      const updated = await tx.orgBudgetReservation.update({
        where: { id: row.id },
        data: {
          state: "released",
          releaseReason: input.reason,
          releasedByRole: input.cancelledBy.party,
          releasedById: input.cancelledBy.userId,
          releasedAt: now,
          version: { increment: 1 },
        },
        include: WITH_PERIOD,
      });

      const ref = generateId("obo");
      const amount = money(fromDbMinor(row.reservedMinor), row.currency);
      const result: BudgetOpResult = {
        ref,
        op: "release",
        entryId: null,
        amount,
        reservation: reservationView(updated),
      };
      await recordOp(tx, {
        ref,
        op: "release",
        key,
        clientKey,
        hash,
        organizationId: row.organizationId,
        budgetAccountId: row.budgetAccountId,
        reservationId: row.id,
        amount,
        entryId: null,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op: "release",
        actor,
        actorType: "system",
        action: "business.booking.released",
        subjectType: "org_budget_reservation",
        subjectId: row.id,
        before: { state: row.state },
        after: {
          state: "released",
          releasedMinor: amount.amountMinor,
          party: input.cancelledBy.party,
          userId: input.cancelledBy.userId,
        },
        reason: input.reason,
        aggregateType: "booking",
        aggregateId: row.id,
        fromVersion: row.version,
        toVersion: updated.version,
        cityId: row.cityId,
        eventKey: eventKeyOf("release", row.id),
        occurredAt: now,
        payload: {
          organizationId: row.organizationId,
          reservationId: row.id,
          bookingRef: row.bookingRef,
          budgetId: row.budgetAccountId,
          state: "released",
          party: input.cancelledBy.party,
          amountMinor: amount.amountMinor,
          currency: row.currency,
        },
      });
      return { result, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await replayOf<BudgetOpResult>(deps.db, key, hash);
      if (winner !== null) {
        return winner;
      }
      const fresh = await requireReservation(deps.db, input.bookingRef);
      const recorded = await replayTerminalOp(deps.db, fresh, "release", hash);
      if (recorded !== null) {
        return recorded;
      }
    }
    throw error;
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────

export type ReservationStatusView = {
  readonly reservation: ReservationView;
  readonly ops: ReadonlyArray<{
    readonly ref: string;
    readonly op: string;
    readonly clientKey: string;
    readonly amount: MoneyView;
    readonly entryId: string | null;
    readonly createdAt: string;
  }>;
  /**
   * The paying organization's billing identity and the booking's cost
   * centre, as ride-service's BUSINESS RECEIPT names them (cost centre,
   * organization tax id). Internal read only (service key): the gateway
   * never proxies /v1/finance, and the receipt shows them to the booking's
   * own booker/traveller — never to the driver.
   */
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly legalName: string | null;
    readonly taxId: string | null;
  } | null;
  readonly costCentre: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  } | null;
};

/**
 * For a caller whose request timed out and does not know what happened —
 * and for ride-service's business receipt (the billing block).
 */
export async function reservationStatus(
  deps: WalletDeps,
  bookingRef: string,
): Promise<ReservationStatusView> {
  const row = await requireReservation(deps.db, bookingRef);
  // Its reserve, commit and release — and every reserve top-up.
  const ops = await deps.db.orgBudgetOp.findMany({
    where: { OR: [{ reservationId: row.id }, increaseOpsWhere(row)] },
    orderBy: { createdAt: "asc" },
  });
  const org = await loadOrganization(deps.db, row.organizationId);
  const centre = await deps.db.organizationCostCentre.findUnique({
    where: { id: row.costCentreId },
  });
  return {
    reservation: reservationView(row),
    organization:
      org === null
        ? null
        : {
            id: org.id,
            name: org.name,
            legalName: org.legalName,
            taxId: org.taxId,
          },
    costCentre:
      centre === null
        ? null
        : { id: centre.id, code: centre.code, name: centre.name },
    ops: ops.map((op) => ({
      ref: op.id,
      op: op.op,
      clientKey: op.clientKey,
      amount: money(fromDbMinor(op.amountMinor), op.currency),
      entryId: op.entryId,
      createdAt: op.createdAt.toISOString(),
    })),
  };
}

const LIST_LIMIT = 500;

/**
 * The organization's BUSINESS bookings — owners and admins see all of them,
 * a booker the ones they made, a traveller none (they use `/bookings/mine`).
 * Only rows funded by this organization's budgets exist here: a member's
 * personal trips are never part of this model, so they cannot leak into it.
 */
export async function listOrganizationBookings(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  period: string | undefined,
): Promise<readonly ReservationView[]> {
  const { role } = await requireOrgRole(
    deps.db,
    orgId,
    actor.id,
    ORG_BOOKER_ROLES,
  );
  const rows = await deps.db.orgBudgetReservation.findMany({
    where: {
      organizationId: orgId,
      ...(ORG_ADMIN_ROLES.includes(role) ? {} : { bookerId: actor.id }),
      ...(period === undefined ? {} : { budgetAccount: { period } }),
    },
    include: WITH_PERIOD,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return rows.map(reservationView);
}

/** The caller's own business bookings, as the passenger, in any organization. */
export async function listMyBusinessBookings(
  deps: WalletDeps,
  actor: Actor,
): Promise<readonly ReservationView[]> {
  const rows = await deps.db.orgBudgetReservation.findMany({
    where: { travellerId: actor.id },
    include: WITH_PERIOD,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return rows.map(reservationView);
}
