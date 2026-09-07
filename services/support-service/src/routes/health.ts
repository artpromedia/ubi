import { Hono } from "hono";

import { checkPrismaConnection } from "../lib/prisma";
import { checkRedisConnection } from "../lib/redis";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => c.json({ status: "ok", service: "support-service" }, 200));

healthRoutes.get("/ready", async (c) => {
  const [database, redis] = await Promise.all([
    checkPrismaConnection(),
    checkRedisConnection(),
  ]);
  const ready = database.healthy && redis;
  return c.json(
    {
      status: ready ? "ready" : "degraded",
      checks: { database: database.healthy, redis },
    },
    ready ? 200 : 503,
  );
});
