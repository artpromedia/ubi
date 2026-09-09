/**
 * The ledger port.
 *
 * The double-entry ledger lives in payment-service and stays there. Growth
 * never opens a second chart of accounts and never edits an existing entry
 * (CLAUDE.md #4, #26, #27). Two kinds of money movement leave this service, and
 * both are a request for the ledger to post a NEW journal entry of balanced
 * counter-lines that references the campaign or the trip:
 *
 *  - `postIncentive` — a driver rebate, a commission-free-window waiver, a
 *    milestone bonus, or the reversal of one. It is always a SEPARATE journal
 *    line: the base commission entry the pricing engine posted is never touched
 *    (CLAUDE.md #27). Cash trips net the rebate against what the driver owes;
 *    wallet trips pay it out. Either way the driver's line is a credit.
 *
 *  - `postBenefit` — a rider benefit that funds the difference so a contracted
 *    party is made whole (e.g. marketing pays the driver the fare the rider did
 *    not, or credits the rider's wallet). The funding party is debited; the
 *    beneficiary is credited. A rider discount therefore never posts a negative
 *    line against a driver or a supplier (CLAUDE.md #26).
 *
 * This interface is deliberately narrow: it carries intent and gets back the
 * line the ledger posted. It cannot express "change that entry", because that
 * operation must not exist. The HTTP adapter is the real implementation; tests
 * substitute a fake, and nothing in `src/` ever does.
 */
import { ContractError, IDEMPOTENCY_HEADER, type Money } from "@ubi/contracts";

import { ledgerLogger } from "../lib/logger";

import type { Actor } from "./types";

export type IncentiveKind =
  | "rebate"
  | "window_waiver"
  | "rebate_reversal"
  | "milestone";

/** Where the driver's credit lands, and therefore what it means. */
export type IncentiveSettlement =
  | "driver_wallet" // paid out to the driver's wallet
  | "driver_owed"; // netted against what a cash-collecting driver owes UBI

export interface IncentivePostingRequest {
  readonly ruleId: string;
  readonly driverId: string;
  readonly tripId: string;
  readonly kind: IncentiveKind;
  /** Always positive; `rebate_reversal` reverses the direction internally. */
  readonly amount: Money;
  readonly settlement: IncentiveSettlement;
  readonly cityId: string | null;
  readonly reason: string;
  /** Scoped key; a replay must return the original line, never post a second. */
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export type BenefitFunding = "ubi_marketing" | "ubi_fee" | "earned_credit";

/** Where the positive (beneficiary) line lands. */
export interface BenefitBeneficiary {
  readonly account: string;
  readonly walletId: string | null;
  readonly ref: string;
}

export interface BenefitPostingRequest {
  readonly reservationId: string;
  readonly campaignVersionId: string;
  readonly adjustmentType: string;
  readonly amount: Money;
  readonly funding: BenefitFunding;
  readonly beneficiary: BenefitBeneficiary;
  readonly cityId: string | null;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly actor: Actor;
}

export interface PostedEntry {
  readonly entryId: string;
  /** The specific line this service will reference (`ledger_line_id`). */
  readonly ledgerLineId: string;
  /** True when the ledger returned an entry a previous attempt already posted. */
  readonly replayed: boolean;
}

export interface LedgerPort {
  postIncentive(request: IncentivePostingRequest): Promise<PostedEntry>;
  postBenefit(request: BenefitPostingRequest): Promise<PostedEntry>;
}

interface LedgerHttpOptions {
  readonly baseUrl: string;
  readonly incentivePath?: string;
  readonly benefitPath?: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const RESPONSE_SHAPE_ERROR =
  "the ledger returned a response this service cannot read";

function parseEntry(body: unknown): PostedEntry {
  if (typeof body !== "object" || body === null) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  const record = body as Record<string, unknown>;
  const entryId = record.entryId;
  const ledgerLineId = record.ledgerLineId;
  if (typeof entryId !== "string" || typeof ledgerLineId !== "string") {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  return { entryId, ledgerLineId, replayed: record.replayed === true };
}

/**
 * Talks to payment-service over HTTP. Both endpoints are idempotent on the same
 * scoped key this service sends, so a retry after a network failure returns the
 * original line rather than posting a second one.
 */
export function createHttpLedger(options: LedgerHttpOptions): LedgerPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const incentivePath = options.incentivePath ?? "/v1/finance/incentives";
  const benefitPath = options.benefitPath ?? "/v1/finance/benefits";

  async function post(path: string, payload: unknown, key: string, actor: Actor, cityId: string | null): Promise<PostedEntry> {
    const url = `${options.baseUrl.replace(/\/+$/, "")}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [IDEMPOTENCY_HEADER]: key,
      "X-User-ID": actor.id,
      "X-User-Role": actor.role,
    };
    if (cityId !== null) {
      headers["X-City-ID"] = cityId;
    }
    if (options.serviceKey !== undefined) {
      headers["X-Service-Key"] = options.serviceKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail: unknown = await response.json().catch(() => undefined);
        const code =
          typeof detail === "object" &&
          detail !== null &&
          typeof (detail as { code?: unknown }).code === "string"
            ? (detail as { code: string }).code
            : null;
        ledgerLogger.error(
          { status: response.status, code, path },
          "ledger refused the posting",
        );
        throw new ContractError(
          "service_unavailable",
          "the ledger could not post this entry",
          { status: response.status, ledgerCode: code },
        );
      }
      return parseEntry(await response.json());
    } catch (error) {
      if (error instanceof ContractError) {
        throw error;
      }
      ledgerLogger.error({ err: error, path }, "ledger call failed");
      throw new ContractError(
        "service_unavailable",
        "the ledger is not reachable; nothing was posted",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async postIncentive(
      request: IncentivePostingRequest,
    ): Promise<PostedEntry> {
      return post(
        incentivePath,
        {
          ruleId: request.ruleId,
          driverId: request.driverId,
          tripId: request.tripId,
          kind: request.kind,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          settlement: request.settlement,
          reason: request.reason,
        },
        request.idempotencyKey,
        request.actor,
        request.cityId,
      );
    },

    async postBenefit(request: BenefitPostingRequest): Promise<PostedEntry> {
      return post(
        benefitPath,
        {
          reservationId: request.reservationId,
          campaignVersionId: request.campaignVersionId,
          adjustmentType: request.adjustmentType,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          funding: request.funding,
          beneficiary: request.beneficiary,
          reason: request.reason,
        },
        request.idempotencyKey,
        request.actor,
        request.cityId,
      );
    },
  };
}
