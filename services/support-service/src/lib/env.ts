/**
 * Environment classification for support-service.
 */
export function isProductionEnvironment(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  const normalized = nodeEnv?.trim().toLowerCase();
  return normalized === "production" || normalized === "prod";
}
