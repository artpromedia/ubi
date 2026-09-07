/**
 * Peer-to-peer transfers, the top-up saga, and the recipient-consented return.
 *
 * Rules this module exists to enforce:
 *  - the server decides everything: the sender is the authenticated actor, the
 *    currency and every limit come from city config, and the client's numbers
 *    are only ever an *amount* it is asking to send;
 *  - a posted transfer is never pulled back unilaterally — the recipient must
 *    consent, or the sender must go through a dispute (CLAUDE.md #7);
 *  - `topup + transfer` is a saga: both legs post or neither does, and a
 *    capture that cannot be posted is compensated at the rail;
 *  - every status change goes through `assertTransition("walletTransfer", …)`.
 */
import {
  assertTransition,
  ContractError,
  initialState,
  type Money,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { walletLogger } from "../lib/logger";
import { generateId } from "../lib/utils";

import { publishEvent, writeAudit } from "./audit";
import { verifyWalletPin } from "./authorize";
import { balanceOf } from "./balances";
import { isIdempotencyRace } from "./idempotency";
import { lockWallet, type WalletDeps } from "./context";
import {
  assertSufficientFunds,
  assertWithinLimits,
  limitStatus,
} from "./limits";
import { fromDbMinor } from "./minor-units";
import { assertPinShape } from "./pin";
import { postEntry } from "./post-entry";
import { requireRail } from "./providers";
import { evaluateTransferRisk, isNewRecipient, type RiskReason } from "./risk";
import { openRiskReviewCase } from "./review";
import type { Actor, LedgerTx } from "./types";
import {
  assertNotLocked,
  assertNotSafeMode,
  assertOutsideCoolingCap,
  ensureWallet,
} from "./wallets";
import { assertFlagEnabled, type WalletCityConfig } from "./city-config";

const TRANSFER_MACHINE = "walletTransfer" as const;

export interface TransferTopupRequest {
  readonly methodId: string;
  readonly amountMinor: number;
}

export interface SendTransferInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly toUserId: string;
  readonly amountMinor: number;
  readonly note?: string | undefined;
  readonly pin: string;
  readonly topup?: TransferTopupRequest | undefined;
  readonly idempotencyKey: string;
}

export interface TransferResult {
  readonly transferId: string;
  readonly status: "posted" | "held_risk";
  readonly amount: Money;
  readonly toUserId: string;
  readonly entryId: string | null;
  readonly riskReason: string | null;
  readonly reviewCaseId: string | null;
  readonly topupId: string | null;
  readonly balanceAfter: Money | null;
  readonly replayed: boolean;
  readonly createdAt: string;
}

interface TransferRow {
  readonly id: string;
  readonly fromWallet: string | null;
  readonly toWallet: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly riskHoldReason: string | null;
  readonly entryId: string | null;
  readonly version: number;
  readonly createdAt: Date;
}

/** Thrown inside the ledger transaction to force a rollback of a captured saga. */
class SagaAbort extends Error {
  constructor(override readonly cause: ContractError) {
    super(cause.message);
    this.name = "SagaAbort";
  }
}

function transferIdempotencyKey(actorId: string, key: string): string {
  return scopedIdempotencyKey("wallet.transfer", actorId, key);
}

/**
 * Rebuilds the original answer from the persisted transfer. Replay is
 * deterministic because it reads the stored outcome — it never re-decides.
 */
async function replayOutcome(
  tx: LedgerTx,
  row: TransferRow,
  toUserId: string,
): Promise<TransferResult> {
  const amount = money(fromDbMinor(row.amountMinor), row.currency);
  if (row.status === "rejected_limit") {
    throw new ContractError(
      "limit_exceeded",
      row.riskHoldReason ?? "transfer exceeded the wallet's limits",
      { transferId: row.id, replayed: true },
    );
  }
  if (row.status === "rejected_safe_mode") {
    throw new ContractError("safe_mode_active", "wallet is in safe mode", {
      transferId: row.id,
      replayed: true,
    });
  }
  const reviewCase =
    row.status === "held_risk"
      ? await tx.supportCase.findFirst({
          where: { subjectType: "transfer", subjectId: row.id },
          select: { id: true },
        })
      : null;
  const topup = await tx.topup.findFirst({
    where: { sagaTransferId: row.id },
    select: { id: true },
  });
  return {
    transferId: row.id,
    status: row.status === "held_risk" ? "held_risk" : "posted",
    amount,
    toUserId,
    entryId: row.entryId,
    riskReason: row.riskHoldReason,
    reviewCaseId: reviewCase?.id ?? null,
    topupId: topup?.id ?? null,
    balanceAfter:
      row.fromWallet === null
        ? null
        : await balanceOf(tx, row.fromWallet, row.currency),
    replayed: true,
    createdAt: row.createdAt.toISOString(),
  };
}

async function recordRejection(
  deps: WalletDeps,
  params: {
    readonly actor: Actor;
    readonly transferId: string;
    readonly fromWalletId: string;
    readonly toWalletId: string;
    readonly amount: Money;
    readonly note: string | undefined;
    readonly idempotencyKey: string;
    readonly status: "rejected_limit" | "rejected_safe_mode";
    readonly reason: string;
  },
): Promise<void> {
  assertTransition(TRANSFER_MACHINE, initialState(TRANSFER_MACHINE), params.status);
  await deps.db.$transaction(async (tx) => {
    await tx.transfer.create({
      data: {
        id: params.transferId,
        fromWallet: params.fromWalletId,
        toWallet: params.toWalletId,
        amountMinor: BigInt(params.amount.amountMinor),
        currency: params.amount.currency,
        note: params.note ?? null,
        status: params.status,
        riskHoldReason: params.reason,
        idempotencyKey: params.idempotencyKey,
      },
    });
    await writeAudit(tx, {
      actor: params.actor,
      action: `wallet.transfer.${params.status}`,
      subjectType: "transfer",
      subjectId: params.transferId,
      after: { status: params.status, amountMinor: params.amount.amountMinor },
      reason: params.reason,
    });
  });
}

async function findByIdempotency(
  deps: WalletDeps,
  key: string,
): Promise<TransferRow | null> {
  return deps.db.transfer.findUnique({ where: { idempotencyKey: key } });
}

export async function sendTransfer(
  deps: WalletDeps,
  input: SendTransferInput,
): Promise<TransferResult> {
  const now = deps.now();
  const idempotencyKey = transferIdempotencyKey(input.actor.id, input.idempotencyKey);

  const existing = await findByIdempotency(deps, idempotencyKey);
  if (existing !== null) {
    return deps.db.$transaction((tx) => replayOutcome(tx, existing, input.toUserId));
  }

  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");
  assertPinShape(input.pin);

  if (input.amountMinor <= 0) {
    throw new ContractError("validation_failed", "amount must be greater than zero");
  }
  if (input.toUserId === input.actor.id) {
    throw new ContractError("validation_failed", "a wallet cannot pay itself");
  }

  const recipient = await deps.directory.byUserId(input.toUserId);
  if (recipient === null) {
    throw new ContractError("recipient_not_found", "no such recipient");
  }

  const amount = money(input.amountMinor, config.city.currency);

  const { sender, recipientWallet } = await deps.db.$transaction(async (tx) => ({
    sender: await ensureWallet(tx, "user", input.actor.id, config.city),
    recipientWallet: await ensureWallet(tx, "user", input.toUserId, config.city),
  }));

  assertNotLocked(sender);

  const transferId = generateId("tr");

  // Safe mode blocks peer-to-peer entirely — it is not a smaller limit.
  if (sender.safeModeUntil !== null && sender.safeModeUntil > now) {
    await recordRejection(deps, {
      actor: input.actor,
      transferId,
      fromWalletId: sender.id,
      toWalletId: recipientWallet.id,
      amount,
      note: input.note,
      idempotencyKey,
      status: "rejected_safe_mode",
      reason: "safe_mode_active",
    });
    assertNotSafeMode(sender, now);
  }

  await verifyWalletPin(deps, input.actor, sender, input.pin, config, now);

  // The capture happens before the ledger transaction so the wallet is funded
  // when the transfer leg is evaluated; if that leg does not commit, the
  // capture is compensated below.
  const capture = await captureSagaTopup(deps, input, config, transferId);

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, sender.id);
      const locked = await tx.wallet.findUniqueOrThrow({ where: { id: sender.id } });

      let topupId: string | null = null;
      if (capture !== null) {
        const topupEntry = await postEntry(tx, {
          kind: "topup",
          reference: `topup:${capture.topupId}`,
          occurredAt: now,
          idempotencyKey: `${idempotencyKey}:topup`,
          description: "wallet top-up (saga leg 1)",
          lines: [
            {
              account: "psp_settlement",
              amount: money(-capture.amount.amountMinor, capture.amount.currency),
              counterpartRef: `wallet:${sender.id}`,
            },
            {
              account: "wallet",
              walletId: sender.id,
              amount: capture.amount,
              counterpartRef: `topup:${capture.topupId}`,
            },
          ],
        });
        await tx.topup.create({
          data: {
            id: capture.topupId,
            walletId: sender.id,
            methodId: capture.methodId,
            amountMinor: BigInt(capture.amount.amountMinor),
            currency: capture.amount.currency,
            status: "captured",
            pspRef: capture.pspRef,
            entryId: topupEntry.id,
            idempotencyKey: `${idempotencyKey}:topup`,
          },
        });
        topupId = capture.topupId;
      }

      const limits = await limitStatus(tx, locked, config.city, now);
      try {
        assertWithinLimits(limits, amount);
      } catch (error) {
        throw abortable(error, capture !== null);
      }

      const newRecipient = await isNewRecipient(tx, sender.id, recipientWallet.id);
      try {
        assertOutsideCoolingCap(
          locked,
          now,
          newRecipient,
          amount.amountMinor,
          config.policy.pinResetCoolingCapMinor,
        );
        await assertSufficientFunds(tx, locked, amount);
      } catch (error) {
        throw abortable(error, capture !== null);
      }

      const verdict = await evaluateTransferRisk(tx, {
        fromWalletId: sender.id,
        toWalletId: recipientWallet.id,
        amount,
        policy: config.policy,
        now,
      });

      if (verdict.hold) {
        if (capture !== null) {
          // "Both post or neither": a held transfer has not posted, so the
          // top-up must not either. Roll back and re-record the hold on its own.
          throw new SagaAbort(
            new ContractError("risk_hold", "transfer held for review", {
              reason: verdict.reason,
            }),
          );
        }
        return holdTransfer(tx, {
          actor: input.actor,
          cityId: input.cityId,
          transferId,
          senderWalletId: sender.id,
          recipientWalletId: recipientWallet.id,
          toUserId: input.toUserId,
          amount,
          note: input.note,
          idempotencyKey,
          reason: verdict.reason,
          slaMinutes: config.policy.riskReviewSlaMinutes,
          now,
        });
      }

      return postTransfer(tx, {
        actor: input.actor,
        cityId: input.cityId,
        transferId,
        senderWalletId: sender.id,
        recipientWalletId: recipientWallet.id,
        toUserId: input.toUserId,
        amount,
        note: input.note,
        idempotencyKey,
        topupId,
        now,
      });
    });
  } catch (error) {
    return handleTransferFailure(deps, {
      error,
      capture,
      actor: input.actor,
      cityId: input.cityId,
      transferId,
      senderWalletId: sender.id,
      recipientWalletId: recipientWallet.id,
      toUserId: input.toUserId,
      amount,
      note: input.note,
      idempotencyKey,
      slaMinutes: config.policy.riskReviewSlaMinutes,
      now,
    });
  }
}

function abortable(error: unknown, hasCapture: boolean): unknown {
  if (hasCapture && error instanceof ContractError) {
    return new SagaAbort(error);
  }
  return error;
}

interface CapturedTopup {
  readonly topupId: string;
  readonly methodId: string;
  readonly pspRef: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

async function captureSagaTopup(
  deps: WalletDeps,
  input: SendTransferInput,
  config: WalletCityConfig,
  transferId: string,
): Promise<CapturedTopup | null> {
  const request = input.topup;
  if (request === undefined) {
    return null;
  }
  if (request.amountMinor <= 0) {
    throw new ContractError("validation_failed", "top-up amount must be greater than zero");
  }
  const available = config.city.paymentMethods.find(
    (method) => method.id === request.methodId,
  );
  if (available === undefined || !available.available) {
    throw new ContractError(
      "payment_method_unavailable",
      available?.reason ?? "that payment method is not available in this city",
      { methodId: request.methodId },
    );
  }
  const rail = requireRail(deps.topupRail, "top-up");
  const captureKey = `${transferIdempotencyKey(input.actor.id, input.idempotencyKey)}:capture`;
  const topupAmount = money(request.amountMinor, config.city.currency);
  const result = await rail.capture({
    methodId: request.methodId,
    amount: topupAmount,
    reference: `transfer:${transferId}`,
    idempotencyKey: captureKey,
  });
  walletLogger.info(
    {
      transferId,
      methodId: request.methodId,
      amountMinor: topupAmount.amountMinor,
      currency: topupAmount.currency,
    },
    "saga top-up captured",
  );
  return {
    topupId: generateId("top"),
    methodId: request.methodId,
    pspRef: result.pspRef,
    amount: topupAmount,
    idempotencyKey: captureKey,
  };
}

interface PostParams {
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly senderWalletId: string;
  readonly recipientWalletId: string;
  readonly toUserId: string;
  readonly amount: Money;
  readonly note: string | undefined;
  readonly idempotencyKey: string;
  readonly topupId: string | null;
  readonly now: Date;
}

async function postTransfer(tx: LedgerTx, params: PostParams): Promise<TransferResult> {
  assertTransition(TRANSFER_MACHINE, initialState(TRANSFER_MACHINE), "posted");

  const entry = await postEntry(tx, {
    kind: "p2p_transfer",
    reference: `transfer:${params.transferId}`,
    occurredAt: params.now,
    idempotencyKey: params.idempotencyKey,
    description: "wallet transfer",
    lines: [
      {
        account: "wallet",
        walletId: params.senderWalletId,
        amount: money(-params.amount.amountMinor, params.amount.currency),
        counterpartRef: `transfer:${params.transferId}:to:${params.recipientWalletId}`,
      },
      {
        account: "wallet",
        walletId: params.recipientWalletId,
        amount: params.amount,
        counterpartRef: `transfer:${params.transferId}:from:${params.senderWalletId}`,
      },
    ],
  });

  await tx.transfer.create({
    data: {
      id: params.transferId,
      fromWallet: params.senderWalletId,
      toWallet: params.recipientWalletId,
      amountMinor: BigInt(params.amount.amountMinor),
      currency: params.amount.currency,
      note: params.note ?? null,
      status: "posted",
      entryId: entry.id,
      idempotencyKey: params.idempotencyKey,
    },
  });

  if (params.topupId !== null) {
    await tx.topup.update({
      where: { id: params.topupId },
      data: { sagaTransferId: params.transferId },
    });
  }

  await writeAudit(tx, {
    actor: params.actor,
    action: "wallet.transfer.posted",
    subjectType: "transfer",
    subjectId: params.transferId,
    after: {
      status: "posted",
      amountMinor: params.amount.amountMinor,
      currency: params.amount.currency,
      entryId: entry.id,
      sagaTopupId: params.topupId,
    },
  });

  await publishEvent(tx, {
    name: "transfer.posted",
    aggregateType: "transfer",
    aggregateId: params.transferId,
    fromVersion: null,
    toVersion: 1,
    actor: params.actor,
    actorType: "rider",
    cityId: params.cityId,
    idempotencyKey: `${params.idempotencyKey}:posted`,
    occurredAt: params.now,
    payload: {
      transferId: params.transferId,
      from: params.senderWalletId,
      to: params.recipientWalletId,
      amountMinor: params.amount.amountMinor,
      currency: params.amount.currency,
      counterpartRef: `transfer:${params.transferId}`,
    },
  });

  if (params.topupId !== null) {
    await publishEvent(tx, {
      name: "topup.captured",
      aggregateType: "wallet",
      aggregateId: params.senderWalletId,
      fromVersion: null,
      toVersion: 1,
      actor: params.actor,
      actorType: "rider",
      cityId: params.cityId,
      idempotencyKey: `${params.idempotencyKey}:topup.captured`,
      occurredAt: params.now,
      payload: { topupId: params.topupId, transferId: params.transferId },
    });
  }

  return {
    transferId: params.transferId,
    status: "posted",
    amount: params.amount,
    toUserId: params.toUserId,
    entryId: entry.id,
    riskReason: null,
    reviewCaseId: null,
    topupId: params.topupId,
    balanceAfter: await balanceOf(tx, params.senderWalletId, params.amount.currency),
    replayed: false,
    createdAt: params.now.toISOString(),
  };
}

interface HoldParams extends Omit<PostParams, "topupId"> {
  readonly reason: RiskReason;
  readonly slaMinutes: number;
}

async function holdTransfer(tx: LedgerTx, params: HoldParams): Promise<TransferResult> {
  assertTransition(TRANSFER_MACHINE, initialState(TRANSFER_MACHINE), "held_risk");

  await tx.transfer.create({
    data: {
      id: params.transferId,
      fromWallet: params.senderWalletId,
      toWallet: params.recipientWalletId,
      amountMinor: BigInt(params.amount.amountMinor),
      currency: params.amount.currency,
      note: params.note ?? null,
      status: "held_risk",
      riskHoldReason: params.reason,
      idempotencyKey: params.idempotencyKey,
    },
  });

  const review = await openRiskReviewCase(tx, {
    actor: params.actor,
    userId: params.actor.id,
    transferId: params.transferId,
    reason: params.reason,
    amountMinor: params.amount.amountMinor,
    currency: params.amount.currency,
    slaMinutes: params.slaMinutes,
    now: params.now,
  });

  await writeAudit(tx, {
    actor: params.actor,
    action: "wallet.transfer.held",
    subjectType: "transfer",
    subjectId: params.transferId,
    after: { status: "held_risk", reason: params.reason, caseId: review.caseId },
    reason: params.reason,
  });

  await publishEvent(tx, {
    name: "transfer.held",
    aggregateType: "transfer",
    aggregateId: params.transferId,
    fromVersion: null,
    toVersion: 1,
    actor: params.actor,
    actorType: "rider",
    cityId: params.cityId,
    idempotencyKey: `${params.idempotencyKey}:held`,
    occurredAt: params.now,
    payload: {
      transferId: params.transferId,
      from: params.senderWalletId,
      to: params.recipientWalletId,
      amountMinor: params.amount.amountMinor,
      currency: params.amount.currency,
      counterpartRef: `case:${review.caseId}`,
    },
  });

  return {
    transferId: params.transferId,
    status: "held_risk",
    amount: params.amount,
    toUserId: params.toUserId,
    entryId: null,
    riskReason: params.reason,
    reviewCaseId: review.caseId,
    topupId: null,
    balanceAfter: await balanceOf(tx, params.senderWalletId, params.amount.currency),
    replayed: false,
    createdAt: params.now.toISOString(),
  };
}

interface FailureParams {
  readonly error: unknown;
  readonly capture: CapturedTopup | null;
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly senderWalletId: string;
  readonly recipientWalletId: string;
  readonly toUserId: string;
  readonly amount: Money;
  readonly note: string | undefined;
  readonly idempotencyKey: string;
  readonly slaMinutes: number;
  readonly now: Date;
}

/**
 * Compensation. The ledger transaction rolled back, so the wallet is exactly
 * as it was; the only thing left outside the database is the rail capture, and
 * it is refunded here before the caller is told what happened.
 */
async function handleTransferFailure(
  deps: WalletDeps,
  params: FailureParams,
): Promise<TransferResult> {
  const original =
    params.error instanceof SagaAbort ? params.error.cause : params.error;

  // Lost an idempotency race: the winner has already posted under this key, so
  // the answer is its result. The rail capture is *not* compensated — both
  // calls carried the same rail idempotency key and therefore refer to the one
  // capture the winner's entry accounts for.
  if (isIdempotencyRace(original)) {
    const winner = await findByIdempotency(deps, params.idempotencyKey);
    if (winner !== null) {
      return deps.db.$transaction((tx) => replayOutcome(tx, winner, params.toUserId));
    }
  }

  if (params.capture !== null) {
    const rail = requireRail(deps.topupRail, "top-up");
    await rail.refund(params.capture.pspRef, `${params.capture.idempotencyKey}:refund`);
    walletLogger.warn(
      {
        transferId: params.transferId,
        amountMinor: params.capture.amount.amountMinor,
        currency: params.capture.amount.currency,
      },
      "saga rolled back; top-up capture compensated",
    );
  }

  if (original instanceof ContractError && original.code === "risk_hold") {
    return deps.db.$transaction((tx) =>
      holdTransfer(tx, {
        actor: params.actor,
        cityId: params.cityId,
        transferId: params.transferId,
        senderWalletId: params.senderWalletId,
        recipientWalletId: params.recipientWalletId,
        toUserId: params.toUserId,
        amount: params.amount,
        note: params.note,
        idempotencyKey: params.idempotencyKey,
        reason: (original.details?.reason as RiskReason | undefined) ?? "new_recipient",
        slaMinutes: params.slaMinutes,
        now: params.now,
      }),
    );
  }

  if (original instanceof ContractError && original.code === "limit_exceeded") {
    await recordRejection(deps, {
      actor: params.actor,
      transferId: params.transferId,
      fromWalletId: params.senderWalletId,
      toWalletId: params.recipientWalletId,
      amount: params.amount,
      note: params.note,
      idempotencyKey: params.idempotencyKey,
      status: "rejected_limit",
      reason: original.message,
    });
  }

  throw original;
}
