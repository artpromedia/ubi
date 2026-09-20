/**
 * Rider-side funding authorization for a marketplace selection (M05 step 3).
 *
 * The award saga in ride-service calls this before it captures the winning
 * commission hold: the SELECTED amount — not the initially requested price —
 * must be payable with the request's stored payment method. Nothing is
 * debited here; wallet rides settle at completion exactly as legacy rides
 * do, so this is an authoritative spendable check plus an audit record, not
 * a capture. A true rider-side authorization hold (encumbering the fare
 * until completion) is a documented follow-up; today's semantics match the
 * legacy wallet ride flow the marketplace settlement reuses.
 *
 * The check is deliberately re-evaluated on every call (the award id is the
 * caller's idempotency key): no money moved, so replaying the question is
 * honest — a cached "yes" from before the rider emptied their wallet would
 * not be.
 */
import { ContractError, paymentMethodAvailable } from "@ubi/contracts";

import { writeAudit } from "./audit";
import { spendableOf } from "./balances";
import { assertNotLocked, assertNotSafeMode, ensureWallet } from "./wallets";

import type { WalletDeps } from "./context";

export interface MarketplaceFundingInput {
  readonly requesterId: string;
  readonly requestId: string;
  readonly awardId: string;
  readonly paymentMethodId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly cityId: string;
}

export interface MarketplaceFundingResult {
  readonly authorized: true;
  readonly awardId: string;
  readonly paymentMethodId: string;
}

export async function authorizeMarketplaceFunding(
  deps: WalletDeps,
  input: MarketplaceFundingInput,
): Promise<MarketplaceFundingResult> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ContractError(
      "validation_failed",
      "the funding amount must be a positive integer in minor units",
      { amountMinor: input.amountMinor },
    );
  }

  const { city } = await deps.config.loadForWallet(input.cityId);
  if (city.currency !== input.currency) {
    throw new ContractError(
      "validation_failed",
      "the funding currency does not match the city's currency",
      { currency: input.currency, cityCurrency: city.currency },
    );
  }
  if (!paymentMethodAvailable(city, input.paymentMethodId)) {
    throw new ContractError(
      "payment_method_unavailable",
      "that payment method is not available here",
      { paymentMethodId: input.paymentMethodId },
    );
  }

  return deps.db.$transaction(async (tx) => {
    if (input.paymentMethodId === "wallet") {
      const wallet = await ensureWallet(tx, "user", input.requesterId, city);
      assertNotLocked(wallet);
      assertNotSafeMode(wallet, deps.now());
      const spendable = await spendableOf(tx, wallet.id, wallet.currency);
      if (spendable.amountMinor < input.amountMinor) {
        throw new ContractError(
          "insufficient_funds",
          "the wallet cannot cover the selected fare",
          {
            requiredMinor: input.amountMinor,
            spendableMinor: spendable.amountMinor,
            shortfallMinor: input.amountMinor - spendable.amountMinor,
          },
        );
      }
    }
    // Non-wallet methods (cash and any config-listed provider method) carry
    // no balance to verify here; availability was checked above and the
    // provider authorization/capture continues to happen at its existing
    // point in the settlement flow.

    await writeAudit(tx, {
      actor: { id: "marketplace-engine", role: "service" },
      action: "wallet.mp_funding.authorized",
      subjectType: "mp_award",
      subjectId: input.awardId,
      after: {
        requestId: input.requestId,
        requesterId: input.requesterId,
        paymentMethodId: input.paymentMethodId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      },
    });

    return {
      authorized: true as const,
      awardId: input.awardId,
      paymentMethodId: input.paymentMethodId,
    };
  });
}
