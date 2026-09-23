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
 * THE WIRE CONTRACT IS USER-SERVICE'S MOUNTED ROUTE, not a shape of our own
 * (services/user-service/src/routes/grants.ts + src/grants/grants.ts, pinned by
 * its tests/mandates/grants.test.ts, and exercised against the REAL user-service
 * process by tests/grant-port-user-service.test.ts here):
 *
 *   POST {USER_SERVICE_URL}/internal/grants
 *   x-service-key:   AI_GRANTS_SERVICE_KEY (constant-time checked; fails closed)
 *   idempotency-key: a digest of the scoped confirm key, <= 64 url-safe
 *                    characters (a replay returns the ORIGINAL grant)
 *   body: { actorId, action, resourceRef, provider?, termsVersion (<= 60),
 *           total: { amountMinor, currency }, assurance, mandateId?, expiresAt }
 *   201/200: { success: true, data: { grant: GrantView, replayed } }
 *   4xx/5xx: { success: false, error: { code, message, details? } }
 *
 * The actor travels IN THE BODY (the internal route authenticates the calling
 * service, never a user). Optional fields are OMITTED, not null — the route's
 * schema accepts a string or nothing. The response is parsed against a strict
 * schema and the returned grant must carry exactly the terms asked for: a replay
 * under a reused key that answers different terms is refused, never trusted.
 *
 * The HTTP adapter is the real implementation. Most tests substitute a fake that
 * writes a real `action_grants` row, so the single-use and expiry guards run
 * against the same rows and constraints as production.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ContractError,
  CurrencySchema,
  IDEMPOTENCY_HEADER,
} from "@ubi/contracts";

import { toolLogger } from "../lib/logger";

export type GrantAssurance = "pin" | "biometric" | "mandate";

/** user-service's column limits (MintGrantSchema) — checked before sending. */
export const GRANT_LIMITS = {
  actorId: 128,
  action: 120,
  resourceRef: 200,
  provider: 120,
  termsVersion: 60,
  mandateId: 128,
} as const;

export interface GrantMintRequest {
  readonly actorId: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly provider?: string;
  /** At most 60 characters (see `grantTermsVersion`). */
  readonly termsVersion: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly assurance: GrantAssurance;
  /**
   * The proof the user supplied (PIN token / biometric assertion). Never logged
   * and NOT SENT: user-service's mounted mint contract has no proof field, so
   * nothing verifies it at mint today (a recorded residual — the proof is still
   * required at the confirm route so the client flow is the final one).
   */
  readonly assuranceProof: string;
  /**
   * The ORIGINATING mandate of an `assurance: "mandate"` grant, persisted on the
   * grant row at mint (`action_grants.mandate_id`). Every later action under the
   * grant derives its authority from that stored binding — never from a caller
   * (recheck A03 / P02). Required with, and only with, `assurance: "mandate"`.
   * user-service additionally refuses the mint unless it names an ACTIVE
   * mandate owned by `actorId`.
   */
  readonly mandateId?: string;
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
  readonly cityId: string;
}

export interface MintedGrant {
  readonly grantId: string;
  readonly expiresAt: string;
  readonly assurance: GrantAssurance;
}

/**
 * A grant terms version that fits user-service's 60-character column: the
 * label plus a digest of the full terms. Deterministic, so the value minted,
 * the value consumed against and the value re-derived at execution all agree.
 */
export function grantTermsVersion(label: string, terms: string): string {
  const digest = createHash("sha256").update(terms).digest("hex").slice(0, 40);
  const value = `${label}:${digest}`;
  if (value.length > GRANT_LIMITS.termsVersion) {
    throw new Error(`grant terms label ${label} is too long`);
  }
  return value;
}

/**
 * The Idempotency-Key the mint carries. user-service accepts at most 64
 * url-safe characters (IdempotencyKeySchema), which a scoped key
 * (`<operation>:<actor>:<client key>`) overruns; a digest of it is short,
 * deterministic — a replay lands on the same grant — and still unique per
 * operation, actor and client key.
 */
export function wireGrantIdempotencyKey(scopedKey: string): string {
  const digest = createHash("sha256")
    .update(scopedKey)
    .digest("hex")
    .slice(0, 48);
  return `grant:${digest}`;
}

/**
 * Refuses a mint request whose assurance and mandate binding disagree, before
 * anything leaves the service: a mandate grant without its mandate would be
 * authority with no revocable source, and an attended grant naming a mandate
 * would smuggle one in.
 */
export function assertMintBinding(request: GrantMintRequest): void {
  const mandateBound =
    request.mandateId !== undefined && request.mandateId.length > 0;
  if ((request.assurance === "mandate") !== mandateBound) {
    throw new ContractError(
      "validation_failed",
      "a mandate grant must carry exactly its originating mandate",
      { reason: "mandate_binding_invalid" },
    );
  }
}

/** The request body exactly as user-service's MintGrantSchema accepts it. */
const MintBodySchema = z
  .object({
    actorId: z.string().min(1).max(GRANT_LIMITS.actorId),
    action: z.string().min(1).max(GRANT_LIMITS.action),
    resourceRef: z.string().min(1).max(GRANT_LIMITS.resourceRef),
    provider: z.string().min(1).max(GRANT_LIMITS.provider).optional(),
    termsVersion: z.string().min(1).max(GRANT_LIMITS.termsVersion),
    total: z
      .object({
        amountMinor: z.number().int().min(0).safe(),
        currency: CurrencySchema,
      })
      .strict(),
    assurance: z.enum(["pin", "biometric", "mandate"]),
    mandateId: z.string().min(1).max(GRANT_LIMITS.mandateId).optional(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

type MintBody = z.infer<typeof MintBodySchema>;

/** user-service's GrantView, strictly. Unknown extra fields are ignored. */
const GrantViewSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  resourceRef: z.string().min(1),
  provider: z.string().nullable(),
  termsVersion: z.string().min(1),
  total: z.object({
    amountMinor: z.number().int().min(0).safe(),
    currency: CurrencySchema,
  }),
  assurance: z.enum(["pin", "biometric", "mandate"]),
  mandateId: z.string().nullable(),
  expiresAt: z.string().datetime({ offset: true }),
  consumedAt: z.string().datetime({ offset: true }).nullable(),
});

const MintEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ grant: GrantViewSchema, replayed: z.boolean() }),
});

const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});

export interface GrantPort {
  mint(request: GrantMintRequest): Promise<MintedGrant>;
}

interface GrantHttpOptions {
  readonly baseUrl: string;
  readonly path?: string;
  /** AI_GRANTS_SERVICE_KEY. Without one the port refuses to mint. */
  readonly serviceKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** The wire body for a request; refuses anything user-service would refuse. */
export function mintBodyFor(request: GrantMintRequest): MintBody {
  assertMintBinding(request);
  const parsed = MintBodySchema.safeParse({
    actorId: request.actorId,
    action: request.action,
    resourceRef: request.resourceRef,
    ...(request.provider === undefined ? {} : { provider: request.provider }),
    termsVersion: request.termsVersion,
    total: { amountMinor: request.totalMinor, currency: request.currency },
    assurance: request.assurance,
    ...(request.mandateId === undefined
      ? {}
      : { mandateId: request.mandateId }),
    expiresAt: request.expiresAt.toISOString(),
  });
  if (!parsed.success) {
    // A defect on our side (e.g. an over-long terms version), not the user's:
    // nothing was confirmed and nothing leaves the service.
    throw new ContractError(
      "internal_error",
      "the confirmation could not be prepared",
      {
        reason: "grant_request_invalid",
        issues: parsed.error.issues.map(
          (issue) => issue.path.join(".") || "(root)",
        ),
      },
    );
  }
  return parsed.data;
}

function sameTerms(
  grant: z.infer<typeof GrantViewSchema>,
  body: MintBody,
): boolean {
  return (
    grant.actorId === body.actorId &&
    grant.action === body.action &&
    grant.resourceRef === body.resourceRef &&
    grant.termsVersion === body.termsVersion &&
    grant.total.amountMinor === body.total.amountMinor &&
    grant.total.currency === body.total.currency &&
    grant.assurance === body.assurance &&
    grant.mandateId === (body.mandateId ?? null) &&
    grant.provider === (body.provider ?? null)
  );
}

async function refusalFrom(response: Response): Promise<ContractError> {
  let code = "unknown";
  let reason: unknown;
  try {
    const parsed = ErrorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      reason = parsed.data.error.details?.reason;
    }
  } catch {
    // an unreadable refusal is handled like any other below
  }
  toolLogger.error(
    { status: response.status, code, reason },
    "grant mint refused",
  );
  const details = {
    status: response.status,
    upstreamCode: code,
    ...(typeof reason === "string" ? { upstreamReason: reason } : {}),
  };
  if (response.status === 403) {
    // user-service refused the AUTHORITY itself (e.g. a mandate that is not
    // active or not the actor's): a real refusal, surfaced as one.
    return new ContractError(
      "forbidden",
      "the confirmation could not be authorised",
      details,
    );
  }
  if (response.status === 401) {
    // The service key was refused: an ask ↔ user-service misconfiguration,
    // never the end user's session.
    return new ContractError(
      "service_unavailable",
      "the auth service is not available to the assistant right now; nothing was confirmed",
      { ...details, reason: "grant_service_auth_refused" },
    );
  }
  if (response.status === 409) {
    return new ContractError(
      "conflict",
      "the confirmation conflicts with an earlier one; nothing new was confirmed",
      details,
    );
  }
  if (response.status >= 500) {
    return new ContractError(
      "service_unavailable",
      "the auth service is not reachable; nothing was confirmed",
      details,
    );
  }
  // 4xx validation: our request did not match the contract — a defect, not a
  // reason to ask the user for another PIN.
  return new ContractError(
    "service_unavailable",
    "the confirmation could not be authorised right now; nothing was confirmed",
    { ...details, reason: "grant_request_rejected" },
  );
}

export function createHttpGrantPort(options: GrantHttpOptions): GrantPort {
  const doFetch = options.fetchImpl ?? fetch;
  const path = options.path ?? "/internal/grants";
  const timeoutMs = options.timeoutMs ?? 8_000;
  return {
    async mint(request: GrantMintRequest): Promise<MintedGrant> {
      const body = mintBodyFor(request);
      if (options.serviceKey === undefined || options.serviceKey.length === 0) {
        // Fail closed: user-service would refuse an unauthenticated mint, and
        // an unconfigured deployment must say so rather than try.
        throw new ContractError(
          "service_unavailable",
          "confirmations are not configured on this deployment; nothing was confirmed",
          { reason: "grant_service_key_missing" },
        );
      }
      const url = `${options.baseUrl.replace(/\/+$/, "")}${path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [IDEMPOTENCY_HEADER]: wireGrantIdempotencyKey(
              request.idempotencyKey,
            ),
            "x-service-key": options.serviceKey,
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw await refusalFrom(response);
        }
        const parsed = MintEnvelopeSchema.safeParse(await response.json());
        if (!parsed.success) {
          toolLogger.error(
            {
              issues: parsed.error.issues.map(
                (issue) => issue.path.join(".") || "(root)",
              ),
            },
            "grant mint answered an unreadable grant",
          );
          throw new ContractError(
            "service_unavailable",
            "the auth service returned an unreadable grant",
            { reason: "malformed_grant_response" },
          );
        }
        const { grant } = parsed.data.data;
        if (!sameTerms(grant, body)) {
          // A replay under this key answered a grant for OTHER terms: never
          // act on authority that is not what the user just confirmed.
          throw new ContractError(
            "conflict",
            "the authorization does not match the confirmed terms",
            { reason: "grant_terms_mismatch" },
          );
        }
        return {
          grantId: grant.id,
          expiresAt: grant.expiresAt,
          assurance: grant.assurance,
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
