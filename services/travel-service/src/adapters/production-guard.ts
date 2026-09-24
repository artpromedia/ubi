/**
 * Boot-time refusal of test-only supply in production (recheck P04:
 * "Disable fixture adapters in production configuration").
 *
 * The fixture adapter answers from a catalog in its config row — it books
 * nothing real. In production configuration the service refuses to START
 * while any `travel_suppliers` row names it, enabled or not: a disabled row
 * could be flipped on at runtime without a reboot, and the registry refuses
 * resolution then as well (./registry.ts). A clear, fatal boot error is the
 * point — never a warning that scrolls past.
 */
import { isProductionEnv } from "./http-supplier";
import { NON_PRODUCTION_ADAPTERS } from "./registry";

import type { TravelTx } from "../ops/types";

export class ProductionSupplyConfigError extends Error {
  constructor(readonly offending: readonly { id: string; adapter: string }[]) {
    super(
      `travel-service refuses to start in production: supplier row(s) ${offending
        .map((row) => `${row.id} (${row.adapter})`)
        .join(", ")} use a test-only adapter`,
    );
    this.name = "ProductionSupplyConfigError";
  }
}

/**
 * Throws `ProductionSupplyConfigError` when production configuration would
 * be able to select a test-only adapter. A no-op outside production.
 */
export async function assertProductionSupplyConfig(
  db: TravelTx,
  production: boolean = isProductionEnv(),
): Promise<void> {
  if (!production) {
    return;
  }
  const rows = await db.travelSupplier.findMany({
    where: { adapter: { in: [...NON_PRODUCTION_ADAPTERS] } },
    select: { id: true, adapter: true },
    orderBy: { id: "asc" },
  });
  if (rows.length > 0) {
    throw new ProductionSupplyConfigError(rows);
  }
}
