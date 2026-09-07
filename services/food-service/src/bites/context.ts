/**
 * The dependencies every Bites action needs.
 *
 * They are injected rather than imported so the service entrypoint can wire the
 * real singletons and the tests can wire a real, isolated database with a fake
 * payment service — with no mock layer anywhere in `src/`.
 */
import type { CityConfigProvider } from "./city-config.js";
import type { PaymentPort } from "./payment-port.js";
import type { BitesDb } from "./lib/types.js";

export interface BitesDeps {
  readonly db: BitesDb;
  readonly config: CityConfigProvider;
  readonly payments: PaymentPort;
  /** Injected so issue-window and ETA arithmetic is testable without waiting. */
  readonly now: () => Date;
}
