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
  cityConfig: {
    wanted: "GET /v1/config/cities/{cityId} (city config through the gateway)",
    reason:
      "@ubi/mobile-core ConfigProvider already calls this path, but the api-gateway proxies no /v1/config/* prefix — config-dependent screens must degrade honestly until the mount lands",
  },
  earningsOverview: {
    wanted:
      "GET /v1/drivers/me/earnings/overview (an aggregated earnings read model)",
    reason:
      "no such endpoint exists in ride-service or payment-service's route tables; only the marketplace commission statement (GET /v1/wallet/mp/overview, already consumed by WalletHoldsContainer) and the legacy incentives statement exist",
  },
  payouts: {
    wanted: "GET /v1/drivers/me/payouts and a cashout endpoint",
    reason:
      "payment-service's quarantined legacy routes (src/routes/payouts.ts) are unmounted (QUARANTINE.md) and were fail-open; no replacement is mounted at the gateway",
  },
  driverDocuments: {
    wanted:
      "vehicle/document management beyond the identity slice's upload endpoints",
    reason:
      "identity document upload exists (/v1/drivers/me/documents, gateway-proxied), but this app's Account.Vehicle/Documents/Ratings/FleetArrangement/LivenessCheck boards were not part of this slice's audited scope and would imply more than is verified working end to end",
  },
} as const;

export type UnsupportedKey = keyof typeof UNSUPPORTED;

export function notYetSupported(key: UnsupportedKey): never {
  const e = UNSUPPORTED[key];
  throw new NotYetSupported(key, e.wanted, e.reason);
}
