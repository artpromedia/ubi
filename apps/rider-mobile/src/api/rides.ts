// Ride execution against ride-service THROUGH the gateway (C05 / G01).
// Route table verified in services/ride-service/internal/handler/rides.go:
//   GET  /v1/rides/active            -> RideView | 204 (no active ride)
//   GET  /v1/rides/{rideId}          -> RideView (ETag = aggregate version)
//   POST /v1/rides/{rideId}/cancel   -> RideView ({ reasonCode } optional for riders)
// Money on the wire is bare minor units plus the ride's single `currency`
// field (move.RideView); rideMoney composes the server's own numbers into the
// Money shape the shared formatter renders — composition, never arithmetic.
import { api, type Money } from "@ubi/mobile-core";

export type RidePlace = { lat: number; lng: number; address?: string };

export type RideDriverSummary = { driverId: string; etaSeconds?: number };

/** move.RideView as served (state = canonical machine state, status = board word). */
export type RideView = {
  rideId: string;
  state: string;
  status: string;
  version: number;
  cityId: string;
  configVersion: number;
  vehicleClass: string;
  paymentMethodId: string;
  pickup: RidePlace;
  dropoff: RidePlace;
  currency: string;
  quotedFareMinor: number;
  waitFeeMinor: number;
  finalFareMinor?: number | null;
  fareSource?: string;
  driver?: RideDriverSummary | null;
  pinRequired: boolean;
  pinVerified: boolean;
  pinLocked: boolean;
  cancelReasonCode?: string;
  cancelledByRole?: string;
  requestedAt: string;
  assignedAt?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  updatedAt: string;
  options?: string[];
};

/** Server minor units + the view's own currency, composed for display only. */
export const rideMoney = (
  view: Pick<RideView, "currency">,
  amountMinor: number | null | undefined,
): Money | null =>
  amountMinor === null || amountMinor === undefined
    ? null
    : { amountMinor, currency: view.currency };

const TERMINAL_PREFIXES = ["cancelled", "no_show"];
export const isTerminalCancel = (state: string) =>
  TERMINAL_PREFIXES.some((p) => state.startsWith(p));
export const isCompleted = (state: string) =>
  state === "completed" ||
  state === "payment_pending" ||
  state === "payment_failed" ||
  state === "rated";

export const ridesApi = {
  ride: (rideId: string) =>
    api<RideView>("GET", "/v1/rides/" + encodeURIComponent(rideId)),
  /** 204 (no body) means no active ride; api() then resolves undefined. */
  active: () => api<RideView | undefined>("GET", "/v1/rides/active"),
  cancel: (rideId: string, reasonCode?: string) =>
    api<RideView>(
      "POST",
      "/v1/rides/" + encodeURIComponent(rideId) + "/cancel",
      reasonCode ? { reasonCode } : {},
    ),
};
