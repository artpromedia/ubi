/**
 * Internal action-grant + mandate-run routes (slice NEW-01, CLAUDE.md #18).
 *
 * These are SERVICE-TO-SERVICE only. ask-service and travel-service mint a
 * grant after a user confirms a review; the service that books the supplier
 * consumes it; the mandate runner runs a mandate when an external event fires.
 * All three authenticate with the internal service key (never the gateway
 * identity), so no model tool can reach them — a model can only ever hold a
 * user identity, never the service key.
 *
 * Mounted under `/internal`, a namespace the gateway never forwards client
 * traffic to.
 */
import { Hono } from "hono";

import {
  consumeGrant,
  ConsumeGrantSchema,
  mintGrant,
  MintGrantSchema,
} from "../grants/grants";
import { requireInternalService, SERVICE_KEY_HEADER } from "../grants/service-auth";
import type { AiActionDeps } from "../grants/types";
import {
  contractRoute,
  ok,
  parseBody,
  requireIdempotencyKey,
} from "../identity/http";
import { runMandate } from "../mandates/run";
import { MandateRunSchema } from "../mandates/schemas";

export function createGrantRoutes(deps: AiActionDeps): Hono {
  const routes = new Hono();

  /** Mint a single-use grant for a confirmed review. Idempotent on the key. */
  routes.post(
    "/internal/grants",
    contractRoute(async (c) => {
      requireInternalService(c.req.header(SERVICE_KEY_HEADER));
      const idempotencyKey = requireIdempotencyKey(c);
      const body = await parseBody(c, MintGrantSchema);
      const result = await mintGrant(deps, body, idempotencyKey);
      return ok(
        c,
        { grant: result.grant, replayed: result.replayed },
        result.replayed ? 200 : 201,
      );
    }),
  );

  /** Verify + consume a grant, atomically and once. */
  routes.post(
    "/internal/grants/:id/consume",
    contractRoute(async (c) => {
      requireInternalService(c.req.header(SERVICE_KEY_HEADER));
      const idempotencyKey = requireIdempotencyKey(c);
      const body = await parseBody(c, ConsumeGrantSchema);
      const result = await consumeGrant(
        deps,
        c.req.param("id"),
        body,
        idempotencyKey,
      );
      return ok(c, {
        grant: result.grant,
        consumedAt: result.consumedAt,
        replayed: result.replayed,
      });
    }),
  );

  /** Run a mandate when an external event fires. Dedupes on triggerRef. */
  routes.post(
    "/internal/mandates/:id/run",
    contractRoute(async (c) => {
      requireInternalService(c.req.header(SERVICE_KEY_HEADER));
      requireIdempotencyKey(c);
      const body = await parseBody(c, MandateRunSchema);
      const result = await runMandate(deps, c.req.param("id"), body);
      return ok(c, result);
    }),
  );

  return routes;
}
