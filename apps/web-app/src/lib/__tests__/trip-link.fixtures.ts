/**
 * Contract-true trip-link fixtures: each is parsed through the REAL @ubi/contracts schema
 * (imported from its source — the web app does not depend on the package), so a fixture that
 * drifts from what ride-service serves fails the tests instead of passing on a wrong shape.
 */
import {
  MpTripAccessPinSchema,
  MpTripAccessViewSchema,
} from "../../../../../packages/contracts/src/marketplace";
import type { TripAccessPin, TripAccessView } from "../trip-link";

const at = (ms: number) => new Date(Date.now() + ms).toISOString();

export const TOKEN = "uta_Q2hpZGlPYmlUcmlwTGluazAwMQ";

export function tripView(over: Partial<TripAccessView> = {}): TripAccessView {
  return MpTripAccessViewSchema.parse({
    status: "driver_on_the_way",
    statusLabel: "Your driver is on the way",
    passenger: { firstName: "Ngozi" },
    pickup: { label: "Lekki Phase 1" },
    dropoff: { label: "Victoria Island" },
    driver: {
      displayName: "Chidi Obi",
      initials: "CO",
      rating: "4.80",
      completedTrips: 212,
      vehicle: "Grey Toyota Corolla",
      plateMasked: "LAG ·· 42A",
      profileStatus: "verified",
    },
    eta: {
      label: "About 6 min away",
      etaSeconds: 360,
      basis: "routed_leg",
      asOf: at(-20_000),
    },
    pickupVerification: {
      method: "pin",
      pinAvailable: true,
      instructions: "Tell your driver your 4-digit PIN before you get in.",
    },
    support: {
      reference: "TRP-7Q2K",
      emergencyNumber: "112",
      note: "Need help? Contact UBI support with your trip reference.",
    },
    actions: {
      canDecline: true,
      declineIsFree: true,
      declineNote:
        "Declining before pickup is free. The person who booked the ride is told.",
    },
    expiresAt: at(3 * 3_600_000),
    asOf: at(-20_000),
    ...over,
  }) as TripAccessView;
}

export function tripPin(over: Partial<TripAccessPin> = {}): TripAccessPin {
  return MpTripAccessPinSchema.parse({
    pin: "4831",
    state: "driver_assigned",
    expiresAt: at(3_600_000),
    ...over,
  });
}
