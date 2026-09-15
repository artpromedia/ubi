/**
 * Server-only. The single place external destinations come from: HTTPS from
 * the named environment variable, or nothing. A missing destination renders
 * launch-status copy through `DestinationLink`; never a dead link, never a
 * fabricated store badge.
 */
import "server-only";

import {
  DESTINATION_ENV,
  httpsUrl,
  reportUnsetDestinations,
} from "./destination-env.mjs";

export type DestinationKey = keyof typeof DESTINATION_ENV;

/** Launch-status copy shown when a destination is not configured. Plain text, not a link, not in tab order. */
export const PENDING_COPY: Record<DestinationKey, string> = {
  rider: "The UBI web app opens here when it goes live.",
  driver: "Driver sign-up opens here with the launch.",
  iosStore: "App Store link appears when the listing is published.",
  androidStore: "Google Play link appears when the listing is published.",
  driverIosStore:
    "App Store link for UBI Driver appears when the listing is published.",
  driverAndroidStore:
    "Google Play link for UBI Driver appears when the listing is published.",
  privacy: "Privacy policy is published before public launch.",
  terms: "Terms are published before public launch.",
  fleetContact:
    "Fleet arrangements are agreed with UBI directly. Contact details follow at launch.",
  help: "Help is available inside the app.",
};

/**
 * The https destination for `key`, with an optional path appended, or
 * undefined when the variable is unset, malformed or not https.
 */
export function destination(
  key: DestinationKey,
  path = "",
): string | undefined {
  const base = httpsUrl(process.env[DESTINATION_ENV[key]]);
  if (base === undefined) return undefined;
  return path === "" ? base : new URL(path, base).toString();
}

export { DESTINATION_ENV, reportUnsetDestinations };
