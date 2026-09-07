import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";

import { prisma } from "../../src/lib/prisma";
import {
  authedHeaders,
  closeConnections,
  createHarness,
  createUser,
  FULL_SCOPES,
  identityHeader,
  type TestHarness,
  type TestUser,
} from "./harness";

let harness: TestHarness;
let user: TestUser;

beforeAll(async () => {
  harness = createHarness();
  harness.setNow(new Date("2026-03-01T09:00:00.000Z"));
  user = await createUser("RIDER");
});

afterAll(async () => {
  await closeConnections();
});

async function enrol(deviceId: string, principalUserId = user.id) {
  return harness.app.fetch(
    new Request("http://user-service.test/devices/enroll", {
      method: "POST",
      headers: await authedHeaders({
        userId: principalUserId,
        role: "rider",
        scopes: FULL_SCOPES,
      }),
      body: JSON.stringify({
        deviceId,
        platform: "android",
        model: "Pixel 7a",
      }),
    }),
  );
}

describe("device enrolment", () => {
  it("requires step-up for a new device and issues a limited-mode token", async () => {
    const response = await enrol("device-alpha-0001");
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      data: {
        status: string;
        deviceId: string;
        trusted: boolean;
        stepUp: {
          required: boolean;
          methods: string[];
          unavailable: { method: string }[];
        };
        token: { accessToken: string; mode: string; scopes: string[] };
      };
    };

    expect(body.data.status).toBe("step_up_required");
    expect(body.data.trusted).toBe(false);
    expect(body.data.stepUp.required).toBe(true);
    // No other trusted device yet, so that method is offered as unavailable
    // with a reason rather than quietly dropped.
    expect(body.data.stepUp.methods).toEqual(["selfie_nin"]);
    expect(body.data.stepUp.unavailable[0]?.method).toBe("old_device_approve");

    expect(body.data.token.mode).toBe("limited");
    expect(body.data.token.scopes).toContain("ride:book:cash");
    expect(body.data.token.scopes).not.toContain("wallet:transfer:p2p");
    expect(body.data.token.scopes).not.toContain("security:pin:change");

    const claims = jose.decodeJwt(body.data.token.accessToken);
    expect(claims.mode).toBe("limited");
    expect(claims.sub).toBe(user.id);
    expect(claims.deviceId).toBe(body.data.deviceId);

    const stored = await prisma.device.findUniqueOrThrow({
      where: { id: body.data.deviceId },
    });
    expect(stored.trusted).toBe(false);
    expect(stored.userId).toBe(user.id);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { name: "device.enrolled", aggregateId: body.data.deviceId },
    });
    expect(event.actorId).toBe(user.id);
    expect(event.aggregateType).toBe("device");
  });

  it("hands a full-mode token to a device that is already trusted", async () => {
    const first = await enrol("device-beta-0002");
    const created = (await first.json()) as { data: { deviceId: string } };
    await prisma.device.update({
      where: { id: created.data.deviceId },
      data: { trusted: true },
    });

    const response = await enrol("device-beta-0002");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        status: string;
        trusted: boolean;
        token: { mode: string; scopes: null };
      };
    };
    expect(body.data.status).toBe("enrolled");
    expect(body.data.trusted).toBe(true);
    expect(body.data.token.mode).toBe("full");
    expect(body.data.token.scopes).toBeNull();
  });

  it("offers old-device approval once another device is trusted", async () => {
    const response = await enrol("device-gamma-0003");
    const body = (await response.json()) as {
      data: { stepUp: { methods: string[]; unavailable: unknown[] } };
    };
    expect(body.data.stepUp.methods).toEqual([
      "old_device_approve",
      "selfie_nin",
    ]);
    expect(body.data.stepUp.unavailable).toHaveLength(0);
  });

  it("namespaces the device id per user, so trust cannot be inherited", async () => {
    const other = await createUser("RIDER");
    const mine = await enrol("shared-install-id-9");
    const theirs = await enrol("shared-install-id-9", other.id);

    const a = (await mine.json()) as { data: { deviceId: string } };
    const b = (await theirs.json()) as { data: { deviceId: string } };
    expect(a.data.deviceId).not.toBe(b.data.deviceId);
  });
});

describe("the identity context is the only thing that authenticates", () => {
  it("refuses a request with no signed context", async () => {
    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "device-noauth-01" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("unauthorized");
  });

  it("refuses a forged x-auth-user-id, which it never reads", async () => {
    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-user-id": user.id,
          "x-auth-user-role": "admin",
        },
        body: JSON.stringify({ deviceId: "device-forged-01" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a context signed with the wrong key", async () => {
    const forged = await identityHeader(
      { userId: user.id, role: "rider", scopes: FULL_SCOPES },
      { secret: "an-attacker-controlled-secret-of-length-40" },
    );
    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": forged,
        },
        body: JSON.stringify({ deviceId: "device-forged-02" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a context whose payload was edited after signing", async () => {
    const token = await identityHeader({
      userId: user.id,
      role: "rider",
      scopes: ["profile:read"],
    });
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payload as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.scp = [...FULL_SCOPES];
    claims.role = "admin";
    const tampered = `${header as string}.${Buffer.from(
      JSON.stringify(claims),
    ).toString("base64url")}.${signature as string}`;

    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": tampered,
        },
        body: JSON.stringify({ deviceId: "device-tampered-1" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses an expired context", async () => {
    const expired = await identityHeader(
      { userId: user.id, role: "rider", scopes: FULL_SCOPES },
      { expiresInSeconds: -10 },
    );
    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": expired,
        },
        body: JSON.stringify({ deviceId: "device-expired-01" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a scope the context does not carry", async () => {
    const response = await harness.app.fetch(
      new Request("http://user-service.test/devices/enroll", {
        method: "POST",
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: ["profile:read"],
          modes: ["limited"],
        }),
        body: JSON.stringify({ deviceId: "device-scopeless-1" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("limited_mode");
  });
});
