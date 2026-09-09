/**
 * The promotions port — promotion eligibility and driver-incentive explanations.
 *
 * Eligibility and every benefit amount are computed by promotions-service from
 * the funded campaign version; the assistant only reports what it is told and
 * never promises a discount it has not confirmed (rule #26, doc_promotions).
 * The driver-incentive explanation is read-only and driver-scoped.
 */
import { ContractError } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

import type { Actor } from "../ops/types";

export interface EligibilityAdjustment {
  readonly type: string;
  readonly label: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly fundedBy: string | null;
  readonly campaignVersionId: string | null;
  readonly reasonCode: string | null;
}

export interface EligibilityResult {
  readonly covered: boolean;
  readonly adjustments: readonly EligibilityAdjustment[];
  readonly notes: readonly string[];
}

export interface IncentiveExplanation {
  readonly postingId: string;
  readonly summary: string;
  readonly basis: string;
  readonly atCap: boolean;
}

export interface EligibilityInput {
  readonly campaignRef?: string;
  readonly context?: string;
}

export interface PromotionsPort {
  eligibility(actor: Actor, input: EligibilityInput): Promise<EligibilityResult>;
  explainIncentive(
    actor: Actor,
    postingId: string,
  ): Promise<IncentiveExplanation | null>;
}

interface PromotionsHttpOptions {
  readonly baseUrl: string;
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpPromotionsPort(
  options: PromotionsHttpOptions,
): PromotionsPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");

  function headers(actor: Actor): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    };
    if (options.serviceKey !== undefined) {
      h["X-Service-Key"] = options.serviceKey;
    }
    return h;
  }

  async function call(
    path: string,
    method: "GET" | "POST",
    actor: Actor,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers: headers(actor),
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async eligibility(actor, input): Promise<EligibilityResult> {
      try {
        const response = await call(
          "/v1/promotions/eligibility",
          "POST",
          actor,
          input,
        );
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "promotion eligibility is not available right now",
          );
        }
        return (await response.json()) as EligibilityResult;
      } catch (error) {
        if (error instanceof ContractError) throw error;
        toolLogger.error({ err: error }, "eligibility call failed");
        throw new ContractError(
          "service_unavailable",
          "promotion eligibility is not available right now",
        );
      }
    },
    async explainIncentive(
      actor,
      postingId,
    ): Promise<IncentiveExplanation | null> {
      try {
        const response = await call(
          `/v1/promotions/incentives/${encodeURIComponent(postingId)}/explain`,
          "GET",
          actor,
        );
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "the incentive explanation is not available right now",
          );
        }
        return (await response.json()) as IncentiveExplanation;
      } catch (error) {
        if (error instanceof ContractError) throw error;
        toolLogger.error({ err: error }, "incentive explain call failed");
        throw new ContractError(
          "service_unavailable",
          "the incentive explanation is not available right now",
        );
      }
    },
  };
}
