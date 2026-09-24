/**
 * The one production test every fail-closed rule here uses. `production` and
 * `prod` (any case, trimmed) are production — the same rule as ride-service,
 * travel-service and ask-service, so a shorthand cannot dodge it.
 */
export function isProductionEnvironment(nodeEnv: string | undefined): boolean {
  const normalized = (nodeEnv ?? "").trim().toLowerCase();
  return normalized === "production" || normalized === "prod";
}
