/**
 * The support port — hand a thread to a human.
 *
 * When the assistant reaches the edge of what it may do, or the user asks for a
 * person, the thread becomes a support case in support-service. The transcript
 * handed over is the REDACTED text this service already stored; raw card data,
 * PINs, documents and precise addresses never appear in it (rule #20).
 */
import { ContractError } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

import type { Actor } from "../ops/types";

export interface OpenCaseInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly threadId: string;
  readonly includeTranscript: boolean;
  readonly transcript: readonly { sender: string; text: string }[];
  readonly idempotencyKey: string;
}

export interface OpenedCase {
  readonly supportCaseId: string;
  readonly estimatedWaitSec: number;
}

export interface SupportPort {
  openCase(input: OpenCaseInput): Promise<OpenedCase>;
}

interface SupportHttpOptions {
  readonly baseUrl: string;
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpSupportPort(
  options: SupportHttpOptions,
): SupportPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async openCase(input: OpenCaseInput): Promise<OpenedCase> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
        "X-User-ID": input.actor.id,
        "X-User-Role": input.actor.role,
        "X-City-ID": input.cityId,
      };
      if (options.serviceKey !== undefined) {
        headers["X-Service-Key"] = options.serviceKey;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await doFetch(`${base}/v1/support/cases`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            category: "account",
            source: "ask",
            threadId: input.threadId,
            includeTranscript: input.includeTranscript,
            transcript: input.includeTranscript ? input.transcript : [],
          }),
        });
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "a support case could not be opened right now",
          );
        }
        const body = (await response.json()) as {
          id?: unknown;
          supportCaseId?: unknown;
          estimatedWaitSec?: unknown;
        };
        const id =
          typeof body.supportCaseId === "string"
            ? body.supportCaseId
            : typeof body.id === "string"
              ? body.id
              : null;
        if (id === null) {
          throw new ContractError(
            "service_unavailable",
            "support returned an unreadable case",
          );
        }
        return {
          supportCaseId: id,
          estimatedWaitSec:
            typeof body.estimatedWaitSec === "number"
              ? body.estimatedWaitSec
              : 0,
        };
      } catch (error) {
        if (error instanceof ContractError) throw error;
        toolLogger.error({ err: error }, "support case open failed");
        throw new ContractError(
          "service_unavailable",
          "a support case could not be opened right now",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
