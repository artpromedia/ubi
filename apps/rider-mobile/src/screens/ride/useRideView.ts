// Shared ride-view poller (C05). The server view is the only state machine —
// screens render `state`/`status` and never infer transitions of their own.
// Polling matches the marketplace containers' REST cadence (realtime WS is the
// sanctioned upgrade path once G10 closes).
import { useQuery } from "@tanstack/react-query";
import { ridesApi, isTerminalCancel, type RideView } from "../../api/rides";

export function useRideView(rideId: string) {
  return useQuery({
    queryKey: ["ride", rideId],
    queryFn: () => ridesApi.ride(rideId),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      if (s === undefined) return 3_000;
      if (isTerminalCancel(s) || s === "rated") return false;
      if (s === "completed") return 10_000; // fare/settlement fields may still land
      return 3_000;
    },
  });
}

/** Where a ride in this server state is rendered. Used by deep links and hand-offs. */
export function rideScreenFor(view: RideView): string {
  const s = view.state;
  if (isTerminalCancel(s)) return "Details";
  if (s === "in_progress" || s === "safety_hold") return "InTrip";
  if (
    s === "completed" ||
    s === "payment_pending" ||
    s === "payment_failed" ||
    s === "rated"
  )
    return "Pay";
  return "Assigned";
}
