/**
 * Split-fare requests: one rider asks another to pay a share.
 *
 * A request moves no money by itself. Only the payer, with their PIN, turns a
 * request into a posted entry — the requester can never pull from someone
 * else's wallet.
 */
import {
  ContractError,
  type Money,
  money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { verifyWalletPin } from "./authorize";
import { balanceOf } from "./balances";
import { assertFlagEnabled } from "./city-config";
import { lockWallet, type WalletDeps } from "./context";
import { isIdempotencyRace } from "./idempotency";
import {
  assertSufficientFunds,
  assertWithinLimits,
  limitStatus,
} from "./limits";
import { fromDbMinor } from "./minor-units";
import { assertPinShape } from "./pin";
import { postEntry } from "./post-entry";
import { assertNotLocked, assertNotSafeMode, ensureWallet } from "./wallets";
import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "./types";

/**
 * `transfer_requests` has no machine in contracts/state-machines.json, so the
 * legal moves are declared here and asserted the same way.
 */
const REQUEST_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending: ["paid", "cancelled", "expired"],
  paid: [],
  cancelled: [],
  expired: [],
};

function assertRequestTransition(from: string, to: string): void {
  const allowed = REQUEST_TRANSITIONS[from];
  if (allowed === undefined) {
    throw new ContractError(
      "illegal_transition",
      `unknown request state "${from}"`,
    );
  }
  if (!allowed.includes(to)) {
    throw new ContractError(
      "illegal_transition",
      `a ${from} request cannot become ${to}`,
      { from, to, allowed },
    );
  }
}

export interface CreateRequestInput {
  readonly actor: Actor;
  readonly cityId: string;
  /** The person being asked to pay. */
  readonly fromUserId: string;
  readonly amountMinor: number;
  readonly rideId?: string | undefined;
  readonly idempotencyKey: string;
}

export interface RequestResult {
  readonly requestId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amount: Money;
  readonly rideId: string | null;
  readonly status: string;
  readonly replayed: boolean;
}

export async function createRequest(
  deps: WalletDeps,
  input: CreateRequestInput,
): Promise<RequestResult> {
  const now = deps.now();
  const key = scopedIdempotencyKey(
    "wallet.request",
    input.actor.id,
    input.idempotencyKey,
  );

  const existing = await deps.db.transferRequest.findUnique({
    where: { idempotencyKey: key },
  });
  if (existing !== null) {
    return {
      requestId: existing.id,
      fromUserId: existing.fromUser,
      toUserId: existing.toUser,
      amount: money(fromDbMinor(existing.amountMinor), existing.currency),
      rideId: existing.rideId,
      status: existing.status,
      replayed: true,
    };
  }

  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");

  if (input.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "amount must be greater than zero",
    );
  }
  if (input.fromUserId === input.actor.id) {
    throw new ContractError(
      "validation_failed",
      "a rider cannot bill themselves",
    );
  }
  const payer = await deps.directory.byUserId(input.fromUserId);
  if (payer === null) {
    throw new ContractError("recipient_not_found", "no such rider");
  }

  const amount = money(input.amountMinor, config.city.currency);
  const requestId = generateId("req");

  return deps.db.$transaction(async (tx) => {
    await tx.transferRequest.create({
      data: {
        id: requestId,
        fromUser: input.fromUserId,
        toUser: input.actor.id,
        amountMinor: BigInt(amount.amountMinor),
        currency: amount.currency,
        rideId: input.rideId ?? null,
        status: "pending",
        idempotencyKey: key,
      },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "wallet.request.created",
      subjectType: "transfer",
      subjectId: requestId,
      after: {
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        rideId: input.rideId ?? null,
      },
    });

    await publishEvent(tx, {
      name: "request.created",
      aggregateType: "transfer",
      aggregateId: requestId,
      fromVersion: null,
      toVersion: 1,
      actor: input.actor,
      actorType: "rider",
      cityId: input.cityId,
      idempotencyKey: `request.created:${requestId}`,
      occurredAt: now,
      payload: {
        requestId,
        from: input.fromUserId,
        to: input.actor.id,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        counterpartRef:
          input.rideId === undefined
            ? `request:${requestId}`
            : `ride:${input.rideId}`,
      },
    });

    return {
      requestId,
      fromUserId: input.fromUserId,
      toUserId: input.actor.id,
      amount,
      rideId: input.rideId ?? null,
      status: "pending",
      replayed: false,
    };
  });
}

export interface PayRequestInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly requestId: string;
  readonly pin: string;
  readonly idempotencyKey: string;
}

export interface PayRequestResult {
  readonly requestId: string;
  readonly transferId: string;
  readonly entryId: string;
  readonly amount: Money;
  readonly balanceAfter: Money;
  readonly replayed: boolean;
}

export async function payRequest(
  deps: WalletDeps,
  input: PayRequestInput,
): Promise<PayRequestResult> {
  const now = deps.now();
  const key = scopedIdempotencyKey(
    "wallet.request.pay",
    input.actor.id,
    input.idempotencyKey,
  );

  const replayed = await deps.db.transfer.findUnique({
    where: { idempotencyKey: key },
  });
  if (replayed !== null) {
    const balance =
      replayed.fromWallet === null
        ? money(0, replayed.currency)
        : await balanceOf(deps.db, replayed.fromWallet, replayed.currency);
    return {
      requestId: input.requestId,
      transferId: replayed.id,
      entryId: replayed.entryId ?? "",
      amount: money(fromDbMinor(replayed.amountMinor), replayed.currency),
      balanceAfter: balance,
      replayed: true,
    };
  }

  const config = await deps.config.loadForWallet(input.cityId);
  assertFlagEnabled(config.flags, "wallet_p2p");
  assertPinShape(input.pin);

  const request = await deps.db.transferRequest.findUnique({
    where: { id: input.requestId },
  });
  if (request === null) {
    throw new ContractError("not_found", "request not found");
  }
  if (request.fromUser !== input.actor.id) {
    throw new ContractError(
      "forbidden",
      "only the person billed may pay this request",
    );
  }

  const payerWallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", input.actor.id, config.city),
  );
  const payeeWallet = await deps.db.$transaction((tx) =>
    ensureWallet(tx, "user", request.toUser, config.city),
  );

  assertNotLocked(payerWallet);
  assertNotSafeMode(payerWallet, now);
  await verifyWalletPin(deps, input.actor, payerWallet, input.pin, config, now);

  const amount = money(fromDbMinor(request.amountMinor), request.currency);
  if (amount.currency !== config.city.currency) {
    throw new ContractError(
      "validation_failed",
      "this request is in a different currency from the city's wallet",
      { requestCurrency: amount.currency },
    );
  }

  const transferId = generateId("tr");

  const replayIfRaced = async (): Promise<PayRequestResult | null> => {
    const winner = await deps.db.transfer.findUnique({
      where: { idempotencyKey: key },
    });
    if (winner === null || winner.fromWallet === null) {
      return null;
    }
    return {
      requestId: request.id,
      transferId: winner.id,
      entryId: winner.entryId ?? "",
      amount: money(fromDbMinor(winner.amountMinor), winner.currency),
      balanceAfter: await balanceOf(
        deps.db,
        winner.fromWallet,
        winner.currency,
      ),
      replayed: true,
    };
  };

  try {
    return await deps.db.$transaction(async (tx) => {
      await lockWallet(tx, payerWallet.id);
      const fresh = await tx.transferRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      assertRequestTransition(fresh.status, "paid");

      const limits = await limitStatus(tx, payerWallet, config.city, now);
      assertWithinLimits(limits, amount);
      await assertSufficientFunds(tx, payerWallet, amount);

      const entry = await postEntry(tx, {
        kind: "request_payment",
        reference: `request:${request.id}`,
        occurredAt: now,
        idempotencyKey: key,
        description: "split-fare request paid",
        lines: [
          {
            account: "wallet",
            walletId: payerWallet.id,
            amount: money(-amount.amountMinor, amount.currency),
            counterpartRef: `request:${request.id}:to:${payeeWallet.id}`,
          },
          {
            account: "wallet",
            walletId: payeeWallet.id,
            amount,
            counterpartRef: `request:${request.id}:from:${payerWallet.id}`,
          },
        ],
      });

      await tx.transfer.create({
        data: {
          id: transferId,
          fromWallet: payerWallet.id,
          toWallet: payeeWallet.id,
          amountMinor: BigInt(amount.amountMinor),
          currency: amount.currency,
          note:
            fresh.rideId === null ? "split fare" : `split fare ${fresh.rideId}`,
          status: "posted",
          entryId: entry.id,
          idempotencyKey: key,
        },
      });

      const updated = await tx.transferRequest.updateMany({
        where: { id: request.id, status: "pending" },
        data: { status: "paid" },
      });
      if (updated.count !== 1) {
        throw new ContractError("conflict", "this request was already settled");
      }

      await writeAudit(tx, {
        actor: input.actor,
        action: "wallet.request.paid",
        subjectType: "transfer",
        subjectId: request.id,
        before: { status: "pending" },
        after: { status: "paid", transferId, entryId: entry.id },
      });

      await publishEvent(tx, {
        name: "request.paid",
        aggregateType: "transfer",
        aggregateId: request.id,
        fromVersion: null,
        toVersion: 1,
        actor: input.actor,
        actorType: "rider",
        cityId: input.cityId,
        idempotencyKey: `request.paid:${request.id}`,
        occurredAt: now,
        payload: {
          requestId: request.id,
          transferId,
          from: payerWallet.id,
          to: payeeWallet.id,
          amountMinor: amount.amountMinor,
          counterpartRef: `request:${request.id}`,
        },
      });

      return {
        requestId: request.id,
        transferId,
        entryId: entry.id,
        amount,
        balanceAfter: await balanceOf(tx, payerWallet.id, amount.currency),
        replayed: false,
      };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const winner = await replayIfRaced();
      if (winner !== null) {
        return winner;
      }
    }
    throw error;
  }
}

/** Exposed so the route can list what a rider owes and is owed. */
export async function listRequests(
  tx: LedgerTx,
  userId: string,
): Promise<{
  readonly owed: readonly RequestResult[];
  readonly owing: readonly RequestResult[];
}> {
  const rows = await tx.transferRequest.findMany({
    where: {
      OR: [{ fromUser: userId }, { toUser: userId }],
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const map = (row: (typeof rows)[number]): RequestResult => ({
    requestId: row.id,
    fromUserId: row.fromUser,
    toUserId: row.toUser,
    amount: money(fromDbMinor(row.amountMinor), row.currency),
    rideId: row.rideId,
    status: row.status,
    replayed: false,
  });
  return {
    owing: rows.filter((row) => row.fromUser === userId).map(map),
    owed: rows.filter((row) => row.toUser === userId).map(map),
  };
}
