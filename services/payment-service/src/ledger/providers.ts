/**
 * Outbound ports to money rails, and their HTTP adapters.
 *
 * Nothing here fabricates a result. When a rail is not configured the factory
 * returns `null` and the wallet answers `service_unavailable` — an honestly
 * unavailable rail (CLAUDE.md #8), never a fake success and never a fake delay.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ContractError, type Money } from "@ubi/contracts";

export interface NameEnquiryRequest {
  readonly bankCode: string;
  readonly accountNumber: string;
}

export interface NameEnquiryResult {
  readonly accountName: string;
  readonly sessionId: string;
}

export interface BankPayoutRequest {
  readonly bankCode: string;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly amount: Money;
  readonly reference: string;
  readonly idempotencyKey: string;
}

export interface BankPayoutResult {
  readonly sessionId: string;
}

/** Bank rail used for NIP payouts: name enquiry first, then the instruction. */
export interface BankRailProvider {
  nameEnquiry(request: NameEnquiryRequest): Promise<NameEnquiryResult | null>;
  sendPayout(request: BankPayoutRequest): Promise<BankPayoutResult>;
}

export interface TopupCaptureRequest {
  readonly methodId: string;
  readonly amount: Money;
  readonly reference: string;
  readonly idempotencyKey: string;
}

export interface TopupCaptureResult {
  readonly pspRef: string;
}

/** Card / mobile-money rail used to fund a wallet, with a compensating refund. */
export interface TopupProvider {
  capture(request: TopupCaptureRequest): Promise<TopupCaptureResult>;
  /** Compensation for a capture whose ledger transaction did not commit. */
  refund(pspRef: string, idempotencyKey: string): Promise<void>;
}

const NameEnquiryResponse = z.object({
  accountName: z.string().min(1),
  sessionId: z.string().min(1),
});

const PayoutResponse = z.object({ sessionId: z.string().min(1) });

const CaptureResponse = z.object({ pspRef: z.string().min(1) });

interface HttpRailConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

function railConfig(prefix: string): HttpRailConfig | null {
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

async function railPost<T>(
  config: HttpRailConfig,
  path: string,
  body: Readonly<Record<string, unknown>>,
  idempotencyKey: string,
  schema: z.ZodType<T>,
): Promise<{ status: number; parsed: T | null }> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { status: response.status, parsed: null };
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ContractError("service_unavailable", "rail returned an unusable response", {
      path,
    });
  }
  return { status: response.status, parsed: parsed.data };
}

/** `NIP_BASE_URL` + `NIP_API_KEY`, or `null` when the rail is not configured. */
export function httpBankRailProvider(): BankRailProvider | null {
  const config = railConfig("NIP");
  if (config === null) {
    return null;
  }
  return {
    async nameEnquiry(request) {
      const { status, parsed } = await railPost(
        config,
        "/name-enquiry",
        { bankCode: request.bankCode, accountNumber: request.accountNumber },
        `ne:${request.bankCode}:${request.accountNumber}`,
        NameEnquiryResponse,
      );
      if (status === 404) {
        return null;
      }
      if (parsed === null) {
        throw new ContractError("service_unavailable", "bank name enquiry failed", {
          status,
        });
      }
      return parsed;
    },
    async sendPayout(request) {
      const { status, parsed } = await railPost(
        config,
        "/transfers",
        {
          bankCode: request.bankCode,
          accountNumber: request.accountNumber,
          accountName: request.accountName,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          reference: request.reference,
        },
        request.idempotencyKey,
        PayoutResponse,
      );
      if (parsed === null) {
        throw new ContractError("service_unavailable", "bank payout was not accepted", {
          status,
        });
      }
      return parsed;
    },
  };
}

/** `TOPUP_BASE_URL` + `TOPUP_API_KEY`, or `null` when the rail is not configured. */
export function httpTopupProvider(): TopupProvider | null {
  const config = railConfig("TOPUP");
  if (config === null) {
    return null;
  }
  return {
    async capture(request) {
      const { status, parsed } = await railPost(
        config,
        "/captures",
        {
          methodId: request.methodId,
          amountMinor: request.amount.amountMinor,
          currency: request.amount.currency,
          reference: request.reference,
        },
        request.idempotencyKey,
        CaptureResponse,
      );
      if (parsed === null) {
        throw new ContractError("service_unavailable", "top-up was not captured", {
          status,
        });
      }
      return parsed;
    },
    async refund(pspRef, idempotencyKey) {
      const { status, parsed } = await railPost(
        config,
        "/refunds",
        { pspRef },
        idempotencyKey,
        z.object({}).passthrough(),
      );
      if (parsed === null) {
        throw new ContractError("service_unavailable", "top-up refund was not accepted", {
          status,
        });
      }
    },
  };
}

export function requireRail<T>(rail: T | null, name: string): T {
  if (rail === null) {
    throw new ContractError(
      "service_unavailable",
      `the ${name} rail is not configured in this environment`,
      { rail: name },
    );
  }
  return rail;
}

/**
 * HMAC-SHA256 over the exact bytes the bank sent. An unset secret is a failure,
 * not a bypass: an unverifiable webhook is rejected.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env.NIP_WEBHOOK_SECRET;
  if (!secret) {
    throw new ContractError(
      "service_unavailable",
      "bank webhook secret is not configured; callbacks cannot be verified",
    );
  }
  if (!signature) {
    throw new ContractError("unauthorized", "missing webhook signature");
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    throw new ContractError("unauthorized", "malformed webhook signature");
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new ContractError("unauthorized", "webhook signature did not verify");
  }
}
