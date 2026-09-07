/**
 * The dependencies every ops action needs.
 *
 * They are injected rather than imported so `src/index.ts` can wire the real
 * singletons and the tests can wire a real, isolated database with a fake ledger
 * and a fake notifier — with no mock layer anywhere in `src/`.
 */
import type { CityConfigProvider } from "./city-config";
import type { LedgerPort } from "./ledger-port";
import type { SafetyNotifier } from "./notifier";
import type { SupportDb } from "./types";

export interface SupportDeps {
  readonly db: SupportDb;
  readonly config: CityConfigProvider;
  readonly ledger: LedgerPort;
  readonly notifier: SafetyNotifier;
  /** Injected so SLA and backoff arithmetic is testable without waiting. */
  readonly now: () => Date;
}
