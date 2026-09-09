/**
 * The dependencies every travel flow needs.
 *
 * They are injected rather than imported so `src/index.ts` can wire the real
 * singletons and the tests can wire a real, isolated database with a fake
 * payment port — with no mock layer anywhere in `src/`. The supply adapters are
 * resolved from the supplier row's `adapter` column, so a test seeds a `fixture`
 * supplier and production seeds `duffel` / `nuitee`, and the flows are identical.
 */
import type { CityConfigProvider } from "./config";
import type { PaymentPort } from "../ports/payment-port";
import type { TravelDb } from "./types";

export interface TravelDeps {
  readonly db: TravelDb;
  readonly config: CityConfigProvider;
  readonly payment: PaymentPort;
  /** Injected so cache/hold/expiry arithmetic is testable without waiting. */
  readonly now: () => Date;
}
