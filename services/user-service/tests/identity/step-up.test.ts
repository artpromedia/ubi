import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/prisma";
import {
  authedHeaders,
  closeConnections,
  createDriver,
  createHarness,
  createUser,
  FULL_SCOPES,
  type TestDriver,
  type TestHarness,
} from "./harness";

let harness: TestHarness;

/** A recognisable, non-secret payload that stands in for the selfie bytes. */
const SELFIE_MARKER = "SELFIEBYTESMARKER";
const SELFIE = `${SELFIE_MARKER}${"A".repeat(200)}`;
const NIN = "12345678901";

beforeAll(() => {
  harness = createHarness();
  harness.setNow(new Date("2026-03-01T09:00:00.000Z"));
});

afterAll(async () => {
  await closeConnections();
});

async function enrolNewDevice(userId: string, deviceId: string): Promise<string> {
  const response = await harness.app.fetch(
    new Request("http://user-service.test/devices/enroll", {
      method: "POST",
      headers: await authedHeaders({ userId, role: "driver", scopes: FULL_SCOPES }),
      body: JSON.stringify({ deviceId, platform: "android" }),
    }),
  );
  const body = (await response.json()) as { data: { stepUp: { challengeId: string } } };
  return body.data.stepUp.challengeId;
}

async function selfie(userId: string, challengeId: string) {
  return harness.app.fetch(
    new Request("http://user-service.test/auth/step-up/selfie", {
      method: "POST",
      headers: await authedHeaders({ userId, role: "driver", scopes: FULL_SCOPES }),
      body: JSON.stringify({ challengeId, nin: NIN, imageBase64: SELFIE }),
    }),
  );
}

describe("selfie step-up stores a score and never the image", () => {
  it("passes, trusts the device, and keeps only the score", async () => {
    const driver = await createDriver();
    const challengeId = await enrolNewDevice(driver.id, "device-selfie-pass-1");

    harness.face.livenessScore = 0.97;
    harness.face.matchScore = 0.9123;

    const response = await selfie(driver.id, challengeId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { status: string; score: number; token: { mode: string } | null };
    };
    expect(body.data.status).toBe("passed");
    expect(body.data.score).toBe(0.9123);
    expect(body.data.token?.mode).toBe("full");

    const challenge = await prisma.stepUpChallenge.findUniqueOrThrow({
      where: { id: challengeId },
    });
    expect(challenge.status).toBe("passed");
    expect(Number(challenge.score)).toBe(0.9123);
    expect(challenge.deviceId).not.toBeNull();

    const device = await prisma.device.findUniqueOrThrow({
      where: { id: challenge.deviceId as string },
    });
    expect(device.trusted).toBe(true);
  });

  it("writes the image nowhere — not to the challenge, the face check, the audit log or the outbox", async () => {
    const driver = await createDriver();
    const challengeId = await enrolNewDevice(driver.id, "device-selfie-scan-1");
    harness.face.livenessScore = 0.99;
    harness.face.matchScore = 0.98;
    await selfie(driver.id, challengeId);

    // Search every table this flow writes to for any trace of the image or the
    // NIN. Column-by-column would miss a column added later; this does not.
    const tables = [
      "step_up_challenges",
      "face_checks",
      "audit_log",
      "outbox_events",
      "devices",
    ];
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe<Array<{ dump: string }>>(
        `SELECT t::text AS dump FROM "${table}" t`,
      );
      const dump = rows.map((row) => row.dump).join("\n");
      expect(dump).not.toContain(SELFIE_MARKER);
      expect(dump).not.toContain(NIN);
    }

    const faceCheck = await prisma.faceCheck.findFirstOrThrow({
      where: { driverId: driver.driverId },
      orderBy: { createdAt: "desc" },
    });
    expect(Number(faceCheck.score)).toBe(0.98);
    expect(faceCheck.passed).toBe(true);
  });
});

describe("a failed face check", () => {
  let driver: TestDriver;

  beforeAll(async () => {
    driver = await createDriver({ online: true });
    const challengeId = await enrolNewDevice(driver.id, "device-selfie-fail-1");
    harness.face.livenessScore = 0.95;
    harness.face.matchScore = 0.4;
    const response = await selfie(driver.id, challengeId);
    expect(response.status).toBe(200);
  });

  it("takes the driver offline", async () => {
    const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(row.isOnline).toBe(false);
    expect(row.isAvailable).toBe(false);
  });

  it("does NOT deactivate the account", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("ACTIVE");
    expect(user.deletedAt).toBeNull();
  });

  it("opens an identity case for a person to decide", async () => {
    const identityCase = await prisma.identityCase.findFirstOrThrow({
      where: { driverId: driver.driverId },
    });
    expect(identityCase.status).toBe("open");
    expect(identityCase.decidedBy).toEqual([]);
  });

  it("emits face_check.failed, step_up.failed and identity.case_opened", async () => {
    const driverEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: driver.driverId },
      select: { name: true },
    });
    const names = driverEvents.map((event) => event.name);
    expect(names).toContain("face_check.failed");
    expect(names).toContain("identity.case_opened");
    expect(names).toContain("driver.status_changed");
    expect(names).toContain("driver.eligibility_changed");

    const userEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: driver.id },
      select: { name: true },
    });
    expect(userEvents.map((event) => event.name)).toContain("step_up.failed");
  });

  it("tells the driver the reason and the appeal path", async () => {
    const response = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/eligibility", {
        headers: await authedHeaders({
          userId: driver.id,
          role: "driver",
          scopes: FULL_SCOPES,
        }),
      }),
    );
    const body = (await response.json()) as {
      data: { eligible: boolean; reasons: string[]; appealPath: string; appealMessage: string };
    };
    expect(body.data.eligible).toBe(false);
    expect(body.data.reasons.length).toBeGreaterThan(0);
    expect(body.data.appealPath).toBe("/support/cases?topic=identity_review");
    expect(body.data.appealMessage).toContain("Support");
  });

  it("hands back no token, and says why", async () => {
    const other = await createDriver();
    const challengeId = await enrolNewDevice(other.id, "device-selfie-fail-2");
    harness.face.livenessScore = 0.3;
    harness.face.matchScore = 0.99;

    const response = await selfie(other.id, challengeId);
    const body = (await response.json()) as {
      data: { status: string; token: unknown; reason: string; appealPath: string };
    };
    expect(body.data.status).toBe("failed");
    expect(body.data.token).toBeNull();
    expect(body.data.reason).toContain("liveness");
    expect(body.data.appealPath).toBe("/support/cases?topic=identity_review");

    const device = await prisma.device.findFirstOrThrow({
      where: { userId: other.id },
      orderBy: { enrolledAt: "desc" },
    });
    expect(device.trusted).toBe(false);
  });
});

describe("old-device approval", () => {
  it("lets a trusted device approve a new one, and never itself", async () => {
    const user = await createUser("RIDER");

    const firstChallenge = await enrolNewDevice(user.id, "device-trusted-src-1");
    const first = await prisma.stepUpChallenge.findUniqueOrThrow({
      where: { id: firstChallenge },
    });
    const trustedDeviceId = first.deviceId as string;
    await prisma.device.update({ where: { id: trustedDeviceId }, data: { trusted: true } });

    const secondChallenge = await enrolNewDevice(user.id, "device-trusted-new-1");

    // A device cannot approve its own challenge.
    const selfApproval = await harness.app.fetch(
      new Request("http://user-service.test/auth/step-up/approve", {
        method: "POST",
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: FULL_SCOPES,
          deviceId: (
            await prisma.stepUpChallenge.findUniqueOrThrow({ where: { id: secondChallenge } })
          ).deviceId,
        }),
        body: JSON.stringify({ challengeId: secondChallenge }),
      }),
    );
    expect(selfApproval.status).toBe(401);

    const approval = await harness.app.fetch(
      new Request("http://user-service.test/auth/step-up/approve", {
        method: "POST",
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: FULL_SCOPES,
          deviceId: trustedDeviceId,
        }),
        body: JSON.stringify({ challengeId: secondChallenge }),
      }),
    );
    expect(approval.status).toBe(200);
    const body = (await approval.json()) as { data: { token: { mode: string } } };
    expect(body.data.token.mode).toBe("full");
  });

  it("refuses approval from a device that is not trusted", async () => {
    const user = await createUser("RIDER");
    const challengeId = await enrolNewDevice(user.id, "device-untrusted-ap1");
    const other = await enrolNewDevice(user.id, "device-untrusted-ap2");
    const otherChallenge = await prisma.stepUpChallenge.findUniqueOrThrow({
      where: { id: other },
    });

    const response = await harness.app.fetch(
      new Request("http://user-service.test/auth/step-up/approve", {
        method: "POST",
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: FULL_SCOPES,
          deviceId: otherChallenge.deviceId,
        }),
        body: JSON.stringify({ challengeId }),
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "step_up_required",
    );
  });
});
