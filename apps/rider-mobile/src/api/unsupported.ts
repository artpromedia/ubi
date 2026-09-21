// UNSUPPORTED SERVER-SIDE registry (C05 contract rule). Every entry names a
// capability this app's boards call for whose endpoint DOES NOT EXIST through
// the api-gateway today. Screens that need one of these render an honest
// feature-unavailable state; nothing here is ever mocked into success, and a
// call always throws NotYetSupported. When the server ships an endpoint, move
// it into a real api module and delete its row.
export class NotYetSupported extends Error {
  readonly code = "not_yet_supported";
  constructor(
    readonly key: string,
    readonly wanted: string,
    readonly reason: string,
  ) {
    super("Not supported by the server yet: " + wanted + " — " + reason);
    this.name = "NotYetSupported";
  }
}

export const UNSUPPORTED = {
  sosDispatch: {
    wanted: "POST /v1/safety/sos/trigger (in-app SOS dispatch)",
    reason:
      "payment-service mounts safety routes at /safety, but the api-gateway proxies no /v1/safety/* prefix (services/api-gateway/src/routes/proxy.ts), so no dispatch endpoint is reachable by the app",
  },
  rideRating: {
    wanted: "POST /v1/rides/{rideId}/rating (rate a completed trip)",
    reason:
      "ride-service's route table (internal/handler/rides.go Routes) has no rating endpoint",
  },
  tripShare: {
    wanted: "POST trip-share link (live trip sharing)",
    reason:
      "payment-service /safety/trip/share exists but is not gateway-proxied; no other service serves it",
  },
  bites: {
    wanted:
      "food ordering journey (/v1/food, /v1/restaurants consumed end to end)",
    reason:
      "food-service routes exist but the Bites boards are out of C05 scope and unaudited; surfacing them would imply availability (G12)",
  },
  sendParcels: {
    wanted: "parcel send journey (/v1/delivery custody/returns)",
    reason:
      "delivery-service has no custody/return endpoints (G08); publishing the Send surface would imply availability",
  },
  cityConfig: {
    wanted: "GET /v1/config/cities/{cityId} (city config through the gateway)",
    reason:
      "@ubi/mobile-core ConfigProvider already calls this path, but the api-gateway proxies no /v1/config/* prefix — config-dependent screens must degrade honestly until the mount lands",
  },
} as const;

export type UnsupportedKey = keyof typeof UNSUPPORTED;

export function notYetSupported(key: UnsupportedKey): never {
  const e = UNSUPPORTED[key];
  throw new NotYetSupported(key, e.wanted, e.reason);
}

/** Typed stand-ins so a screen wired for the future endpoint fails loudly, never silently. */
export const unsupportedApi = {
  sosDispatch: (_rideId?: string): never => notYetSupported("sosDispatch"),
  rateRide: (_rideId: string, _stars: number): never =>
    notYetSupported("rideRating"),
  shareTrip: (_rideId: string): never => notYetSupported("tripShare"),
};
