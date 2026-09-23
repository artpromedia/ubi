/**
 * Shared plumbing for the live supplier adapters — Duffel (flights,
 * ./duffel.ts) and Nuitee/LiteAPI (stays, ./liteapi.ts).
 *
 * READINESS (recheck T01, CLAUDE.md #8 — the honesty rule). A capability is:
 *
 *  - `implemented` when a request/response mapping against a DOCUMENTED
 *    supplier endpoint exists in this build. A capability the supplier does
 *    not offer is `implemented: false` and names the supported alternative.
 *  - `operational` only when it is implemented AND the credential is present
 *    (and, in production, is not a test-mode credential — its bookings are not
 *    real) AND the base URL is permitted AND — when the supplier row opts into
 *    `probe: true` — a lightweight authenticated probe just succeeded.
 *
 * Credentials alone never make anything operational, and `reachable` is true
 * only after a real provider call succeeded; it is never inferred from
 * configuration. Every operation enforces the same readiness before it sends
 * anything (`assertCallable`), so health and behaviour cannot disagree.
 *
 * SECRETS. A supplier row names its secrets by reference (`secretRef`,
 * `webhookSecretRef`); the platform injects them as `TRAVEL_SECRET_<REF>`.
 * No secret literal lives in code or in the config row.
 *
 * BASE URLS. Each adapter talks to the supplier's official hosts. A row may
 * override `baseUrl` for a local contract server or sandbox outside
 * production; in production an override must stay on the official hosts over
 * HTTPS, so a config edit can never redirect a live API token elsewhere.
 */
import { z } from "zod";

import { SupplierHttpError, SupplierPreflightError } from "./errors";
import { adapterLogger } from "../lib/logger";

import type {
  CapabilityReadiness,
  ProviderHealth,
  SupplierContext,
} from "./types";

export type HttpSupplierAdapter = "duffel" | "nuitee";

const SECRET_REF = /^[A-Za-z0-9_]+$/;

export const httpConfigSchema = z
  .object({
    /** Override of the supplier's API base URL (official hosts only in production). */
    baseUrl: z.string().url().optional(),
    /** Name of the secret holding the API token / key. */
    secretRef: z.string().regex(SECRET_REF).optional(),
    /** Name of the secret holding the webhook signing secret / token. */
    webhookSecretRef: z.string().regex(SECRET_REF).optional(),
    /**
     * The currency UBI settles this supplier's orders in. An offer priced in
     * any other currency is not sellable here: FX is never guessed.
     */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    bookTimeoutMs: z.number().int().positive().max(180_000).optional(),
    /** Opt-in: health runs a lightweight authenticated probe. */
    probe: z.boolean().optional(),
  })
  .passthrough();

export type HttpConfig = z.infer<typeof httpConfigSchema>;

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Production configuration: `NODE_ENV=production`, or the platform-wide
 * `UBI_ENV=production|prod` (docs/security/INTERNAL_IDENTITY.md).
 */
export function isProductionEnv(): boolean {
  if (envValue("NODE_ENV") === "production") {
    return true;
  }
  const ubiEnv = envValue("UBI_ENV");
  return ubiEnv === "production" || ubiEnv === "prod";
}

export function parseHttpConfig(ctx: SupplierContext): HttpConfig {
  const parsed = httpConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    throw new SupplierPreflightError(
      "service_unavailable",
      "config_invalid",
      "the supplier configuration is not valid; no provider call was made",
      { supplierId: ctx.supplierId },
    );
  }
  return parsed.data;
}

/** The platform-injected secret for a reference, or null. */
export function resolveSecret(ref: string | undefined): string | null {
  if (ref === undefined) {
    return null;
  }
  return envValue(`TRAVEL_SECRET_${ref.toUpperCase()}`) ?? null;
}

export function credentialsPresent(ctx: SupplierContext): boolean {
  const parsed = httpConfigSchema.safeParse(ctx.config);
  return parsed.success && resolveSecret(parsed.data.secretRef) !== null;
}

export interface SupplierEndpoint {
  readonly adapter: HttpSupplierAdapter;
  /** Official base URL used when the row does not override it. */
  readonly defaultBaseUrl: string;
  /** Hosts an override may use in production. */
  readonly officialHosts: readonly string[];
  /**
   * Prefixes of the supplier's TEST-mode credentials (Duffel `duffel_test_`,
   * LiteAPI `sand_`). Such a credential books sandbox inventory — nothing a
   * traveller can fly or sleep in — so production never sells with it, exactly
   * as it never serves the fixture adapter.
   */
  readonly testCredentialPrefixes?: readonly string[];
}

/** True when `token` is a test-mode credential and this is production configuration. */
export function isTestCredentialInProduction(
  endpoint: SupplierEndpoint,
  token: string,
): boolean {
  return (
    isProductionEnv() &&
    (endpoint.testCredentialPrefixes ?? []).some((prefix) =>
      token.startsWith(prefix),
    )
  );
}

export interface ResolvedBaseUrl {
  readonly url: string;
  readonly permitted: boolean;
}

export function resolveBaseUrl(
  endpoint: SupplierEndpoint,
  configured: string | undefined,
): ResolvedBaseUrl {
  const raw = configured ?? endpoint.defaultBaseUrl;
  const url = raw.replace(/\/+$/, "");
  if (configured === undefined || !isProductionEnv()) {
    return { url, permitted: true };
  }
  try {
    const parsed = new URL(url);
    return {
      url,
      permitted:
        parsed.protocol === "https:" &&
        endpoint.officialHosts.includes(parsed.hostname),
    };
  } catch {
    return { url, permitted: false };
  }
}

export function providerName(adapter: HttpSupplierAdapter): string {
  return adapter === "duffel" ? "Duffel" : "Nuitee/LiteAPI";
}

/**
 * The gate every operation passes BEFORE it sends anything: a present
 * credential (never a test-mode one in production) and a permitted base URL.
 * Returns the token for the call.
 */
export function assertCallable(
  ctx: SupplierContext,
  endpoint: SupplierEndpoint,
  operation: string,
  baseUrlOverride?: string,
): {
  readonly token: string;
  readonly baseUrl: string;
  readonly config: HttpConfig;
} {
  const config = parseHttpConfig(ctx);
  const token = resolveSecret(config.secretRef);
  if (token === null) {
    adapterLogger.warn(
      { supplierId: ctx.supplierId, adapter: endpoint.adapter, operation },
      "live supplier call refused: credentials are not provisioned",
    );
    throw new SupplierPreflightError(
      "service_unavailable",
      "credentials_missing",
      `${providerName(endpoint.adapter)} ${operation} cannot run: the supplier credential is not provisioned; no provider call was made`,
      { adapter: endpoint.adapter, operation, credentialsPresent: false },
    );
  }
  if (isTestCredentialInProduction(endpoint, token)) {
    adapterLogger.error(
      { supplierId: ctx.supplierId, adapter: endpoint.adapter, operation },
      "live supplier call refused: a test-mode credential is configured in production",
    );
    throw new SupplierPreflightError(
      "service_unavailable",
      "test_credentials_in_production",
      `${providerName(endpoint.adapter)} ${operation} refused: the configured credential is a test-mode one, whose bookings are not real; no provider call was made`,
      { adapter: endpoint.adapter, operation },
    );
  }
  const base = resolveBaseUrl(endpoint, baseUrlOverride ?? config.baseUrl);
  if (!base.permitted) {
    throw new SupplierPreflightError(
      "service_unavailable",
      "base_url_not_permitted",
      `${providerName(endpoint.adapter)} ${operation} refused: the configured base URL is not an official supplier host; no provider call was made`,
      { adapter: endpoint.adapter, operation },
    );
  }
  return { token, baseUrl: base.url, config };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface SupplierRequest {
  readonly adapter: HttpSupplierAdapter;
  readonly operation: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs: number;
}

export interface SupplierResponse {
  readonly status: number;
  /** Parsed JSON, or null for an empty / non-JSON body. */
  readonly body: unknown;
}

/**
 * One HTTP exchange with a supplier. A response of ANY status is returned for
 * the adapter to map; only "no response" (timeout, dropped connection) throws,
 * as an AMBIGUOUS `SupplierHttpError` — the request may have been applied.
 */
export async function supplierRequest(
  request: SupplierRequest,
): Promise<SupplierResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    adapterLogger.debug(
      {
        adapter: request.adapter,
        operation: request.operation,
        status: response.status,
        latencyMs: Date.now() - started,
      },
      "supplier call answered",
    );
    return { status: response.status, body };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    adapterLogger.warn(
      {
        adapter: request.adapter,
        operation: request.operation,
        timedOut,
        latencyMs: Date.now() - started,
        err: error,
      },
      "supplier call got no answer; outcome unknown",
    );
    throw new SupplierHttpError(
      request.adapter,
      request.operation,
      null,
      timedOut ? "timeout" : "network_error",
      true,
      `${providerName(request.adapter)} ${request.operation} got no answer (${timedOut ? "timed out" : "connection failed"}); whether it took effect is unknown`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Readiness and health
// ---------------------------------------------------------------------------

export interface CapabilitySpec {
  readonly implemented: boolean;
  /** For an unsupported capability: the supported alternative. */
  readonly alternative?: string;
}

/** The capabilities that must all be operational for the supplier to sell. */
export const CORE_CAPABILITIES = [
  "search",
  "refreshOffer",
  "book",
  "lookup",
] as const;

export type ProbeOutcome = "ok" | "failed" | "not_run";

export interface HttpSupplierHealth extends ProviderHealth {
  readonly implemented: boolean;
  readonly operational: boolean;
  readonly credentialsPresent: boolean;
  readonly reason: string;
  readonly probe: ProbeOutcome;
  readonly capabilities: Readonly<Record<string, CapabilityReadiness>>;
}

/**
 * Builds the health report. `probe` runs only when the row opts in, the
 * credential is present and the base URL is permitted.
 */
export interface HealthExtras {
  /** The adapter's own, stricter config validation (e.g. a required currency). */
  readonly configValid?: boolean;
  /**
   * Per-capability blockers the adapter enforces at call time (e.g. LiteAPI
   * `book` without a configured payment method), so each capability's health
   * says exactly why it would refuse.
   */
  readonly capabilityBlockers?: Readonly<Record<string, string>>;
}

export async function httpSupplierHealth(
  ctx: SupplierContext,
  endpoint: SupplierEndpoint,
  specs: Readonly<Record<string, CapabilitySpec>>,
  probe: () => Promise<boolean>,
  extras: HealthExtras = {},
): Promise<HttpSupplierHealth> {
  const parsed = httpConfigSchema.safeParse(ctx.config);
  const config =
    parsed.success && extras.configValid !== false ? parsed.data : null;
  const token = config === null ? null : resolveSecret(config.secretRef);
  const present = token !== null;
  const testCredential =
    token !== null && isTestCredentialInProduction(endpoint, token);
  const base =
    config === null
      ? { url: endpoint.defaultBaseUrl, permitted: false }
      : resolveBaseUrl(endpoint, config.baseUrl);
  const wantsProbe = config?.probe === true;

  let probeOutcome: ProbeOutcome = "not_run";
  if (wantsProbe && present && !testCredential && base.permitted) {
    try {
      probeOutcome = (await probe()) ? "ok" : "failed";
    } catch {
      probeOutcome = "failed";
    }
  }

  let blocker: string | null = null;
  if (config === null) {
    blocker = "config_invalid";
  } else if (!present) {
    blocker = "credentials_missing";
  } else if (testCredential) {
    blocker = "test_credentials_in_production";
  } else if (!base.permitted) {
    blocker = "base_url_not_permitted";
  } else if (wantsProbe && probeOutcome !== "ok") {
    blocker = "probe_failed";
  }

  const capabilities: Record<string, CapabilityReadiness> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (!spec.implemented) {
      capabilities[name] = {
        implemented: false,
        operational: false,
        reason: "unsupported_by_supplier",
        ...(spec.alternative === undefined
          ? {}
          : { alternative: spec.alternative }),
      };
      continue;
    }
    const own = blocker ?? extras.capabilityBlockers?.[name] ?? null;
    capabilities[name] = {
      implemented: true,
      operational: own === null,
      reason: own ?? "operational",
    };
  }

  const operational = CORE_CAPABILITIES.every(
    (name) => capabilities[name]?.operational === true,
  );
  const name = providerName(endpoint.adapter);
  const coreBlocker =
    CORE_CAPABILITIES.map((core) => capabilities[core])
      .map((readiness) =>
        readiness !== undefined && !readiness.operational
          ? readiness.reason
          : null,
      )
      .find((value) => value !== null) ?? null;
  const reason = blocker ?? coreBlocker ?? "operational";
  const note =
    reason === "operational"
      ? `${name} mapping implemented and credentialed${probeOutcome === "ok" ? "; probe succeeded" : "; not probed (reachability unproven)"}`
      : `${name} mapping implemented but not operational: ${reason.replace(/_/g, " ")} (credentials ${present ? "present" : "not provisioned"} — credentials alone never make a supplier live)`;

  return {
    supplierId: ctx.supplierId,
    adapter: endpoint.adapter,
    reachable: probeOutcome === "ok",
    liveCallsBlocked: !operational,
    implemented: true,
    operational,
    credentialsPresent: present,
    reason,
    probe: probeOutcome,
    capabilities,
    note,
  };
}
