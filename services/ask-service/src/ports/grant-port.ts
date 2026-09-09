/**
 * The action-grant port (CLAUDE.md #18).
 *
 * A transactional tool may run only under a single-use action grant, and only
 * user-service (the auth domain) may mint one — after the user confirms a review
 * sheet with the required assurance (PIN or biometric). The model cannot mint,
 * extend or modify a grant; ask-service cannot mint one either. This port is the
 * one-way door to that authority: ask-service asks user-service to mint a grant
 * bound to the exact terms the user confirmed (terms version, total, currency,
 * expiry, idempotency key, assurance), and gets back a grant id.
 *
 * The grant is then *consumed* here, once, inside the execution transaction — see
 * ops/grants.ts. Minting authority and consumption enforcement are deliberately
 * split: user-service decides a grant may exist; ask-service decides it is spent.
 *
 * The HTTP adapter is the real implementation. Tests substitute a fake that
 * writes a real `action_grants` row, so the single-use and expiry guards run
 * against the same rows and constraints as production.
 */
import { ContractError, IDEMPOTENCY_HEADER } from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

export type GrantAssurance = "pin" | "biometric" | "mandate";

export interface GrantMintRequest {
  readonly actorId: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly provider?: string;
  readonly termsVersion: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly assurance: GrantAssurance;
  /** The proof the user supplied (PIN token / biometric assertion). Never logged. */
  readonly assuranceProof: string;
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
  readonly cityId: string;
}

export interface MintedGrant {
  readonly grantId: string;
  readonly expiresAt: string;
  readonly assurance: GrantAssurance;
}

export interface GrantPort {
  mint(request: GrantMintRequest): Promise<MintedGrant>;
}

interface GrantHttpOptions {
  readonly baseUrl: string;
  readonly path?: string;
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpGrantPort(options: GrantHttpOptions): GrantPort {
  const doFetch = options.fetchImpl ?? fetch;
  const path = options.path ?? "/v1/grants";
  const timeoutMs = options.timeoutMs ?? 8_000;
  return {
    async mint(request: GrantMintRequest): Promise<MintedGrant> {
      const url = `${options.baseUrl.replace(/\/+$/, "")}${path}`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [IDEMPOTENCY_HEADER]: request.idempotencyKey,
        "X-User-ID": request.actorId,
        "X-City-ID": request.cityId,
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
            action: request.action,
            resourceRef: request.resourceRef,
            provider: request.provider ?? null,
            termsVersion: request.termsVersion,
            totalMinor: request.totalMinor,
            currency: request.currency,
            assurance: request.assurance,
            assuranceProof: request.assuranceProof,
            expiresAt: request.expiresAt.toISOString(),
          }),
        });
        if (!response.ok) {
          toolLogger.error(
            { status: response.status, action: request.action },
            "grant mint refused",
          );
          throw new ContractError(
            "step_up_required",
            "the confirmation could not be authorised",
            { status: response.status },
          );
        }
        const body = (await response.json()) as {
          grantId?: unknown;
          expiresAt?: unknown;
          assurance?: unknown;
        };
        if (typeof body.grantId !== "string") {
          throw new ContractError(
            "service_unavailable",
            "the auth service returned an unreadable grant",
          );
        }
        return {
          grantId: body.grantId,
          expiresAt:
            typeof body.expiresAt === "string"
              ? body.expiresAt
              : request.expiresAt.toISOString(),
          assurance:
            body.assurance === "biometric" || body.assurance === "mandate"
              ? body.assurance
              : "pin",
        };
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        toolLogger.error({ err: error }, "grant mint call failed");
        throw new ContractError(
          "service_unavailable",
          "the auth service is not reachable; nothing was confirmed",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
