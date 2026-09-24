/**
 * Prefunded organization money and cost-centre budgets on the canonical
 * ledger (A06 part C).
 *
 * THE MONEY MODEL — no stored balance, no credit:
 *  - the ORGANIZATION WALLET (owner_type `organization`) is topped up through
 *    the wallet top-up rail — the same TopupProvider, the same `topup` entry
 *    (psp_settlement → wallet) and the same `topups` record a personal top-up
 *    writes, so finance recon matches it against the PSP like any other
 *    capture. The rail captures first and the journal commits second; a
 *    capture whose entry cannot commit is refunded at the rail;
 *  - a BUDGET ACCOUNT is one cost centre's budget for one city-local month,
 *    and it IS a ledger wallet (owner_type `org_budget`). An admin ALLOCATES
 *    into it from the organization wallet with a journal entry, and RETURNS
 *    unspent money the same way. Both lock the organization wallet first and
 *    the budget account second — the order every path here uses;
 *  - a budget's AVAILABLE amount is its journal-derived balance minus the
 *    booking reservations still `reserved` against it (./reservations.ts).
 *    Nothing can take a budget below zero: allocation needs the organization
 *    wallet's spendable, a return needs the budget's available, and a
 *    reservation needs available under the account's row lock.
 *
 * `business_travel` (per city) gates NEW money commitments — top-ups and
 * allocations. Returning unspent money is never blocked: a kill switch stops
 * new commitments, it must not strand an organization's funds.
 */
import { createHash } from "node:crypto";

import { ContractError, money, type Money } from "@ubi/contracts";

import {
  assertBusinessTravelOn,
  loadOrganization,
  type OrgRecord,
  requireOrgRole,
} from "./authority";
import {
  BUDGET_WALLET_OWNER,
  BUSINESS_WALLET_TIER,
  ORG_ADMIN_ROLES,
  ORG_BOOKER_ROLES,
  ORG_WALLET_OWNER,
  refusal,
} from "./model";
import {
  assertPeriod,
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
import { balanceOf, spendableOf } from "../ledger/balances";
import { lockWallet, type WalletDeps } from "../ledger/context";
import { isIdempotencyRace } from "../ledger/idempotency";
import { fromNullableDbMinor } from "../ledger/minor-units";
import { postEntry } from "../ledger/post-entry";
import { requireRail } from "../ledger/providers";
import { walletLogger } from "../lib/logger";
import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "../ledger/types";
import type { WalletRecord } from "../ledger/wallets";
import type { OrgBudgetAccount } from "@prisma/client/index";

// ── Wallets and accounts ──────────────────────────────────────────────────

export async function findOrgWallet(
  tx: LedgerTx,
  org: OrgRecord,
): Promise<WalletRecord | null> {
  const result = await tx.wallet.findUnique({
    where: {
      ownerType_ownerId_currency: {
        ownerType: ORG_WALLET_OWNER,
        ownerId: org.id,
        currency: org.currency,
      },
    },
  });
  return result;
}

/** The organization's funding wallet, created on first use (idempotent). */
export async function ensureOrgWallet(
  tx: LedgerTx,
  org: OrgRecord,
): Promise<WalletRecord> {
  const result = await tx.wallet.upsert({
    where: {
      ownerType_ownerId_currency: {
        ownerType: ORG_WALLET_OWNER,
        ownerId: org.id,
        currency: org.currency,
      },
    },
    create: {
      id: generateId("wal"),
      ownerType: ORG_WALLET_OWNER,
      ownerId: org.id,
      currency: org.currency,
      tier: BUSINESS_WALLET_TIER,
    },
    update: {},
  });
  return result;
}

/** Deterministic, so two first allocations to the same budget meet on one row. */
export function budgetAccountIdOf(
  costCentreId: string,
  period: string,
): string {
  const digest = createHash("sha256")
    .update(`${costCentreId}|${period}`)
    .digest("base64url")
    .slice(0, 24);
  return `oba_${digest}`;
}

async function ensureBudgetAccount(
  tx: LedgerTx,
  org: OrgRecord,
  costCentreId: string,
  period: string,
  actorId: string,
): Promise<OrgBudgetAccount> {
  const id = budgetAccountIdOf(costCentreId, period);
  const existing = await tx.orgBudgetAccount.findUnique({ where: { id } });
  if (existing !== null) {
    return existing;
  }
  const wallet = await tx.wallet.upsert({
    where: {
      ownerType_ownerId_currency: {
        ownerType: BUDGET_WALLET_OWNER,
        ownerId: id,
        currency: org.currency,
      },
    },
    create: {
      id: generateId("wal"),
      ownerType: BUDGET_WALLET_OWNER,
      ownerId: id,
      currency: org.currency,
      tier: BUSINESS_WALLET_TIER,
    },
    update: {},
  });
  return tx.orgBudgetAccount.upsert({
    where: { costCentreId_period: { costCentreId, period } },
    create: {
      id,
      organizationId: org.id,
      costCentreId,
      period,
      walletId: wallet.id,
      currency: org.currency,
      createdBy: actorId,
    },
    update: {},
  });
}

/**
 * Locks the budget account for the rest of the transaction. Every path that
 * moves or reserves a budget's money holds this lock, so they serialize per
 * budget and the available figure they read cannot go stale before they act.
 */
export async function lockBudgetAccount(
  tx: LedgerTx,
  budgetAccountId: string,
): Promise<OrgBudgetAccount> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM org_budget_accounts WHERE id = ${budgetAccountId} FOR UPDATE
  `;
  const account = await tx.orgBudgetAccount.findUnique({
    where: { id: budgetAccountId },
  });
  if (account === null) {
    throw new ContractError("not_found", "no such budget", { budgetAccountId });
  }
  return account;
}

// ── Views ─────────────────────────────────────────────────────────────────

type MoneyView = { readonly amountMinor: number; readonly currency: string };

export type BudgetAccountView = {
  readonly budgetId: string;
  readonly organizationId: string;
  readonly costCentreId: string;
  readonly period: string;
  readonly balance: MoneyView;
  readonly reserved: MoneyView;
  readonly available: MoneyView;
};

/** The sum of reservations still `reserved` against a budget wallet. */
export async function reservedAgainst(
  tx: LedgerTx,
  walletId: string,
  currency: string,
): Promise<Money> {
  const result = await tx.orgBudgetReservation.aggregate({
    _sum: { reservedMinor: true },
    where: { walletId, currency, state: "reserved" },
  });
  return money(fromNullableDbMinor(result._sum.reservedMinor), currency);
}

export async function budgetView(
  tx: LedgerTx,
  account: OrgBudgetAccount,
): Promise<BudgetAccountView> {
  const balance = await balanceOf(tx, account.walletId, account.currency);
  const reserved = await reservedAgainst(
    tx,
    account.walletId,
    account.currency,
  );
  return {
    budgetId: account.id,
    organizationId: account.organizationId,
    costCentreId: account.costCentreId,
    period: account.period,
    balance,
    reserved,
    available: money(
      balance.amountMinor - reserved.amountMinor,
      account.currency,
    ),
  };
}

async function unallocatedOf(tx: LedgerTx, org: OrgRecord): Promise<Money> {
  const wallet = await findOrgWallet(tx, org);
  return wallet === null
    ? money(0, org.currency)
    : spendableOf(tx, wallet.id, wallet.currency);
}

export type FundingView = {
  readonly organizationId: string;
  readonly currency: string;
  readonly unallocated: MoneyView;
  readonly budgets: readonly BudgetAccountView[];
};

/** Owners and admins: the prefunded wallet and every budget. */
export async function fundingView(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
): Promise<FundingView> {
  const { org } = await requireOrgRole(
    deps.db,
    orgId,
    actor.id,
    ORG_ADMIN_ROLES,
  );
  const accounts = await deps.db.orgBudgetAccount.findMany({
    where: { organizationId: orgId },
    orderBy: [{ period: "desc" }, { costCentreId: "asc" }],
  });
  const budgets: BudgetAccountView[] = [];
  for (const account of accounts) {
    budgets.push(await budgetView(deps.db, account));
  }
  return {
    organizationId: orgId,
    currency: org.currency,
    unallocated: await unallocatedOf(deps.db, org),
    budgets,
  };
}

/**
 * Budget availability for one period — owners, admins and bookers (a booker
 * needs to know what they can book against; they see no funding history).
 */
export async function listBudgets(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  period: string | undefined,
): Promise<readonly BudgetAccountView[]> {
  await requireOrgRole(deps.db, orgId, actor.id, ORG_BOOKER_ROLES);
  const accounts = await deps.db.orgBudgetAccount.findMany({
    where: {
      organizationId: orgId,
      ...(period === undefined ? {} : { period: assertPeriod(period) }),
    },
    orderBy: [{ period: "desc" }, { costCentreId: "asc" }],
  });
  const views: BudgetAccountView[] = [];
  for (const account of accounts) {
    views.push(await budgetView(deps.db, account));
  }
  return views;
}

// ── Top-up ────────────────────────────────────────────────────────────────

export interface OrgTopupInput {
  readonly methodId: string;
  readonly amountMinor: number;
}

export type OrgTopupResult = {
  readonly ref: string;
  readonly op: "topup";
  readonly organizationId: string;
  readonly topupId: string;
  readonly entryId: string;
  readonly amount: MoneyView;
  readonly unallocated: MoneyView;
};

/**
 * Tops the organization wallet up through the wallet top-up rail. The rail
 * captures first and the ledger records second, so the journal never claims
 * money that was not taken; a capture whose entry cannot commit is refunded.
 */
export async function topUpOrganization(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  input: OrgTopupInput,
  clientKey: string,
): Promise<OpOutcome<OrgTopupResult>> {
  const now = deps.now();
  const key = scopedKey("topup", actor.id, clientKey);
  const hash = termsHash({
    op: "topup",
    organizationId: orgId,
    methodId: input.methodId,
    amountMinor: input.amountMinor,
  });

  const { org } = await requireOrgRole(
    deps.db,
    orgId,
    actor.id,
    ORG_ADMIN_ROLES,
  );
  const prior = await replayOf<OrgTopupResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  assertPositiveMinor(input.amountMinor, org.currency);
  if (org.status !== "active") {
    throw refusal("organization_not_active", { organizationId: orgId });
  }
  const { city, flags } = await deps.config.load(org.cityId);
  assertBusinessTravelOn(flags, org.cityId);
  if (city.currency !== org.currency) {
    throw refusal("currency_mismatch", {
      organizationCurrency: org.currency,
      cityCurrency: city.currency,
    });
  }
  const method = city.paymentMethods.find(
    (entry) => entry.id === input.methodId,
  );
  if (method === undefined || !method.available) {
    throw new ContractError(
      "payment_method_unavailable",
      method?.reason ?? "that payment method is not available in this city",
      { methodId: input.methodId },
    );
  }

  const wallet = await deps.db.$transaction(async (tx) => {
    const row = await ensureOrgWallet(tx, org);
    return row;
  });
  const amount = money(input.amountMinor, org.currency);
  const rail = requireRail(deps.topupRail, "top-up");
  const topupId = generateId("top");
  const capture = await rail.capture({
    methodId: input.methodId,
    amount,
    reference: `topup:${topupId}`,
    idempotencyKey: `${key}:capture`,
  });

  try {
    return await deps.db.$transaction(async (tx) => {
      const entry = await postEntry(tx, {
        kind: "topup",
        reference: `topup:${topupId}`,
        occurredAt: now,
        idempotencyKey: key,
        description: "organization wallet top-up",
        lines: [
          {
            account: "psp_settlement",
            amount: money(-amount.amountMinor, amount.currency),
            counterpartRef: `wallet:${wallet.id}`,
          },
          {
            account: "wallet",
            walletId: wallet.id,
            amount,
            counterpartRef: `topup:${topupId}`,
          },
        ],
      });
      await tx.topup.create({
        data: {
          id: topupId,
          walletId: wallet.id,
          methodId: input.methodId,
          amountMinor: BigInt(amount.amountMinor),
          currency: amount.currency,
          status: "captured",
          pspRef: capture.pspRef,
          entryId: entry.id,
          idempotencyKey: key,
        },
      });

      const ref = generateId("obo");
      const result: OrgTopupResult = {
        ref,
        op: "topup",
        organizationId: orgId,
        topupId,
        entryId: entry.id,
        amount,
        unallocated: await spendableOf(tx, wallet.id, wallet.currency),
      };
      await recordOp(tx, {
        ref,
        op: "topup",
        key,
        clientKey,
        hash,
        organizationId: orgId,
        budgetAccountId: null,
        reservationId: null,
        amount,
        entryId: entry.id,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op: "topup",
        actor,
        actorType: "agent",
        action: "business.organization.topped_up",
        subjectType: "wallet",
        subjectId: wallet.id,
        before: null,
        after: {
          organizationId: orgId,
          topupId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          methodId: input.methodId,
          entryId: entry.id,
        },
        aggregateType: "wallet",
        aggregateId: wallet.id,
        fromVersion: null,
        toVersion: 1,
        cityId: org.cityId,
        eventKey: eventKeyOf("topup", topupId),
        occurredAt: now,
        payload: {
          organizationId: orgId,
          walletId: wallet.id,
          topupId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          entryId: entry.id,
        },
      });
      return { result, replayed: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error) || isUniqueViolation(error)) {
      // A same-key rival committed first. The rail capture is idempotent on
      // `${key}:capture`, so its capture and ours are the SAME capture: answer
      // the winner and refund nothing.
      const winner = await replayOf<OrgTopupResult>(deps.db, key, hash);
      if (winner !== null) {
        return winner;
      }
    }
    await rail.refund(capture.pspRef, `${key}:refund`);
    walletLogger.warn(
      { topupId, organizationId: orgId, amountMinor: amount.amountMinor },
      "organization top-up entry did not commit; capture compensated",
    );
    throw error;
  }
}

// ── Allocation and return ─────────────────────────────────────────────────

export interface BudgetMoveInput {
  readonly costCentreId: string;
  readonly period: string;
  readonly amountMinor: number;
}

export type BudgetMoveResult = {
  readonly ref: string;
  readonly op: "allocate" | "return";
  readonly organizationId: string;
  readonly entryId: string;
  readonly amount: MoneyView;
  readonly budget: BudgetAccountView;
  readonly unallocated: MoneyView;
};

/**
 * Moves prefunded money from the organization wallet into a cost centre's
 * budget for a month (creating the budget on first allocation). Refused when
 * the organization wallet cannot cover it — there is no overdraft.
 */
export async function allocateBudget(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  input: BudgetMoveInput,
  clientKey: string,
): Promise<OpOutcome<BudgetMoveResult>> {
  const result = await moveBudget(
    deps,
    actor,
    orgId,
    input,
    clientKey,
    "allocate",
  );
  return result;
}

/**
 * Returns unspent budget to the organization wallet. Only what is AVAILABLE
 * (balance minus live reservations) can go back, so a return can never
 * strand a booking that is already reserved. Never blocked by the flag.
 */
export async function returnBudget(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  input: BudgetMoveInput,
  clientKey: string,
): Promise<OpOutcome<BudgetMoveResult>> {
  const result = await moveBudget(
    deps,
    actor,
    orgId,
    input,
    clientKey,
    "return",
  );
  return result;
}

async function moveBudget(
  deps: WalletDeps,
  actor: Actor,
  orgId: string,
  input: BudgetMoveInput,
  clientKey: string,
  op: "allocate" | "return",
): Promise<OpOutcome<BudgetMoveResult>> {
  const now = deps.now();
  const key = scopedKey(op, actor.id, clientKey);
  const hash = termsHash({
    op,
    organizationId: orgId,
    costCentreId: input.costCentreId,
    period: input.period,
    amountMinor: input.amountMinor,
  });

  const { org } = await requireOrgRole(
    deps.db,
    orgId,
    actor.id,
    ORG_ADMIN_ROLES,
  );
  const prior = await replayOf<BudgetMoveResult>(deps.db, key, hash);
  if (prior !== null) {
    return prior;
  }
  assertPositiveMinor(input.amountMinor, org.currency);
  assertPeriod(input.period);
  if (op === "allocate") {
    // A NEW commitment: the city must be live with the flag on. A return
    // reads no config at all, so a paused city never strands the money.
    const { city, flags } = await deps.config.load(org.cityId);
    assertBusinessTravelOn(flags, org.cityId);
    if (org.status !== "active") {
      throw refusal("organization_not_active", { organizationId: orgId });
    }
    const current = periodOf(now, city.timezone);
    if (input.period < current) {
      throw new ContractError(
        "validation_failed",
        "money can only be allocated to the current or a future month",
        { period: input.period, currentPeriod: current },
      );
    }
  }
  const amount = money(input.amountMinor, org.currency);

  try {
    return await deps.db.$transaction(async (tx) => {
      // Re-read the authority inside the transaction that moves the money.
      const fresh = await loadOrganization(tx, orgId);
      if (fresh === null) {
        throw new ContractError("not_found", "no such organization");
      }
      await requireOrgRole(tx, orgId, actor.id, ORG_ADMIN_ROLES);

      const orgWallet = await ensureOrgWallet(tx, fresh);
      await lockWallet(tx, orgWallet.id);

      let account: OrgBudgetAccount;
      if (op === "allocate") {
        const costCentre = await tx.organizationCostCentre.findUnique({
          where: { id: input.costCentreId },
        });
        if (
          costCentre === null ||
          costCentre.organizationId !== orgId ||
          costCentre.status !== "active"
        ) {
          throw refusal("cost_centre_invalid", {
            costCentreId: input.costCentreId,
          });
        }
        const ensured = await ensureBudgetAccount(
          tx,
          fresh,
          input.costCentreId,
          input.period,
          actor.id,
        );
        account = await lockBudgetAccount(tx, ensured.id);
      } else {
        const existing = await tx.orgBudgetAccount.findUnique({
          where: {
            costCentreId_period: {
              costCentreId: input.costCentreId,
              period: input.period,
            },
          },
        });
        if (existing === null || existing.organizationId !== orgId) {
          throw refusal("no_budget_for_period", {
            costCentreId: input.costCentreId,
            period: input.period,
          });
        }
        account = await lockBudgetAccount(tx, existing.id);
      }

      // Under both locks: a same-key rival may have committed while we waited.
      const raced = await replayOf<BudgetMoveResult>(tx, key, hash);
      if (raced !== null) {
        return raced;
      }

      if (op === "allocate") {
        const spendable = await spendableOf(
          tx,
          orgWallet.id,
          orgWallet.currency,
        );
        if (spendable.amountMinor < amount.amountMinor) {
          throw new ContractError(
            "insufficient_spendable",
            "the organization wallet cannot cover this allocation — top it up first",
            {
              reason: "organization_funds_insufficient",
              unallocatedMinor: spendable.amountMinor,
              requiredMinor: amount.amountMinor,
            },
          );
        }
      } else {
        const before = await budgetView(tx, account);
        if (before.available.amountMinor < amount.amountMinor) {
          throw refusal("budget_insufficient", {
            availableMinor: before.available.amountMinor,
            requiredMinor: amount.amountMinor,
          });
        }
      }

      const budgetRef = `business_budget:${account.id}`;
      const orgRef = `organization:${orgId}`;
      const entry = await postEntry(tx, {
        kind:
          op === "allocate"
            ? "business_budget_allocation"
            : "business_budget_return",
        reference: budgetRef,
        occurredAt: now,
        idempotencyKey: key,
        description:
          op === "allocate"
            ? `budget allocation ${account.period}`
            : `budget return ${account.period}`,
        lines:
          op === "allocate"
            ? [
                {
                  account: "wallet",
                  walletId: orgWallet.id,
                  amount: money(-amount.amountMinor, amount.currency),
                  counterpartRef: budgetRef,
                },
                {
                  account: "wallet",
                  walletId: account.walletId,
                  amount,
                  counterpartRef: orgRef,
                },
              ]
            : [
                {
                  account: "wallet",
                  walletId: account.walletId,
                  amount: money(-amount.amountMinor, amount.currency),
                  counterpartRef: orgRef,
                },
                {
                  account: "wallet",
                  walletId: orgWallet.id,
                  amount,
                  counterpartRef: budgetRef,
                },
              ],
      });

      const bumped = await tx.orgBudgetAccount.update({
        where: { id: account.id },
        data: { version: { increment: 1 } },
      });
      const budget = await budgetView(tx, bumped);
      const ref = generateId("obo");
      const result: BudgetMoveResult = {
        ref,
        op,
        organizationId: orgId,
        entryId: entry.id,
        amount,
        budget,
        unallocated: await spendableOf(tx, orgWallet.id, orgWallet.currency),
      };
      await recordOp(tx, {
        ref,
        op,
        key,
        clientKey,
        hash,
        organizationId: orgId,
        budgetAccountId: account.id,
        reservationId: null,
        amount,
        entryId: entry.id,
        actor,
        result: { ...result },
      });
      await writeTrail(tx, {
        op,
        actor,
        actorType: "agent",
        action:
          op === "allocate"
            ? "business.budget.allocated"
            : "business.budget.returned",
        subjectType: "org_budget",
        subjectId: account.id,
        before: { version: account.version },
        after: {
          version: bumped.version,
          organizationId: orgId,
          costCentreId: account.costCentreId,
          period: account.period,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          entryId: entry.id,
          balanceMinor: budget.balance.amountMinor,
        },
        aggregateType: "wallet",
        aggregateId: account.walletId,
        fromVersion: account.version,
        toVersion: bumped.version,
        cityId: fresh.cityId,
        eventKey: eventKeyOf(op, ref),
        occurredAt: now,
        payload: {
          organizationId: orgId,
          budgetId: account.id,
          costCentreId: account.costCentreId,
          period: account.period,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          entryId: entry.id,
        },
      });
      return { result, replayed: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error) || isUniqueViolation(error)) {
      const winner = await replayOf<BudgetMoveResult>(deps.db, key, hash);
      if (winner !== null) {
        return winner;
      }
    }
    throw error;
  }
}
