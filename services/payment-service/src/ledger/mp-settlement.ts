/**
 * Marketplace completion settlement (M06) — the wire endpoint's brain.
 *
 * The marketplace engine calls POST /v1/wallet/mp/settlements when a
 * negotiated-fare execution completes. The 10% commission was already
 * captured at selection (`captureHold`), so this settlement NEVER charges the
 * fee again:
 *  - wallet trip: debit the rider the agreed fare, credit the driver the FULL
 *    fare (tips bypass commission on their own `tips` lines);
 *  - cash trip: the driver already holds the fare, so nothing posts except a
 *    wallet tip — and the answer is still `{settled: true, method: "cash"}`.
 *
 * Idempotent ON THE AWARD ID, following the ledger's conventions: the journal
 * entry (when one posts) and the outbox event both carry a settlement key
 * derived from the award, each behind its own unique `idempotency_key`
 * column, so however many times completion is retried the fare moves at most
 * once and every caller gets the original outcome back.
 *
 * When the rider cannot cover a wallet fare the debit refuses with the
 * canonical `insufficient_funds` / `insufficient_spendable` error and the
 * whole transaction rolls back: nothing is recorded, so the settlement stays
 * RETRYABLE. Chasing the rider (dunning, partial recovery, blocking the
 * account) is deliberately ops scope — the ledger never fakes a settlement it
 * could not fund.
 */
import {
  ContractError,
  type Money,
  scopedIdempotencyKey,
} from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { isIdempotencyRace } from "./idempotency";
import {
  postMarketplaceCompletion,
  type RidePaymentMethod,
} from "./ride-posting";
import { ensureWallet } from "./wallets";

import type { WalletDeps } from "./context";
import type { Actor } from "./types";

const MP_SERVICE_ACTOR: Actor = { id: "marketplace-engine", role: "service" };

export interface MarketplaceSettlementInput {
  readonly awardId: string;
  readonly executionRef: {
    readonly service: "ride" | "delivery";
    readonly id: string;
  };
  readonly requesterId: string;
  readonly driverId: string;
  readonly fareMinor: Money;
  readonly tipMinor?: Money | undefined;
  readonly method: RidePaymentMethod;
  readonly cityId: string;
}

export interface MarketplaceSettlementResult {
  readonly settled: true;
  readonly method: RidePaymentMethod;
  /** Null when nothing posted (a plain cash trip with no wallet tip). */
  readonly journalEntryId: string | null;
  readonly replayed: boolean;
}

function settlementKey(awardId: string): string {
  return scopedIdempotencyKey(
    "wallet.mp_settlement.settle",
    MP_SERVICE_ACTOR.id,
    `award:${awardId}`,
  );
}

interface SettledEventPayload {
  readonly method?: unknown;
  readonly fareMinor?: unknown;
  readonly journalEntryId?: unknown;
}

/**
 * The durable record of a completed settlement is its outbox event (every
 * outcome writes one, even the cash trip that posts no journal entry). A
 * replay re-reads it; a replay whose body disagrees with what was settled is
 * a caller bug and is refused rather than answered with the old outcome.
 */
async function findReplay(
  deps: WalletDeps,
  input: MarketplaceSettlementInput,
  eventKey: string,
): Promise<MarketplaceSettlementResult | null> {
  const prior = await deps.db.outboxEvent.findUnique({
    where: { idempotencyKey: eventKey },
  });
  if (prior === null) {
    return null;
  }
  const payload = prior.payload as SettledEventPayload;
  if (
    payload.method !== input.method ||
    payload.fareMinor !== input.fareMinor.amountMinor
  ) {
    throw new ContractError(
      "conflict",
      "this award was already settled with different terms",
      {
        awardId: input.awardId,
        settledMethod: payload.method ?? null,
        settledFareMinor: payload.fareMinor ?? null,
      },
    );
  }
  return {
    settled: true,
    method: input.method,
    journalEntryId:
      typeof payload.journalEntryId === "string"
        ? payload.journalEntryId
        : null,
    replayed: true,
  };
}

export async function settleMarketplaceCompletion(
  deps: WalletDeps,
  input: MarketplaceSettlementInput,
): Promise<MarketplaceSettlementResult> {
  const now = deps.now();
  const settleKey = settlementKey(input.awardId);
  const eventKey = `${settleKey}:settled`;
  const tipMinor = input.tipMinor?.amountMinor ?? 0;

  const config = await deps.config.loadForWallet(input.cityId);
  const currency = config.city.currency;
  // Same rule as every other Money body on this surface: the caller's
  // denomination must be the city's, or the request is refused — never
  // silently re-denominated.
  if (input.fareMinor.currency !== currency) {
    throw new ContractError(
      "validation_failed",
      "the fare currency does not match the city's wallet currency",
      { currency: input.fareMinor.currency, cityCurrency: currency },
    );
  }
  if (input.tipMinor !== undefined && input.tipMinor.currency !== currency) {
    throw new ContractError(
      "validation_failed",
      "the tip currency does not match the city's wallet currency",
      { currency: input.tipMinor.currency, cityCurrency: currency },
    );
  }

  const replay = await findReplay(deps, input, eventKey);
  if (replay !== null) {
    return replay;
  }

  try {
    return await deps.db.$transaction(async (tx) => {
      const driverWallet = await ensureWallet(
        tx,
        "user",
        input.driverId,
        config.city,
      );
      const riderWallet =
        input.method === "wallet" || tipMinor > 0
          ? await ensureWallet(tx, "user", input.requesterId, config.city)
          : undefined;

      // postMarketplaceCompletion takes the rider wallet's row lock and runs
      // the spendable guard (balance minus active bid holds) before any line
      // is written; a short rider rolls the whole settlement back, and
      // recovery/dunning stays ops scope.
      const completion = await postMarketplaceCompletion(tx, {
        rideId: input.executionRef.id,
        awardId: input.awardId,
        method: input.method,
        riderWalletId: riderWallet?.id,
        driverWalletId: driverWallet.id,
        fareMinor: input.fareMinor.amountMinor,
        tipMinor,
        currency,
        occurredAt: now,
        idempotencyKey: settleKey,
      });
      const journalEntryId = completion.entry?.id ?? null;

      await writeAudit(tx, {
        actor: MP_SERVICE_ACTOR,
        action: "wallet.mp_settlement.settled",
        subjectType: "mp_award",
        subjectId: input.awardId,
        after: {
          method: input.method,
          executionService: input.executionRef.service,
          executionId: input.executionRef.id,
          fareMinor: input.fareMinor.amountMinor,
          tipMinor,
          currency,
          journalEntryId,
          driverWalletId: driverWallet.id,
          riderWalletId: riderWallet?.id ?? null,
        },
      });
      // No dedicated settlement event exists in the closed catalog yet, so
      // the closest existing names carry it: a wallet settlement IS a posted
      // wallet movement, and a cash settlement acknowledges the cash fare.
      await publishEvent(tx, {
        name:
          input.method === "wallet"
            ? "transfer.posted"
            : "payment.cash_acknowledged",
        aggregateType: "mp_settlement",
        aggregateId: input.awardId,
        fromVersion: null,
        toVersion: 1,
        actor: MP_SERVICE_ACTOR,
        actorType: "service",
        cityId: input.cityId,
        idempotencyKey: eventKey,
        occurredAt: now,
        payload: {
          awardId: input.awardId,
          executionService: input.executionRef.service,
          executionId: input.executionRef.id,
          method: input.method,
          fareMinor: input.fareMinor.amountMinor,
          tipMinor,
          currency,
          journalEntryId,
          driverWalletId: driverWallet.id,
          riderWalletId: riderWallet?.id ?? null,
        },
      });

      return {
        settled: true as const,
        method: input.method,
        journalEntryId,
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the award-scoped idempotency race (journal entry or outbox event
    // unique key): the winner settled; answer with its outcome.
    if (isIdempotencyRace(error)) {
      const won = await findReplay(deps, input, eventKey);
      if (won !== null) {
        return won;
      }
    }
    throw error;
  }
}
