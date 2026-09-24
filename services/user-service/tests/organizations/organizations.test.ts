import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The shared wire contract. Imported from source because @ubi/contracts does
// not re-export it yet; every response below is parsed against it.
import {
  BUSINESS_TRAVEL_EVENT_NAMES,
  BUSINESS_TRAVEL_FLAG,
  ORG_ADMIN_ROLES,
  ORG_BOOKER_ROLES,
  ORG_INVITATION_TTL_DAYS,
  ORG_ROLES,
  OrgCostCentreViewSchema,
  OrganizationViewSchema,
  OrgInvitationViewSchema,
  OrgMemberViewSchema,
} from "../../../../packages/contracts/src/business-travel";
import {
  BUSINESS_TRAVEL_FLAG as SERVICE_FLAG,
  ORG_ADMIN_ROLES as SERVICE_ADMIN_ROLES,
  ORG_BOOKER_ROLES as SERVICE_BOOKER_ROLES,
  ORG_EVENT_NAMES,
  ORG_INVITATION_TTL_DAYS as SERVICE_TTL_DAYS,
  ORG_ROLES as SERVICE_ROLES,
} from "../../src/organizations/model";
import {
  call,
  createHarness,
  createUser,
  type Harness,
  key,
  prisma,
  seedCity,
  setBusinessTravel,
  type TestUser,
} from "./harness";

/**
 * Business travel organizations (A06 part C), end to end through the real
 * route handlers and a real Postgres: the authorization matrix, consented
 * invitations, privacy of the member view, idempotency, deny-by-default, and
 * the audit + outbox trail of every change.
 */

type Org = ReturnType<typeof OrganizationViewSchema.parse>;
type Member = ReturnType<typeof OrgMemberViewSchema.parse>;
type Invitation = ReturnType<typeof OrgInvitationViewSchema.parse>;
type CostCentre = ReturnType<typeof OrgCostCentreViewSchema.parse>;

const START = new Date("2026-09-23T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let harness: Harness;
let cityId: string;

beforeAll(async () => {
  harness = createHarness(START);
  cityId = await seedCity();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createOrg(
  owner: TestUser,
  name = "Acme Logistics",
): Promise<Org> {
  const res = await call<{ organization: Org }>(
    harness.app,
    "POST",
    "/organizations",
    owner.id,
    { key: key(), body: { name, cityId, legalName: "Acme Logistics Ltd" } },
  );
  expect(res.status).toBe(201);
  return OrganizationViewSchema.parse(res.body.data?.organization);
}

async function invite(
  orgId: string,
  inviter: TestUser,
  invitee: TestUser,
  role: string,
  extra: Record<string, unknown> = {},
) {
  return call<{ invitation: Invitation }>(
    harness.app,
    "POST",
    `/organizations/${orgId}/invitations`,
    inviter.id,
    { key: key(), body: { phone: invitee.phone, role, ...extra } },
  );
}

async function join(
  orgId: string,
  inviter: TestUser,
  invitee: TestUser,
  role: string,
): Promise<Member> {
  const invited = await invite(orgId, inviter, invitee, role);
  expect(invited.status).toBe(201);
  const invitationId = invited.body.data?.invitation.invitationId ?? "";
  const accepted = await call<{ member: Member }>(
    harness.app,
    "POST",
    `/organizations/invitations/${invitationId}/accept`,
    invitee.id,
    { key: key() },
  );
  expect(accepted.status).toBe(201);
  return OrgMemberViewSchema.parse(accepted.body.data?.member);
}

interface Cast {
  readonly org: Org;
  readonly owner: TestUser;
  readonly admin: TestUser;
  readonly booker: TestUser;
  readonly traveller: TestUser;
  readonly outsider: TestUser;
  readonly members: Record<"owner" | "admin" | "booker" | "traveller", Member>;
}

async function cast(): Promise<Cast> {
  const owner = await createUser("Olu");
  const admin = await createUser("Amaka");
  const booker = await createUser("Bayo");
  const traveller = await createUser("Tobi");
  const outsider = await createUser("Uche");
  const org = await createOrg(owner);
  const adminMember = await join(org.id, owner, admin, "admin");
  const bookerMember = await join(org.id, admin, booker, "booker");
  const travellerMember = await join(org.id, admin, traveller, "traveller");
  const ownerRow = await prisma.organizationMember.findUniqueOrThrow({
    where: {
      organizationId_userId: { organizationId: org.id, userId: owner.id },
    },
  });
  const ownerMember: Member = {
    memberId: ownerRow.id,
    userId: owner.id,
    displayName: `${owner.firstName} ${owner.lastName}`,
    role: "owner",
    status: "active",
    costCentreId: null,
    joinedAt: ownerRow.createdAt.toISOString(),
  };
  return {
    org,
    owner,
    admin,
    booker,
    traveller,
    outsider,
    members: {
      owner: ownerMember,
      admin: adminMember,
      booker: bookerMember,
      traveller: travellerMember,
    },
  };
}

// ---------------------------------------------------------------------------

describe("the contract and the service agree", () => {
  it("mirrors roles, flag, TTL and the closed event list exactly", () => {
    expect([...SERVICE_ROLES]).toEqual([...ORG_ROLES]);
    expect([...SERVICE_ADMIN_ROLES]).toEqual([...ORG_ADMIN_ROLES]);
    expect([...SERVICE_BOOKER_ROLES]).toEqual([...ORG_BOOKER_ROLES]);
    expect(SERVICE_FLAG).toBe(BUSINESS_TRAVEL_FLAG);
    expect(SERVICE_TTL_DAYS).toBe(ORG_INVITATION_TTL_DAYS);
    expect([...ORG_EVENT_NAMES]).toEqual([...BUSINESS_TRAVEL_EVENT_NAMES]);
  });
});

describe("authentication", () => {
  it("refuses a request with no signed identity context", async () => {
    const res = await call(harness.app, "GET", "/organizations", null);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("refuses a forged x-auth-user-id header — the header-trusting middleware never answers", async () => {
    const owner = await createUser();
    const org = await createOrg(owner);
    const res = await call(
      harness.app,
      "GET",
      `/organizations/${org.id}`,
      null,
      {
        headers: { "x-auth-user-id": owner.id, "x-auth-user-role": "admin" },
      },
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
    expect(res.raw).not.toContain("protectedApi");
  });
});

describe("creating an organization", () => {
  it("is deny-by-default: no business_travel rule, or a rule set off, is feature_disabled (404)", async () => {
    const owner = await createUser();
    const noRule = await seedCity({ flag: null });
    const off = await seedCity({ flag: false });
    for (const city of [noRule, off]) {
      const res = await call(harness.app, "POST", "/organizations", owner.id, {
        key: key(),
        body: { name: "Dark Corp", cityId: city },
      });
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("feature_disabled");
    }
    expect(
      await prisma.organization.count({
        where: { cityId: { in: [noRule, off] } },
      }),
    ).toBe(0);
  });

  it("makes the caller the owner, opens with a CLOSED policy, and writes audit + outbox", async () => {
    const owner = await createUser();
    const org = await createOrg(owner);
    expect(org.myRole).toBe("owner");
    expect(org.currency).toBe("NGN");
    expect(org.policy).toEqual({
      tripCap: { amountMinor: 0, currency: "NGN" },
      allowedServices: [],
      allowedClasses: [],
      version: 1,
    });
    expect(org.billing).toEqual({
      legalName: "Acme Logistics Ltd",
      taxId: null,
    });

    const audit = await prisma.auditLog.findMany({
      where: { subjectType: "organization", subjectId: org.id },
    });
    expect(audit.map((row) => row.action)).toEqual(["organization.created"]);
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateType: "user", aggregateId: owner.id },
    });
    expect(events.map((row) => row.name)).toContain("organization.created");
    const created = events.find((row) => row.name === "organization.created");
    expect(created?.payload).toMatchObject({ organizationId: org.id });
  });

  it("replays the same Idempotency-Key and refuses it for a different organization", async () => {
    const owner = await createUser();
    const idem = key();
    const body = { name: "Replay Ltd", cityId };
    const first = await call<{ organization: Org }>(
      harness.app,
      "POST",
      "/organizations",
      owner.id,
      { key: idem, body },
    );
    const second = await call<{ organization: Org }>(
      harness.app,
      "POST",
      "/organizations",
      owner.id,
      { key: idem, body },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data?.organization.id).toBe(
      first.body.data?.organization.id,
    );

    const reused = await call(harness.app, "POST", "/organizations", owner.id, {
      key: idem,
      body: { name: "Something Else", cityId },
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error?.code).toBe("idempotency_key_reuse");
    expect(
      await prisma.organization.count({ where: { createdBy: owner.id } }),
    ).toBe(1);
  });

  it("requires an Idempotency-Key", async () => {
    const owner = await createUser();
    const res = await call(harness.app, "POST", "/organizations", owner.id, {
      body: { name: "No Key Ltd", cityId },
    });
    expect(res.status).toBe(422);
  });
});

describe("the authorization matrix", () => {
  let c: Cast;
  beforeAll(async () => {
    c = await cast();
  });

  const everyone = (): Array<[string, TestUser]> => [
    ["owner", c.owner],
    ["admin", c.admin],
    ["booker", c.booker],
    ["traveller", c.traveller],
    ["outsider", c.outsider],
  ];

  it("lets every member read the organization; billing only for owners and admins; outsiders get 404", async () => {
    const expected: Record<string, { status: number; billing: boolean }> = {
      owner: { status: 200, billing: true },
      admin: { status: 200, billing: true },
      booker: { status: 200, billing: false },
      traveller: { status: 200, billing: false },
      outsider: { status: 404, billing: false },
    };
    for (const [name, user] of everyone()) {
      const res = await call<{ organization: Org }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}`,
        user.id,
      );
      expect(res.status, name).toBe(expected[name]?.status);
      if (res.status === 200) {
        const org = OrganizationViewSchema.parse(res.body.data?.organization);
        expect(org.myRole, name).toBe(name);
        expect(org.billing !== null, name).toBe(expected[name]?.billing);
      }
    }
  });

  it("lets only owners and admins change the policy and billing", async () => {
    const expected: Record<string, number> = {
      owner: 200,
      admin: 200,
      booker: 403,
      traveller: 403,
      outsider: 404,
    };
    for (const [name, user] of everyone()) {
      const current = await prisma.organization.findUniqueOrThrow({
        where: { id: c.org.id },
      });
      const policy = await call<{ organization: Org }>(
        harness.app,
        "PUT",
        `/organizations/${c.org.id}/policy`,
        user.id,
        {
          key: key(),
          body: {
            tripCapMinor: 1_500_000,
            allowedServices: ["ride"],
            allowedClasses: ["go", "comfort"],
            expectedPolicyVersion: current.policyVersion,
          },
        },
      );
      expect(policy.status, `policy as ${name}`).toBe(expected[name]);
      const billing = await call(
        harness.app,
        "PUT",
        `/organizations/${c.org.id}/billing`,
        user.id,
        {
          key: key(),
          body: { legalName: "Acme Logistics Ltd", taxId: "TIN-001" },
        },
      );
      expect(billing.status, `billing as ${name}`).toBe(expected[name]);
    }
  });

  it("lets only owners and admins create cost centres; every member may list them", async () => {
    const create: Record<string, number> = {
      owner: 201,
      admin: 201,
      booker: 403,
      traveller: 403,
      outsider: 404,
    };
    for (const [name, user] of everyone()) {
      const res = await call(
        harness.app,
        "POST",
        `/organizations/${c.org.id}/cost-centres`,
        user.id,
        { key: key(), body: { code: `CC-${name}`, name: `${name} centre` } },
      );
      expect(res.status, name).toBe(create[name]);
      const list = await call<{ costCentres: CostCentre[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/cost-centres`,
        user.id,
      );
      expect(list.status, name).toBe(name === "outsider" ? 404 : 200);
    }
  });

  it("lets owners invite any role, admins only bookers and travellers, nobody else", async () => {
    const cases: Array<[string, TestUser, string, number]> = [
      ["owner→admin", c.owner, "admin", 201],
      ["owner→owner", c.owner, "owner", 201],
      ["admin→traveller", c.admin, "traveller", 201],
      ["admin→booker", c.admin, "booker", 201],
      ["admin→admin", c.admin, "admin", 403],
      ["admin→owner", c.admin, "owner", 403],
      ["booker→traveller", c.booker, "traveller", 403],
      ["traveller→traveller", c.traveller, "traveller", 403],
      ["outsider→traveller", c.outsider, "traveller", 404],
    ];
    for (const [label, inviter, role, status] of cases) {
      const invitee = await createUser();
      const res = await invite(c.org.id, inviter, invitee, role);
      expect(res.status, label).toBe(status);
      if (status === 201) {
        OrgInvitationViewSchema.parse(res.body.data?.invitation);
      }
    }
    const list: Record<string, number> = {
      owner: 200,
      admin: 200,
      booker: 403,
      traveller: 403,
      outsider: 404,
    };
    for (const [name, user] of everyone()) {
      const res = await call(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/invitations`,
        user.id,
      );
      expect(res.status, name).toBe(list[name]);
    }
  });

  it("scopes the member list: admins all, bookers the active members, travellers only themselves", async () => {
    const seen = async (user: TestUser) => {
      const res = await call<{ members: Member[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/members`,
        user.id,
      );
      return res;
    };
    const ownerView = await seen(c.owner);
    expect(ownerView.status).toBe(200);
    const all = ownerView.body.data?.members ?? [];
    expect(all.map((m) => m.userId)).toEqual(
      expect.arrayContaining([
        c.owner.id,
        c.admin.id,
        c.booker.id,
        c.traveller.id,
      ]),
    );

    const bookerView = (await seen(c.booker)).body.data?.members ?? [];
    expect(bookerView.every((m) => m.status === "active")).toBe(true);
    expect(bookerView.map((m) => m.userId)).toContain(c.traveller.id);

    const travellerView = (await seen(c.traveller)).body.data?.members ?? [];
    expect(travellerView.map((m) => m.userId)).toEqual([c.traveller.id]);

    expect((await seen(c.outsider)).status).toBe(404);
  });

  it("lets admins manage bookers and travellers only; owners manage everyone", async () => {
    const promote = await call<{ member: Member }>(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      c.admin.id,
      { key: key(), body: { role: "booker" } },
    );
    expect(promote.status).toBe(200);
    expect(promote.body.data?.member.role).toBe("booker");

    const toAdmin = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      c.admin.id,
      { key: key(), body: { role: "admin" } },
    );
    expect(toAdmin.status).toBe(403);

    const touchOwner = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.owner.memberId}`,
      c.admin.id,
      { key: key(), body: { role: "traveller" } },
    );
    expect(touchOwner.status).toBe(403);

    const bookerTries = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      c.booker.id,
      { key: key(), body: { role: "traveller" } },
    );
    expect(bookerTries.status).toBe(403);

    const back = await call<{ member: Member }>(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      c.owner.id,
      { key: key(), body: { role: "traveller" } },
    );
    expect(back.status).toBe(200);
    expect(back.body.data?.member.role).toBe("traveller");
  });
});

describe("removal and the last owner", () => {
  it("lets admins remove travellers, members leave, and never leaves an organization ownerless", async () => {
    const c = await cast();
    const bookerRemoves = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}/remove`,
      c.booker.id,
      { key: key() },
    );
    expect(bookerRemoves.status).toBe(403);

    const adminRemoves = await call<{ member: Member }>(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}/remove`,
      c.admin.id,
      { key: key() },
    );
    expect(adminRemoves.status).toBe(200);
    expect(adminRemoves.body.data?.member.status).toBe("removed");

    // The removed traveller is now an outsider.
    const gone = await call(
      harness.app,
      "GET",
      `/organizations/${c.org.id}`,
      c.traveller.id,
    );
    expect(gone.status).toBe(404);

    const leaves = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.booker.memberId}/remove`,
      c.booker.id,
      { key: key() },
    );
    expect(leaves.status).toBe(200);

    const soleOwnerLeaves = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.owner.memberId}/remove`,
      c.owner.id,
      { key: key() },
    );
    expect(soleOwnerLeaves.status).toBe(409);
    const soleOwnerDemoted = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.owner.memberId}`,
      c.owner.id,
      { key: key(), body: { role: "admin" } },
    );
    expect(soleOwnerDemoted.status).toBe(409);
  });

  it("serializes two concurrent owner demotions so exactly one survives as owner", async () => {
    const first = await createUser();
    const second = await createUser();
    const org = await createOrg(first);
    const secondMember = await join(org.id, first, second, "owner");
    const firstMember = await prisma.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: org.id, userId: first.id },
      },
    });

    const results = await Promise.all([
      call(
        harness.app,
        "PATCH",
        `/organizations/${org.id}/members/${firstMember.id}`,
        first.id,
        { key: key(), body: { role: "admin" } },
      ),
      call(
        harness.app,
        "PATCH",
        `/organizations/${org.id}/members/${secondMember.memberId}`,
        second.id,
        { key: key(), body: { role: "admin" } },
      ),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: org.id, role: "owner", status: "active" },
      }),
    ).toBe(1);
  });
});

describe("policy edits", () => {
  it("refuses a stale policy version, replays a key, and refuses a key reused for another policy", async () => {
    const owner = await createUser();
    const org = await createOrg(owner);
    const idem = key();
    const body = {
      tripCapMinor: 2_000_000,
      allowedServices: ["ride", "ride"],
      allowedClasses: ["comfort", "go"],
      expectedPolicyVersion: 1,
    };
    const first = await call<{ organization: Org }>(
      harness.app,
      "PUT",
      `/organizations/${org.id}/policy`,
      owner.id,
      { key: idem, body },
    );
    expect(first.status).toBe(200);
    const policy = OrganizationViewSchema.parse(
      first.body.data?.organization,
    ).policy;
    expect(policy).toEqual({
      tripCap: { amountMinor: 2_000_000, currency: "NGN" },
      allowedServices: ["ride"],
      allowedClasses: ["comfort", "go"],
      version: 2,
    });

    const replay = await call<{ organization: Org }>(
      harness.app,
      "PUT",
      `/organizations/${org.id}/policy`,
      owner.id,
      { key: idem, body },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data?.organization.policy.version).toBe(2);

    const reuse = await call(
      harness.app,
      "PUT",
      `/organizations/${org.id}/policy`,
      owner.id,
      { key: idem, body: { ...body, tripCapMinor: 9 } },
    );
    expect(reuse.status).toBe(409);
    expect(reuse.body.error?.code).toBe("idempotency_key_reuse");

    const stale = await call(
      harness.app,
      "PUT",
      `/organizations/${org.id}/policy`,
      owner.id,
      { key: key(), body: { ...body, expectedPolicyVersion: 1 } },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("version_conflict");

    const unknownService = await call(
      harness.app,
      "PUT",
      `/organizations/${org.id}/policy`,
      owner.id,
      {
        key: key(),
        body: {
          ...body,
          allowedServices: ["helicopter"],
          expectedPolicyVersion: 2,
        },
      },
    );
    expect(unknownService.status).toBe(422);

    const audits = await prisma.auditLog.findMany({
      where: {
        subjectType: "organization",
        subjectId: org.id,
        action: "organization.policy_updated",
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.before).toMatchObject({
      tripCapMinor: 0,
      policyVersion: 1,
    });
    expect(audits[0]?.after).toMatchObject({
      tripCapMinor: 2_000_000,
      policyVersion: 2,
    });
  });
});

describe("cost centres", () => {
  it("refuses a duplicate code, archives once, and refuses an archived centre as a member default", async () => {
    const c = await cast();
    const created = await call<{ costCentre: CostCentre }>(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/cost-centres`,
      c.admin.id,
      { key: key(), body: { code: "ENG", name: "Engineering" } },
    );
    expect(created.status).toBe(201);
    const centre = OrgCostCentreViewSchema.parse(created.body.data?.costCentre);

    const duplicate = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/cost-centres`,
      c.admin.id,
      { key: key(), body: { code: "ENG", name: "Engineering again" } },
    );
    expect(duplicate.status).toBe(409);

    const assign = await call<{ member: Member }>(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      c.admin.id,
      { key: key(), body: { costCentreId: centre.costCentreId } },
    );
    expect(assign.status).toBe(200);
    expect(assign.body.data?.member.costCentreId).toBe(centre.costCentreId);

    const archived = await call<{ costCentre: CostCentre }>(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/cost-centres/${centre.costCentreId}/archive`,
      c.admin.id,
      { key: key() },
    );
    expect(archived.status).toBe(200);
    expect(archived.body.data?.costCentre.status).toBe("archived");

    const again = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/cost-centres/${centre.costCentreId}/archive`,
      c.admin.id,
      { key: key() },
    );
    expect(again.status).toBe(409);

    const assignArchived = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${c.members.booker.memberId}`,
      c.admin.id,
      { key: key(), body: { costCentreId: centre.costCentreId } },
    );
    expect(assignArchived.status).toBe(422);

    // Another organization's cost centre is not assignable either.
    const other = await cast();
    const foreign = await call(
      harness.app,
      "PATCH",
      `/organizations/${other.org.id}/members/${other.members.booker.memberId}`,
      other.admin.id,
      { key: key(), body: { costCentreId: centre.costCentreId } },
    );
    expect(foreign.status).toBe(422);
  });
});

describe("invitations are consented and bound to one user", () => {
  it("refuses an unknown number, an existing member and a duplicate pending invitation", async () => {
    const c = await cast();
    const unknown = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/invitations`,
      c.admin.id,
      { key: key(), body: { phone: "+2349000000001", role: "traveller" } },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("recipient_not_found");

    const member = await invite(c.org.id, c.admin, c.booker, "traveller");
    expect(member.status).toBe(409);

    const newcomer = await createUser();
    expect(
      (await invite(c.org.id, c.admin, newcomer, "traveller")).status,
    ).toBe(201);
    expect((await invite(c.org.id, c.admin, newcomer, "booker")).status).toBe(
      409,
    );
  });

  it("grants nothing until the invitee accepts; nobody else can accept; accept replays", async () => {
    const c = await cast();
    const newcomer = await createUser("Nneka");
    const invited = await invite(c.org.id, c.admin, newcomer, "traveller");
    const invitation = OrgInvitationViewSchema.parse(
      invited.body.data?.invitation,
    );
    expect(invitation.status).toBe("pending");
    expect(invitation.inviteeUserId).toBe(newcomer.id);
    // The audit row names the invitee by id — never the phone that found them.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { subjectId: c.org.id, action: "organization.member_invited" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.after)).not.toContain(newcomer.phone);

    // Pending: not a member yet.
    const early = await call(
      harness.app,
      "GET",
      `/organizations/${c.org.id}`,
      newcomer.id,
    );
    expect(early.status).toBe(404);

    // Only the invitee sees it in their inbox.
    const inbox = await call<{ invitations: Invitation[] }>(
      harness.app,
      "GET",
      "/organizations/invitations",
      newcomer.id,
    );
    expect(inbox.body.data?.invitations.map((i) => i.invitationId)).toContain(
      invitation.invitationId,
    );
    const strangersInbox = await call<{ invitations: Invitation[] }>(
      harness.app,
      "GET",
      "/organizations/invitations",
      c.outsider.id,
    );
    expect(
      strangersInbox.body.data?.invitations.map((i) => i.invitationId),
    ).not.toContain(invitation.invitationId);

    for (const stranger of [c.outsider, c.admin, c.owner]) {
      const hijack = await call(
        harness.app,
        "POST",
        `/organizations/invitations/${invitation.invitationId}/accept`,
        stranger.id,
        { key: key() },
      );
      expect(hijack.status).toBe(404);
    }

    const accepted = await call<{ member: Member; invitation: Invitation }>(
      harness.app,
      "POST",
      `/organizations/invitations/${invitation.invitationId}/accept`,
      newcomer.id,
      { key: key() },
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.data?.member.role).toBe("traveller");
    expect(accepted.body.data?.invitation.status).toBe("accepted");

    const replay = await call<{ member: Member }>(
      harness.app,
      "POST",
      `/organizations/invitations/${invitation.invitationId}/accept`,
      newcomer.id,
      { key: key() },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data?.member.memberId).toBe(
      accepted.body.data?.member.memberId,
    );

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateType: "user", aggregateId: newcomer.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.name)).toEqual([
      "organization.member_invited",
      "organization.invitation_accepted",
    ]);
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toContain(newcomer.phone);
    }
  });

  it("honours declines and revocations, and expires after the TTL", async () => {
    const c = await cast();
    const decliner = await createUser();
    const declined = await invite(c.org.id, c.admin, decliner, "traveller");
    const declinedId = declined.body.data?.invitation.invitationId ?? "";
    const decline = await call<{ invitation: Invitation }>(
      harness.app,
      "POST",
      `/organizations/invitations/${declinedId}/decline`,
      decliner.id,
      { key: key() },
    );
    expect(decline.status).toBe(200);
    expect(decline.body.data?.invitation.status).toBe("declined");
    const acceptDeclined = await call(
      harness.app,
      "POST",
      `/organizations/invitations/${declinedId}/accept`,
      decliner.id,
      { key: key() },
    );
    expect(acceptDeclined.status).toBe(409);

    const revokee = await createUser();
    const revoked = await invite(c.org.id, c.admin, revokee, "traveller");
    const revokedId = revoked.body.data?.invitation.invitationId ?? "";
    const bookerRevokes = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/invitations/${revokedId}/revoke`,
      c.booker.id,
      { key: key() },
    );
    expect(bookerRevokes.status).toBe(403);
    const revoke = await call<{ invitation: Invitation }>(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/invitations/${revokedId}/revoke`,
      c.admin.id,
      { key: key() },
    );
    expect(revoke.body.data?.invitation.status).toBe("revoked");
    const acceptRevoked = await call(
      harness.app,
      "POST",
      `/organizations/invitations/${revokedId}/accept`,
      revokee.id,
      { key: key() },
    );
    expect(acceptRevoked.status).toBe(409);

    const late = await createUser();
    const lateInvite = await invite(c.org.id, c.admin, late, "traveller");
    const lateId = lateInvite.body.data?.invitation.invitationId ?? "";
    harness.setNow(
      new Date(START.getTime() + (ORG_INVITATION_TTL_DAYS + 1) * DAY_MS),
    );
    try {
      const inbox = await call<{ invitations: Invitation[] }>(
        harness.app,
        "GET",
        "/organizations/invitations",
        late.id,
      );
      expect(inbox.body.data?.invitations).toEqual([]);
      const expired = await call(
        harness.app,
        "POST",
        `/organizations/invitations/${lateId}/accept`,
        late.id,
        { key: key() },
      );
      expect(expired.status).toBe(409);
      expect(expired.body.error?.details).toMatchObject({ status: "expired" });
    } finally {
      harness.setNow(START);
    }
  });

  it("reactivates the same membership row when a removed member is invited back", async () => {
    const c = await cast();
    await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}/remove`,
      c.admin.id,
      { key: key() },
    );
    const back = await join(c.org.id, c.admin, c.traveller, "booker");
    expect(back.memberId).toBe(c.members.traveller.memberId);
    expect(back.role).toBe("booker");
    expect(back.status).toBe("active");
  });

  it("stops NEW invitations when business_travel is switched off, without locking anyone in", async () => {
    const offCity = await seedCity();
    const owner = await createUser();
    const res = await call<{ organization: Org }>(
      harness.app,
      "POST",
      "/organizations",
      owner.id,
      { key: key(), body: { name: "Switch Ltd", cityId: offCity } },
    );
    const org = OrganizationViewSchema.parse(res.body.data?.organization);
    const member = await createUser();
    const pendingInvitee = await createUser();
    const joined = await join(org.id, owner, member, "traveller");
    const pending = await invite(org.id, owner, pendingInvitee, "traveller");
    expect(pending.status).toBe(201);

    await setBusinessTravel(offCity, false);
    const blocked = await invite(
      org.id,
      owner,
      await createUser(),
      "traveller",
    );
    expect(blocked.status).toBe(404);
    expect(blocked.body.error?.code).toBe("feature_disabled");

    // Existing relationships keep working: accept, remove, tighten policy.
    const accepted = await call(
      harness.app,
      "POST",
      `/organizations/invitations/${pending.body.data?.invitation.invitationId}/accept`,
      pendingInvitee.id,
      { key: key() },
    );
    expect(accepted.status).toBe(201);
    const removed = await call(
      harness.app,
      "POST",
      `/organizations/${org.id}/members/${joined.memberId}/remove`,
      owner.id,
      { key: key() },
    );
    expect(removed.status).toBe(200);
  });
});

describe("an invitation never outlives its inviter's authority", () => {
  async function invitationStatus(invitationId: string): Promise<string> {
    const row = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: invitationId },
    });
    return row.status;
  }

  it("revokes a removed owner's pending invitations, so an accomplice cannot take the organization back", async () => {
    const c = await cast();
    const coOwner = await createUser("Ngozi");
    await join(c.org.id, c.owner, coOwner, "owner");
    const accomplice = await createUser("Mallam");
    const colleague = await createUser("Chidi");
    const toOwner = await invite(c.org.id, c.owner, accomplice, "owner");
    const toTraveller = await invite(c.org.id, c.owner, colleague, "traveller");
    const ownerInvite = toOwner.body.data?.invitation.invitationId ?? "";
    const travellerInvite =
      toTraveller.body.data?.invitation.invitationId ?? "";

    const removed = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/members/${c.members.owner.memberId}/remove`,
      coOwner.id,
      { key: key() },
    );
    expect(removed.status).toBe(200);
    // A removed member can grant nothing: every pending invitation they sent
    // is revoked in the removal's transaction, with its audit + outbox trail.
    expect(await invitationStatus(ownerInvite)).toBe("revoked");
    expect(await invitationStatus(travellerInvite)).toBe("revoked");
    const audit = await prisma.auditLog.findMany({
      where: {
        subjectId: c.org.id,
        action: "organization.invitation_revoked",
        reason: "inviter_lost_authority",
      },
    });
    expect(audit).toHaveLength(2);
    const events = await prisma.outboxEvent.findMany({
      where: {
        name: "organization.invitation_revoked",
        aggregateId: { in: [accomplice.id, colleague.id] },
      },
    });
    expect(events).toHaveLength(2);

    const takeover = await call(
      harness.app,
      "POST",
      `/organizations/invitations/${ownerInvite}/accept`,
      accomplice.id,
      { key: key() },
    );
    expect(takeover.status).toBe(409);
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: c.org.id, userId: accomplice.id },
      }),
    ).toBe(0);
  });

  it("revokes only what a demoted inviter can no longer grant", async () => {
    const c = await cast();
    const coOwner = await createUser("Funke");
    await join(c.org.id, c.owner, coOwner, "owner");
    const wouldBeAdmin = await createUser("Kemi");
    const wouldBeBooker = await createUser("Segun");
    const adminInvite =
      (await invite(c.org.id, coOwner, wouldBeAdmin, "admin")).body.data
        ?.invitation.invitationId ?? "";
    const bookerInvite =
      (await invite(c.org.id, coOwner, wouldBeBooker, "booker")).body.data
        ?.invitation.invitationId ?? "";
    const coOwnerRow = await prisma.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: c.org.id, userId: coOwner.id },
      },
    });

    const demoted = await call(
      harness.app,
      "PATCH",
      `/organizations/${c.org.id}/members/${coOwnerRow.id}`,
      c.owner.id,
      { key: key(), body: { role: "admin" } },
    );
    expect(demoted.status).toBe(200);
    // An admin may not grant admin, but may still grant booker.
    expect(await invitationStatus(adminInvite)).toBe("revoked");
    expect(await invitationStatus(bookerInvite)).toBe("pending");
    const booker = await call<{ member: Member }>(
      harness.app,
      "POST",
      `/organizations/invitations/${bookerInvite}/accept`,
      wouldBeBooker.id,
      { key: key() },
    );
    expect(booker.status).toBe(201);
    expect(booker.body.data?.member.role).toBe("booker");
  });

  it("refuses at accept an invitation whose inviter can no longer grant its role", async () => {
    const c = await cast();
    const invitee = await createUser("Ada");
    // A pending invitation from a member who has since been demoted to
    // booker, written straight to the table — the accept-time backstop must
    // refuse it on its own, whatever path left it pending.
    await prisma.organizationMember.update({
      where: { id: c.members.admin.memberId },
      data: { role: "booker" },
    });
    const invitationId = `orgi_backstop_${key()}`;
    await prisma.organizationInvitation.create({
      data: {
        id: invitationId,
        organizationId: c.org.id,
        inviteeUserId: invitee.id,
        role: "traveller",
        status: "pending",
        invitedBy: c.admin.id,
        idempotencyKey: `backstop:${invitationId}`,
        expiresAt: new Date(START.getTime() + DAY_MS),
      },
    });
    const refused = await call(
      harness.app,
      "POST",
      `/organizations/invitations/${invitationId}/accept`,
      invitee.id,
      { key: key() },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details).toMatchObject({
      reason: "inviter_not_authorized",
    });
    expect(
      await prisma.organizationMember.count({
        where: { organizationId: c.org.id, userId: invitee.id },
      }),
    ).toBe(0);
  });

  it("lets only someone who could grant a role withdraw its invitation", async () => {
    const c = await cast();
    const candidate = await createUser("Bola");
    const ownerInvite =
      (await invite(c.org.id, c.owner, candidate, "owner")).body.data
        ?.invitation.invitationId ?? "";
    const byAdmin = await call(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/invitations/${ownerInvite}/revoke`,
      c.admin.id,
      { key: key() },
    );
    expect(byAdmin.status).toBe(403);
    expect(await invitationStatus(ownerInvite)).toBe("pending");
    const byOwner = await call<{ invitation: Invitation }>(
      harness.app,
      "POST",
      `/organizations/${c.org.id}/invitations/${ownerInvite}/revoke`,
      c.owner.id,
      { key: key() },
    );
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.data?.invitation.status).toBe("revoked");
  });

  it("shows a lapsed invitation as expired in the organization's list", async () => {
    const c = await cast();
    const late = await createUser("Yemi");
    const invitationId =
      (await invite(c.org.id, c.admin, late, "traveller")).body.data?.invitation
        .invitationId ?? "";
    harness.setNow(
      new Date(START.getTime() + (ORG_INVITATION_TTL_DAYS + 1) * DAY_MS),
    );
    try {
      const listed = await call<{ invitations: Invitation[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/invitations`,
        c.admin.id,
      );
      const row = listed.body.data?.invitations.find(
        (item) => item.invitationId === invitationId,
      );
      expect(OrgInvitationViewSchema.parse(row).status).toBe("expired");
    } finally {
      harness.setNow(START);
    }
  });
});

describe("passenger privacy", () => {
  it("never puts a member's phone, email or personal data on any organization view", async () => {
    const c = await cast();
    const responses = await Promise.all([
      call<{ members: Member[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/members`,
        c.owner.id,
      ),
      call<{ members: Member[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/members`,
        c.booker.id,
      ),
      call<{ invitations: Invitation[] }>(
        harness.app,
        "GET",
        `/organizations/${c.org.id}/invitations`,
        c.admin.id,
      ),
    ]);
    const [ownerList, bookerList] = responses;
    expect(ownerList?.status).toBe(200);
    for (const member of ownerList?.body.data?.members ?? []) {
      // `.strict()` in the contract: any extra key (phone, email, trips…) fails.
      OrgMemberViewSchema.parse(member);
    }
    for (const member of bookerList?.body.data?.members ?? []) {
      OrgMemberViewSchema.parse(member);
    }
    const colleagues = [c.owner, c.admin, c.booker, c.traveller];
    for (const res of responses) {
      for (const person of colleagues) {
        expect(res.raw).not.toContain(person.phone);
        expect(res.raw).not.toContain(person.email);
      }
    }
    const traveller = ownerList?.body.data?.members.find(
      (m) => m.userId === c.traveller.id,
    );
    expect(traveller?.displayName).toBe(
      `${c.traveller.firstName} ${c.traveller.lastName}`,
    );
  });

  it("serves no read of a member's personal trips or profile through the organization", async () => {
    const c = await cast();
    for (const path of [
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}`,
      `/organizations/${c.org.id}/members/${c.members.traveller.memberId}/trips`,
      `/organizations/${c.org.id}/trips`,
    ]) {
      const res = await call(harness.app, "GET", path, c.owner.id);
      // No organization route serves it: the request falls through to the
      // protectedApi catch-all, which refuses it for want of its own
      // credentials — never an organization answer.
      expect([401, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect(res.raw).not.toContain(c.traveller.phone);
    }
  });
});
