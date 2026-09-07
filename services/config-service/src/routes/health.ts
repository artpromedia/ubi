/**
 * Health endpoints. Readiness reports Postgres and Redis separately: the
 * service is still usable without Redis (it degrades to uncached reads), so a
 * Redis outage is reported as degraded rather than dead.
 */
import { Hono } from "hono";

import { checkPrismaConnection } from "../lib/prisma";
import { checkRedisConnection } from "../lib/redis";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({ status: "ok", service: "config-service", timestamp: new Date().toISOString() }),
);

healthRoutes.get("/live", (c) =>
  c.json({ status: "alive", service: "config-service", uptime: process.uptime() }),
);

healthRoutes.get("/ready", async (c) => {
  const [database, cache] = await Promise.all([checkPrismaConnection(), checkRedisConnection()]);
  const status = database ? (cache ? "ready" : "degraded") : "unavailable";
  return c.json({ status, service: "config-service", checks: { database, cache } }, database ? 200 : 503);
});
