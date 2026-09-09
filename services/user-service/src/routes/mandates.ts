/**
 * Mandate routes (slice NEW-01) — the user's own standing authorisations.
 *
 * Every endpoint answers only to the gateway's SIGNED identity context
 * (identity/context.ts); none of it is reachable by a model tool. Paths are
 * mounted WITHOUT the `/v1` prefix because the gateway strips it before
 * forwarding, exactly like the identity slice: `GET /v1/mandates` at the edge
 * arrives here as `GET /mandates`.
 */
import { Hono } from "hono";

import { getIdentity, requireIdentity } from "../identity/context";
import {
  contractRoute,
  ok,
  parseBody,
  requireIdempotencyKey,
} from "../identity/http";
import type { AiActionDeps } from "../grants/types";
import {
  createMandate,
  listExecutions,
  listMandates,
  patchMandate,
  type MandateActor,
} from "../mandates/mandates";
import {
  AssuranceSchema,
  MandateInputSchema,
  MandatePatchSchema,
} from "../mandates/schemas";
import { executionToView } from "../mandates/serialize";

const CreateMandateSchema = MandateInputSchema.extend({
  assurance: AssuranceSchema.optional(),
});

function actorFrom(c: Parameters<typeof getIdentity>[0]): MandateActor {
  const principal = getIdentity(c);
  return {
    userId: principal.userId,
    role: principal.role,
    cityId: principal.cityId,
  };
}

export function createMandateRoutes(deps: AiActionDeps): Hono {
  const routes = new Hono();

  routes.get(
    "/mandates",
    requireIdentity,
    contractRoute(async (c) => {
      const actor = actorFrom(c);
      return ok(c, { mandates: await listMandates(deps, actor.userId) });
    }),
  );

  routes.post(
    "/mandates",
    requireIdentity,
    contractRoute(async (c) => {
      const actor = actorFrom(c);
      const idempotencyKey = requireIdempotencyKey(c);
      const { assurance, ...input } = await parseBody(c, CreateMandateSchema);
      const result = await createMandate(
        deps,
        actor,
        input,
        assurance,
        idempotencyKey,
      );
      return ok(c, { mandate: result.mandate }, result.replayed ? 200 : 201);
    }),
  );

  routes.patch(
    "/mandates/:id",
    requireIdentity,
    contractRoute(async (c) => {
      const actor = actorFrom(c);
      const idempotencyKey = requireIdempotencyKey(c);
      const patch = await parseBody(c, MandatePatchSchema);
      const mandate = await patchMandate(
        deps,
        actor,
        c.req.param("id"),
        patch,
        idempotencyKey,
      );
      return ok(c, { mandate });
    }),
  );

  routes.get(
    "/mandates/:id/executions",
    requireIdentity,
    contractRoute(async (c) => {
      const actor = actorFrom(c);
      const executions = await listExecutions(
        deps,
        actor.userId,
        c.req.param("id"),
      );
      return ok(c, { executions: executions.map(executionToView) });
    }),
  );

  return routes;
}
