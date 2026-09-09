/**
 * Resolves a `travel_suppliers` row to a concrete adapter.
 *
 * The mapping is closed: `fixture` (DEV/TEST deterministic catalog), `duffel`
 * (live flights), `nuitee` (live stays). An unknown adapter name is refused
 * rather than guessed. A flight order can only be serviced by a flight adapter
 * and a stay order by a stay adapter — the registry enforces that the row's
 * `kind` and the adapter's `kind` agree, so a hotel adapter can never be asked
 * to book a flight (CLAUDE.md #23).
 */
import { ContractError } from "@ubi/contracts";

import {
  createDuffelFlightAdapter,
  createNuiteeStayAdapter,
} from "./http-supplier";
import {
  createFixtureFlightAdapter,
  createFixtureStayAdapter,
} from "./fixture";

import type { FlightSupplyAdapter, StaySupplyAdapter, SupplyAdapter } from "./types";

export interface SupplierRow {
  readonly id: string;
  readonly kind: string;
  readonly adapter: string;
  readonly enabled: boolean;
}

export type AdapterFactory = () => SupplyAdapter;

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
