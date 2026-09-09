/**
 * UBI Growth Service (RN-migration handoff — promotions, referrals, driver
 * incentives, campaigns, marketing assistant).
 *
 * Owns:
 *  - campaigns, campaign versions and campaign budgets, with the campaign state
 *    machine and two-person approval (approver ≠ author);
 *  - the promotion budget ledger: reserve on a promise, consume on
 *    qualification, release on expiry, reverse as a compensating entry;
 *  - rider benefits (distinct adjustment objects) and user credits;
 *  - referrals, their server-verified qualification, abuse review queue and
 *    reversals;
 *  - driver commission incentives, posted as SEPARATE ledger lines through the
 *    payment-service ledger port — the base commission is never edited;
 *  - the marketing assistant, which drafts only.
 *
 * The double-entry ledger is not here: it lives in payment-service, reached
 * through a typed port. Balances are derived, never stored (CLAUDE.md #4).
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { createBenefitsRoutes } from "./routes/benefits";
import { createGrowthAdminRoutes } from "./routes/growth-admin";
import { healthRoutes } from "./routes/health";
import { createIncentiveRoutes } from "./routes/incentives";
import { createMarketingRoutes } from "./routes/marketing";
import {
  createAttributionRoutes,
  createReferralRoutes,
} from "./routes/referrals";
import { createDeps } from "./wiring";

import type { GrowthDeps } from "./ops/context";

const PORT = Number.parseInt(process.env.PORT ?? "4012", 10);

export function createApp(deps: GrowthDeps): Hono {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowed = ["https://admin.ubi.africa", "https://app.ubi.africa"];
        if (
          !origin ||
          allowed.includes(origin) ||
          /^http:\/\/localhost:\d+$/.test(origin)
        ) {
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
  app.route("/v1/benefits", createBenefitsRoutes(deps));
  app.route("/v1/referrals", createReferralRoutes(deps));
  app.route("/v1/attribution", createAttributionRoutes(deps));
  app.route("/v1/driver", createIncentiveRoutes(deps));
  app.route("/v1/growth", createGrowthAdminRoutes(deps));
  app.route("/v1/ai/marketing", createMarketingRoutes(deps));

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp(createDeps());
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "growth-service listening");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
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
