import { TripLinkPage } from "@/components/trip-link/TripLinkPage";

/**
 * The guest passenger's trip link (A06 part B). notification-service texts
 * `PASSENGER_TRIP_LINK_BASE_URL + "#t=" + token`, so that base must point here (`/trip-link`).
 * Rendered client-side only: the token is in the URL fragment, which never reaches a server.
 */
export default function TripLinkRoute() {
  return <TripLinkPage />;
}
