/**
 * Standalone wallet top-ups.
 *
 * The capture happens at the rail first and the ledger entry second, so the
 * journal never claims money that was not taken. A capture whose entry cannot
 * be committed is compensated with a refund at the rail.
 */
import {
  ContractError,
  type Money,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { walletLogger } from "../lib/logger";
import { generateId } from "../lib/utils";

import { publishEvent, writeAudit } from "./audit";
import { balanceOf } from "./balances";
import { assertFlagEnabled } from "./city-config";
import type { WalletDeps } from "./context";
import { assertWithinBalanceCap, limitStatus } from "./limits";
import { fromDbMinor } from "./minor-units";
import { postEntry } from "./post-entry";
import { requireRail } from "./providers";
import type { Actor } from "./types";
import { assertNotLocked, ensureWallet } from "./wallets";

export interface TopupInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly methodId: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
}

export interface TopupResult {
  readonly topupId: string;
  readonly amount: Money;
  readonly status: string;
  readonly entryId: string | null;
  readonly balanceAfter: Money;
  readonly replayed: boolean;
}

export async function createTopup(
  deps: WalletDeps,
  input: TopupInput,
): Promise<TopupResult> {
  const now = deps.now();
  const key = scopedIdempotencyKey("wallet.topup", input.actor.id, input.idempotencyKey);

  const existing = await deps.db.topup.findUnique({ where: { idempotencyKey: key } });
  if (existing !== null) {
    return {
      topupId: existing.id,
      amount: money(fromDbMinor(existing.amountMinor), existing.currency),
      status: existing.status,
      entryId: existing.entryId,
      balanceAfter: await balanceOf(deps.db, existing.walletId, existing.currency),
      replayed: true,
    };
  }

  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");

  if (input.amountMinor <= 0) {
    throw new ContractError("validation_failed", "amount must be greater than zero");
  }
  const method = config.city.paymentMethods.find((entry) => entry.id === input.methodId);
  if (method === undefined || !method.available) {
    throw new ContractError(
      "payment_method_unavailable",
      method?.reason ?? "that payment method is not available in this city",
      { methodId: input.methodId },
    );
  }

  const wallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", input.actor.id, config.city),
  );
  assertNotLocked(wallet);

  const amount = money(input.amountMinor, config.city.currency);
  const limits = await limitStatus(deps.db, wallet, config.city, now);
  await assertWithinBalanceCap(deps.db, wallet, amount, limits);

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
        description: "wallet top-up",
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

      await writeAudit(tx, {
        actor: input.actor,
        action: "wallet.topup.captured",
        subjectType: "wallet",
        subjectId: wallet.id,
        after: {
          topupId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          methodId: input.methodId,
          entryId: entry.id,
        },
      });

      await publishEvent(tx, {
        name: "topup.captured",
        aggregateType: "wallet",
        aggregateId: wallet.id,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType: "rider",
        cityId: input.cityId,
        idempotencyKey: `topup.captured:${topupId}`,
        occurredAt: now,
        payload: {
          topupId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          counterpartRef: `topup:${topupId}`,
        },
      });

      return {
        topupId,
        amount,
        status: "captured",
        entryId: entry.id,
        balanceAfter: await balanceOf(tx, wallet.id, amount.currency),
        replayed: false,
      };
    });
  } catch (error) {
    await rail.refund(capture.pspRef, `${key}:refund`);
    walletLogger.warn(
      { topupId, amountMinor: amount.amountMinor, currency: amount.currency },
      "top-up entry did not commit; capture compensated",
    );
    throw error;
  }
}
