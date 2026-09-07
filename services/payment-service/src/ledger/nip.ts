/**
 * NIP bank payouts.
 *
 * Name enquiry runs first so the sender sees who they are paying before the
 * money leaves. The wallet is debited when the instruction is accepted — the
 * value sits in `bank_settlement` until the bank confirms. Callbacks are
 * verified, idempotent, and safe out of order: a reversal that arrives before
 * the confirmation is applied, and the late confirmation is then ignored rather
 * than resurrecting a payout that has already been unwound.
 */
import { ContractError, type Money, money, scopedIdempotencyKey } from "@ubi/contracts";

import { walletLogger } from "../lib/logger";
import { generateId } from "../lib/utils";

import { publishEvent, writeAudit } from "./audit";
import { verifyWalletPin } from "./authorize";
import { balanceOf } from "./balances";
import { assertFlagEnabled } from "./city-config";
import { lockWallet, type WalletDeps } from "./context";
import { assertSufficientFunds, assertWithinLimits, limitStatus } from "./limits";
import { fromDbMinor } from "./minor-units";
import { assertPinShape } from "./pin";
import { postEntry } from "./post-entry";
import { requireRail } from "./providers";
import type { Actor, LedgerTx } from "./types";
import {
  assertNotLocked,
  assertNotSafeMode,
  ensureWallet,
} from "./wallets";

export const NIP_STATUSES = ["pending", "confirmed", "reversed"] as const;
export type NipStatus = (typeof NIP_STATUSES)[number];

/**
 * `nip_transfers` has no machine in contracts/state-machines.json; the legal
 * moves are declared here so an out-of-order callback is refused rather than
 * silently applied.
 */
const NIP_TRANSITIONS: Readonly<Record<NipStatus, readonly NipStatus[]>> = {
  pending: ["confirmed", "reversed"],
  confirmed: ["reversed"],
  reversed: [],
};

function canMove(from: string, to: NipStatus): boolean {
  const allowed = NIP_TRANSITIONS[from as NipStatus];
  return allowed !== undefined && allowed.includes(to);
}

export interface NipEnquiryResult {
  readonly accountName: string;
  readonly sessionId: string;
}

export interface CreateNipInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly bankCode: string;
  readonly accountNumber: string;
  readonly amountMinor: number;
  readonly pin: string;
  readonly idempotencyKey: string;
}

export interface NipResult {
  readonly nipTransferId: string;
  readonly status: NipStatus;
  readonly accountName: string;
  readonly amount: Money;
  readonly entryId: string | null;
  readonly balanceAfter: Money;
  readonly replayed: boolean;
}

/** Name enquiry on its own, so the app can show the account holder first. */
export async function nameEnquiry(
  deps: WalletDeps,
  cityId: string,
  bankCode: string,
  accountNumber: string,
): Promise<NipEnquiryResult> {
  const config = await deps.config.loadForWallet(cityId);
  assertFlagEnabled(config.flags, "wallet_nip");
  const rail = requireRail(deps.bankRail, "bank");
  const result = await rail.nameEnquiry({ bankCode, accountNumber });
  if (result === null) {
    throw new ContractError("recipient_not_found", "that account could not be found");
  }
  return { accountName: result.accountName, sessionId: result.sessionId };
}

export async function createNipTransfer(
  deps: WalletDeps,
  input: CreateNipInput,
): Promise<NipResult> {
  const now = deps.now();
  const key = scopedIdempotencyKey("wallet.nip", input.actor.id, input.idempotencyKey);

  const existing = await deps.db.nipTransfer.findUnique({ where: { idempotencyKey: key } });
  if (existing !== null) {
    return {
      nipTransferId: existing.id,
      status: existing.status as NipStatus,
      accountName: existing.accountName ?? "",
      amount: money(fromDbMinor(existing.amountMinor), existing.currency),
      entryId: existing.entryId,
      balanceAfter: await balanceOf(deps.db, existing.walletId, existing.currency),
      replayed: true,
    };
  }

  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_nip");
  assertPinShape(input.pin);
  if (input.amountMinor <= 0) {
    throw new ContractError("validation_failed", "amount must be greater than zero");
  }

  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", input.actor.id, config.city),
  );
  assertNotLocked(wallet);
  assertNotSafeMode(wallet, now);
  await verifyWalletPin(deps, input.actor, wallet, input.pin, config, now);

  // Name enquiry first — before any money moves.
  const rail = requireRail(deps.bankRail, "bank");
  const enquiry = await rail.nameEnquiry({
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
  });
  if (enquiry === null) {
    throw new ContractError("recipient_not_found", "that account could not be found");
  }

  const amount = money(input.amountMinor, config.city.currency);
  const nipId = generateId("nip");

  const prepared = await deps.db.$transaction(async (tx) => {
    await lockWallet(tx, wallet.id);
    const limits = await limitStatus(tx, wallet, config.city, now);
    assertWithinLimits(limits, amount);
    await assertSufficientFunds(tx, wallet, amount);

    const entry = await postEntry(tx, {
      kind: "nip_transfer",
      reference: `nip:${nipId}`,
      occurredAt: now,
      idempotencyKey: key,
      description: "bank transfer instructed",
      lines: [
        {
          account: "wallet",
          walletId: wallet.id,
          amount: money(-amount.amountMinor, amount.currency),
          counterpartRef: `nip:${nipId}`,
        },
        {
          account: "bank_settlement",
          amount,
          counterpartRef: `wallet:${wallet.id}`,
        },
      ],
    });

    await tx.nipTransfer.create({
      data: {
        id: nipId,
        walletId: wallet.id,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: enquiry.accountName,
        amountMinor: BigInt(amount.amountMinor),
        currency: amount.currency,
        status: "pending",
        sessionId: enquiry.sessionId,
        entryId: entry.id,
        idempotencyKey: key,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.nip.pending",
      subjectType: "wallet",
      subjectId: wallet.id,
      after: {
        nipTransferId: nipId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        bankCode: input.bankCode,
        entryId: entry.id,
      },
    });

    await publishEvent(tx, {
      name: "nip.pending",
      aggregateType: "wallet",
      aggregateId: wallet.id,
      fromVersion: null,
      toVersion: 1,
      actor: input.actor,
      actorType: "rider",
      cityId: input.cityId,
      idempotencyKey: `nip.pending:${nipId}`,
      occurredAt: now,
      payload: {
        nipTransferId: nipId,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        counterpartRef: `nip:${nipId}`,
      },
    });

    return {
      entryId: entry.id,
      balanceAfter: await balanceOf(tx, wallet.id, amount.currency),
    };
  });

  // The instruction goes to the bank only after the debit is committed, so a
  // payout can never exist that the ledger does not know about.
  await rail.sendPayout({
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    accountName: enquiry.accountName,
    amount,
    reference: `nip:${nipId}`,
    idempotencyKey: key,
  });

  return {
    nipTransferId: nipId,
    status: "pending",
    accountName: enquiry.accountName,
    amount,
    entryId: prepared.entryId,
    balanceAfter: prepared.balanceAfter,
    replayed: false,
  };
}

export interface NipCallback {
  readonly sessionId: string;
  readonly status: "confirmed" | "reversed";
  readonly reference: string;
  readonly reason?: string | undefined;
}

export interface NipCallbackResult {
  readonly nipTransferId: string;
  readonly status: NipStatus;
  readonly applied: boolean;
  readonly ignoredReason: string | null;
  readonly entryId: string | null;
}

/**
 * Applies a verified bank callback. Delivering the same callback twice is a
 * no-op; a confirmation that arrives after a reversal is recorded and ignored.
 */
export async function applyNipCallback(
  deps: WalletDeps,
  cityId: string,
  callback: NipCallback,
): Promise<NipCallbackResult> {
  const now = deps.now();
  const actor: Actor = { id: "bank-webhook", role: "system" };

  return deps.db.$transaction(async (tx) => {
    const transfer = await tx.nipTransfer.findFirst({
      where: { sessionId: callback.sessionId },
    });
    if (transfer === null) {
      throw new ContractError("not_found", "no bank transfer matches that session");
    }

    if (transfer.status === callback.status) {
      return {
        nipTransferId: transfer.id,
        status: transfer.status as NipStatus,
        applied: false,
        ignoredReason: "duplicate_delivery",
        entryId: transfer.entryId,
      };
    }

    if (!canMove(transfer.status, callback.status)) {
      // Out of order: the payout has already been unwound. Record the fact and
      // leave the ledger alone.
      await writeAudit(tx, {
        actor,
        action: "wallet.nip.callback_ignored",
        subjectType: "wallet",
        subjectId: transfer.walletId,
        before: { status: transfer.status },
        after: { attempted: callback.status },
        reason: "out_of_order_callback",
      });
      walletLogger.warn(
        { nipTransferId: transfer.id, from: transfer.status, to: callback.status },
        "out-of-order bank callback ignored",
      );
      return {
        nipTransferId: transfer.id,
        status: transfer.status as NipStatus,
        applied: false,
        ignoredReason: "out_of_order",
        entryId: transfer.entryId,
      };
    }

    if (callback.status === "confirmed") {
      await tx.nipTransfer.update({
        where: { id: transfer.id },
        data: { status: "confirmed", confirmedAt: now },
      });
      await writeAudit(tx, {
        actor,
        action: "wallet.nip.confirmed",
        subjectType: "wallet",
        subjectId: transfer.walletId,
        before: { status: transfer.status },
        after: { status: "confirmed", nipTransferId: transfer.id },
      });
      await publishEvent(tx, {
        name: "nip.confirmed",
        aggregateType: "wallet",
        aggregateId: transfer.walletId,
        fromVersion: null,
        toVersion: 1,
        actor,
        actorType: "system",
        cityId,
        idempotencyKey: `nip.confirmed:${transfer.id}`,
        occurredAt: now,
        payload: {
          nipTransferId: transfer.id,
          amountMinor: fromDbMinor(transfer.amountMinor),
          currency: transfer.currency,
          counterpartRef: `nip:${transfer.id}`,
        },
      });
      return {
        nipTransferId: transfer.id,
        status: "confirmed" as const,
        applied: true,
        ignoredReason: null,
        entryId: transfer.entryId,
      };
    }

    const amount = money(fromDbMinor(transfer.amountMinor), transfer.currency);
    const entry = await postReversal(tx, transfer.id, transfer.walletId, amount, now);

    await tx.nipTransfer.update({
      where: { id: transfer.id },
      data: { status: "reversed", reversedAt: now },
    });
    await writeAudit(tx, {
      actor,
      action: "wallet.nip.reversed",
      subjectType: "wallet",
      subjectId: transfer.walletId,
      before: { status: transfer.status },
      after: { status: "reversed", entryId: entry },
      reason: callback.reason ?? null,
    });
    await publishEvent(tx, {
      name: "nip.reversed",
      aggregateType: "wallet",
      aggregateId: transfer.walletId,
      fromVersion: null,
      toVersion: 1,
      actor,
      actorType: "system",
      cityId,
      idempotencyKey: `nip.reversed:${transfer.id}`,
      occurredAt: now,
      payload: {
        nipTransferId: transfer.id,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        counterpartRef: `nip:${transfer.id}`,
      },
    });

    return {
      nipTransferId: transfer.id,
      status: "reversed" as const,
      applied: true,
      ignoredReason: null,
      entryId: entry,
    };
  });
}

async function postReversal(
  tx: LedgerTx,
  nipId: string,
  walletId: string,
  amount: Money,
  now: Date,
): Promise<string> {
  const entry = await postEntry(tx, {
    kind: "nip_reversal",
    reference: `nip:${nipId}`,
    occurredAt: now,
    idempotencyKey: `nip.reversal:${nipId}`,
    description: "bank returned the transfer",
    lines: [
      {
        account: "bank_settlement",
        amount: money(-amount.amountMinor, amount.currency),
        counterpartRef: `wallet:${walletId}`,
      },
      {
        account: "wallet",
        walletId,
        amount,
        counterpartRef: `nip:${nipId}:reversal`,
      },
    ],
  });
  return entry.id;
}
