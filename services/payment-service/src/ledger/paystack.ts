/**
 * Paystack PSP adapter and raw-body webhook processor (CC-B03, DEC-6 Part A).
 *
 * Implements the existing `TopupProvider` and `BankRailProvider` ports against
 * Paystack's v1 HTTP API when `PAYSTACK_SECRET_KEY` is configured, and returns
 * `null` otherwise so unconfigured environments stay honestly unavailable
 * (`503 service_unavailable`) rather than fabricating captures or payouts.
 *
 * Inbound webhooks (`POST /v1/psp/webhooks/paystack`) are verified with
 * constant-time HMAC-SHA512 over the exact raw UTF-8 request body before JSON
 * parsing, deduplicated on `(provider, event_type, external_ref)` in
 * `psp_webhook_events`, and reconciled idempotently against `Topup.pspRef` and
 * `NipTransfer` so synchronous captures and webhook replays never double-post.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ContractError, money } from "@ubi/contracts";

import { publishEvent, writeAudit } from "./audit";
import { lockWallet, type WalletDeps } from "./context";
import { assertWithinBalanceCap, limitStatus } from "./limits";
import { fromDbMinor } from "./minor-units";
import { applyNipCallback } from "./nip";
import { postEntry } from "./post-entry";
import { assertNotLocked, ensureWallet } from "./wallets";
import { walletLogger } from "../lib/logger";
import { generateId } from "../lib/utils";

import type { BankRailProvider, TopupProvider } from "./providers";
import type { Actor, LedgerTx } from "./types";

const DEFAULT_PAYSTACK_BASE_URL = "https://api.paystack.co";

interface PaystackConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
}

function paystackConfig(): PaystackConfig | null {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) {
    return null;
  }
  const baseUrl = (
    process.env.PAYSTACK_BASE_URL?.trim() || DEFAULT_PAYSTACK_BASE_URL
  ).replace(/\/+$/, "");
  return { baseUrl, secretKey };
}

const PaystackChargeResponse = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z
    .object({
      reference: z.string().min(1),
      status: z.string().optional(),
    })
    .optional(),
});

const PaystackRefundResponse = z.object({
  status: z.boolean(),
  message: z.string().optional(),
});

const PaystackResolveBankResponse = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z
    .object({
      account_number: z.string().min(1),
      account_name: z.string().min(1),
    })
    .optional(),
});

const PaystackRecipientResponse = z.object({
  status: z.boolean(),
  data: z
    .object({
      recipient_code: z.string().min(1),
    })
    .optional(),
});

const PaystackTransferResponse = z.object({
  status: z.boolean(),
  data: z
    .object({
      reference: z.string().min(1).optional(),
      transfer_code: z.string().min(1).optional(),
    })
    .optional(),
});

async function paystackRequest<T>(
  config: PaystackConfig,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: Readonly<Record<string, unknown>>,
  idempotencyKey?: string,
): Promise<{ status: number; parsed: T | null }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.secretKey}`,
    accept: "application/json",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (idempotencyKey !== undefined) {
    headers["idempotency-key"] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    walletLogger.error({ err: error, path }, "Paystack HTTP request failed");
    throw new ContractError(
      "service_unavailable",
      "payment provider is unreachable",
      { provider: "paystack", path },
    );
  }

  if (!response.ok) {
    return { status: response.status, parsed: null };
  }

  const rawJson: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(rawJson);
  if (!parsed.success) {
    throw new ContractError(
      "service_unavailable",
      "payment provider returned an unusable response",
      { provider: "paystack", path },
    );
  }
  return { status: response.status, parsed: parsed.data };
}

/**
 * Paystack `TopupProvider` adapter. Returns `null` when `PAYSTACK_SECRET_KEY`
 * is unset so `wiring.ts` can fall back cleanly or surface `503`.
 */
export function paystackTopupProvider(): TopupProvider | null {
  const config = paystackConfig();
  if (config === null) {
    return null;
  }

  return {
    async capture(request) {
      const isSavedAuth = request.methodId.startsWith("AUTH_");
      const path = isSavedAuth
        ? "/transaction/charge_authorization"
        : "/charge";
      const payload: Record<string, unknown> = isSavedAuth
        ? {
            authorization_code: request.methodId,
            email: `wallet-${request.reference.replace(/[^a-zA-Z0-9._-]/g, "_")}@receipts.ubi.africa`,
            amount: request.amount.amountMinor,
            currency: request.amount.currency,
            reference: request.reference,
          }
        : {
            email: `wallet-${request.reference.replace(/[^a-zA-Z0-9._-]/g, "_")}@receipts.ubi.africa`,
            amount: request.amount.amountMinor,
            currency: request.amount.currency,
            reference: request.reference,
            metadata: {
              methodId: request.methodId,
              idempotencyKey: request.idempotencyKey,
            },
          };

      const { status, parsed } = await paystackRequest(
        config,
        "POST",
        path,
        PaystackChargeResponse,
        payload,
        request.idempotencyKey,
      );

      if (
        parsed === null ||
        !parsed.status ||
        parsed.data === undefined ||
        (parsed.data.status !== undefined && parsed.data.status !== "success")
      ) {
        throw new ContractError(
          "service_unavailable",
          "top-up was not captured by Paystack",
          {
            provider: "paystack",
            status,
            chargeStatus: parsed?.data?.status ?? null,
          },
        );
      }

      return { pspRef: parsed.data.reference };
    },

    async refund(pspRef, idempotencyKey) {
      const { status, parsed } = await paystackRequest(
        config,
        "POST",
        "/refund",
        PaystackRefundResponse,
        { transaction: pspRef, merchant_note: idempotencyKey },
        idempotencyKey,
      );
      if (parsed === null || !parsed.status) {
        throw new ContractError(
          "service_unavailable",
          "top-up refund was not accepted by Paystack",
          { provider: "paystack", status },
        );
      }
    },
  };
}

/**
 * Paystack `BankRailProvider` adapter (`/bank/resolve` + `/transferrecipient`
 * + `/transfer`). Returns `null` when `PAYSTACK_SECRET_KEY` is unset.
 */
export function paystackBankRailProvider(): BankRailProvider | null {
  const config = paystackConfig();
  if (config === null) {
    return null;
  }

  return {
    async nameEnquiry(request) {
      const query = new URLSearchParams({
        account_number: request.accountNumber,
        bank_code: request.bankCode,
      });
      const { status, parsed } = await paystackRequest(
        config,
        "GET",
        `/bank/resolve?${query.toString()}`,
        PaystackResolveBankResponse,
      );
      // Paystack returns 404 or 422 when the account number cannot be resolved.
      if (status === 404 || status === 422) {
        return null;
      }
      if (parsed === null || !parsed.status || parsed.data === undefined) {
        throw new ContractError(
          "service_unavailable",
          "bank name enquiry failed at Paystack",
          { provider: "paystack", status },
        );
      }
      return {
        accountName: parsed.data.account_name,
        sessionId: `ps_ne_${request.bankCode}_${parsed.data.account_number}`,
      };
    },

    async sendPayout(request) {
      const recipientRes = await paystackRequest(
        config,
        "POST",
        "/transferrecipient",
        PaystackRecipientResponse,
        {
          type: "nuban",
          name: request.accountName,
          account_number: request.accountNumber,
          bank_code: request.bankCode,
          currency: request.amount.currency,
        },
        `${request.idempotencyKey}:recipient`,
      );
      const recipientCode = recipientRes.parsed?.data?.recipient_code;
      if (
        recipientRes.parsed === null ||
        !recipientRes.parsed.status ||
        !recipientCode
      ) {
        throw new ContractError(
          "service_unavailable",
          "bank transfer recipient could not be registered",
          { provider: "paystack", status: recipientRes.status },
        );
      }

      const transferRes = await paystackRequest(
        config,
        "POST",
        "/transfer",
        PaystackTransferResponse,
        {
          source: "balance",
          amount: request.amount.amountMinor,
          currency: request.amount.currency,
          recipient: recipientCode,
          reference: request.reference,
          reason: "UBI wallet payout",
        },
        request.idempotencyKey,
      );
      const sessionRef =
        transferRes.parsed?.data?.reference ??
        transferRes.parsed?.data?.transfer_code;
      if (
        transferRes.parsed === null ||
        !transferRes.parsed.status ||
        !sessionRef
      ) {
        throw new ContractError(
          "service_unavailable",
          "bank payout was not accepted by Paystack",
          { provider: "paystack", status: transferRes.status },
        );
      }
      return { sessionId: sessionRef };
    },
  };
}

/**
 * Verifies Paystack's `x-paystack-signature` header (hex HMAC-SHA512 over the
 * exact raw UTF-8 body). Fails closed with `503 service_unavailable` when no
 * secret is configured, and `401 unauthorized` on missing or invalid MACs.
 */
export function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | undefined,
): void {
  const secret =
    process.env.PAYSTACK_WEBHOOK_SECRET?.trim() ||
    process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) {
    throw new ContractError(
      "service_unavailable",
      "Paystack webhook secret is not configured; callbacks cannot be verified",
    );
  }
  if (!signatureHeader) {
    throw new ContractError(
      "unauthorized",
      "missing Paystack webhook signature",
    );
  }
  const normalized = signatureHeader.trim();
  if (!/^[0-9a-fA-F]{128}$/.test(normalized)) {
    throw new ContractError(
      "unauthorized",
      "malformed Paystack webhook signature",
    );
  }
  const expected = createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest();
  const provided = Buffer.from(normalized, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new ContractError(
      "unauthorized",
      "Paystack webhook signature did not verify",
    );
  }
}

const PaystackWebhookEnvelope = z.object({
  event: z.string().min(1).max(120),
  data: z.record(z.unknown()),
});

const ChargeSuccessData = z.object({
  reference: z.string().min(1).max(200),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  channel: z.string().max(64).optional(),
  metadata: z
    .object({
      cityId: z.string().min(1).max(128).optional(),
      userId: z.string().min(1).max(128).optional(),
      methodId: z.string().min(1).max(64).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

const TransferWebhookData = z.object({
  reference: z.string().min(1).max(200),
  reason: z.string().max(280).optional(),
  metadata: z
    .object({
      cityId: z.string().min(1).max(128).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

export interface PaystackWebhookOutcome {
  readonly received: true;
  readonly event: string;
  readonly reference: string;
  readonly replayed: boolean;
  readonly applied: boolean;
  readonly status: string;
  readonly topupId: string | null;
  readonly entryId: string | null;
}

async function lockPaystackRef(tx: LedgerTx, reference: string): Promise<void> {
  const lockKey = `psp:paystack:${reference}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export async function handlePaystackWebhook(
  deps: WalletDeps,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<PaystackWebhookOutcome> {
  // Verify HMAC-SHA512 over raw bytes BEFORE touching JSON.parse.
  verifyPaystackSignature(rawBody, signatureHeader);

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    throw new ContractError(
      "validation_failed",
      "webhook body is not valid JSON",
    );
  }

  const envelope = PaystackWebhookEnvelope.safeParse(decoded);
  if (!envelope.success) {
    throw new ContractError(
      "validation_failed",
      "webhook body does not match Paystack event envelope",
    );
  }

  const { event, data } = envelope.data;
  let externalRef: string | null = null;
  if (typeof data.reference === "string" && data.reference.trim().length > 0) {
    externalRef = data.reference.trim();
  } else if (typeof data.id === "number" || typeof data.id === "string") {
    externalRef = String(data.id);
  }
  if (externalRef === null) {
    throw new ContractError(
      "validation_failed",
      "webhook event is missing a provider reference",
    );
  }

  const payloadHash = createHash("sha256")
    .update(rawBody, "utf8")
    .digest("hex");

  if (event === "charge.success") {
    const parsedCharge = ChargeSuccessData.safeParse(data);
    if (!parsedCharge.success) {
      throw new ContractError(
        "validation_failed",
        "charge.success payload is invalid",
      );
    }
    const charge = parsedCharge.data;
    const now = deps.now();
    const webhookActor: Actor = { id: "paystack-webhook", role: "system" };

    return deps.db.$transaction(async (tx) => {
      await lockPaystackRef(tx, charge.reference);

      const seen = await tx.pspWebhookEvent.findUnique({
        where: {
          provider_eventType_externalRef: {
            provider: "paystack",
            eventType: event,
            externalRef: charge.reference,
          },
        },
      });
      if (seen !== null) {
        if (seen.payloadHash !== payloadHash) {
          throw new ContractError(
            "idempotency_conflict",
            "Paystack reference was already processed with a different payload",
            { reference: charge.reference },
          );
        }
        const priorTopup = await tx.topup.findUnique({
          where: { pspRef: charge.reference },
        });
        return {
          received: true,
          event,
          reference: charge.reference,
          replayed: true,
          applied: false,
          status: seen.outcome,
          topupId: priorTopup?.id ?? seen.topupId ?? null,
          entryId: priorTopup?.entryId ?? seen.entryId ?? null,
        };
      }

      // Reconcile against any synchronous capture recorded by `createTopup`.
      const existingTopup = await tx.topup.findUnique({
        where: { pspRef: charge.reference },
      });
      if (existingTopup !== null) {
        if (
          fromDbMinor(existingTopup.amountMinor) !== charge.amount ||
          existingTopup.currency !== charge.currency
        ) {
          throw new ContractError(
            "idempotency_conflict",
            "webhook amount or currency disagrees with captured top-up",
            { reference: charge.reference, topupId: existingTopup.id },
          );
        }
        await tx.pspWebhookEvent.create({
          data: {
            id: generateId("pwh"),
            provider: "paystack",
            eventType: event,
            externalRef: charge.reference,
            payloadHash,
            outcome: "already_captured",
            topupId: existingTopup.id,
            entryId: existingTopup.entryId,
          },
        });
        return {
          received: true,
          event,
          reference: charge.reference,
          replayed: false,
          applied: false,
          status: "already_captured",
          topupId: existingTopup.id,
          entryId: existingTopup.entryId,
        };
      }

      const cityId = charge.metadata?.cityId;
      const userId = charge.metadata?.userId;
      if (!cityId || !userId) {
        await tx.pspWebhookEvent.create({
          data: {
            id: generateId("pwh"),
            provider: "paystack",
            eventType: event,
            externalRef: charge.reference,
            payloadHash,
            outcome: "ignored_unmatched",
          },
        });
        return {
          received: true,
          event,
          reference: charge.reference,
          replayed: false,
          applied: false,
          status: "ignored_unmatched",
          topupId: null,
          entryId: null,
        };
      }

      const config = await deps.config.load(cityId);
      if (config.city.currency !== charge.currency) {
        throw new ContractError(
          "validation_failed",
          "webhook currency does not match the city's wallet currency",
          {
            cityCurrency: config.city.currency,
            webhookCurrency: charge.currency,
          },
        );
      }

      const wallet = await ensureWallet(tx, "user", userId, config.city);
      await lockWallet(tx, wallet.id);
      assertNotLocked(wallet);

      const amount = money(charge.amount, config.city.currency);
      const limits = await limitStatus(tx, wallet, config.city, now);
      await assertWithinBalanceCap(tx, wallet, amount, limits);

      const topupId = generateId("top");
      const entry = await postEntry(tx, {
        kind: "topup",
        reference: `topup:${topupId}`,
        occurredAt: now,
        idempotencyKey: `psp.paystack.charge:${charge.reference}`,
        description: "wallet top-up (Paystack webhook)",
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
          methodId: charge.metadata?.methodId ?? charge.channel ?? "card",
          amountMinor: BigInt(amount.amountMinor),
          currency: amount.currency,
          status: "captured",
          pspRef: charge.reference,
          entryId: entry.id,
          idempotencyKey: `psp.paystack.topup:${charge.reference}`,
        },
      });

      await tx.pspWebhookEvent.create({
        data: {
          id: generateId("pwh"),
          provider: "paystack",
          eventType: event,
          externalRef: charge.reference,
          payloadHash,
          outcome: "applied",
          topupId,
          entryId: entry.id,
        },
      });

      await writeAudit(tx, {
        actor: webhookActor,
        action: "wallet.topup.captured",
        subjectType: "wallet",
        subjectId: wallet.id,
        after: {
          topupId,
          pspRef: charge.reference,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          entryId: entry.id,
        },
      });

      await publishEvent(tx, {
        name: "topup.captured",
        aggregateType: "wallet",
        aggregateId: wallet.id,
        fromVersion: null,
        toVersion: 1,
        actor: webhookActor,
        actorType: "system",
        cityId,
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
        received: true,
        event,
        reference: charge.reference,
        replayed: false,
        applied: true,
        status: "applied",
        topupId,
        entryId: entry.id,
      };
    });
  }

  if (
    event === "transfer.success" ||
    event === "transfer.failed" ||
    event === "transfer.reversed"
  ) {
    const parsedTransfer = TransferWebhookData.safeParse(data);
    if (!parsedTransfer.success) {
      throw new ContractError(
        "validation_failed",
        "transfer webhook payload is invalid",
      );
    }
    const transferEvent = parsedTransfer.data;

    const existingEvent = await deps.db.pspWebhookEvent.findUnique({
      where: {
        provider_eventType_externalRef: {
          provider: "paystack",
          eventType: event,
          externalRef: transferEvent.reference,
        },
      },
    });
    if (existingEvent !== null) {
      if (existingEvent.payloadHash !== payloadHash) {
        throw new ContractError(
          "idempotency_conflict",
          "Paystack transfer event was already processed with a different payload",
        );
      }
      return {
        received: true,
        event,
        reference: transferEvent.reference,
        replayed: true,
        applied: false,
        status: existingEvent.outcome,
        topupId: null,
        entryId: existingEvent.entryId,
      };
    }

    const strippedNipId = transferEvent.reference.replace(/^nip:/, "");
    const nipRow = await deps.db.nipTransfer.findFirst({
      where: {
        OR: [{ sessionId: transferEvent.reference }, { id: strippedNipId }],
      },
    });

    if (nipRow === null || nipRow.sessionId === null) {
      await deps.db.pspWebhookEvent.create({
        data: {
          id: generateId("pwh"),
          provider: "paystack",
          eventType: event,
          externalRef: transferEvent.reference,
          payloadHash,
          outcome: "ignored_unmatched",
        },
      });
      return {
        received: true,
        event,
        reference: transferEvent.reference,
        replayed: false,
        applied: false,
        status: "ignored_unmatched",
        topupId: null,
        entryId: null,
      };
    }

    const callbackOutcome = await applyNipCallback(
      deps,
      transferEvent.metadata?.cityId ?? "LOS",
      {
        sessionId: nipRow.sessionId,
        status: event === "transfer.success" ? "confirmed" : "reversed",
        reference: transferEvent.reference,
        reason: transferEvent.reason,
      },
    );

    await deps.db.pspWebhookEvent.upsert({
      where: {
        provider_eventType_externalRef: {
          provider: "paystack",
          eventType: event,
          externalRef: transferEvent.reference,
        },
      },
      create: {
        id: generateId("pwh"),
        provider: "paystack",
        eventType: event,
        externalRef: transferEvent.reference,
        payloadHash,
        outcome: callbackOutcome.applied
          ? "applied"
          : (callbackOutcome.ignoredReason ?? "ignored"),
        nipId: nipRow.id,
        entryId: callbackOutcome.entryId,
      },
      update: {},
    });

    return {
      received: true,
      event,
      reference: transferEvent.reference,
      replayed: false,
      applied: callbackOutcome.applied,
      status: callbackOutcome.status,
      topupId: null,
      entryId: callbackOutcome.entryId,
    };
  }

  // Record unhandled event types idempotently so retries remain 200 OK.
  const existingUnhandled = await deps.db.pspWebhookEvent.findUnique({
    where: {
      provider_eventType_externalRef: {
        provider: "paystack",
        eventType: event,
        externalRef,
      },
    },
  });
  if (existingUnhandled !== null) {
    return {
      received: true,
      event,
      reference: externalRef,
      replayed: true,
      applied: false,
      status: existingUnhandled.outcome,
      topupId: null,
      entryId: null,
    };
  }

  await deps.db.pspWebhookEvent.create({
    data: {
      id: generateId("pwh"),
      provider: "paystack",
      eventType: event,
      externalRef,
      payloadHash,
      outcome: "ignored_event_type",
    },
  });

  return {
    received: true,
    event,
    reference: externalRef,
    replayed: false,
    applied: false,
    status: "ignored_event_type",
    topupId: null,
    entryId: null,
  };
}
