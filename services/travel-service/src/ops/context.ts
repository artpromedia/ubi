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
import type { TravelDb } from "./types";
import type { PaymentPort } from "../ports/payment-port";
import type { RidePort } from "../ports/ride-port";

export interface TravelDeps {
  readonly db: TravelDb;
  readonly config: CityConfigProvider;
  readonly payment: PaymentPort;
  /**
   * ride-service's Book for Later marketplace, called as the traveller with a
   * signed identity: airport transfers become scheduled ride requests there.
   */
  readonly rides: RidePort;
  /** Injected so cache/hold/expiry arithmetic is testable without waiting. */
  readonly now: () => Date;
}
