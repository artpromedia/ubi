/**
 * UBI Config Service.
 *
 * Serves the versioned city configuration every other service and both apps
 * read their numbers from, and evaluates feature flags deny-by-default.
 */
import { serve } from "@hono/node-server";

import { buildApp } from "./app";
import { PORT } from "./lib/env";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { startMarketingRevalidation } from "./marketing-revalidate";

const app = buildApp();

const marketingRevalidation = startMarketingRevalidation().catch(
  (err: unknown) => {
    logger.error({ err }, "marketing revalidation consumer failed to start");
    return undefined;
  },
);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info({ port: info.port }, "config-service listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  server.close();
  await (await marketingRevalidation)?.stop();
  await disconnectPrisma();
  await disconnectRedis();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

export { app };
