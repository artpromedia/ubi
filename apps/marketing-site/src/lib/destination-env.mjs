/**
 * Environment variable behind each outbound destination. Plain JS so that
 * next.config.mjs (build time) and src/lib/destinations.ts (request time) read
 * the same list; an unset or non-https value is reported by both.
 */
export const DESTINATION_ENV = {
  rider: "UBI_RIDER_URL",
  driver: "UBI_DRIVER_URL",
  iosStore: "UBI_IOS_STORE_URL",
  androidStore: "UBI_ANDROID_STORE_URL",
  driverIosStore: "UBI_DRIVER_IOS_STORE_URL",
  driverAndroidStore: "UBI_DRIVER_ANDROID_STORE_URL",
  privacy: "UBI_PRIVACY_URL",
  terms: "UBI_TERMS_URL",
  fleetContact: "UBI_FLEET_CONTACT_URL",
  help: "UBI_HELP_URL",
};

/** An https URL, or undefined for anything else (unset, malformed, http). */
export function httpsUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reports every destination that will render as launch-status copy instead of
 * a link. Called from next.config.mjs so the build log lists them, and from
 * instrumentation.ts so the server log does too.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {(message: string) => void} [log]
 * @returns {string[]} the variable names that are unset or not https
 */
export function reportUnsetDestinations(env = process.env, log = console.warn) {
  /** @type {string[]} */
  const unset = [];
  for (const [key, name] of Object.entries(DESTINATION_ENV)) {
    if (httpsUrl(env[name]) === undefined) {
      unset.push(name);
      log(
        `[marketing] destination "${key}" not configured (${name} unset or not https): rendering launch-status copy`,
      );
    }
  }
  return unset;
}
