/**
 * The ledger port.
 *
 * The double-entry ledger lives in payment-service and stays there. A remedy
 * never edits a fare, never touches a historical entry and never opens a second
 * chart of accounts here: it asks the ledger to post a NEW journal entry of
 * counter-lines that references the support case, and the ledger decides which
 * accounts those lines land in.
 *
 * That is why this interface is deliberately narrow. It carries intent — which
 * case, which subject, which typed remedy, how much, why — and gets back the
 * entry the ledger posted. It cannot express "change that entry", because that
 * operation must not exist.
 *
 * The HTTP adapter below is the real implementation. Tests substitute a fake;
 * nothing in `src/` ever does.
 */
import { ContractError, IDEMPOTENCY_HEADER, type Money } from "@ubi/contracts";

import { ledgerLogger } from "../lib/logger";

import type { RemedyType } from "./city-config";

export interface RemedyPostingRequest {
  readonly caseId: string;
  readonly remedyId: string;
  readonly type: RemedyType;
  readonly amount: Money;
  readonly cityId: string;
  /** Who the counter-lines benefit. Their wallet is resolved by the ledger. */
  readonly beneficiary: { readonly userType: string; readonly userId: string };
  /** The item the case is about — the ride, order or shipment being made good. */
  readonly subject: { readonly type: string; readonly id: string } | null;
  readonly reason: string;
  /** Scoped key; a replay must return the original entry, not post a second. */
  readonly idempotencyKey: string;
  readonly actor: { readonly id: string; readonly role: string };
}

export interface PostedLine {
  readonly account: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly counterpartRef: string | null;
}

export interface PostedRemedyEntry {
  readonly entryId: string;
  /** The case this entry answers to — `journal_entries.case_ref`. */
  readonly caseRef: string;
  readonly lines: readonly PostedLine[];
  /** True when the ledger returned the entry a previous attempt already posted. */
  readonly replayed: boolean;
}

export interface LedgerPort {
  postRemedy(request: RemedyPostingRequest): Promise<PostedRemedyEntry>;
}

interface LedgerHttpOptions {
  readonly baseUrl: string;
  readonly path?: string;
  readonly serviceKey?: string | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const RESPONSE_SHAPE_ERROR = "the ledger returned a response this service cannot read";

function parseEntry(body: unknown): PostedRemedyEntry {
  if (typeof body !== "object" || body === null) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  const record = body as Record<string, unknown>;
  const entryId = record.entryId;
  const caseRef = record.caseRef;
  const lines = record.lines;
  if (typeof entryId !== "string" || typeof caseRef !== "string" || !Array.isArray(lines)) {
    throw new ContractError("service_unavailable", RESPONSE_SHAPE_ERROR);
  }
  const parsedLines: PostedLine[] = lines.map((line) => {
    const candidate = line as Record<string, unknown>;
    return {
      account: String(candidate.account ?? ""),
      amountMinor: Number(candidate.amountMinor ?? 0),
      currency: String(candidate.currency ?? ""),
      counterpartRef:
        typeof candidate.counterpartRef === "string" ? candidate.counterpartRef : null,
    };
  });
  return {
    entryId,
    caseRef,
    lines: parsedLines,
    replayed: record.replayed === true,
  };
}

/**
 * Talks to payment-service over HTTP. The remedy endpoint is idempotent on the
 * same scoped key this service sends, so a retry after a network failure returns
 * the original entry rather than posting a second one.
 */
export function createHttpLedger(options: LedgerHttpOptions): LedgerPort {
  const doFetch = options.fetchImpl ?? fetch;
  const path = options.path ?? "/v1/finance/remedies";
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async postRemedy(request: RemedyPostingRequest): Promise<PostedRemedyEntry> {
      const url = `${options.baseUrl.replace(/\/+$/, "")}${path}`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [IDEMPOTENCY_HEADER]: request.idempotencyKey,
        "X-City-ID": request.cityId,
        "X-User-ID": request.actor.id,
        "X-User-Role": request.actor.role,
      };
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
          body: JSON.stringify({
            caseId: request.caseId,
            remedyId: request.remedyId,
            type: request.type,
            amountMinor: request.amount.amountMinor,
            currency: request.amount.currency,
            beneficiary: request.beneficiary,
            subject: request.subject,
            reason: request.reason,
          }),
        });

        if (!response.ok) {
          const detail: unknown = await response.json().catch(() => undefined);
          // The ledger's own error code is preserved so the agent sees "the
          // remedy is larger than the wallet can take", not "something failed".
          const code =
            typeof detail === "object" &&
            detail !== null &&
            typeof (detail as { code?: unknown }).code === "string"
              ? (detail as { code: string }).code
              : null;
          ledgerLogger.error(
            { status: response.status, code, caseId: request.caseId },
            "ledger refused the remedy posting",
          );
          throw new ContractError(
            "service_unavailable",
            "the ledger could not post this remedy",
            { status: response.status, ledgerCode: code },
          );
        }

        return parseEntry(await response.json());
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        ledgerLogger.error({ err: error, caseId: request.caseId }, "ledger call failed");
        throw new ContractError(
          "service_unavailable",
          "the ledger is not reachable; the remedy was not posted",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
