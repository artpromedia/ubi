// Airport transfer words (travel-v2.yaml AirportTransfer). Each status keeps its own distinct
// word — "pending, no driver yet" is never "requested", and neither is ever "driver confirmed",
// which appears ONLY for `awarded` (the traveller's own selected award). The server's own
// statusLabel / notice / outcome / choice labels are always printed as well; nothing here
// invents a state, a time or an amount.
import { ApiError } from "@ubi/mobile-core";
import type {
  AirportTransfer,
  LinkedItemStatus,
  TransferDirection,
  TransferStatus,
} from "../../api/travel";
import type { StatusWord } from "../marketplace/riderCopy";

export const TRANSFER_STATUS: Record<TransferStatus, StatusWord> = {
  pending_unassigned: { label: "Pending · no driver yet", tone: "info" },
  requested: { label: "Sent to drivers · no driver yet", tone: "info" },
  awarded: { label: "Driver confirmed", tone: "ok" },
  failed: { label: "Not booked · no driver", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** LinkedItem statuses the shared StatusPill vocabulary doesn't carry, as distinct words. */
export const LINKED_STATUS_WORD: Partial<Record<LinkedItemStatus, StatusWord>> =
  {
    pending_unassigned: TRANSFER_STATUS.pending_unassigned,
    requested: TRANSFER_STATUS.requested,
    awarded: TRANSFER_STATUS.awarded,
  };

export const LIVE_TRANSFER = new Set<TransferStatus>([
  "pending_unassigned",
  "requested",
  "awarded",
]);

export const directionOf = (
  d: "to_airport" | "from_airport",
): TransferDirection =>
  d === "to_airport" ? "departure_dropoff" : "arrival_pickup";

export const DIRECTION_TEXT: Record<TransferDirection, string> = {
  arrival_pickup: "From the airport after landing",
  departure_dropoff: "To the airport for departure",
};

/** When the ride will be asked for, in words — the server derives the window, never the app. */
export const publishNoteFor = (d: TransferDirection) =>
  d === "arrival_pickup"
    ? "Nothing is booked now. UBI sends your request to drivers near your landing time, with a pickup window worked out from your flight. No driver is secured until you choose a driver’s offer in the ride app."
    : "Nothing is booked now. UBI sends your request to drivers ahead of your flight, timed so you reach the airport before check-in closes. No driver is secured until you choose a driver’s offer in the ride app.";

/** The window the server derived, or the arrive-by time for a departure. */
export const windowLineOf = (t: AirportTransfer): string | null =>
  t.pickupWindow
    ? "Pickup window " +
      t.pickupWindow.label +
      " (" +
      t.pickupWindow.timeZone +
      ")"
    : t.arriveBy
      ? "At the airport by " +
        t.arriveBy.label +
        " (" +
        t.arriveBy.timeZone +
        ")"
      : null;

export const flightNoteOf = (t: AirportTransfer): string | null =>
  t.flight?.status === "delayed"
    ? "Your flight is delayed. The request is retimed to the new flight time within the same limit — a delay never allows a higher fare or diverting a driver’s current passenger."
    : t.flight?.status === "cancelled"
      ? "Your flight was cancelled. A ride without a secured driver is withdrawn for free; your flight refund follows the airline’s rules."
      : null;

const REFUSAL_TEXT: Record<string, string> = {
  linked_order_not_flight: "An airport ride links to a flight order.",
  flight_not_booked:
    "The flight must be confirmed or ticketed before an airport ride can be arranged.",
  order_city_mismatch: "This flight was booked in a different city.",
  flight_leg_unknown: "That flight has no such leg.",
  flight_leg_airport_unknown: "The flight leg doesn’t name its airport.",
  airport_not_in_city: "That airport isn’t served by UBI in this city.",
  pickup_too_soon:
    "This pickup is too soon to schedule. Request a ride in the ride app when you’re ready.",
  vehicle_class_unknown: "That vehicle class isn’t offered in this city.",
  currency_mismatch: "The limit must be in the city’s currency.",
  requested_above_limit:
    "The fare you ask for can’t be above the limit you approve.",
  role_not_requester: "An airport ride is arranged by the traveller.",
};

/** A refused transfer action in plain words (the server's own message otherwise). */
export function transferRefusal(e: unknown): { title: string; body: string } {
  if (!(e instanceof ApiError))
    return {
      title: "You’re offline",
      body: "Nothing was sent. Try again when you’re back online — retrying is safe, it can’t act twice.",
    };
  const details = e.details as
    | { reason?: string; currency?: string }
    | undefined;
  const reason = details?.reason;
  if (e.code === "feature_disabled")
    return {
      title: "Airport rides aren’t available here",
      body: "UBI isn’t arranging airport rides in your city right now. Book a ride in the ride app when you’re ready.",
    };
  if (e.code === "payment_method_unavailable")
    return {
      title: "Payment method unavailable",
      body: "Your UBI Wallet can’t be used for rides in this city right now.",
    };
  if (reason && REFUSAL_TEXT[reason])
    return {
      title: "Can’t arrange this airport ride",
      body:
        REFUSAL_TEXT[reason] +
        (reason === "currency_mismatch" && details?.currency
          ? " (" + details.currency + ")"
          : ""),
    };
  return { title: "That didn’t go through", body: e.message };
}
