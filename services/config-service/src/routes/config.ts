/**
 * City config routes — contracts/openapi/support-config.yaml.
 *
 * GET is conditional: the active version carries a strong ETag, and a client
 * polling on foreground gets 304 until a new version is activated.
 */
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";

import { CityConfigSchema, IDEMPOTENCY_HEADER } from "@ubi/contracts";

import {
  ApprovalResponse,
  ChangeRequestBody,
  ChangeRequestResponse,
  CitiesResponse,
  CityIdParam,
  CityStatusBody,
  CityStatusResponse,
  ConditionalHeaders,
  HistoryResponse,
  IdempotencyHeaders,
  RequestIdParam,
  errorResponses,
  jsonContent,
} from "./schemas";
import { CONFIG_CACHE_TTL_SEC } from "../lib/env";
import { etagMatches } from "../lib/etag";
import { requireConfigAdmin } from "../middleware/actor";
import { listCities, setCityStatus } from "../services/cities.service";
import {
  approveChangeRequest,
  createChangeRequest,
  getActiveConfig,
  getHistory,
} from "../services/config.service";

const listCitiesRoute = createRoute({
  method: "get",
  path: "/v1/config/cities",
  tags: ["config"],
  summary:
    "Every city with its launch status (planned, launching, active, paused)",
  responses: {
    200: jsonContent(CitiesResponse, "city rows, launch cities first"),
    500: errorResponses[500],
    503: errorResponses[503],
  },
});

const cityStatusRoute = createRoute({
  method: "post",
  path: "/v1/config/cities/status",
  tags: ["config"],
  summary:
    "Change the launch status of one or more cities, optionally switching flags in the same change; launch-group members must go live together",
  request: {
    headers: IdempotencyHeaders,
    body: { content: { "application/json": { schema: CityStatusBody } } },
  },
  responses: {
    200: jsonContent(CityStatusResponse, "status changed (or replayed)"),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

const getCityConfigRoute = createRoute({
  method: "get",
  path: "/v1/config/cities/{cityId}",
  tags: ["config"],
  summary: "Active city config version",
  request: { params: CityIdParam, headers: ConditionalHeaders },
  responses: {
    200: jsonContent(CityConfigSchema, "the active config version"),
    304: { description: "config unchanged since the supplied ETag" },
    404: errorResponses[404],
    500: errorResponses[500],
    503: errorResponses[503],
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/v1/config/cities/{cityId}/history",
  tags: ["config"],
  summary: "Version history with author and approvers",
  request: { params: CityIdParam },
  responses: {
    200: jsonContent(HistoryResponse, "versions, newest first"),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

const createChangeRequestRoute = createRoute({
  method: "post",
  path: "/v1/config/change-requests",
  tags: ["config"],
  summary: "Propose a config change",
  request: {
    headers: IdempotencyHeaders,
    body: { content: { "application/json": { schema: ChangeRequestBody } } },
  },
  responses: {
    201: jsonContent(ChangeRequestResponse, "pending change request"),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

const approveRoute = createRoute({
  method: "post",
  path: "/v1/config/change-requests/{id}/approve",
  tags: ["config"],
  summary:
    "Approve a change request; the second distinct approver activates it",
  request: { params: RequestIdParam, headers: IdempotencyHeaders },
  responses: {
    200: jsonContent(
      ApprovalResponse,
      "approval recorded, possibly activating",
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    500: errorResponses[500],
  },
});

export function registerConfigRoutes(app: OpenAPIHono): void {
  app.openapi(listCitiesRoute, async (c) => {
    const cities = await listCities();
    c.header("Cache-Control", `private, max-age=${CONFIG_CACHE_TTL_SEC}`);
    return c.json(cities, 200);
  });

  app.openapi(cityStatusRoute, async (c) => {
    const actor = requireConfigAdmin(c);
    const body = c.req.valid("json");
    const result = await setCityStatus({
      cityIds: body.cityIds,
      status: body.status,
      flags: body.flags,
      reason: body.reason,
      actor,
      idempotencyKey: c.req.valid("header")[IDEMPOTENCY_HEADER],
    });
    return c.json(
      {
        cities: result.cities.map((entry) => ({ ...entry })),
        flags: result.flags.map((entry) => ({ ...entry })),
        by: result.by,
        replayed: result.replayed,
      },
      200,
    );
  });

  app.openapi(getCityConfigRoute, async (c) => {
    const { cityId } = c.req.valid("param");
    const active = await getActiveConfig(cityId);
    c.header("ETag", active.etag);
    c.header("Cache-Control", `private, max-age=${CONFIG_CACHE_TTL_SEC}`);
    if (etagMatches(c.req.valid("header")["if-none-match"], active.etag)) {
      return c.body(null, 304);
    }
    return c.json(active.config, 200);
  });

  app.openapi(historyRoute, async (c) => {
    requireConfigAdmin(c);
    const { cityId } = c.req.valid("param");
    const versions = await getHistory(cityId);
    return c.json(
      {
        cityId,
        versions: versions.map((entry) => ({
          ...entry,
          approvers: [...entry.approvers],
        })),
      },
      200,
    );
  });

  app.openapi(createChangeRequestRoute, async (c) => {
    const actor = requireConfigAdmin(c);
    const body = c.req.valid("json");
    const created = await createChangeRequest({
      cityId: body.cityId,
      patch: body.patch,
      reason: body.reason,
      actor,
      idempotencyKey: c.req.valid("header")[IDEMPOTENCY_HEADER],
    });
    return c.json(created, 201);
  });

  app.openapi(approveRoute, async (c) => {
    const actor = requireConfigAdmin(c);
    const { id } = c.req.valid("param");
    // Idempotency-Key is required by the route schema; the approval itself is
    // keyed on (requestId, approverId), so a retry is caught as already_approved
    // rather than recorded twice.
    const result = await approveChangeRequest({ requestId: id, actor });
    return c.json(
      { ...result, diff: result.diff.map((entry) => ({ ...entry })) },
      200,
    );
  });
}
