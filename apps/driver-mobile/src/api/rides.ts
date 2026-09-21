// Ride execution against ride-service THROUGH the gateway (C05 / G01).
// Route table verified in services/ride-service/internal/handler/rides.go:
//   GET  /v1/rides/active                 -> RideView | 204 (no active ride)
//   GET  /v1/rides/{rideId}               -> RideView (ETag = aggregate version)
//   POST /v1/rides/{rideId}/arrived       -> RideView (requires a fresh, in-geofence
//                                             driver position — see lib/location.ts)
//   POST /v1/rides/{rideId}/verify-pin    { pin } -> PinResultView
//   POST /v1/rides/{rideId}/start         -> RideView (requires a verified PIN)
//   POST /v1/rides/{rideId}/complete      -> RideView (server computes the total;
//                                             no amount is ever sent from the client)
//   POST /v1/rides/{rideId}/cancel        { reasonCode } -> RideView (a driver
//                                             cancellation MUST carry a reason code)
//   GET  /v1/drivers/me/status            -> DriverStatusView
//   POST /v1/drivers/me/status            { online, filters } -> DriverStatusView
//   POST /v1/drivers/me/locations         { points: LocationPoint[] } -> LocationBatchResult
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

/** move.PinResultView — the answer to a PIN attempt. */
export type PinResultView = {
  verified: boolean;
  attemptsLeft: number;
  ride?: RideView;
};

export type DriverStatusView = {
  driverId: string;
  state: string;
  online: boolean;
  version: number;
  cityId: string;
  vehicleClasses: string[];
  currentRideId?: string | null;
  onlineSince?: string | null;
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
export const isCash = (view: Pick<RideView, "paymentMethodId">) =>
  view.paymentMethodId.toLowerCase().includes("cash");

export const ridesApi = {
  ride: (rideId: string) =>
    api<RideView>("GET", "/v1/rides/" + encodeURIComponent(rideId)),
  /** 204 (no body) means no active ride; api() then resolves undefined. */
  active: () => api<RideView | undefined>("GET", "/v1/rides/active"),
  arrived: (rideId: string) =>
    api<RideView>(
      "POST",
      "/v1/rides/" + encodeURIComponent(rideId) + "/arrived",
    ),
  verifyPin: (rideId: string, pin: string) =>
    api<PinResultView>(
      "POST",
      "/v1/rides/" + encodeURIComponent(rideId) + "/verify-pin",
      { pin },
    ),
  start: (rideId: string) =>
    api<RideView>("POST", "/v1/rides/" + encodeURIComponent(rideId) + "/start"),
  complete: (rideId: string) =>
    api<RideView>(
      "POST",
      "/v1/rides/" + encodeURIComponent(rideId) + "/complete",
    ),
  cancel: (rideId: string, reasonCode: string) =>
    api<RideView>(
      "POST",
      "/v1/rides/" + encodeURIComponent(rideId) + "/cancel",
      { reasonCode },
    ),
  status: () => api<DriverStatusView>("GET", "/v1/drivers/me/status"),
  setStatus: (online: boolean, vehicleClasses: string[] = []) =>
    api<DriverStatusView>("POST", "/v1/drivers/me/status", {
      online,
      filters: { vehicleClasses },
    }),
};

/**
 * The closed set of cancellation reasons the server accepts
 * (services/ride-service/internal/domain/ride.go CancellationReasons). A
 * driver cancellation must carry one of these exactly — an unknown code is
 * refused rather than stored, so this list is not an app-side guess.
 */
export const DRIVER_CANCEL_REASONS: readonly {
  code: string;
  label: string;
}[] = [
  { code: "rider_no_show", label: "Rider didn’t show up" },
  { code: "rider_unreachable", label: "Can’t reach the rider" },
  { code: "wrong_pickup", label: "Pickup location is wrong" },
  { code: "vehicle_issue", label: "Vehicle issue" },
  { code: "traffic", label: "Traffic made this unworkable" },
  { code: "unsafe", label: "Safety concern" },
  { code: "other", label: "Other" },
];
