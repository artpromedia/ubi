/**
 * Internal driver-profile read model (P10) — SERVICE-TO-SERVICE only.
 *
 *   GET /internal/driver-profiles?ids=<uuid>,<uuid>,…
 *
 * ride-service and ask-service batch-resolve the drivers behind a set of
 * offers into the privacy-limited card in @ubi/contracts
 * (`DriverProfilesResponseSchema`). Each caller authenticates with its own
 * `x-service-name` + `x-service-key`; a gateway-signed user identity is never
 * accepted, so no end user — and no model tool, which only ever holds a user
 * identity — can enumerate drivers.
 *
 * A GET: resolving profiles changes nothing, so there is no Idempotency-Key.
 *
 * Mounted under `/internal`, a namespace the gateway never forwards client
 * traffic to, and OUTSIDE `protectedApi` so the header-trusting service-auth
 * middleware is never the thing that lets a request in.
 */
import { Hono } from "hono";
import { z } from "zod";

import { ContractError } from "@ubi/contracts";

import {
  resolveDriverProfiles,
  type DriverProfileDeps,
} from "../driver-profiles/profiles";
import {
  requireDriverProfileCaller,
  SERVICE_KEY_HEADER,
  SERVICE_NAME_HEADER,
} from "../driver-profiles/service-auth";
import { contractRoute, ok } from "../identity/http";

/** Mirrors `DRIVER_PROFILE_BATCH_MAX` in @ubi/contracts (driver-profile.ts). */
export const DRIVER_PROFILE_BATCH_MAX = 50;

const IdsSchema = z
  .array(z.string().uuid("every id must be a driver's user id (uuid)"))
  .min(1, "ids must name at least one driver")
  .max(
    DRIVER_PROFILE_BATCH_MAX,
    `at most ${DRIVER_PROFILE_BATCH_MAX} ids per call`,
  );

function parseIds(raw: string | undefined): string[] {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const parsed = IdsSchema.safeParse([...new Set(values)]);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      "ids must be 1 to 50 comma-separated driver user ids",
      {
        issues: parsed.error.issues.map((issue) => ({
          path: ["ids", ...issue.path].join("."),
          message: issue.message,
        })),
      },
    );
  }
  return parsed.data;
}

export function createDriverProfileRoutes(deps: DriverProfileDeps): Hono {
  const routes = new Hono();

  routes.get(
    "/internal/driver-profiles",
    contractRoute(async (c) => {
      // Authenticate before looking at the query: an unauthenticated caller
      // learns nothing, not even whether its ids were well-formed.
      requireDriverProfileCaller(
        c.req.header(SERVICE_NAME_HEADER),
        c.req.header(SERVICE_KEY_HEADER),
      );
      const ids = parseIds(c.req.query("ids"));
      const profiles = await resolveDriverProfiles(deps, ids);
      // A profile card is personal data: no shared cache may keep it.
      c.header("Cache-Control", "no-store");
      return ok(c, { profiles });
    }),
  );

  return routes;
}
