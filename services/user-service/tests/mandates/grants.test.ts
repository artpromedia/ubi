import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeConnections,
  createHarness,
  type Harness,
  key,
  newUserId,
  outboxNames,
  patch,
  post,
  serviceHeaders,
  userHeaders,
} from "./harness";
import { prisma } from "../../src/lib/prisma";

interface GrantView {
  id: string;
  actorId: string;
  action: string;
  resourceRef: string;
  provider: string | null;
  termsVersion: string;
  total: { amountMinor: number; currency: string };
  assurance: string;
  mandateId: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

const START = new Date("2026-09-09T10:00:00.000Z");
let harness: Harness;

beforeAll(() => {
  harness = createHarness(START);
});

afterAll(async () => {
  await closeConnections();
});

function mintBody(actorId: string, expiresAt: string) {
  return {
    actorId,
    action: "airport_pickup.reserve",
    resourceRef: `res_${actorId}`,
    provider: "ubi_rides",
    termsVersion: "terms_v3",
    total: { amountMinor: 850_000, currency: "NGN" },
    assurance: "pin" as const,
    expiresAt,
  };
}

describe("action grants — mint", () => {
  it("mints a single-use grant for a confirmed review", async () => {
    const actorId = newUserId();
    const res = await post<Envelope<{ grant: GrantView; replayed: boolean }>>(
      harness.app,
      "/internal/grants",
      serviceHeaders(key()),
      mintBody(actorId, "2026-09-09T11:00:00.000Z"),
    );

    expect(res.status).toBe(201);
    expect(res.body.data?.replayed).toBe(false);
    const grant = res.body.data?.grant;
    expect(grant?.actorId).toBe(actorId);
    expect(grant?.total).toEqual({ amountMinor: 850_000, currency: "NGN" });
    expect(grant?.assurance).toBe("pin");
    expect(grant?.consumedAt).toBeNull();

    expect(await outboxNames(actorId)).toContain("action_grant.minted");
  });

  it("replays the original grant when the same idempotency key is reused", async () => {
    const actorId = newUserId();
    const idem = key();
    const first = await post<Envelope<{ grant: GrantView; replayed: boolean }>>(
      harness.app,
      "/internal/grants",
      serviceHeaders(idem),
      mintBody(actorId, "2026-09-09T11:00:00.000Z"),
    );
    // A materially different body under the same key still returns the original.
    const second = await post<
      Envelope<{ grant: GrantView; replayed: boolean }>
    >(harness.app, "/internal/grants", serviceHeaders(idem), {
      ...mintBody(actorId, "2026-09-09T11:00:00.000Z"),
      total: { amountMinor: 1, currency: "NGN" },
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.replayed).toBe(true);
    expect(second.body.data?.grant.id).toBe(first.body.data?.grant.id);
    expect(second.body.data?.grant.total.amountMinor).toBe(850_000);
  });

  it("refuses a caller without the internal service key", async () => {
    const res = await post<Envelope<never>>(
      harness.app,
      "/internal/grants",
      { "content-type": "application/json", "idempotency-key": key() },
      mintBody(newUserId(), "2026-09-09T11:00:00.000Z"),
    );
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("requires an idempotency key", async () => {
    const res = await post<Envelope<never>>(
      harness.app,
      "/internal/grants",
      serviceHeaders(),
      mintBody(newUserId(), "2026-09-09T11:00:00.000Z"),
    );
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("validation_failed");
  });
});

describe("action grants — verify + consume", () => {
  async function mint(actorId: string, expiresAt: string): Promise<string> {
    const res = await post<Envelope<{ grant: GrantView }>>(
      harness.app,
      "/internal/grants",
      serviceHeaders(key()),
      mintBody(actorId, expiresAt),
    );
    return res.body.data?.grant.id as string;
  }

  it("consumes once and fails the second, different consume (single-use)", async () => {
    const actorId = newUserId();
    const grantId = await mint(actorId, "2026-09-09T11:00:00.000Z");

    const first = await post<
      Envelope<{ consumedAt: string; replayed: boolean }>
    >(
      harness.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(key()),
      { resultRef: "ord_123" },
    );
    expect(first.status).toBe(200);
    expect(first.body.data?.replayed).toBe(false);
    expect(first.body.data?.consumedAt).toBeTruthy();

    const second = await post<Envelope<never>>(
      harness.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(key()),
      {},
    );
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("conflict");
    expect(second.body.error?.details?.reason).toBe("already_consumed");

    expect(await outboxNames(actorId)).toContain("action_grant.consumed");
  });

  it("replays the original result when the same consume key is retried", async () => {
    const actorId = newUserId();
    const grantId = await mint(actorId, "2026-09-09T11:00:00.000Z");
    const consumeKey = key();

    const first = await post<
      Envelope<{ consumedAt: string; replayed: boolean }>
    >(
      harness.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(consumeKey),
      {},
    );
    const retry = await post<
      Envelope<{ consumedAt: string; replayed: boolean }>
    >(
      harness.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(consumeKey),
      {},
    );

    expect(retry.status).toBe(200);
    expect(retry.body.data?.replayed).toBe(true);
    expect(retry.body.data?.consumedAt).toBe(first.body.data?.consumedAt);
  });

  it("handles an expired grant: replay still returns it, consume fails", async () => {
    const local = createHarness(new Date("2026-09-09T10:00:00.000Z"));
    const actorId = newUserId();
    const idem = key();
    const body = mintBody(actorId, "2026-09-09T10:30:00.000Z");

    const minted = await post<Envelope<{ grant: GrantView }>>(
      local.app,
      "/internal/grants",
      serviceHeaders(idem),
      body,
    );
    const grantId = minted.body.data?.grant.id as string;

    // Advance well past the grant's expiry.
    local.setNow(new Date("2026-09-09T12:00:00.000Z"));

    // A replayed mint still returns the original (now-expired) grant.
    const replay = await post<
      Envelope<{ grant: GrantView; replayed: boolean }>
    >(local.app, "/internal/grants", serviceHeaders(idem), body);
    expect(replay.status).toBe(200);
    expect(replay.body.data?.replayed).toBe(true);
    expect(replay.body.data?.grant.id).toBe(grantId);

    // Consuming an expired grant fails.
    const consume = await post<Envelope<never>>(
      local.app,
      `/internal/grants/${grantId}/consume`,
      serviceHeaders(key()),
      {},
    );
    expect(consume.status).toBe(409);
    expect(consume.body.error?.details?.reason).toBe("grant_expired");
  });

  it("rejects a genuinely new mint whose expiry is already in the past", async () => {
    const local = createHarness(new Date("2026-09-09T12:00:00.000Z"));
    const res = await post<Envelope<never>>(
      local.app,
      "/internal/grants",
      serviceHeaders(key()),
      mintBody(newUserId(), "2026-09-09T11:00:00.000Z"),
    );
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("validation_failed");
  });
});

describe("action grants — mandate binding (recheck A03 / P02)", () => {
  function mandateBody(overrides: Record<string, unknown> = {}) {
    return {
      action: "marketplace.ride.select",
      title: "Pick a driver for my commute",
      passengers: "self_only",
      categories: ["go"],
      perRunCap: { amountMinor: 900_000, currency: "NGN" },
      periodCap: {
        amount: { amountMinor: 5_000_000, currency: "NGN" },
        runs: 10,
        period: "month",
      },
      constraints: [],
      expiresAt: "2027-03-01T00:00:00.000Z",
      assurance: { method: "pin", proof: "step-up" },
      ...overrides,
    };
  }

  async function createMandate(userId: string, at: Harness = harness) {
    const res = await post<Envelope<{ mandate: { id: string } }>>(
      at.app,
      "/mandates",
      await userHeaders({ userId }, key()),
      mandateBody(),
    );
    expect(res.status).toBe(201);
    return res.body.data?.mandate.id as string;
  }

  function mandateMint(actorId: string, mandateId: string | undefined) {
    return {
      ...mintBody(actorId, "2026-09-09T11:00:00.000Z"),
      action: "mp.negotiate",
      assurance: "mandate" as const,
      ...(mandateId === undefined ? {} : { mandateId }),
    };
  }

  async function mint(body: unknown, at: Harness = harness) {
    return post<Envelope<{ grant: GrantView; replayed: boolean }>>(
      at.app,
      "/internal/grants",
      serviceHeaders(key()),
      body,
    );
  }

  it("mints a mandate grant bound to an ACTIVE mandate the actor owns", async () => {
    const actorId = newUserId();
    const mandateId = await createMandate(actorId);
    const res = await mint(mandateMint(actorId, mandateId));
    expect(res.status).toBe(201);
    expect(res.body.data?.grant.assurance).toBe("mandate");
    expect(res.body.data?.grant.mandateId).toBe(mandateId);
  });

  it("refuses a mandate grant that names no mandate", async () => {
    const res = await mint(mandateMint(newUserId(), undefined));
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.reason).toBe("mandate_binding_missing");
  });

  it("refuses another user's mandate, and an unknown one, alike", async () => {
    const owner = newUserId();
    const mandateId = await createMandate(owner);
    const stranger = await mint(mandateMint(newUserId(), mandateId));
    expect(stranger.status).toBe(403);
    expect(stranger.body.error?.details?.reason).toBe("mandate_not_found");
    const unknown = await mint(mandateMint(owner, "mnd_does_not_exist"));
    expect(unknown.status).toBe(403);
    expect(unknown.body.error?.details?.reason).toBe("mandate_not_found");
    expect(await prisma.actionGrant.count({ where: { mandateId } })).toBe(0);
  });

  it("refuses a paused or revoked mandate", async () => {
    const actorId = newUserId();
    const paused = await createMandate(actorId);
    const pausedRes = await patch<Envelope<unknown>>(
      harness.app,
      `/mandates/${paused}`,
      await userHeaders({ userId: actorId }, key()),
      { op: "pause" },
    );
    expect(pausedRes.status).toBe(200);
    const onPaused = await mint(mandateMint(actorId, paused));
    expect(onPaused.status).toBe(403);
    expect(onPaused.body.error?.details?.reason).toBe("mandate_paused");

    const revoked = await createMandate(actorId);
    const revokedRes = await patch<Envelope<unknown>>(
      harness.app,
      `/mandates/${revoked}`,
      await userHeaders({ userId: actorId }, key()),
      { op: "revoke", assurance: { method: "pin", proof: "step-up" } },
    );
    expect(revokedRes.status).toBe(200);
    const onRevoked = await mint(mandateMint(actorId, revoked));
    expect(onRevoked.status).toBe(403);
    expect(onRevoked.body.error?.details?.reason).toBe("mandate_revoked");
  });

  it("refuses a mandate that has expired by the mint's clock", async () => {
    const local = createHarness(new Date("2026-09-09T10:00:00.000Z"));
    const actorId = newUserId();
    const mandateId = await createMandate(actorId, local);
    local.setNow(new Date("2027-03-02T00:00:00.000Z"));
    const res = await mint(
      {
        ...mandateMint(actorId, mandateId),
        expiresAt: "2027-03-02T01:00:00.000Z",
      },
      local,
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.reason).toBe("mandate_expired");
  });

  it("refuses a currency the mandate does not cover and a total above its per-run cap", async () => {
    const actorId = newUserId();
    const mandateId = await createMandate(actorId);
    const currency = await mint({
      ...mandateMint(actorId, mandateId),
      total: { amountMinor: 1_000, currency: "GHS" },
    });
    expect(currency.status).toBe(403);
    expect(currency.body.error?.details?.reason).toBe(
      "mandate_currency_mismatch",
    );
    const cap = await mint({
      ...mandateMint(actorId, mandateId),
      total: { amountMinor: 900_001, currency: "NGN" },
    });
    expect(cap.status).toBe(403);
    expect(cap.body.error?.details?.reason).toBe("mandate_cap_exceeded");
  });

  it("refuses an attended grant that tries to carry a mandate", async () => {
    const actorId = newUserId();
    const mandateId = await createMandate(actorId);
    const res = await mint({
      ...mintBody(actorId, "2026-09-09T11:00:00.000Z"),
      mandateId,
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.details?.reason).toBe("mandate_on_attended_grant");
  });
});
