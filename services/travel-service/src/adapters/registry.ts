/**
 * Resolves a `travel_suppliers` row to a concrete adapter.
 *
 * The mapping is closed: `fixture` (DEV/TEST deterministic catalog), `duffel`
 * (live flights), `nuitee` (live stays). An unknown adapter name is refused
 * rather than guessed. A flight order can only be serviced by a flight adapter
 * and a stay order by a stay adapter — the registry enforces that the row's
 * `kind` and the adapter's `kind` agree, so a hotel adapter can never be asked
 * to book a flight (CLAUDE.md #23).
 *
 * The fixture adapter cannot be selected in production configuration: the
 * service refuses to boot with a fixture row (./production-guard.ts), and —
 * should a row be flipped after boot — resolution refuses here too.
 */
import { ContractError } from "@ubi/contracts";

import { createDuffelFlightAdapter } from "./duffel";
import {
  createFixtureFlightAdapter,
  createFixtureStayAdapter,
} from "./fixture";
import { isProductionEnv } from "./http-supplier";
import { createNuiteeStayAdapter } from "./liteapi";

import type {
  FlightSupplyAdapter,
  StaySupplyAdapter,
  SupplyAdapter,
} from "./types";

export interface SupplierRow {
  readonly id: string;
  readonly kind: string;
  readonly adapter: string;
  readonly enabled: boolean;
}

export type AdapterFactory = () => SupplyAdapter;

/** Adapters that serve DEV/TEST only and may never run in production. */
export const NON_PRODUCTION_ADAPTERS: ReadonlySet<string> = new Set([
  "fixture",
]);

function refuseInProduction(row: SupplierRow): void {
  if (NON_PRODUCTION_ADAPTERS.has(row.adapter) && isProductionEnv()) {
    throw new ContractError(
      "service_unavailable",
      "this supplier uses a test-only adapter, which production never serves",
      { supplierId: row.id, adapter: row.adapter },
    );
  }
}

const FLIGHT_ADAPTERS: Readonly<Record<string, () => FlightSupplyAdapter>> = {
  fixture: createFixtureFlightAdapter,
  duffel: createDuffelFlightAdapter,
};

const STAY_ADAPTERS: Readonly<Record<string, () => StaySupplyAdapter>> = {
  fixture: createFixtureStayAdapter,
  nuitee: createNuiteeStayAdapter,
};

export function resolveFlightAdapter(row: SupplierRow): FlightSupplyAdapter {
  if (row.kind !== "flight") {
    throw new ContractError(
      "validation_failed",
      "this supplier is not a flight supplier",
      { supplierId: row.id, kind: row.kind },
    );
  }
  refuseInProduction(row);
  const factory = FLIGHT_ADAPTERS[row.adapter];
  if (factory === undefined) {
    throw new ContractError(
      "service_unavailable",
      "no flight adapter is registered for this supplier",
      { supplierId: row.id, adapter: row.adapter },
    );
  }
  return factory();
}

export function resolveStayAdapter(row: SupplierRow): StaySupplyAdapter {
  if (row.kind !== "stay") {
    throw new ContractError(
      "validation_failed",
      "this supplier is not a stay supplier",
      { supplierId: row.id, kind: row.kind },
    );
  }
  refuseInProduction(row);
  const factory = STAY_ADAPTERS[row.adapter];
  if (factory === undefined) {
    throw new ContractError(
      "service_unavailable",
      "no stay adapter is registered for this supplier",
      { supplierId: row.id, adapter: row.adapter },
    );
  }
  return factory();
}

/** For servicing an existing order, whose kind is known from the order row. */
export function resolveAdapter(row: SupplierRow): SupplyAdapter {
  return row.kind === "flight"
    ? resolveFlightAdapter(row)
    : resolveStayAdapter(row);
}
