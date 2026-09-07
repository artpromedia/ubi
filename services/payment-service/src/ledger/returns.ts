/**
 * Return requests, consent and disputes.
 *
 * A posted transfer is never pulled back unilaterally (CLAUDE.md #7). The
 * sender may *ask*; only the recipient's consent produces the reversing entry.
 * If the recipient declines, the sender's remaining route is a dispute — which
 * a human decides, and which still ends in a journal entry, never in an edit to
 * the original one.
 */
import {
  assertTransition,
  ContractError,
  type Money,
  money,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { assertFlagEnabled } from "./city-config";
import { fromDbMinor } from "./minor-units";
import { postEntry } from "./post-entry";
import { generateId } from "../lib/utils";

import type { WalletDeps } from "./context";
import type { Actor, LedgerTx } from "./types";


const TRANSFER_MACHINE = "walletTransfer" as const;

export const RETURN_STATUSES = ["requested", "returned", "declined", "disputed"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface ReturnRequestResult {
  readonly returnRequestId: string;
  readonly transferId: string;
  readonly status: ReturnStatus;
  readonly transferStatus: string;
  readonly amount: Money;
  readonly entryId: string | null;
}

interface LoadedTransfer {
  readonly id: string;
  readonly fromWallet: string | null;
  readonly toWallet: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly version: number;
  readonly createdAt: Date;
}

async function loadTransfer(tx: LedgerTx, transferId: string): Promise<LoadedTransfer> {
  const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
  if (transfer === null) {
    throw new ContractError("not_found", "transfer not found", { transferId });
  }
  return transfer;
}

async function walletOwner(tx: LedgerTx, walletId: string): Promise<string> {
  const wallet = await tx.wallet.findUnique({
    where: { id: walletId },
    select: { ownerId: true },
  });
  if (wallet === null) {
    throw new ContractError("not_found", "wallet not found", { walletId });
  }
  return wallet.ownerId;
}

/** Optimistic-concurrency status change; the machine decides what is legal. */
async function moveTransfer(
  tx: LedgerTx,
  transfer: LoadedTransfer,
  next: string,
): Promise<void> {
  assertTransition(TRANSFER_MACHINE, transfer.status, next);
  const updated = await tx.transfer.updateMany({
    where: { id: transfer.id, version: transfer.version },
    data: { status: next, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new ContractError("version_conflict", "the transfer changed underneath us", {
      transferId: transfer.id,
    });
  }
}

export interface OpenReturnInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly reason?: string | undefined;
}

/** The sender asks the recipient to send the money back. Nothing moves yet. */
export async function openReturnRequest(
  deps: WalletDeps,
  input: OpenReturnInput,
): Promise<ReturnRequestResult> {
  const now = deps.now();
  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");

  return deps.db.$transaction(async (tx) => {
    const transfer = await loadTransfer(tx, input.transferId);
    if (transfer.fromWallet === null) {
      throw new ContractError("not_found", "transfer has no sender wallet");
    }
    const senderId = await walletOwner(tx, transfer.fromWallet);
    if (senderId !== input.actor.id) {
      throw new ContractError("forbidden", "only the sender may ask for a return");
    }

    const deadline = new Date(
      transfer.createdAt.getTime() + config.policy.returnRequestWindowHours * 3_600_000,
    );
    if (now > deadline) {
      throw new ContractError(
        "conflict",
        "the window for asking the recipient to return this transfer has closed",
        { closedAt: deadline.toISOString() },
      );
    }

    await moveTransfer(tx, transfer, "return_requested");

    const returnRequestId = generateId("ret");
    await tx.returnRequest.create({
      data: {
        id: returnRequestId,
        transferId: transfer.id,
        status: "requested",
        reason: input.reason ?? null,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.transfer.return_requested",
      subjectType: "transfer",
      subjectId: transfer.id,
      before: { status: transfer.status },
      after: { status: "return_requested", returnRequestId },
      reason: input.reason ?? null,
    });

    await publishEvent(tx, {
      name: "transfer.return_requested",
      aggregateType: "transfer",
      aggregateId: transfer.id,
      fromVersion: transfer.version,
      toVersion: transfer.version + 1,
      actor: input.actor,
      actorType: "rider",
      cityId: input.cityId,
      idempotencyKey: `transfer.return_requested:${returnRequestId}`,
      occurredAt: now,
      payload: {
        transferId: transfer.id,
        from: transfer.fromWallet,
        to: transfer.toWallet,
        amountMinor: fromDbMinor(transfer.amountMinor),
        counterpartRef: `return:${returnRequestId}`,
      },
    });

    return {
      returnRequestId,
      transferId: transfer.id,
      status: "requested" as const,
      transferStatus: "return_requested",
      amount: money(fromDbMinor(transfer.amountMinor), transfer.currency),
      entryId: null,
    };
  });
}

export interface RespondToReturnInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly returnRequestId: string;
  readonly consent: boolean;
  readonly reason?: string | undefined;
}

/**
 * The recipient answers. Consent posts the reversing entry; a decline leaves
 * the money exactly where it is and opens the dispute route for the sender.
 */
export async function respondToReturnRequest(
  deps: WalletDeps,
  input: RespondToReturnInput,
): Promise<ReturnRequestResult> {
  const now = deps.now();
  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");

  return deps.db.$transaction(async (tx) => {
    const transfer = await loadTransfer(tx, input.transferId);
    if (transfer.fromWallet === null || transfer.toWallet === null) {
      throw new ContractError("not_found", "transfer has no wallets");
    }
    const recipientId = await walletOwner(tx, transfer.toWallet);
    if (recipientId !== input.actor.id) {
      throw new ContractError(
        "return_not_consented",
        "only the recipient may agree to return a posted transfer",
      );
    }

    const request = await tx.returnRequest.findUnique({
      where: { id: input.returnRequestId },
    });
    if (request === null || request.transferId !== transfer.id) {
      throw new ContractError("not_found", "return request not found");
    }
    if (request.status !== "requested") {
      throw new ContractError("conflict", "this return request was already answered", {
        status: request.status,
      });
    }

    const amount = money(fromDbMinor(transfer.amountMinor), transfer.currency);

    if (!input.consent) {
      await moveTransfer(tx, transfer, "declined_by_recipient");
      await tx.returnRequest.update({
        where: { id: request.id },
        data: { status: "declined", reason: input.reason ?? request.reason },
      });
      await writeAudit(tx, {
        actor: input.actor,
        action: "wallet.transfer.return_declined",
        subjectType: "transfer",
        subjectId: transfer.id,
        before: { status: transfer.status },
        after: { status: "declined_by_recipient" },
        reason: input.reason ?? null,
      });
      return {
        returnRequestId: request.id,
        transferId: transfer.id,
        status: "declined" as const,
        transferStatus: "declined_by_recipient",
        amount,
        entryId: null,
      };
    }

    const entry = await reverseTransfer(tx, {
      actor: input.actor,
      cityId: input.cityId,
      transferId: transfer.id,
      fromWalletId: transfer.fromWallet,
      toWalletId: transfer.toWallet,
      amount,
      reference: `return:${request.id}`,
      now,
    });

    await moveTransfer(tx, transfer, "reversed");
    await tx.returnRequest.update({
      where: { id: request.id },
      data: { status: "returned" },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.transfer.returned",
      subjectType: "transfer",
      subjectId: transfer.id,
      before: { status: transfer.status },
      after: { status: "reversed", entryId: entry },
      reason: input.reason ?? null,
    });

    return {
      returnRequestId: request.id,
      transferId: transfer.id,
      status: "returned" as const,
      transferStatus: "reversed",
      amount,
      entryId: entry,
    };
  });
}

interface ReverseInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly fromWalletId: string;
  readonly toWalletId: string;
  readonly amount: Money;
  readonly reference: string;
  readonly now: Date;
  readonly caseRef?: string | null;
}

/** The reversal is a new entry. The original entry is never touched. */
async function reverseTransfer(tx: LedgerTx, input: ReverseInput): Promise<string> {
  const entry = await postEntry(tx, {
    kind: "p2p_reversal",
    reference: input.reference,
    occurredAt: input.now,
    idempotencyKey: `reversal:${input.reference}`,
    caseRef: input.caseRef ?? null,
    description: "wallet transfer reversed with the recipient's consent",
    lines: [
      {
        account: "wallet",
        walletId: input.toWalletId,
        amount: money(-input.amount.amountMinor, input.amount.currency),
        counterpartRef: `${input.reference}:from:${input.toWalletId}`,
      },
      {
        account: "wallet",
        walletId: input.fromWalletId,
        amount: input.amount,
        counterpartRef: `${input.reference}:to:${input.fromWalletId}`,
      },
    ],
  });

  await publishEvent(tx, {
    name: "transfer.reversed",
    aggregateType: "transfer",
    aggregateId: input.transferId,
    fromVersion: null,
    toVersion: 1,
    actor: input.actor,
    actorType: "rider",
    cityId: input.cityId,
    idempotencyKey: `transfer.reversed:${input.reference}`,
    occurredAt: input.now,
    payload: {
      transferId: input.transferId,
      from: input.toWalletId,
      to: input.fromWalletId,
      amountMinor: input.amount.amountMinor,
      counterpartRef: input.reference,
    },
  });

  return entry.id;
}

export interface DisputeInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly transferId: string;
  readonly reason: string;
}

export interface DisputeResult {
  readonly transferId: string;
  readonly transferStatus: string;
  readonly caseId: string;
}

/**
 * After a decline the sender may dispute, inside the city's dispute window. A
 * dispute opens a case for a human — it does not move money by itself.
 */
export async function disputeTransfer(
  deps: WalletDeps,
  input: DisputeInput,
): Promise<DisputeResult> {
  const now = deps.now();
  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");

  return deps.db.$transaction(async (tx) => {
    const transfer = await loadTransfer(tx, input.transferId);
    if (transfer.fromWallet === null) {
      throw new ContractError("not_found", "transfer has no sender wallet");
    }
    const senderId = await walletOwner(tx, transfer.fromWallet);
    if (senderId !== input.actor.id) {
      throw new ContractError("forbidden", "only the sender may dispute this transfer");
    }

    const deadline = new Date(
      transfer.createdAt.getTime() + config.policy.disputeWindowHours * 3_600_000,
    );
    if (now > deadline) {
      throw new ContractError("conflict", "the dispute window has closed", {
        closedAt: deadline.toISOString(),
      });
    }

    await moveTransfer(tx, transfer, "disputed");

    const caseId = generateId("case");
    await tx.supportCase.create({
      data: {
        id: caseId,
        userType: "rider",
        userId: input.actor.id,
        subjectType: "transfer",
        subjectId: transfer.id,
        category: "wallet_transfer_dispute",
        status: "open",
        slaDue: new Date(now.getTime() + config.policy.riskReviewSlaMinutes * 60_000),
      },
    });
    await tx.caseEvent.create({
      data: {
        id: generateId("cev"),
        caseId,
        kind: "wallet.transfer_disputed",
        payload: {
          transferId: transfer.id,
          amountMinor: fromDbMinor(transfer.amountMinor),
          currency: transfer.currency,
        },
        actor: input.actor.id,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.transfer.disputed",
      subjectType: "transfer",
      subjectId: transfer.id,
      before: { status: transfer.status },
      after: { status: "disputed", caseId },
      reason: input.reason,
    });

    return { transferId: transfer.id, transferStatus: "disputed", caseId };
  });
}
