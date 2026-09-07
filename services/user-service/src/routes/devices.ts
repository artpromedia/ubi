/**
 * Device routes (slice 03, board 15a).
 *
 *   POST /devices/enroll   known trusted device → a full-mode token.
 *                          NEW device → a step-up challenge and a LIMITED-MODE
 *                          token: book with cash, read history, nothing that
 *                          moves money.
 *   GET  /devices          the devices on this account and which are trusted.
 *
 * Identity comes from the gateway's SIGNED context, never from `x-auth-user-id`
 * (see identity/context.ts).
 */
import { ContractError } from "@ubi/contracts";
import { Hono } from "hono";

import { getIdentity, requireIdentity, requireScope } from "../identity/context";
import type { IdentityDeps } from "../identity/deps";
import { enrollDevice, EnrollDeviceSchema, listDevices } from "../identity/devices";
import { contractRoute, ok, parseBody } from "../identity/http";
import { prisma } from "../lib/prisma";

export function createDeviceRoutes(deps: IdentityDeps): Hono {
  const routes = new Hono();

  routes.post(
    "/enroll",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "device:enroll");
      const body = await parseBody(c, EnrollDeviceSchema);

      const user = await prisma.user.findUnique({
        where: { id: principal.userId },
        select: { email: true, status: true },
      });
      if (user === null) throw new ContractError("not_found", "Account not found");
      if (user.status === "SUSPENDED") {
        throw new ContractError("forbidden", "This account is suspended");
      }

      const result = await enrollDevice(deps, {
        ...body,
        userId: principal.userId,
        role: principal.role,
        email: user.email,
        cityId: principal.cityId,
        sessionId: principal.sessionId,
      });

      return ok(
        c,
        {
          status: result.status,
          deviceId: result.deviceId,
          trusted: result.trusted,
          stepUp: {
            required: result.status === "step_up_required",
            challengeId: result.challengeId,
            methods: result.methods,
            unavailable: result.unavailable,
          },
          token: {
            accessToken: result.token.accessToken,
            expiresIn: result.token.expiresIn,
            mode: result.token.mode,
            scopes: result.token.scopes,
          },
        },
        result.status === "enrolled" ? 200 : 201,
      );
    }),
  );

  routes.get(
    "/",
    requireIdentity,
    contractRoute(async (c) => {
      const principal = getIdentity(c);
      requireScope(principal, "profile:read");
      return ok(c, { devices: await listDevices(deps, principal.userId) });
    }),
  );

  return routes;
}
