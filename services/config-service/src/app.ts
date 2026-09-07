/**
 * Application wiring. `buildApp()` returns a Hono app with no side effects, so
 * tests drive the real routes through `app.request()` without opening a socket.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { ContractError } from "@ubi/contracts";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { errorHandler } from "./middleware/error-handler";
import { registerConfigRoutes } from "./routes/config";
import { registerFlagRoutes } from "./routes/flags";
import { healthRoutes } from "./routes/health";

export function buildApp(): OpenAPIHono {
  const app = new OpenAPIHono({
    // Request validation failures leave as canonical validation_failed bodies,
    // never as a framework-shaped error.
    defaultHook: (result) => {
      if (!result.success) {
        throw new ContractError("validation_failed", "request failed validation", {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
    },
  });

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.onError(errorHandler);
  app.notFound(() => {
    throw new ContractError("not_found", "no such endpoint");
  });

  app.route("/health", healthRoutes);

  // Routes carry their full path so the generated document matches
  // contracts/openapi/support-config.yaml exactly.
  registerConfigRoutes(app);
  registerFlagRoutes(app);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "UBI Config & Flags",
      version: "0.1.0",
      description:
        "Versioned city configuration and deny-by-default feature flags. Money is integer minor units with the currency from city config.",
    },
  });

  return app;
}
