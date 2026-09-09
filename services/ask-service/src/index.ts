/**
 * UBI Ask Service (slice NEW-01 — Ask UBI, transaction review/execution, AI log).
 *
 * Owns:
 *  - the conversational assistant: threads and a streamed message turn backed by
 *    a privately served model, grounded by RAG over versioned policy docs, and
 *    limited to bounded read tools whose actor comes from the gateway context;
 *  - transaction reviews and executions: the model proposes, the user confirms,
 *    user-service mints a single-use grant, and only then does an execution run —
 *    the model never moves money (CLAUDE.md #18-25);
 *  - the AI action log (`ai_actions`) with 90-day retention, and its ops views.
 *
 * The double-entry ledger is not here. Any money movement inside an execution is
 * a typed port call into the service that owns the ledger; balances are never
 * stored here.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { logger } from "./lib/logger";
import { disconnectPrisma } from "./lib/prisma";
import { disconnectRedis } from "./lib/redis";
import { createAskRoutes } from "./routes/ask";
import { healthRoutes } from "./routes/health";
import { createOpsAiRoutes } from "./routes/ops-ai";
import { createDeps } from "./wiring";

import type { AskDeps } from "./ops/context";

const PORT = Number.parseInt(process.env.PORT ?? "4013", 10);

export function createApp(deps: AskDeps): Hono {
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
  app.route("/v1/ask", createAskRoutes(deps));
  app.route("/v1/ops/ai", createOpsAiRoutes(deps));

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp(createDeps());
  const server = serve({ fetch: app.fetch, port: PORT });
  logger.info({ port: PORT }, "ask-service listening");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    server.close();
    void Promise.allSettled([disconnectPrisma(), disconnectRedis()]).then(
      () => {
        process.exit(0);
      },
    );
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}
