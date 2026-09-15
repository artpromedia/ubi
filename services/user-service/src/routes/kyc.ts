/**
 * KYC requirements: what a driver in a city must provide. Public, no account
 * data, no personal data. Mounted at both `/kyc/requirements` (behind the
 * gateway, which strips `/v1`) and `/v1/kyc/requirements` (direct internal
 * reads, e.g. the marketing site).
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import { contractRoute, ok } from "../identity/http";
import {
  driverRequirementsFor,
  REQUIREMENT_ROLES,
} from "../identity/requirements";

const QuerySchema = z.object({
  cityId: z.string().min(1).max(16),
  role: z.enum(REQUIREMENT_ROLES),
});

export function createKycRoutes(): Hono {
  const routes = new Hono();
  // The registry is synchronous; contractRoute expects a promise-returning handler.
  const handler = contractRoute(async (c) => {
    await Promise.resolve();
    const parsed = QuerySchema.safeParse({
      cityId: c.req.query("cityId"),
      role: c.req.query("role") ?? "driver",
    });
    if (!parsed.success) {
      throw new ContractError(
        "validation_failed",
        "cityId is required and role must be driver",
        {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
    }
    const requirements = driverRequirementsFor(parsed.data.cityId);
    c.header("Cache-Control", "public, max-age=3600");
    // The marketing site parses the bare document; the apps read the standard
    // `{ success, data }` envelope. Both are the same object.
    return ok(c, requirements);
  });
  routes.get("/kyc/requirements", handler);
  routes.get("/v1/kyc/requirements", handler);
  return routes;
}
