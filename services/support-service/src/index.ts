/**
 * UBI Support Service (slice 11 — support, safety, review queues, audit).
 *
 * Owns:
 *  - support cases with a unified ride / wallet / message timeline and typed
 *    remedies posted as ledger counter-lines against the case;
 *  - safety cases: durable SOS with retry and SMS fallback, a 24/7 queue with an
 *    SLA, and typed responder actions;
 *  - the KYC / merchant / hotel / fleet / claims / identity review queues, where
 *    automated checks are advisory and a human decides;
 *  - the audit trail behind all of it.
 *
 * Finance reconciliation is deliberately not here: it lives in payment-service
 * beside the ledger it reconciles.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis, withSweepLock } from "./lib/redis";
import { sweepPendingDeliveries } from "./ops/safety";
import { healthRoutes } from "./routes/health";
import { createReviewRoutes } from "./routes/reviews";
import { createSafetyRoutes } from "./routes/safety";
import { createSupportRoutes } from "./routes/support";
import { createDeps } from "./wiring";

import type { SupportDeps } from "./ops/context";

const PORT = Number.parseInt(process.env.PORT ?? "4011", 10);
const SOS_SWEEP_INTERVAL_MS = Number.parseInt(
  process.env.SOS_SWEEP_INTERVAL_MS ?? "30000",
  10,
);

export function createApp(deps: SupportDeps): Hono {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowed = ["https://admin.ubi.africa", "https://app.ubi.africa"];
        if (!origin || allowed.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
          return origin || "";
        }
        return "";
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Request-ID",
        "X-User-ID",
        "X-User-Role",
        "X-City-ID",
      ],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.route("/health", healthRoutes);
  app.route("/v1/support", createSupportRoutes(deps));
  app.route("/v1/safety", createSafetyRoutes(deps));
  app.route("/v1/reviews", createReviewRoutes(deps));

  return app;
}

/**
 * Retries SOS notifications whose delivery is still pending. The incident itself
 * is already committed; this only chases the alert.
 */
function startSosSweep(): NodeJS.Timeout {
  const deps = createDeps();
  const timer = setInterval(() => {
    void withSweepLock("support:sos-sweep", 25, async () => {
      const handled = await sweepPendingDeliveries(deps);
      if (handled > 0) {
        logger.info({ handled }, "retried pending SOS notifications");
      }
    }).catch((error: unknown) => {
      logger.error({ err: error }, "SOS sweep failed");
    });
  }, SOS_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp(createDeps());
  const sweep = startSosSweep();
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "support-service listening");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    clearInterval(sweep);
    server.close();
    void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).then(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}
