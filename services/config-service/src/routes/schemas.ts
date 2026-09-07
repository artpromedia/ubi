/**
 * Request and response shapes for the OpenAPI routes.
 *
 * Source: contracts/openapi/support-config.yaml. The city config body is
 * described by `CityConfigSchema` from @ubi/contracts rather than a copy, so the
 * wire shape and the validation the apps perform can never drift apart.
 */
import { z } from "@hono/zod-openapi";
import {
  ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
} from "@ubi/contracts";

export const CityIdParam = z.object({
  cityId: z
    .string()
    .min(1)
    .max(16)
    .openapi({ param: { name: "cityId", in: "path" }, example: "LOS" }),
});

export const RequestIdParam = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .openapi({ param: { name: "id", in: "path" } }),
});

export const FlagKeyParam = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .openapi({ param: { name: "key", in: "path" } }),
});

export const ConditionalHeaders = z.object({
  "if-none-match": z.string().optional(),
});

export const IdempotencyHeaders = z.object({
  [IDEMPOTENCY_HEADER]: IdempotencyKeySchema,
});

export const FlagsQuery = z.object({
  cityId: z.string().min(1).max(16).optional(),
  userId: z.string().min(1).max(64).optional(),
});

export const ErrorSchema = z
  .object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  })
  .openapi("Error");

/** Evaluated flag map: `{ [key]: boolean }`, deny-by-default. */
export const FlagMapSchema = z.record(z.boolean()).openapi("FlagMap");

export const ChangeRequestBody = z
  .object({
    cityId: z.string().min(1).max(16),
    patch: z.record(z.unknown()),
    reason: z.string().min(3).max(500),
  })
  .openapi("ConfigChangeRequestBody");

export const ChangeRequestResponse = z
  .object({
    id: z.string(),
    cityId: z.string(),
    status: z.string(),
    reason: z.string(),
    authorId: z.string(),
    createdAt: z.string(),
    approvals: z.number().int(),
    approvalsRequired: z.number().int(),
    replayed: z.boolean(),
  })
  .openapi("ConfigChangeRequest");

export const ApprovalResponse = z
  .object({
    requestId: z.string(),
    cityId: z.string(),
    status: z.string(),
    approvals: z.number().int(),
    approvalsRequired: z.number().int(),
    activated: z.boolean(),
    version: z.number().int().nullable(),
    diff: z.array(
      z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }),
    ),
  })
  .openapi("ConfigApproval");

export const HistoryResponse = z
  .object({
    cityId: z.string(),
    versions: z.array(
      z.object({
        version: z.number().int(),
        activatedAt: z.string().nullable(),
        authoredBy: z.string(),
        approvedBy: z.string().nullable(),
        approvers: z.array(z.string()),
        reason: z.string().nullable(),
      }),
    ),
  })
  .openapi("ConfigHistory");

export const FlagChangeBody = z
  .object({
    cityId: z.string().min(1).max(16).nullable().default(null),
    enabled: z.boolean(),
    reason: z.string().min(3).max(500),
    segment: z
      .object({ userIds: z.array(z.string().min(1)).min(1) })
      .optional(),
  })
  .openapi("FlagChangeBody");

export const FlagChangeResponse = z
  .object({
    key: z.string(),
    cityId: z.string().nullable(),
    from: z.boolean(),
    to: z.boolean(),
    by: z.string(),
    replayed: z.boolean(),
  })
  .openapi("FlagChange");

export const jsonContent = <T extends z.ZodTypeAny>(
  schema: T,
  description: string,
) => ({
  description,
  content: { "application/json": { schema } },
});

export const errorResponses = {
  400: jsonContent(ErrorSchema, "malformed request"),
  401: jsonContent(ErrorSchema, "authentication required"),
  403: jsonContent(ErrorSchema, "forbidden"),
  404: jsonContent(ErrorSchema, "not found"),
  409: jsonContent(ErrorSchema, "conflict"),
  422: jsonContent(ErrorSchema, "validation failed"),
  500: jsonContent(ErrorSchema, "internal error"),
  503: jsonContent(ErrorSchema, "dependency unavailable"),
} as const;
