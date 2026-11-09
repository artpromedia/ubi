/**
 * Two-person approval, immutability of activated versions, and the atomicity of
 * activation + audit + outbox. Real Postgres, real Redis.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/app";
import { prisma } from "@/lib/prisma";
import { LAGOS_CITY } from "@/seed/lagos";
import {
  adminHeaders,
  closeConnections,
  resetAll,
  seedLagosForTest,
} from "@tests/helpers/db";

const app = buildApp();

const AUTHOR = "usr_author";
const APPROVER_ONE = "usr_approver_one";
const APPROVER_TWO = "usr_approver_two";

async function createRequest(
  patch: Record<string, unknown>,
  reason = "raise the waiting fee",
  idempotencyKey = "cr-wait-fee-001",
  author = AUTHOR,
): Promise<Response> {
  return app.request("/v1/config/change-requests", {
    method: "POST",
    headers: adminHeaders(author, idempotencyKey),
    body: JSON.stringify({ cityId: LAGOS_CITY.id, patch, reason }),
  });
}

async function approve(
  requestId: string,
  actor: string,
  idempotencyKey: string,
): Promise<Response> {
  return app.request(`/v1/config/change-requests/${requestId}/approve`, {
    method: "POST",
    headers: adminHeaders(actor, idempotencyKey),
  });
}

describe("config change requests", () => {
  beforeEach(async () => {
    await resetAll();
    await seedLagosForTest();
  });

  afterAll(async () => {
    await closeConnections();
  });

  it("rejects a patch that would produce an unparseable config at request time", async () => {
    const before = await prisma.configChangeRequest.count();

    const response = await createRequest({ waitPolicy: { perMinMinor: -1 } });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      code: string;
      details?: Record<string, unknown>;
    };
    expect(body.code).toBe("validation_failed");
    // Nothing is stored: the patch never becomes something an approver could activate.
    expect(await prisma.configChangeRequest.count()).toBe(before);
  });

  it("refuses a patch that tries to set server-owned fields", async () => {
    const response = await createRequest({ version: 99 });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
    expect(await prisma.configChangeRequest.count()).toBe(0);
  });

  it("replays an identical create under the same idempotency key onto one row", async () => {
    const first = await createRequest({ quoteTtlSec: 240 });
    const second = await createRequest({ quoteTtlSec: 240 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { id: string; replayed: boolean };
    const b = (await second.json()) as { id: string; replayed: boolean };
    expect(b.id).toBe(a.id);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(await prisma.configChangeRequest.count()).toBe(1);
  });

  it("refuses a different body under an already used idempotency key", async () => {
    await createRequest({ quoteTtlSec: 240 });
    const response = await createRequest({ quoteTtlSec: 200 });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "idempotency_key_reuse",
    );
  });

  it("will not let the author approve their own change request", async () => {
    const created = (await (
      await createRequest({ quoteTtlSec: 240 })
    ).json()) as { id: string };

    const response = await approve(created.id, AUTHOR, "apr-author-001");

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "approver_is_author",
    );
    expect(await prisma.configApproval.count()).toBe(0);
  });

  it("will not let the same approver approve twice", async () => {
    const created = (await (
      await createRequest({ quoteTtlSec: 240 })
    ).json()) as { id: string };

    const first = await approve(created.id, APPROVER_ONE, "apr-one-001");
    const second = await approve(created.id, APPROVER_ONE, "apr-one-002");

    expect(first.status).toBe(200);
    expect(((await first.json()) as { approvals: number }).approvals).toBe(1);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe(
      "already_approved",
    );
    expect(await prisma.configApproval.count()).toBe(1);
  });

  it("activates exactly one new version on the second distinct approval and leaves the previous one untouched", async () => {
    const previous = await prisma.cityConfigVersion.findFirstOrThrow({
      where: { cityId: LAGOS_CITY.id, version: 1 },
    });
    const created = (await (
      await createRequest({ waitPolicy: { perMinMinor: 6_000 } })
    ).json()) as {
      id: string;
    };

    const first = await approve(created.id, APPROVER_ONE, "apr-one-101");
    expect(((await first.json()) as { activated: boolean }).activated).toBe(
      false,
    );

    const second = await approve(created.id, APPROVER_TWO, "apr-two-101");
    expect(second.status).toBe(200);
    const result = (await second.json()) as {
      activated: boolean;
      version: number;
      diff: Array<{ path: string; before: unknown; after: unknown }>;
    };
    expect(result.activated).toBe(true);
    expect(result.version).toBe(2);
    expect(result.diff).toEqual([
      { path: "version", before: 1, after: 2 },
      { path: "waitPolicy.perMinMinor", before: 5_000, after: 6_000 },
    ]);

    const versions = await prisma.cityConfigVersion.findMany({
      where: { cityId: LAGOS_CITY.id },
      orderBy: { version: "asc" },
    });
    expect(versions.map((version) => version.version)).toEqual([1, 2]);

    // Immutable: the previous row is byte-identical to what it was before.
    const previousNow = await prisma.cityConfigVersion.findFirstOrThrow({
      where: { cityId: LAGOS_CITY.id, version: 1 },
    });
    expect(previousNow.config).toEqual(previous.config);
    expect(previousNow.activatedAt?.toISOString()).toBe(
      previous.activatedAt?.toISOString(),
    );
    expect(previousNow.updatedAt.toISOString()).toBe(
      previous.updatedAt.toISOString(),
    );

    // The new version carries author and activating approver.
    const activated = versions[1];
    expect(activated?.createdBy).toBe(AUTHOR);
    expect(activated?.approvedBy).toBe(APPROVER_TWO);

    // Audit and outbox rows exist, written with the activation.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "config.version_activated", subjectId: activated?.id },
    });
    expect(audit.actorId).toBe(APPROVER_TWO);
    const outbox = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `config.version_activated:${created.id}` },
    });
    expect(outbox.name).toBe("config.version_activated");
    expect(outbox.fromVersion).toBe(1);
    expect(outbox.toVersion).toBe(2);
    expect(outbox.cityId).toBe(LAGOS_CITY.id);
    expect(outbox.publishedAt).toBeNull();
    const payload = outbox.payload as {
      cityId: string;
      version: number;
      by: string[];
    };
    expect(payload.version).toBe(2);
    expect(payload.by).toEqual([AUTHOR, APPROVER_ONE, APPROVER_TWO]);

    // And the served config is the new version.
    const served = await app.request(`/v1/config/cities/${LAGOS_CITY.id}`);
    const config = (await served.json()) as {
      version: number;
      waitPolicy: { perMinMinor: number };
    };
    expect(config.version).toBe(2);
    expect(config.waitPolicy.perMinMinor).toBe(6_000);
  });

  it("rolls back the version, the approval, the audit row and the outbox row together when activation fails", async () => {
    const created = (await (
      await createRequest({ quoteTtlSec: 240 })
    ).json()) as { id: string };
    await approve(created.id, APPROVER_ONE, "apr-one-201");

    // Occupy the idempotency key the activation will use, so the outbox insert
    // inside the activating transaction fails.
    await prisma.outboxEvent.create({
      data: {
        id: "evt_blocker",
        name: "config.version_activated",
        aggregateType: "config",
        aggregateId: LAGOS_CITY.id,
        toVersion: 2,
        actorType: "system",
        actorId: "test",
        idempotencyKey: `config.version_activated:${created.id}`,
        payload: { blocker: true },
        occurredAt: new Date(),
      },
    });

    const versionsBefore = await prisma.cityConfigVersion.count({
      where: { cityId: LAGOS_CITY.id },
    });
    const auditBefore = await prisma.auditLog.count({
      where: { action: "config.version_activated" },
    });

    const response = await approve(created.id, APPROVER_TWO, "apr-two-201");
    expect(response.status).toBe(409);

    expect(
      await prisma.cityConfigVersion.count({
        where: { cityId: LAGOS_CITY.id },
      }),
    ).toBe(versionsBefore);
    expect(
      await prisma.auditLog.count({
        where: { action: "config.version_activated" },
      }),
    ).toBe(auditBefore);
    // The second approval itself is gone: the whole transaction rolled back.
    expect(
      await prisma.configApproval.count({ where: { requestId: created.id } }),
    ).toBe(1);
    const request = await prisma.configChangeRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(request.status).toBe("pending");
    // Only the blocker row exists for that key.
    const events = await prisma.outboxEvent.findMany({
      where: { idempotencyKey: `config.version_activated:${created.id}` },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("evt_blocker");
  });

  it("reports history with the author, the activating approver and every approver", async () => {
    const created = (await (
      await createRequest({ offerTtlSec: 15 })
    ).json()) as { id: string };
    await approve(created.id, APPROVER_ONE, "apr-one-301");
    await approve(created.id, APPROVER_TWO, "apr-two-301");

    const response = await app.request(
      `/v1/config/cities/${LAGOS_CITY.id}/history`,
      {
        headers: adminHeaders(APPROVER_ONE),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versions: Array<{
        version: number;
        authoredBy: string;
        approvedBy: string | null;
        approvers: string[];
        reason: string | null;
      }>;
    };
    expect(body.versions.map((entry) => entry.version)).toEqual([2, 1]);
    const latest = body.versions[0];
    expect(latest?.authoredBy).toBe(AUTHOR);
    expect(latest?.approvedBy).toBe(APPROVER_TWO);
    expect(latest?.approvers).toEqual([APPROVER_ONE, APPROVER_TWO]);
    expect(latest?.reason).toBe("raise the waiting fee");
  });

  it("requires an admin role to propose or approve", async () => {
    const response = await app.request("/v1/config/change-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "usr_rider",
        "x-user-role": "rider",
        "idempotency-key": "cr-rider-001",
      },
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        patch: { offerTtlSec: 60 },
        reason: "why not",
      }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "forbidden",
    );
  });

  it("requires authentication", async () => {
    const response = await app.request("/v1/config/change-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "cr-anon-001",
      },
      body: JSON.stringify({
        cityId: LAGOS_CITY.id,
        patch: { offerTtlSec: 60 },
        reason: "why not",
      }),
    });
    expect(response.status).toBe(401);
  });

  it("404s an unknown city", async () => {
    const response = await app.request("/v1/config/cities/ZZZ");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      "city_unsupported",
    );
  });

  it("404s a city that exists but has no activated version", async () => {
    await prisma.city.create({
      data: {
        id: "ABJ",
        name: "Abuja",
        country: "NG",
        timezone: "Africa/Lagos",
        active: false,
      },
    });
    const response = await app.request("/v1/config/cities/ABJ");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      "not_found",
    );
  });

  it("lists pending change requests with approvals so far and records an audit row for the first approval too", async () => {
    const created = (await (
      await createRequest({ quoteTtlSec: 210 }, "shorten quote TTL")
    ).json()) as { id: string };

    const firstApproval = await app.request(
      `/v1/config/change-requests/${created.id}/approve`,
      {
        method: "POST",
        headers: adminHeaders(APPROVER_ONE, "apr-note-001"),
        body: JSON.stringify({ note: "Reviewed bounds against peak traffic" }),
      },
    );
    expect(firstApproval.status).toBe(200);
    const firstBody = (await firstApproval.json()) as {
      activated: boolean;
      approvals: number;
      approvalsRequired: number;
    };
    expect(firstBody.activated).toBe(false);
    expect(firstBody.approvals).toBe(1);
    expect(firstBody.approvalsRequired).toBe(2);

    // First approval writes its own audit row with actor and note.
    const firstAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "config.change_approved",
        subjectId: created.id,
        actorId: APPROVER_ONE,
      },
    });
    expect(firstAudit.reason).toBe("Reviewed bounds against peak traffic");

    // GET /v1/config/change-requests returns the pending request with approvals so far.
    const listed = await app.request(
      `/v1/config/change-requests?cityId=${LAGOS_CITY.id}&status=pending`,
      { headers: adminHeaders(APPROVER_TWO) },
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      requests: Array<{
        id: string;
        cityId: string;
        status: string;
        approvals: number;
        approvalsRequired: number;
        approvers: Array<{ approverId: string; createdAt: string }>;
        patch: Record<string, unknown>;
      }>;
    };
    expect(listBody.requests).toHaveLength(1);
    expect(listBody.requests[0]).toMatchObject({
      id: created.id,
      cityId: LAGOS_CITY.id,
      status: "pending",
      approvals: 1,
      approvalsRequired: 2,
      patch: { quoteTtlSec: 210 },
    });
    expect(listBody.requests[0]?.approvers.map((a) => a.approverId)).toEqual([
      APPROVER_ONE,
    ]);
  });

  it("allows the author or a config admin to reject a pending request with a required reason, audits it, and replays idempotently", async () => {
    const created = (await (
      await createRequest({ quoteTtlSec: 195 }, "experimental TTL")
    ).json()) as { id: string };

    // Reason < 3 chars is rejected by schema validation (422).
    const shortReason = await app.request(
      `/v1/config/change-requests/${created.id}/reject`,
      {
        method: "POST",
        headers: adminHeaders(APPROVER_ONE, "rej-short-001"),
        body: JSON.stringify({ reason: "no" }),
      },
    );
    expect(shortReason.status).toBe(422);

    // Unrelated non-admin caller cannot reject (403).
    const outsider = await app.request(
      `/v1/config/change-requests/${created.id}/reject`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "usr_outsider",
          "x-user-role": "ops",
          "idempotency-key": "rej-outsider-001",
        },
        body: JSON.stringify({ reason: "not my request" }),
      },
    );
    expect(outsider.status).toBe(403);

    // Author (even without a config_admin role) may withdraw/reject their own request.
    const rejected = await app.request(
      `/v1/config/change-requests/${created.id}/reject`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": AUTHOR,
          "x-user-role": "ops",
          "idempotency-key": "rej-author-001",
        },
        body: JSON.stringify({
          reason: "Withdrawing in favour of v3 proposal",
        }),
      },
    );
    expect(rejected.status).toBe(200);
    const rejBody = (await rejected.json()) as {
      requestId: string;
      status: string;
      rejectedBy: string;
      reason: string;
      replayed: boolean;
    };
    expect(rejBody).toEqual({
      requestId: created.id,
      cityId: LAGOS_CITY.id,
      status: "rejected",
      rejectedBy: AUTHOR,
      reason: "Withdrawing in favour of v3 proposal",
      replayed: false,
    });

    // Idempotent replay with same key + reason returns replayed: true.
    const replay = await app.request(
      `/v1/config/change-requests/${created.id}/reject`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": AUTHOR,
          "x-user-role": "ops",
          "idempotency-key": "rej-author-001",
        },
        body: JSON.stringify({
          reason: "Withdrawing in favour of v3 proposal",
        }),
      },
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { replayed: boolean }).replayed).toBe(
      true,
    );

    // Audit row recorded with actor and reason.
    const rejAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "config.change_rejected", subjectId: created.id },
    });
    expect(rejAudit.actorId).toBe(AUTHOR);
    expect(rejAudit.reason).toBe("Withdrawing in favour of v3 proposal");

    // Subsequent approval on a rejected request fails 409 conflict.
    const lateApprove = await approve(created.id, APPROVER_ONE, "apr-late-001");
    expect(lateApprove.status).toBe(409);
  });

  it("verifies signed x-ubi-identity JWS, enforces config:admin + non-limited mode, and refuses unsigned headers in production", async () => {
    const crypto = await import("node:crypto");
    const secret = "test-config-ubi-identity-secret-at-least-32-chars!!";
    const prevSecret = process.env.UBI_IDENTITY_SECRET;
    const prevEnv = process.env.NODE_ENV;
    process.env.UBI_IDENTITY_SECRET = secret;

    const signIdentity = (claims: {
      sub: string;
      role: string;
      scp: string[];
      mod: string[];
      city?: string | null;
      rid?: string;
    }): string => {
      const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "vnd.ubi.identity+jwt" }),
      ).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          iss: "ubi-gateway",
          aud: "ubi-internal",
          iat: now,
          exp: now + 60,
          rid: claims.rid ?? "req_test_cfg_001",
          sub: claims.sub,
          role: claims.role,
          scp: claims.scp,
          mod: claims.mod,
          city: claims.city ?? "LOS",
        }),
      ).toString("base64url");
      const sig = crypto
        .createHmac("sha256", secret)
        .update(`${header}.${payload}`)
        .digest("base64url");
      return `${header}.${payload}.${sig}`;
    };

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "production";

      // Plain x-user-id / x-user-role without x-ubi-identity is refused 401 in production.
      const unsigned = await app.request(
        `/v1/config/cities/${LAGOS_CITY.id}/history`,
        {
          headers: adminHeaders("usr_forged_admin"),
        },
      );
      expect(unsigned.status).toBe(401);

      // Tampered x-ubi-identity is refused 401.
      const badSig = await app.request(
        `/v1/config/cities/${LAGOS_CITY.id}/history`,
        {
          headers: {
            "x-ubi-identity": `${signIdentity({ sub: "usr_cfg", role: "config_admin", scp: ["config:admin"], mod: [] })}tamper`,
          },
        },
      );
      expect(badSig.status).toBe(401);

      // Limited-mode admin token is refused 403 limited_mode.
      const limitedAdmin = await app.request(
        `/v1/config/cities/${LAGOS_CITY.id}/history`,
        {
          headers: {
            "x-ubi-identity": signIdentity({
              sub: "usr_cfg",
              role: "config_admin",
              scp: ["config:admin"],
              mod: ["limited"],
            }),
          },
        },
      );
      expect(limitedAdmin.status).toBe(403);
      expect(((await limitedAdmin.json()) as { code: string }).code).toBe(
        "limited_mode",
      );

      // Admin role without config:admin scope is refused 403 forbidden.
      const missingScope = await app.request(
        `/v1/config/cities/${LAGOS_CITY.id}/history`,
        {
          headers: {
            "x-ubi-identity": signIdentity({
              sub: "usr_cfg",
              role: "config_admin",
              scp: ["profile:read"],
              mod: [],
            }),
          },
        },
      );
      expect(missingScope.status).toBe(403);

      // Valid signed config_admin JWS succeeds and overrides any plain header mirror.
      const validJws = signIdentity({
        sub: "usr_real_cfg_admin",
        role: "config_admin",
        scp: ["profile:read", "config:admin"],
        mod: ["wallet_safe"],
      });
      const flip = await app.request("/v1/flags/marketplace_rides", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "kill-prod-jws-001",
          "x-ubi-identity": validJws,
          "x-user-id": "usr_spoofed_mirror",
          "x-user-role": "rider",
        },
        body: JSON.stringify({
          cityId: LAGOS_CITY.id,
          enabled: false,
          reason: "Incident drill kill switch",
        }),
      });
      expect(flip.status).toBe(200);
      expect(((await flip.json()) as { by: string }).by).toBe(
        "usr_real_cfg_admin",
      );
    } finally {
      if (prevSecret === undefined) {
        delete process.env.UBI_IDENTITY_SECRET;
      } else {
        process.env.UBI_IDENTITY_SECRET = prevSecret;
      }
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    }
  });
});
