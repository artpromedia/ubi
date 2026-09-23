/**
 * The Duffel (flights) and Nuitee/LiteAPI (stays) adapters.
 *
 * NOT IMPLEMENTED YET (recheck T01). These implement the SAME interfaces as
 * the fixture adapter, but no provider request/response mapping exists in this
 * build: every business operation — search, rates, refresh, book, lookup,
 * change, cancel, refund, status, reconcile — refuses with
 * `service_unavailable` (`implemented: false`, `liveCallsBlocked: true`) and
 * makes no provider call, WHETHER OR NOT credentials are provisioned. Adding a
 * secret does not add a mapping.
 *
 * `providerHealth` says exactly that (CLAUDE.md #8, the honesty rule): it
 * never reports a supplier as reachable or its live calls as unblocked just
 * because credentials are present, and it lists each capability as
 * `implemented: false, operational: false` with the reason — so an ops
 * dashboard or a readiness gate can never show a stub supplier as live.
 * Credentials presence is reported separately, as the external dependency it
 * is, distinct from the missing mapping. When a mapping lands it reads its
 * token through `secretRef` (never a secret literal in code), and that
 * capability — only that one — may then report itself implemented.
 *
 * Duffel is flights; Nuitee is stays. Flight support is NEVER inferred from the
 * hotel API (CLAUDE.md — "do NOT infer Nuitee flight support from a hotel API").
 */
/* eslint-disable require-await -- the SupplyAdapter interfaces are async by contract; these unimplemented shells refuse synchronously */
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { adapterLogger } from "../lib/logger";

import type {
  AdapterOffer,
  BookRequest,
  BookResult,
  CancelRequest,
  CancelResult,
  ChangeRequest,
  ChangeResult,
  FlightSearchParams,
  FlightSupplyAdapter,
  LookupResult,
  OfferValidation,
  ProviderHealth,
  RefundRequest,
  RefundResult,
  SearchResult,
  StaySearchParams,
  StaySupplyAdapter,
  StatusResult,
  SupplierContext,
} from "./types";
import type { JsonRecord } from "../ops/types";

const httpConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
  /** Name of the secret holding the API token; resolved by the platform vault. */
  secretRef: z.string().optional(),
});

export type HttpSupplierAdapter = "duffel" | "nuitee";

/** The operations each live adapter exposes — every one of them unimplemented today. */
const SERVICING_CAPABILITIES = [
  "refreshOffer",
  "book",
  "lookup",
  "change",
  "cancel",
  "refund",
  "status",
  "reconcile",
] as const;

const CAPABILITIES: Readonly<Record<HttpSupplierAdapter, readonly string[]>> = {
  duffel: ["search", ...SERVICING_CAPABILITIES],
  nuitee: ["search", "rates", ...SERVICING_CAPABILITIES],
};

/** Why a capability cannot serve: the one reason that is true in this build. */
export const NOT_IMPLEMENTED_REASON = "not_implemented";

export interface CapabilityReadiness {
  /** A request/response mapping exists for this operation. */
  readonly implemented: boolean;
  /** The operation can serve live traffic right now. */
  readonly operational: boolean;
  readonly reason: string;
}

/**
 * ProviderHealth plus the per-capability truth. It is a structural subtype, so
 * the adapter still satisfies `ServicingAdapter.providerHealth`.
 */
export interface HttpSupplierHealth extends ProviderHealth {
  readonly reachable: false;
  readonly liveCallsBlocked: true;
  readonly implemented: false;
  readonly operational: false;
  readonly reason: typeof NOT_IMPLEMENTED_REASON;
  /** The external dependency, reported apart from the missing mapping. */
  readonly credentialsPresent: boolean;
  readonly capabilities: Readonly<Record<string, CapabilityReadiness>>;
}

function providerName(adapter: HttpSupplierAdapter): string {
  return adapter === "duffel" ? "Duffel" : "Nuitee/LiteAPI";
}

/**
 * True only when the config carries a resolvable secret AND the platform has
 * injected it. Reported for visibility; it does not — and cannot — make any
 * operation work while the mapping is missing.
 */
function credentialsPresent(ctx: SupplierContext): boolean {
  const parsed = httpConfigSchema.safeParse(ctx.config);
  if (!parsed.success || parsed.data.secretRef === undefined) {
    return false;
  }
  const envKey = `TRAVEL_SECRET_${parsed.data.secretRef.toUpperCase()}`;
  const value = process.env[envKey];
  return typeof value === "string" && value !== "";
}

/**
 * Refuses a live call honestly: no mapping exists, so no provider request was
 * made — not "no credentials", which would imply adding one would fix it.
 */
function notImplemented(
  ctx: SupplierContext,
  adapter: HttpSupplierAdapter,
  operation: string,
): never {
  const present = credentialsPresent(ctx);
  adapterLogger.warn(
    {
      supplierId: ctx.supplierId,
      adapter,
      operation,
      credentialsPresent: present,
    },
    "live supplier call refused: the provider mapping is not implemented",
  );
  throw new ContractError(
    "service_unavailable",
    `${providerName(adapter)} ${operation} is not implemented in this build; no provider call was made`,
    {
      adapter,
      operation,
      implemented: false,
      liveCallsBlocked: true,
      credentialsPresent: present,
    },
  );
}

/** The health report for a live adapter: truthful per capability, never green on credentials alone. */
export function httpSupplierHealth(
  ctx: SupplierContext,
  adapter: HttpSupplierAdapter,
): HttpSupplierHealth {
  const present = credentialsPresent(ctx);
  const capabilities: Record<string, CapabilityReadiness> = {};
  for (const capability of CAPABILITIES[adapter]) {
    capabilities[capability] = {
      implemented: false,
      operational: false,
      reason: NOT_IMPLEMENTED_REASON,
    };
  }
  return {
    supplierId: ctx.supplierId,
    adapter,
    // No provider call is ever made, so reachability is unproven — and with
    // every operation refusing, the supplier is not usable either way.
    reachable: false,
    liveCallsBlocked: true,
    implemented: false,
    operational: false,
    reason: NOT_IMPLEMENTED_REASON,
    credentialsPresent: present,
    capabilities,
    note: `${providerName(adapter)} supplier mapping is not implemented; every live call is refused (credentials ${present ? "present" : "not provisioned"} — credentials alone do not make a supplier live)`,
  };
}

function servicing(adapter: HttpSupplierAdapter): {
  refreshOffer(
    ctx: SupplierContext,
    offerRef: string,
  ): Promise<OfferValidation>;
  book(ctx: SupplierContext, request: BookRequest): Promise<BookResult>;
  lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  change(ctx: SupplierContext, request: ChangeRequest): Promise<ChangeResult>;
  cancel(ctx: SupplierContext, request: CancelRequest): Promise<CancelResult>;
  refund(ctx: SupplierContext, request: RefundRequest): Promise<RefundResult>;
  status(ctx: SupplierContext, ourRef: string): Promise<StatusResult>;
  reconcile(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  providerHealth(ctx: SupplierContext): Promise<HttpSupplierHealth>;
} {
  return {
    async refreshOffer(
      ctx: SupplierContext,
      offerRef: string,
    ): Promise<OfferValidation> {
      void offerRef;
      notImplemented(ctx, adapter, "refreshOffer");
    },
    async book(
      ctx: SupplierContext,
      request: BookRequest,
    ): Promise<BookResult> {
      void request;
      notImplemented(ctx, adapter, "book");
    },
    async lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult> {
      void ourRef;
      notImplemented(ctx, adapter, "lookup");
    },
    async change(
      ctx: SupplierContext,
      request: ChangeRequest,
    ): Promise<ChangeResult> {
      void request;
      notImplemented(ctx, adapter, "change");
    },
    async cancel(
      ctx: SupplierContext,
      request: CancelRequest,
    ): Promise<CancelResult> {
      void request;
      notImplemented(ctx, adapter, "cancel");
    },
    async refund(
      ctx: SupplierContext,
      request: RefundRequest,
    ): Promise<RefundResult> {
      void request;
      notImplemented(ctx, adapter, "refund");
    },
    async status(ctx: SupplierContext, ourRef: string): Promise<StatusResult> {
      void ourRef;
      notImplemented(ctx, adapter, "status");
    },
    async reconcile(
      ctx: SupplierContext,
      ourRef: string,
    ): Promise<LookupResult> {
      void ourRef;
      notImplemented(ctx, adapter, "reconcile");
    },
    async providerHealth(ctx: SupplierContext): Promise<HttpSupplierHealth> {
      return httpSupplierHealth(ctx, adapter);
    },
  };
}

/** Duffel — flights only. */
export function createDuffelFlightAdapter(): FlightSupplyAdapter {
  const base = servicing("duffel");
  return {
    adapter: "duffel",
    kind: "flight",
    async search(
      ctx: SupplierContext,
      params: FlightSearchParams,
    ): Promise<SearchResult> {
      void params;
      notImplemented(ctx, "duffel", "search");
    },
    ...base,
  };
}

/** Nuitee / LiteAPI — stays only. Never a flight source. */
export function createNuiteeStayAdapter(): StaySupplyAdapter {
  const base = servicing("nuitee");
  return {
    adapter: "nuitee",
    kind: "stay",
    async search(
      ctx: SupplierContext,
      params: StaySearchParams,
    ): Promise<SearchResult> {
      void params;
      notImplemented(ctx, "nuitee", "search");
    },
    async rates(
      ctx: SupplierContext,
      propertyId: string,
    ): Promise<readonly AdapterOffer[]> {
      void propertyId;
      notImplemented(ctx, "nuitee", "rates");
    },
    ...base,
  };
}

export type { JsonRecord };
