/**
 * Flag routes. Evaluation is deny-by-default and always server-side; the
 * change endpoint is the audited single-actor path (the two-person path for
 * flags is a config change request against the same city).
 */
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { IDEMPOTENCY_HEADER } from "@ubi/contracts";

import { effectiveUserId, requireConfigAdmin } from "../middleware/actor";
import { evaluateFlags, setFlag } from "../services/flags.service";
import {
  FlagChangeBody,
  FlagChangeResponse,
  FlagKeyParam,
  FlagMapSchema,
  FlagsQuery,
  IdempotencyHeaders,
  errorResponses,
  jsonContent,
} from "./schemas";

const evaluateRoute = createRoute({
  method: "get",
  path: "/v1/flags",
  tags: ["flags"],
  summary: "Evaluated flags for a city and user; deny-by-default",
  request: { query: FlagsQuery },
  responses: {
    200: jsonContent(FlagMapSchema, "evaluated flags"),
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

const setFlagRoute = createRoute({
  method: "put",
  path: "/v1/flags/{key}",
  tags: ["flags"],
  summary: "Turn a flag on or off for a city (audited)",
  request: {
    params: FlagKeyParam,
    headers: IdempotencyHeaders,
    body: { content: { "application/json": { schema: FlagChangeBody } } },
  },
  responses: {
    200: jsonContent(FlagChangeResponse, "flag changed"),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

export function registerFlagRoutes(app: OpenAPIHono): void {
  app.openapi(evaluateRoute, async (c) => {
    const query = c.req.valid("query");
    const flags = await evaluateFlags({
      cityId: query.cityId,
      userId: effectiveUserId(c, query.userId),
    });
    c.header("Cache-Control", "private, no-store");
    return c.json(flags, 200);
  });

  app.openapi(setFlagRoute, async (c) => {
    const actor = requireConfigAdmin(c);
    const { key } = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await setFlag({
      key,
      cityId: body.cityId,
      enabled: body.enabled,
      reason: body.reason,
      segment: body.segment,
      actor,
      idempotencyKey: c.req.valid("header")[IDEMPOTENCY_HEADER],
    });
    return c.json(result, 200);
  });
}
