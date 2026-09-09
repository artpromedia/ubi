/**
 * Loading `travel_suppliers` rows and turning them into an adapter + context.
 *
 * A supplier row carries the adapter name, the `enabled` flag and the config
 * JSON (catalog, secret ref, webhook secret). The flows never construct an
 * adapter directly; they ask here, so the `enabled` gate and the kind check are
 * enforced in one place.
 */
import { ContractError } from "@ubi/contracts";

import { resolveFlightAdapter, resolveStayAdapter } from "../adapters/registry";

import type {
  FlightSupplyAdapter,
  StaySupplyAdapter,
  SupplyAdapter,
  SupplierContext,
} from "../adapters/types";
import type { JsonRecord, TravelTx } from "./types";

export interface LoadedSupplier {
  readonly id: string;
  readonly kind: string;
  readonly adapter: string;
  readonly enabled: boolean;
  readonly config: JsonRecord;
}

interface SupplierRecord {
  id: string;
  kind: string;
  adapter: string;
  enabled: boolean;
  config: unknown;
}

function toLoaded(row: SupplierRecord): LoadedSupplier {
  return {
    id: row.id,
    kind: row.kind,
    adapter: row.adapter,
    enabled: row.enabled,
    config: (row.config ?? {}) as JsonRecord,
  };
}

export async function loadSupplier(
  db: TravelTx,
  supplierId: string,
): Promise<LoadedSupplier> {
  const row = await db.travelSupplier.findUnique({ where: { id: supplierId } });
  if (row === null) {
    throw new ContractError("not_found", "no such travel supplier", { supplierId });
  }
  return toLoaded(row);
}

/** The enabled supplier for a kind. Honest unavailability: none enabled ⇒ error. */
export async function pickSupplier(
  db: TravelTx,
  kind: "flight" | "stay",
): Promise<LoadedSupplier> {
  const rows = await db.travelSupplier.findMany({
    where: { kind, enabled: true },
    orderBy: { id: "asc" },
  });
  const row = rows[0];
  if (row === undefined) {
    throw new ContractError(
      "service_unavailable",
      `no ${kind} supplier is available right now`,
      { kind },
    );
  }
  return toLoaded(row);
}

export function contextFor(
  supplier: LoadedSupplier,
  now: () => Date,
): SupplierContext {
  return { supplierId: supplier.id, config: supplier.config, now };
}

export function flightAdapterFor(supplier: LoadedSupplier): FlightSupplyAdapter {
  return resolveFlightAdapter(supplier);
}

export function stayAdapterFor(supplier: LoadedSupplier): StaySupplyAdapter {
  return resolveStayAdapter(supplier);
}

export function adapterFor(supplier: LoadedSupplier): SupplyAdapter {
  return supplier.kind === "flight"
    ? resolveFlightAdapter(supplier)
    : resolveStayAdapter(supplier);
}
