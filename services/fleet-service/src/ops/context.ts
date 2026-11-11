/**
 * The dependencies every fleet flow needs, injected so src/index.ts wires the
 * real singletons and the tests wire a real, isolated database with faithful
 * HTTP doubles of ride-service (contract A) and user-service (/auth/pin/verify)
 * — with no mock layer anywhere in src/.
 */
import type { CityConfigProvider } from "./config";
import type { FleetDb } from "./types";
import type { DocStore } from "../ports/doc-store";
import type { PaymentPort } from "../ports/payment-port";
import type { PinPort } from "../ports/pin-port";
import type { RidePort } from "../ports/ride-port";

export interface FleetDeps {
  readonly db: FleetDb;
  readonly config: CityConfigProvider;
  /** ride-service's occupancy ledger and bookings (internal contract A). */
  readonly rides: RidePort;
  /** user-service's wallet-PIN check, called with the relayed driver context. */
  readonly pins: PinPort;
  /** payment-service's weekly money & remittance view (CC-A02, DEC-9 = A, Q7). */
  readonly payments?: PaymentPort;
  /** Private S3-compatible document storage for KYB and vehicle documents (CC-C02 / P1-05). */
  readonly docs?: DocStore;
  readonly now: () => Date;
}
