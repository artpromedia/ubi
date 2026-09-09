/**
 * The real Duffel (flights) and Nuitee/LiteAPI (stays) adapters.
 *
 * These are thin HTTP shells that implement the SAME interfaces as the fixture
 * adapter. They read a secret reference from the supplier config (never a secret
 * literal in code) and call the provider over HTTPS.
 *
 * LIVE CALLS ARE EXTERNALLY BLOCKED in this environment: there are no provider
 * credentials here and no model serving. Rather than pretend, every call fails
 * loudly with `service_unavailable` and `liveCallsBlocked: true` on health, so
 * the honesty rule holds (CLAUDE.md #8) — an unconfigured provider is shown as
 * unavailable, never silently faked. When credentials are provisioned, the
 * request/response mapping is filled in behind `secretRef`; the interface does
 * not change.
 *
 * Duffel is flights; Nuitee is stays. Flight support is NEVER inferred from the
 * hotel API (CLAUDE.md — "do NOT infer Nuitee flight support from a hotel API").
 */
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { adapterLogger } from "../lib/logger";

import type { JsonRecord } from "../ops/types";
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

const httpConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
  /** Name of the secret holding the API token; resolved by the platform vault. */
  secretRef: z.string().optional(),
});

function providerName(adapter: string): string {
  return adapter === "duffel" ? "Duffel" : adapter === "nuitee" ? "Nuitee/LiteAPI" : adapter;
}

/**
 * True only when the config carries a resolvable secret AND the platform has
 * injected it. In this environment neither holds, so it is always false and
 * every mutating call is refused rather than faked.
 */
function credentialsPresent(ctx: SupplierContext, adapter: string): boolean {
  const parsed = httpConfigSchema.safeParse(ctx.config);
  if (!parsed.success || parsed.data.secretRef === undefined) {
    return false;
  }
  const envKey = `TRAVEL_SECRET_${parsed.data.secretRef.toUpperCase()}`;
  const present = typeof process.env[envKey] === "string" && process.env[envKey] !== "";
  if (!present) {
    adapterLogger.warn(
      { supplierId: ctx.supplierId, adapter },
      "live provider credentials absent; calls are blocked",
    );
  }
  return present;
}

function blocked(adapter: string): never {
  throw new ContractError(
    "service_unavailable",
    `${providerName(adapter)} live calls are not available in this environment (no credentials provisioned)`,
    { adapter, liveCallsBlocked: true },
  );
}

function servicing(adapter: string): {
  refreshOffer(ctx: SupplierContext, offerRef: string): Promise<OfferValidation>;
  book(ctx: SupplierContext, request: BookRequest): Promise<BookResult>;
  lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  change(ctx: SupplierContext, request: ChangeRequest): Promise<ChangeResult>;
  cancel(ctx: SupplierContext, request: CancelRequest): Promise<CancelResult>;
  refund(ctx: SupplierContext, request: RefundRequest): Promise<RefundResult>;
  status(ctx: SupplierContext, ourRef: string): Promise<StatusResult>;
  reconcile(ctx: SupplierContext, ourRef: string): Promise<LookupResult>;
  providerHealth(ctx: SupplierContext): Promise<ProviderHealth>;
} {
  return {
    async refreshOffer(ctx: SupplierContext, offerRef: string): Promise<OfferValidation> {
      void offerRef;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async book(ctx: SupplierContext, request: BookRequest): Promise<BookResult> {
      void request;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async lookup(ctx: SupplierContext, ourRef: string): Promise<LookupResult> {
      void ourRef;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async change(ctx: SupplierContext, request: ChangeRequest): Promise<ChangeResult> {
      void request;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async cancel(ctx: SupplierContext, request: CancelRequest): Promise<CancelResult> {
      void request;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async refund(ctx: SupplierContext, request: RefundRequest): Promise<RefundResult> {
      void request;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async status(ctx: SupplierContext, ourRef: string): Promise<StatusResult> {
      void ourRef;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async reconcile(ctx: SupplierContext, ourRef: string): Promise<LookupResult> {
      void ourRef;
      credentialsPresent(ctx, adapter);
      blocked(adapter);
    },
    async providerHealth(ctx: SupplierContext): Promise<ProviderHealth> {
      const present = credentialsPresent(ctx, adapter);
      return {
        supplierId: ctx.supplierId,
        adapter,
        reachable: present,
        liveCallsBlocked: !present,
        note: present
          ? `${providerName(adapter)} configured`
          : `${providerName(adapter)} credentials not provisioned (externally blocked)`,
      };
    },
  };
}

/** Duffel — flights only. */
export function createDuffelFlightAdapter(): FlightSupplyAdapter {
  const base = servicing("duffel");
  return {
    adapter: "duffel",
    kind: "flight",
    async search(ctx: SupplierContext, params: FlightSearchParams): Promise<SearchResult> {
      void params;
      credentialsPresent(ctx, "duffel");
      blocked("duffel");
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
    async search(ctx: SupplierContext, params: StaySearchParams): Promise<SearchResult> {
      void params;
      credentialsPresent(ctx, "nuitee");
      blocked("nuitee");
    },
    async rates(
      ctx: SupplierContext,
      propertyId: string,
    ): Promise<readonly AdapterOffer[]> {
      void propertyId;
      credentialsPresent(ctx, "nuitee");
      blocked("nuitee");
    },
    ...base,
  };
}

export type { JsonRecord };
