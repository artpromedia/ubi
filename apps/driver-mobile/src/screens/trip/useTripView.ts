// Shared ride-view poller (C05), driver side. The server view is the only
// state machine — screens render `state`/`status` and never infer transitions
// of their own. Polling matches the marketplace containers' REST cadence
// (realtime WS is the sanctioned upgrade path once G10 closes).
import { useQuery } from "@tanstack/react-query";
import { ridesApi, isTerminalCancel, type RideView } from "../../api/rides";

export function useTripView(tripId: string) {
  return useQuery({
    queryKey: ["ride", tripId],
    queryFn: () => ridesApi.ride(tripId),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      if (s === undefined) return 3_000;
      if (isTerminalCancel(s) || s === "rated") return false;
      if (
        s === "completed" ||
        s === "payment_pending" ||
        s === "payment_failed"
      )
        return false; // the driver's own Complete/Cash actions drive this forward, not polling
      return 3_000;
    },
  });
}

/**
 * Where a ride in this server state is rendered for the DRIVER, used for
 * process-death recovery (GET /v1/rides/active on app resume). "driver_assigned"
 * always resolves to Navigate here — the one-time "Offer" landing screen is a
 * local step the driver has, by definition, already passed if the app is
 * recovering an in-progress trip.
 */
export function tripScreenFor(view: RideView): string {
  const s = view.state;
  if (isTerminalCancel(s)) return "Complete";
  if (s === "in_progress" || s === "safety_hold") return "InTrip";
  if (
    s === "completed" ||
    s === "payment_pending" ||
    s === "payment_failed" ||
    s === "rated"
  )
    return "Complete";
  if (s === "driver_arrived" || s === "pin_verification") return "Waiting";
  return "Navigate";
}
