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
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { assertIdentityConfigured } from "./lib/identity-context";
import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis, redis } from "./lib/redis";
import { startRideCompletionConsumer } from "./ops/ride-completion";
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

// 4014: growth-service's port on ubi-network and in api-gateway's proxy map.
const PORT = Number.parseInt(process.env.PORT ?? "4014", 10);

export function createApp(deps: GrowthDeps): Hono {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", secureHeaders());

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
  assertIdentityConfigured();
  const deps = createDeps();
  const app = createApp(deps);
  const subscriptionPromise = startRideCompletionConsumer(deps, redis).catch(
    (err: unknown) => {
      logger.error(
        { err },
        "failed to start growth ride-completion outbox consumer",
      );
      return null;
    },
  );
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "growth-service listening");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    server.close();
    void subscriptionPromise
      .then((sub) => sub?.stop())
      .finally(() => {
        void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).then(
          () => {
            process.exit(0);
          },
        );
      });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}
