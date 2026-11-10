/**
 * Audited dual-approval operations credit to a driver's commission wallet
 * (CC-B03, DEC-6 Part B).
 *
 * Every marketplace bid requires a cleared wallet balance to back its 10%
 * commission hold (`mp-holds.ts`). During a pilot or before self-serve PSP
 * top-ups are enabled in a city, operations can pre-fund or top up a verified
 * driver's commission wallet from UBI operating float (`ubi_float` → `wallet`)
 * under strict controls:
 *
 * 1. Deny-by-default city flag `ops_driver_wallet_credit` + required city
 *    config block `opsCreditPolicy` (`maxPerCreditMinor`,
 *    `maxDriverDailyMinor`, `maxCityDailyMinor`, `reasonCodes`).
 * 2. Target account MUST be a driver (`user.role === "DRIVER"` or linked
 *    `Driver` profile) — rider funds are never touched.
 * 3. Two-person approval (`approver.id !== credit.createdBy`); no journal
 *    entry is posted while `pending_approval`, and cleared funds land
 *    atomically upon approval.
 * 4. Every transition writes an `AuditLog` row and a catalogued `OutboxEvent`
 *    in the same database transaction as the state change.
 * 5. Approved credits can be reversed (`ops_driver_credit_reversal`) only
 *    against unencumbered spendable funds (`assertSufficientFunds`), so an
 *    active commission hold can never be uncovered by a reversal.
 */
import { createHash } from "node:crypto";

import {
  type CityConfig,
  ContractError,
  type Money,
  money,
  opsCreditPolicyFor,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { balanceOf } from "./balances";
import { assertFlagEnabled } from "./city-config";
import { lockWallet, type WalletDeps } from "./context";
import { dateInZone, dayWindow } from "./day-window";
import { isIdempotencyRace } from "./idempotency";
import {
  assertSufficientFunds,
  assertWithinBalanceCap,
  limitStatus,
} from "./limits";
import { fromDbMinor } from "./minor-units";
import { postEntry } from "./post-entry";
import { assertNotLocked, ensureWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, JsonValue, LedgerTx } from "./types";

export const OPS_CREDIT_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "reversed",
] as const;

export type OpsCreditStatus = (typeof OPS_CREDIT_STATUSES)[number];

export interface OpsCreditView {
  readonly id: string;
  readonly cityId: string;
  readonly driverUserId: string;
  readonly walletId: string;
  readonly amount: Money;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly reference: string | null;
  readonly status: OpsCreditStatus;
  readonly createdBy: string;
  readonly createdByRole: string;
  readonly approvedBy: string | null;
  readonly approvedByRole: string | null;
  readonly approvalNote: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedByRole: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly reversedBy: string | null;
  readonly reversedByRole: string | null;
  readonly reversedAt: string | null;
  readonly reversalReason: string | null;
  readonly entryId: string | null;
  readonly reversalEntryId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OpsCreditMutationResult {
  readonly credit: OpsCreditView;
  readonly balanceAfter: Money;
  readonly replayed: boolean;
}

export interface RequestOpsCreditInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly driverUserId: string;
  readonly amountMinor: number;
  readonly reasonCode: string;
  readonly note?: string | null;
  readonly reference?: string | null;
  readonly idempotencyKey: string;
}

export interface ApproveOpsCreditInput {
  readonly actor: Actor;
  readonly creditId: string;
  readonly note?: string | null;
  readonly idempotencyKey: string;
}

export interface RejectOpsCreditInput {
  readonly actor: Actor;
  readonly creditId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface ReverseOpsCreditInput {
  readonly actor: Actor;
  readonly creditId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface ListOpsCreditsFilter {
  readonly cityId?: string;
  readonly status?: OpsCreditStatus;
  readonly driverUserId?: string;
  readonly limit?: number;
}

interface StoredOpsCreditRow {
  readonly id: string;
  readonly cityId: string;
  readonly driverUserId: string;
  readonly walletId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly referenceRef: string | null;
  readonly status: string;
  readonly createdBy: string;
  readonly createdByRole: string;
  readonly requestPayloadHash: string;
  readonly requestIdempotencyKey: string;
  readonly approvedBy: string | null;
  readonly approvedByRole: string | null;
  readonly approvalNote: string | null;
  readonly approvedAt: Date | null;
  readonly approvePayloadHash: string | null;
  readonly approveIdempotencyKey: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedByRole: string | null;
  readonly rejectedReason: string | null;
  readonly rejectedAt: Date | null;
  readonly rejectPayloadHash: string | null;
  readonly rejectIdempotencyKey: string | null;
  readonly reversedBy: string | null;
  readonly reversedByRole: string | null;
  readonly reversalReason: string | null;
  readonly reversedAt: Date | null;
  readonly reversePayloadHash: string | null;
  readonly reverseIdempotencyKey: string | null;
  readonly entryId: string | null;
  readonly reversalEntryId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function hashPayload(payload: Readonly<Record<string, JsonValue>>): string {
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function toView(row: StoredOpsCreditRow): OpsCreditView {
  return {
    id: row.id,
    cityId: row.cityId,
    driverUserId: row.driverUserId,
    walletId: row.walletId,
    amount: money(fromDbMinor(row.amountMinor), row.currency),
    reasonCode: row.reasonCode,
    note: row.note,
    reference: row.referenceRef,
    status: row.status as OpsCreditStatus,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole,
    approvedBy: row.approvedBy,
    approvedByRole: row.approvedByRole,
    approvalNote: row.approvalNote,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedBy: row.rejectedBy,
    rejectedByRole: row.rejectedByRole,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectionReason: row.rejectedReason,
    reversedBy: row.reversedBy,
    reversedByRole: row.reversedByRole,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversalReason: row.reversalReason,
    entryId: row.entryId,
    reversalEntryId: row.reversalEntryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function lockCityOpsCredits(tx: LedgerTx, cityId: string): Promise<void> {
  const lockKey = `ops_credit:${cityId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

/**
 * Verifies that `driverUserId` belongs to an active driver account and never a
 * rider-only account, enforcing DEC-6 Part B ("never touches rider funds").
 */
async function assertDriverTarget(
  tx: LedgerTx,
  driverUserId: string,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: driverUserId },
    select: {
      id: true,
      role: true,
      status: true,
      driver: { select: { id: true } },
    },
  });
  if (user === null) {
    throw new ContractError("not_found", "driver account not found", {
      driverUserId,
    });
  }
  if (user.role !== "DRIVER" && user.driver === null) {
    throw new ContractError(
      "validation_failed",
      "ops wallet credits may only target a driver account, never a rider wallet",
      { driverUserId, role: user.role },
    );
  }
}

function requireOpsCreditPolicy(cityConfig: CityConfig) {
  if (cityConfig.opsCreditPolicy === undefined) {
    throw new ContractError(
      "config_unavailable",
      "city configuration has no opsCreditPolicy block; ops wallet credits are closed",
      { cityId: cityConfig.cityId },
    );
  }
  return opsCreditPolicyFor(cityConfig);
}

async function assertWithinDailyCaps(
  tx: LedgerTx,
  cityConfig: CityConfig,
  driverUserId: string,
  incomingMinor: number,
  now: Date,
  excludeCreditId?: string,
): Promise<void> {
  const policy = requireOpsCreditPolicy(cityConfig);
  if (incomingMinor > policy.maxPerCreditMinor) {
    throw new ContractError(
      "above_city_cap",
      "credit amount exceeds the city per-credit cap",
      {
        scope: "per_credit",
        amountMinor: incomingMinor,
        maxPerCreditMinor: policy.maxPerCreditMinor,
        currency: cityConfig.currency,
      },
    );
  }

  const today = dayWindow(
    dateInZone(now, cityConfig.timezone),
    cityConfig.timezone,
  );

  const dayFilter = {
    cityId: cityConfig.cityId,
    ...(excludeCreditId !== undefined ? { id: { not: excludeCreditId } } : {}),
    OR: [
      {
        status: "pending_approval",
        createdAt: { gte: today.start, lt: today.end },
      },
      {
        status: "approved",
        approvedAt: { gte: today.start, lt: today.end },
      },
    ],
  };

  const [driverAgg, cityAgg] = await Promise.all([
    tx.opsWalletCredit.aggregate({
      _sum: { amountMinor: true },
      where: { ...dayFilter, driverUserId },
    }),
    tx.opsWalletCredit.aggregate({
      _sum: { amountMinor: true },
      where: dayFilter,
    }),
  ]);

  const driverUsedMinor =
    driverAgg._sum.amountMinor === null
      ? 0
      : fromDbMinor(driverAgg._sum.amountMinor);
  if (driverUsedMinor + incomingMinor > policy.maxDriverDailyMinor) {
    throw new ContractError(
      "limit_exceeded",
      "credit would exceed the city's daily per-driver ops credit cap",
      {
        scope: "driver_daily",
        driverUserId,
        usedTodayMinor: driverUsedMinor,
        amountMinor: incomingMinor,
        maxDriverDailyMinor: policy.maxDriverDailyMinor,
        currency: cityConfig.currency,
      },
    );
  }

  const cityUsedMinor =
    cityAgg._sum.amountMinor === null
      ? 0
      : fromDbMinor(cityAgg._sum.amountMinor);
  if (cityUsedMinor + incomingMinor > policy.maxCityDailyMinor) {
    throw new ContractError(
      "above_city_cap",
      "credit would exceed the city's daily total ops credit cap",
      {
        scope: "city_daily",
        cityId: cityConfig.cityId,
        usedTodayMinor: cityUsedMinor,
        amountMinor: incomingMinor,
        maxCityDailyMinor: policy.maxCityDailyMinor,
        currency: cityConfig.currency,
      },
    );
  }
}

export async function requestOpsCredit(
  deps: WalletDeps,
  input: RequestOpsCreditInput,
): Promise<OpsCreditMutationResult> {
  const now = deps.now();
  const note =
    input.note !== undefined &&
    input.note !== null &&
    input.note.trim().length > 0
      ? input.note.trim()
      : null;
  const referenceRef =
    input.reference !== undefined &&
    input.reference !== null &&
    input.reference.trim().length > 0
      ? input.reference.trim()
      : null;
  const reasonCode = input.reasonCode.trim();

  const key = scopedIdempotencyKey(
    "wallet.ops_credit.request",
    input.actor.id,
    input.idempotencyKey,
  );
  const requestPayloadHash = hashPayload({
    cityId: input.cityId,
    driverUserId: input.driverUserId,
    amountMinor: input.amountMinor,
    reasonCode,
    note,
    referenceRef,
  });

  const existing = await deps.db.opsWalletCredit.findUnique({
    where: { requestIdempotencyKey: key },
  });
  if (existing !== null) {
    if (existing.requestPayloadHash !== requestPayloadHash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "that idempotency key was already used for a different ops credit request",
      );
    }
    return {
      credit: toView(existing),
      balanceAfter: await balanceOf(
        deps.db,
        existing.walletId,
        existing.currency,
      ),
      replayed: true,
    };
  }

  const config = await deps.config.load(input.cityId);
  assertFlagEnabled(config.flags, "ops_driver_wallet_credit");
  const policy = requireOpsCreditPolicy(config.city);

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "amountMinor must be a positive integer",
    );
  }
  if (!policy.reasonCodes.includes(reasonCode)) {
    throw new ContractError(
      "validation_failed",
      "reasonCode is not permitted by this city's ops credit policy",
      { reasonCode, allowedReasonCodes: policy.reasonCodes },
    );
  }

  const creditId = generateId("ocrd");
  const amount = money(input.amountMinor, config.city.currency);

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockCityOpsCredits(tx, config.city.cityId);
      await assertDriverTarget(tx, input.driverUserId);

      const wallet = await ensureWallet(
        tx,
        "user",
        input.driverUserId,
        config.city,
      );
      assertNotLocked(wallet);

      const limits = await limitStatus(tx, wallet, config.city, now);
      await assertWithinBalanceCap(tx, wallet, amount, limits);
      await assertWithinDailyCaps(
        tx,
        config.city,
        input.driverUserId,
        amount.amountMinor,
        now,
      );

      const created = await tx.opsWalletCredit.create({
        data: {
          id: creditId,
          cityId: config.city.cityId,
          driverUserId: input.driverUserId,
          walletId: wallet.id,
          amountMinor: BigInt(amount.amountMinor),
          currency: amount.currency,
          reasonCode,
          note,
          referenceRef,
          status: "pending_approval",
          createdBy: input.actor.id,
          createdByRole: input.actor.role,
          requestIdempotencyKey: key,
          requestPayloadHash,
          createdAt: now,
        },
      });

      await writeAudit(tx, {
        actor: input.actor,
        action: "wallet.ops_credit.requested",
        subjectType: "ops_wallet_credit",
        subjectId: created.id,
        after: {
          creditId: created.id,
          cityId: created.cityId,
          driverUserId: created.driverUserId,
          walletId: created.walletId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          reasonCode,
          status: "pending_approval",
        },
        reason: note ?? reasonCode,
      });

      await publishEvent(tx, {
        name: "wallet.ops_credit.requested",
        aggregateType: "ops_wallet_credit",
        aggregateId: created.id,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType: "ops",
        cityId: created.cityId,
        idempotencyKey: `wallet.ops_credit.requested:${created.id}`,
        occurredAt: now,
        payload: {
          creditId: created.id,
          walletId: created.walletId,
          driverUserId: created.driverUserId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          reasonCode,
        },
      });

      return {
        credit: toView(created),
        balanceAfter: await balanceOf(tx, wallet.id, amount.currency),
        replayed: false,
      };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const winner = await deps.db.opsWalletCredit.findUnique({
        where: { requestIdempotencyKey: key },
      });
      if (winner !== null) {
        if (winner.requestPayloadHash !== requestPayloadHash) {
          throw new ContractError(
            "idempotency_key_reuse",
            "that idempotency key was already used for a different ops credit request",
          );
        }
        return {
          credit: toView(winner),
          balanceAfter: await balanceOf(
            deps.db,
            winner.walletId,
            winner.currency,
          ),
          replayed: true,
        };
      }
    }
    throw error;
  }
}

export async function approveOpsCredit(
  deps: WalletDeps,
  input: ApproveOpsCreditInput,
): Promise<OpsCreditMutationResult> {
  const now = deps.now();
  const approvalNote =
    input.note !== undefined &&
    input.note !== null &&
    input.note.trim().length > 0
      ? input.note.trim()
      : null;
  const key = scopedIdempotencyKey(
    "wallet.ops_credit.approve",
    input.actor.id,
    input.idempotencyKey,
  );
  const approvePayloadHash = hashPayload({
    creditId: input.creditId,
    approverId: input.actor.id,
    approvalNote,
  });

  const replayedByKey = await deps.db.opsWalletCredit.findUnique({
    where: { approveIdempotencyKey: key },
  });
  if (replayedByKey !== null) {
    if (replayedByKey.approvePayloadHash !== approvePayloadHash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "that idempotency key was already used for a different approval",
      );
    }
    return {
      credit: toView(replayedByKey),
      balanceAfter: await balanceOf(
        deps.db,
        replayedByKey.walletId,
        replayedByKey.currency,
      ),
      replayed: true,
    };
  }

  const target = await deps.db.opsWalletCredit.findUnique({
    where: { id: input.creditId },
  });
  if (target === null) {
    throw new ContractError("not_found", "ops wallet credit not found", {
      creditId: input.creditId,
    });
  }

  const config = await deps.config.load(target.cityId);
  assertFlagEnabled(config.flags, "ops_driver_wallet_credit");
  const policy = requireOpsCreditPolicy(config.city);

  return deps.db.$transaction(async (tx) => {
    await lockCityOpsCredits(tx, target.cityId);

    const credit = await tx.opsWalletCredit.findUnique({
      where: { id: input.creditId },
    });
    if (credit === null) {
      throw new ContractError("not_found", "ops wallet credit not found", {
        creditId: input.creditId,
      });
    }

    if (credit.approveIdempotencyKey === key) {
      if (credit.approvePayloadHash !== approvePayloadHash) {
        throw new ContractError(
          "idempotency_key_reuse",
          "that idempotency key was already used for a different approval",
        );
      }
      return {
        credit: toView(credit),
        balanceAfter: await balanceOf(tx, credit.walletId, credit.currency),
        replayed: true,
      };
    }

    if (credit.status === "approved") {
      throw new ContractError(
        "already_approved",
        "ops wallet credit has already been approved",
        { creditId: credit.id },
      );
    }
    if (credit.status !== "pending_approval") {
      throw new ContractError(
        "illegal_transition",
        `cannot approve an ops wallet credit in status ${credit.status}`,
        { creditId: credit.id, status: credit.status },
      );
    }
    if (credit.createdBy === input.actor.id) {
      throw new ContractError(
        "approver_is_author",
        "an ops wallet credit must be approved by a second operator, never its author",
        { creditId: credit.id },
      );
    }
    if (!policy.reasonCodes.includes(credit.reasonCode)) {
      throw new ContractError(
        "validation_failed",
        "credit reasonCode is no longer permitted by the active city policy",
        { reasonCode: credit.reasonCode },
      );
    }

    await assertDriverTarget(tx, credit.driverUserId);

    const wallet = await ensureWallet(
      tx,
      "user",
      credit.driverUserId,
      config.city,
    );
    await lockWallet(tx, wallet.id);
    assertNotLocked(wallet);

    const amount = money(fromDbMinor(credit.amountMinor), credit.currency);
    const limits = await limitStatus(tx, wallet, config.city, now);
    await assertWithinBalanceCap(tx, wallet, amount, limits);
    await assertWithinDailyCaps(
      tx,
      config.city,
      credit.driverUserId,
      amount.amountMinor,
      now,
      credit.id,
    );

    const entry = await postEntry(tx, {
      kind: "ops_driver_credit",
      reference: `ops_credit:${credit.id}`,
      occurredAt: now,
      idempotencyKey: `ops_credit.entry:${credit.id}`,
      caseRef: credit.referenceRef ?? credit.id,
      description: `ops driver commission wallet credit (${credit.reasonCode})`,
      lines: [
        {
          account: "ubi_float",
          amount: money(-amount.amountMinor, amount.currency),
          counterpartRef: `wallet:${wallet.id}`,
        },
        {
          account: "wallet",
          walletId: wallet.id,
          amount,
          counterpartRef: `ops_credit:${credit.id}`,
        },
      ],
    });

    const updated = await tx.opsWalletCredit.update({
      where: { id: credit.id },
      data: {
        status: "approved",
        approvedBy: input.actor.id,
        approvedByRole: input.actor.role,
        approvalNote,
        approvedAt: now,
        entryId: entry.id,
        approveIdempotencyKey: key,
        approvePayloadHash,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.ops_credit.approved",
      subjectType: "ops_wallet_credit",
      subjectId: credit.id,
      before: { status: "pending_approval" },
      after: {
        status: "approved",
        entryId: entry.id,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        walletId: wallet.id,
        createdBy: credit.createdBy,
        approvedBy: input.actor.id,
      },
      reason: approvalNote ?? credit.note ?? credit.reasonCode,
    });

    await publishEvent(tx, {
      name: "wallet.ops_credit.approved",
      aggregateType: "ops_wallet_credit",
      aggregateId: credit.id,
      fromVersion: 1,
      toVersion: 2,
      actor: input.actor,
      actorType: "ops",
      cityId: credit.cityId,
      idempotencyKey: `wallet.ops_credit.approved:${credit.id}`,
      occurredAt: now,
      payload: {
        creditId: credit.id,
        walletId: wallet.id,
        driverUserId: credit.driverUserId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        reasonCode: credit.reasonCode,
        entryId: entry.id,
      },
    });

    return {
      credit: toView(updated),
      balanceAfter: await balanceOf(tx, wallet.id, amount.currency),
      replayed: false,
    };
  });
}

export async function rejectOpsCredit(
  deps: WalletDeps,
  input: RejectOpsCreditInput,
): Promise<OpsCreditMutationResult> {
  const now = deps.now();
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new ContractError(
      "reason_code_required",
      "a rejection reason is required",
    );
  }

  const key = scopedIdempotencyKey(
    "wallet.ops_credit.reject",
    input.actor.id,
    input.idempotencyKey,
  );
  const rejectPayloadHash = hashPayload({
    creditId: input.creditId,
    reason,
  });

  const replayedByKey = await deps.db.opsWalletCredit.findUnique({
    where: { rejectIdempotencyKey: key },
  });
  if (replayedByKey !== null) {
    if (replayedByKey.rejectPayloadHash !== rejectPayloadHash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "that idempotency key was already used for a different rejection",
      );
    }
    return {
      credit: toView(replayedByKey),
      balanceAfter: await balanceOf(
        deps.db,
        replayedByKey.walletId,
        replayedByKey.currency,
      ),
      replayed: true,
    };
  }

  return deps.db.$transaction(async (tx) => {
    const credit = await tx.opsWalletCredit.findUnique({
      where: { id: input.creditId },
    });
    if (credit === null) {
      throw new ContractError("not_found", "ops wallet credit not found", {
        creditId: input.creditId,
      });
    }
    await lockCityOpsCredits(tx, credit.cityId);

    const fresh = await tx.opsWalletCredit.findUnique({
      where: { id: input.creditId },
    });
    if (fresh === null) {
      throw new ContractError("not_found", "ops wallet credit not found", {
        creditId: input.creditId,
      });
    }

    if (fresh.rejectIdempotencyKey === key) {
      if (fresh.rejectPayloadHash !== rejectPayloadHash) {
        throw new ContractError(
          "idempotency_key_reuse",
          "that idempotency key was already used for a different rejection",
        );
      }
      return {
        credit: toView(fresh),
        balanceAfter: await balanceOf(tx, fresh.walletId, fresh.currency),
        replayed: true,
      };
    }

    if (fresh.status !== "pending_approval") {
      throw new ContractError(
        "illegal_transition",
        `cannot reject an ops wallet credit in status ${fresh.status}`,
        { creditId: fresh.id, status: fresh.status },
      );
    }

    const updated = await tx.opsWalletCredit.update({
      where: { id: fresh.id },
      data: {
        status: "rejected",
        rejectedBy: input.actor.id,
        rejectedByRole: input.actor.role,
        rejectedAt: now,
        rejectedReason: reason,
        rejectIdempotencyKey: key,
        rejectPayloadHash,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.ops_credit.rejected",
      subjectType: "ops_wallet_credit",
      subjectId: fresh.id,
      before: { status: "pending_approval" },
      after: { status: "rejected", rejectedBy: input.actor.id },
      reason,
    });

    await publishEvent(tx, {
      name: "wallet.ops_credit.rejected",
      aggregateType: "ops_wallet_credit",
      aggregateId: fresh.id,
      fromVersion: 1,
      toVersion: 2,
      actor: input.actor,
      actorType: "ops",
      cityId: fresh.cityId,
      idempotencyKey: `wallet.ops_credit.rejected:${fresh.id}`,
      occurredAt: now,
      payload: {
        creditId: fresh.id,
        walletId: fresh.walletId,
        driverUserId: fresh.driverUserId,
        amountMinor: fromDbMinor(fresh.amountMinor),
        currency: fresh.currency,
        reasonCode: fresh.reasonCode,
      },
    });

    return {
      credit: toView(updated),
      balanceAfter: await balanceOf(tx, fresh.walletId, fresh.currency),
      replayed: false,
    };
  });
}

export async function reverseOpsCredit(
  deps: WalletDeps,
  input: ReverseOpsCreditInput,
): Promise<OpsCreditMutationResult> {
  const now = deps.now();
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new ContractError(
      "reason_code_required",
      "a reversal reason is required",
    );
  }

  const key = scopedIdempotencyKey(
    "wallet.ops_credit.reverse",
    input.actor.id,
    input.idempotencyKey,
  );
  const reversePayloadHash = hashPayload({
    creditId: input.creditId,
    reason,
  });

  const replayedByKey = await deps.db.opsWalletCredit.findUnique({
    where: { reverseIdempotencyKey: key },
  });
  if (replayedByKey !== null) {
    if (replayedByKey.reversePayloadHash !== reversePayloadHash) {
      throw new ContractError(
        "idempotency_key_reuse",
        "that idempotency key was already used for a different reversal",
      );
    }
    return {
      credit: toView(replayedByKey),
      balanceAfter: await balanceOf(
        deps.db,
        replayedByKey.walletId,
        replayedByKey.currency,
      ),
      replayed: true,
    };
  }

  return deps.db.$transaction(async (tx) => {
    const credit = await tx.opsWalletCredit.findUnique({
      where: { id: input.creditId },
    });
    if (credit === null) {
      throw new ContractError("not_found", "ops wallet credit not found", {
        creditId: input.creditId,
      });
    }
    await lockCityOpsCredits(tx, credit.cityId);

    const fresh = await tx.opsWalletCredit.findUnique({
      where: { id: input.creditId },
    });
    if (fresh === null) {
      throw new ContractError("not_found", "ops wallet credit not found", {
        creditId: input.creditId,
      });
    }

    if (fresh.reverseIdempotencyKey === key) {
      if (fresh.reversePayloadHash !== reversePayloadHash) {
        throw new ContractError(
          "idempotency_key_reuse",
          "that idempotency key was already used for a different reversal",
        );
      }
      return {
        credit: toView(fresh),
        balanceAfter: await balanceOf(tx, fresh.walletId, fresh.currency),
        replayed: true,
      };
    }

    if (fresh.status !== "approved") {
      throw new ContractError(
        "illegal_transition",
        `cannot reverse an ops wallet credit in status ${fresh.status}`,
        { creditId: fresh.id, status: fresh.status },
      );
    }

    await lockWallet(tx, fresh.walletId);
    const wallet = await tx.wallet.findUnique({
      where: { id: fresh.walletId },
    });
    if (wallet === null) {
      throw new ContractError("not_found", "wallet not found", {
        walletId: fresh.walletId,
      });
    }

    const amount = money(fromDbMinor(fresh.amountMinor), fresh.currency);
    // Spendable check: refuses with `insufficient_funds` or
    // `insufficient_spendable` if active commission holds encumber the funds.
    await assertSufficientFunds(tx, wallet, amount);

    const entry = await postEntry(tx, {
      kind: "ops_driver_credit_reversal",
      reference: `ops_credit:${fresh.id}:reversal`,
      occurredAt: now,
      idempotencyKey: `ops_credit.reversal:${fresh.id}`,
      caseRef: fresh.referenceRef ?? fresh.id,
      description: `reversal of ops driver credit ${fresh.id}`,
      lines: [
        {
          account: "wallet",
          walletId: wallet.id,
          amount: money(-amount.amountMinor, amount.currency),
          counterpartRef: `ops_credit:${fresh.id}:reversal`,
        },
        {
          account: "ubi_float",
          amount,
          counterpartRef: `wallet:${wallet.id}`,
        },
      ],
    });

    const updated = await tx.opsWalletCredit.update({
      where: { id: fresh.id },
      data: {
        status: "reversed",
        reversedBy: input.actor.id,
        reversedByRole: input.actor.role,
        reversedAt: now,
        reversalReason: reason,
        reversalEntryId: entry.id,
        reverseIdempotencyKey: key,
        reversePayloadHash,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.ops_credit.reversed",
      subjectType: "ops_wallet_credit",
      subjectId: fresh.id,
      before: { status: "approved", entryId: fresh.entryId },
      after: {
        status: "reversed",
        reversalEntryId: entry.id,
        reversedBy: input.actor.id,
      },
      reason,
    });

    await publishEvent(tx, {
      name: "wallet.ops_credit.reversed",
      aggregateType: "ops_wallet_credit",
      aggregateId: fresh.id,
      fromVersion: 2,
      toVersion: 3,
      actor: input.actor,
      actorType: "ops",
      cityId: fresh.cityId,
      idempotencyKey: `wallet.ops_credit.reversed:${fresh.id}`,
      occurredAt: now,
      payload: {
        creditId: fresh.id,
        walletId: wallet.id,
        driverUserId: fresh.driverUserId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        reversalEntryId: entry.id,
      },
    });

    return {
      credit: toView(updated),
      balanceAfter: await balanceOf(tx, wallet.id, amount.currency),
      replayed: false,
    };
  });
}

export async function getOpsCredit(
  deps: WalletDeps,
  creditId: string,
): Promise<OpsCreditView> {
  const row = await deps.db.opsWalletCredit.findUnique({
    where: { id: creditId },
  });
  if (row === null) {
    throw new ContractError("not_found", "ops wallet credit not found", {
      creditId,
    });
  }
  return toView(row);
}

export async function listOpsCredits(
  deps: WalletDeps,
  filter: ListOpsCreditsFilter = {},
): Promise<readonly OpsCreditView[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = await deps.db.opsWalletCredit.findMany({
    where: {
      ...(filter.cityId !== undefined ? { cityId: filter.cityId } : {}),
      ...(filter.status !== undefined ? { status: filter.status } : {}),
      ...(filter.driverUserId !== undefined
        ? { driverUserId: filter.driverUserId }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(toView);
}
