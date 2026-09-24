/**
 * Organization routes (A06 part C — business travel).
 *
 * Every endpoint answers only to the gateway's SIGNED identity context
 * (identity/context.ts); a forged `x-auth-*` header never gets in, and there
 * is no service-key door. Paths are mounted WITHOUT the `/v1` prefix because
 * the gateway strips it for user-service: `GET /v1/organizations` at the edge
 * arrives here as `GET /organizations`. Every mutating request carries an
 * Idempotency-Key (CLAUDE.md #3).
 *
 * Money is not here: funding, budgets, business bookings and statements are
 * payment-service's `/v1/business` (src/business there), on the canonical
 * ledger.
 */
import { Hono, type Context } from "hono";

import { getIdentity, requireIdentity } from "../identity/context";
import {
  contractRoute,
  ok,
  parseBody,
  requireIdempotencyKey,
} from "../identity/http";
import {
  acceptInvitation,
  archiveCostCentre,
  createCostCentre,
  createOrganization,
  declineInvitation,
  getOrganization,
  inviteMember,
  listCostCentres,
  listMembers,
  listMyInvitations,
  listMyOrganizations,
  listOrganizationInvitations,
  removeMember,
  revokeInvitation,
  updateBilling,
  updateMember,
  updatePolicy,
} from "../organizations/organizations";
import {
  CreateCostCentreSchema,
  CreateOrganizationSchema,
  InviteMemberSchema,
  UpdateBillingSchema,
  UpdateMemberSchema,
  UpdatePolicySchema,
} from "../organizations/schemas";

import type { OrgActor, OrganizationDeps } from "../organizations/model";

function actorFrom(c: Context): OrgActor {
  const principal = getIdentity(c);
  return {
    userId: principal.userId,
    role: principal.role,
    cityId: principal.cityId,
  };
}

export function createOrganizationRoutes(deps: OrganizationDeps): Hono {
  const routes = new Hono();
  // `/organizations/*` also matches `/organizations` itself in Hono.
  routes.use("/organizations/*", requireIdentity);

  // ── The caller's own invitations (registered before `/:orgId`) ──

  routes.get(
    "/organizations/invitations",
    contractRoute(async (c) => {
      return ok(c, {
        invitations: await listMyInvitations(deps, actorFrom(c)),
      });
    }),
  );

  routes.post(
    "/organizations/invitations/:invitationId/accept",
    contractRoute(async (c) => {
      requireIdempotencyKey(c);
      const result = await acceptInvitation(
        deps,
        actorFrom(c),
        c.req.param("invitationId"),
      );
      return ok(c, result.value, result.replayed ? 200 : 201);
    }),
  );

  routes.post(
    "/organizations/invitations/:invitationId/decline",
    contractRoute(async (c) => {
      requireIdempotencyKey(c);
      const result = await declineInvitation(
        deps,
        actorFrom(c),
        c.req.param("invitationId"),
      );
      return ok(c, { invitation: result.value });
    }),
  );

  // ── Organizations ──

  routes.get(
    "/organizations",
    contractRoute(async (c) => {
      return ok(c, {
        organizations: await listMyOrganizations(deps, actorFrom(c)),
      });
    }),
  );

  routes.post(
    "/organizations",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, CreateOrganizationSchema);
      const result = await createOrganization(deps, actorFrom(c), input, key);
      return ok(c, { organization: result.value }, result.replayed ? 200 : 201);
    }),
  );

  routes.get(
    "/organizations/:orgId",
    contractRoute(async (c) => {
      const organization = await getOrganization(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
      );
      return ok(c, { organization });
    }),
  );

  routes.put(
    "/organizations/:orgId/policy",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, UpdatePolicySchema);
      const organization = await updatePolicy(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        input,
        key,
      );
      return ok(c, { organization });
    }),
  );

  routes.put(
    "/organizations/:orgId/billing",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, UpdateBillingSchema);
      const organization = await updateBilling(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        input,
        key,
      );
      return ok(c, { organization });
    }),
  );

  // ── Cost centres ──

  routes.get(
    "/organizations/:orgId/cost-centres",
    contractRoute(async (c) => {
      const costCentres = await listCostCentres(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
      );
      return ok(c, { costCentres });
    }),
  );

  routes.post(
    "/organizations/:orgId/cost-centres",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, CreateCostCentreSchema);
      const result = await createCostCentre(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        input,
        key,
      );
      return ok(c, { costCentre: result.value }, result.replayed ? 200 : 201);
    }),
  );

  routes.post(
    "/organizations/:orgId/cost-centres/:costCentreId/archive",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const costCentre = await archiveCostCentre(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        c.req.param("costCentreId"),
        key,
      );
      return ok(c, { costCentre });
    }),
  );

  // ── Members ──

  routes.get(
    "/organizations/:orgId/members",
    contractRoute(async (c) => {
      const members = await listMembers(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
      );
      // Colleagues' names: personal data, no shared cache may keep it.
      c.header("Cache-Control", "no-store");
      return ok(c, { members });
    }),
  );

  routes.patch(
    "/organizations/:orgId/members/:memberId",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, UpdateMemberSchema);
      const member = await updateMember(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        c.req.param("memberId"),
        input,
        key,
      );
      return ok(c, { member });
    }),
  );

  routes.post(
    "/organizations/:orgId/members/:memberId/remove",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const member = await removeMember(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        c.req.param("memberId"),
        key,
      );
      return ok(c, { member });
    }),
  );

  // ── Invitations (the organization's side) ──

  routes.get(
    "/organizations/:orgId/invitations",
    contractRoute(async (c) => {
      const invitations = await listOrganizationInvitations(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
      );
      return ok(c, { invitations });
    }),
  );

  routes.post(
    "/organizations/:orgId/invitations",
    contractRoute(async (c) => {
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, InviteMemberSchema);
      const result = await inviteMember(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        input,
        key,
      );
      return ok(c, { invitation: result.value }, result.replayed ? 200 : 201);
    }),
  );

  routes.post(
    "/organizations/:orgId/invitations/:invitationId/revoke",
    contractRoute(async (c) => {
      requireIdempotencyKey(c);
      const result = await revokeInvitation(
        deps,
        actorFrom(c),
        c.req.param("orgId"),
        c.req.param("invitationId"),
      );
      return ok(c, { invitation: result.value });
    }),
  );

  return routes;
}
