import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashSecret } from "../../src/identity/secret-hash";
import { prisma } from "../../src/lib/prisma";
import {
  authedHeaders,
  CITY_CONFIG,
  closeConnections,
  createHarness,
  createUser,
  createWallet,
  FULL_SCOPES,
  type TestHarness,
  type TestUser,
} from "./harness";

let harness: TestHarness;

const START = new Date("2026-04-01T10:00:00.000Z");

beforeAll(() => {
  harness = createHarness();
  harness.setNow(START);
});

afterAll(async () => {
  await closeConnections();
});

async function withWallet(pin: string): Promise<TestUser> {
  const user = await createUser("RIDER");
  await createWallet(user.id, { pinHash: await hashSecret(pin) });
  return user;
}

async function tryPin(userId: string, pin: string) {
  return harness.app.fetch(
    new Request("http://user-service.test/auth/pin/verify", {
      method: "POST",
      headers: await authedHeaders({ userId, role: "rider", scopes: FULL_SCOPES }),
      body: JSON.stringify({ pin }),
    }),
  );
}

describe("PIN lockout", () => {
  it("locks after the number of attempts city config allows, and not before", async () => {
    const user = await withWallet("4321");
    const limit = CITY_CONFIG.maxPinAttempts;
    expect(limit).toBe(5);

    for (let attempt = 1; attempt < limit; attempt += 1) {
      const response = await tryPin(user.id, "0000");
      const body = (await response.json()) as {
        error: { code: string; details: { attemptsRemaining: number } };
      };
      expect(response.status).toBe(422);
      expect(body.error.code).toBe("wrong_pin");
      expect(body.error.details.attemptsRemaining).toBe(limit - attempt);

      const wallet = await prisma.wallet.findFirstOrThrow({ where: { ownerId: user.id } });
      expect(wallet.pinLockedUntil).toBeNull();
    }

    const locking = await tryPin(user.id, "0000");
    expect(locking.status).toBe(403);
    expect(((await locking.json()) as { error: { code: string } }).error.code).toBe("pin_locked");

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(wallet.pinFailedAttempts).toBe(limit);
    expect(wallet.pinLockedUntil).not.toBeNull();
  });

  it("refuses even the CORRECT pin once locked", async () => {
    const user = await withWallet("4321");
    for (let attempt = 0; attempt < CITY_CONFIG.maxPinAttempts; attempt += 1) {
      await tryPin(user.id, "0000");
    }
    const response = await tryPin(user.id, "4321");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("pin_locked");
  });

  it("emits pin.locked exactly once through the outbox", async () => {
    const user = await withWallet("4321");
    for (let attempt = 0; attempt < CITY_CONFIG.maxPinAttempts; attempt += 1) {
      await tryPin(user.id, "0000");
    }
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: user.id, name: "pin.locked" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ userId: user.id, capMinor: null });

    const audit = await prisma.auditLog.findMany({
      where: { subjectId: user.id, action: "pin.locked" },
    });
    expect(audit).toHaveLength(1);
  });

  it("clears the counter on a correct PIN", async () => {
    const user = await withWallet("4321");
    await tryPin(user.id, "0000");
    await tryPin(user.id, "0000");

    const response = await tryPin(user.id, "4321");
    expect(response.status).toBe(200);

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(wallet.pinFailedAttempts).toBe(0);
  });
});

describe("PIN reset and the cooling window", () => {
  async function passedSelfieChallenge(userId: string, method = "selfie_nin"): Promise<string> {
    const id = `suc_test_${Math.random().toString(36).slice(2, 12)}`;
    await prisma.stepUpChallenge.create({
      data: {
        id,
        userId,
        method,
        status: "passed",
        score: 0.95,
        createdAt: harness.now(),
        resolvedAt: harness.now(),
      },
    });
    return id;
  }

  async function reset(userId: string, challengeId: string, newPin: string) {
    return harness.app.fetch(
      new Request("http://user-service.test/auth/pin/reset", {
        method: "POST",
        headers: await authedHeaders({ userId, role: "rider", scopes: FULL_SCOPES }),
        body: JSON.stringify({ challengeId, newPin }),
      }),
    );
  }

  it("unlocks the PIN after a biometric step-up and starts the cooling window", async () => {
    const user = await withWallet("4321");
    for (let attempt = 0; attempt < CITY_CONFIG.maxPinAttempts; attempt += 1) {
      await tryPin(user.id, "0000");
    }

    const challengeId = await passedSelfieChallenge(user.id);
    const response = await reset(user.id, challengeId, "9876");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { coolingUntil: string } };
    // Slice 03: a two-hour cooling window.
    expect(new Date(body.data.coolingUntil).getTime() - harness.now().getTime()).toBe(
      2 * 60 * 60 * 1000,
    );

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(wallet.pinFailedAttempts).toBe(0);
    expect(wallet.pinLockedUntil).toBeNull();
    expect(wallet.coolingUntil?.toISOString()).toBe(body.data.coolingUntil);

    // The new PIN works, the old one does not.
    expect((await tryPin(user.id, "9876")).status).toBe(200);
    expect((await tryPin(user.id, "4321")).status).toBe(422);
  });

  it("reports the cooling window on a successful verify while it lasts", async () => {
    const user = await withWallet("4321");
    const challengeId = await passedSelfieChallenge(user.id);
    await reset(user.id, challengeId, "5555");

    const verified = await tryPin(user.id, "5555");
    const body = (await verified.json()) as { data: { coolingUntil: string | null } };
    expect(body.data.coolingUntil).not.toBeNull();

    // Once the window has passed, it is no longer reported.
    harness.setNow(new Date(START.getTime() + 3 * 60 * 60 * 1000));
    const later = await tryPin(user.id, "5555");
    const laterBody = (await later.json()) as { data: { coolingUntil: string | null } };
    expect(laterBody.data.coolingUntil).toBeNull();
    harness.setNow(START);
  });

  it("emits pin.rotated and cooling.started", async () => {
    const user = await withWallet("4321");
    const challengeId = await passedSelfieChallenge(user.id);
    await reset(user.id, challengeId, "1212");

    const names = (
      await prisma.outboxEvent.findMany({ where: { aggregateId: user.id } })
    ).map((event) => event.name);
    expect(names).toContain("pin.rotated");
    expect(names).toContain("cooling.started");
  });

  it("refuses an SMS OTP as the step-up — SMS never unlocks money", async () => {
    const user = await withWallet("4321");
    const challengeId = await passedSelfieChallenge(user.id, "sms_otp");
    const response = await reset(user.id, challengeId, "3333");

    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error: { code: string; details: { allowedMethods: string[] } };
    };
    expect(body.error.code).toBe("step_up_required");
    expect(body.error.details.allowedMethods).toEqual(["selfie_nin"]);

    // The PIN is unchanged.
    expect((await tryPin(user.id, "4321")).status).toBe(200);
  });

  it("refuses a challenge that has not passed", async () => {
    const user = await withWallet("4321");
    const id = `suc_test_${Math.random().toString(36).slice(2, 12)}`;
    await prisma.stepUpChallenge.create({
      data: {
        id,
        userId: user.id,
        method: "selfie_nin",
        status: "pending",
        createdAt: harness.now(),
      },
    });
    expect((await reset(user.id, id, "7777")).status).toBe(401);
  });

  it("refuses another person's challenge", async () => {
    const user = await withWallet("4321");
    const stranger = await createUser("RIDER");
    const challengeId = await passedSelfieChallenge(stranger.id);
    expect((await reset(user.id, challengeId, "7777")).status).toBe(401);
  });

  it("consumes the challenge, so one selfie cannot reset the PIN twice", async () => {
    const user = await withWallet("4321");
    const challengeId = await passedSelfieChallenge(user.id);
    expect((await reset(user.id, challengeId, "2468")).status).toBe(200);
    expect((await reset(user.id, challengeId, "1357")).status).toBe(401);
    expect((await tryPin(user.id, "2468")).status).toBe(200);
  });

  it("refuses while the wallet is in safe mode", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id, {
      pinHash: await hashSecret("4321"),
      safeModeUntil: new Date(START.getTime() + 60 * 60 * 1000),
    });
    const challengeId = await passedSelfieChallenge(user.id);

    const response = await reset(user.id, challengeId, "8888");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "safe_mode_active",
    );
  });
});
