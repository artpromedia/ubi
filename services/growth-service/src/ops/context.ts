/**
 * The dependencies every growth action needs.
 *
 * They are injected rather than imported so `src/index.ts` can wire the real
 * singletons and the tests can wire a real, isolated database with a fake ledger
 * — with no mock layer anywhere in `src/`.
 */
import type { FlagProvider } from "./config";
import type { LedgerPort } from "./ledger-port";
import type { GrowthDb } from "./types";

export interface GrowthDeps {
  readonly db: GrowthDb;
  readonly flags: FlagProvider;
  readonly ledger: LedgerPort;
  /** Injected so window, expiry and SLA arithmetic is testable without waiting. */
  readonly now: () => Date;
}
