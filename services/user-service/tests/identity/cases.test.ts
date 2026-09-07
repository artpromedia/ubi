import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { livenessRequiredForShift, samplingBucket } from "../../src/identity/liveness";
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

const NOW = new Date("2026-08-01T09:00:00.000Z");

beforeAll(() => {
  harness = createHarness();
  harness.setNow(NOW);
});

afterAll(async () => {
  await closeConnections();
});

async function openCase(driverId: string): Promise<string> {
  const id = `idc_test_${Math.random().toString(36).slice(2, 12)}`;
  await prisma.identityCase.create({
    data: {
      id,
      driverId,
      signals: { score: 0.4, source: "face_check" },
      status: "open",
      decidedBy: [],
      createdAt: NOW,
    },
  });
  return id;
}

async function decide(
  caseId: string,
  reviewerId: string,
  decision: "reinstate" | "deactivate",
  reason = "Reviewed the evidence and the driver's response.",
) {
  return harness.app.fetch(
    new Request(`http://user-service.test/identity/cases/${caseId}/decide`, {
      method: "POST",
      headers: await authedHeaders({
        userId: reviewerId,
        role: "admin",
        scopes: FULL_SCOPES,
      }),
      body: JSON.stringify({ decision, reason }),
    }),
  );
}

describe("deactivation needs two reviewers", () => {
  let driver: TestDriver;
  let caseId: string;
  let firstReviewer: string;
  let secondReviewer: string;

  beforeAll(async () => {
    driver = await createDriver({ online: true });
    caseId = await openCase(driver.driverId);
    firstReviewer = (await createUser("RIDER")).id;
    secondReviewer = (await createUser("RIDER")).id;
  });

  it("records the first reviewer without deactivating anyone", async () => {
    const response = await decide(caseId, firstReviewer, "deactivate");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { status: string; applied: boolean; reviewers: string[]; reviewersRequired: number };
    };
    expect(body.data.applied).toBe(false);
    expect(body.data.status).toBe("awaiting_second_reviewer");
    expect(body.data.reviewers).toEqual([firstReviewer]);
    expect(body.data.reviewersRequired).toBe(2);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("ACTIVE");
  });

  it("refuses the SAME reviewer as the second signature", async () => {
    const response = await decide(caseId, firstReviewer, "deactivate");
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "already_approved",
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("ACTIVE");
  });

  it("applies only when a SECOND, different reviewer agrees", async () => {
    const response = await decide(caseId, secondReviewer, "deactivate");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { applied: boolean; status: string; reviewers: string[]; appealPath: string };
    };
    expect(body.data.applied).toBe(true);
    expect(body.data.status).toBe("decided");
    expect(body.data.reviewers).toEqual([firstReviewer, secondReviewer]);
    expect(body.data.appealPath).toBe("/support/cases?topic=identity_review");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("SUSPENDED");

    const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(row.isOnline).toBe(false);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: driver.driverId, name: "identity.case_decided" },
    });
    expect(event.payload).toMatchObject({
      decision: "deactivate",
      reviewers: [firstReviewer, secondReviewer],
    });

    const decisions = await prisma.reviewDecision.findMany({
      where: { subjectId: caseId },
      orderBy: { createdAt: "asc" },
    });
    expect(decisions).toHaveLength(2);
    expect(decisions.every((row2) => row2.queue === "identity")).toBe(true);
  });

  it("will not decide the same case twice", async () => {
    const third = (await createUser("RIDER")).id;
    const response = await decide(caseId, third, "reinstate");
    expect(response.status).toBe(409);
  });
});

describe("reinstating", () => {
  it("takes one reviewer, because restoring access is not the dangerous direction", async () => {
    const driver = await createDriver({ online: false });
    const caseId = await openCase(driver.driverId);
    const reviewer = (await createUser("RIDER")).id;

    const response = await decide(caseId, reviewer, "reinstate");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { applied: boolean; status: string } };
    expect(body.data.applied).toBe(true);
    expect(body.data.status).toBe("decided");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("ACTIVE");
  });

  it("restarts the count when the second reviewer disagrees with the first", async () => {
    const driver = await createDriver({ online: true });
    const caseId = await openCase(driver.driverId);
    const first = (await createUser("RIDER")).id;
    const second = (await createUser("RIDER")).id;

    await decide(caseId, first, "deactivate");
    const disagreement = await decide(caseId, second, "reinstate");
    expect(disagreement.status).toBe(200);

    const body = (await disagreement.json()) as { data: { reviewers: string[] } };
    expect(body.data.reviewers).toEqual([second]);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.status).toBe("ACTIVE");
  });
});

describe("who may review", () => {
  it("refuses a driver reviewing their own case", async () => {
    const driver = await createDriver();
    const caseId = await openCase(driver.driverId);

    const response = await harness.app.fetch(
      new Request(`http://user-service.test/identity/cases/${caseId}/decide`, {
        method: "POST",
        headers: await authedHeaders({
          userId: driver.id,
          role: "admin",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({ decision: "reinstate", reason: "I am fine, honestly." }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a rider who is not a reviewer", async () => {
    const driver = await createDriver();
    const caseId = await openCase(driver.driverId);
    const rider = await createUser("RIDER");

    const response = await harness.app.fetch(
      new Request(`http://user-service.test/identity/cases/${caseId}/decide`, {
        method: "POST",
        headers: await authedHeaders({
          userId: rider.id,
          role: "rider",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({ decision: "reinstate", reason: "Because I said so." }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("the driver liveness gate", () => {
  it("requires a check on the first shift from a device", async () => {
    const driver = await createDriver();
    const gate = await livenessRequiredForShift(
      harness.deps,
      driver.driverId,
      driver.id,
      "dev_never_seen",
    );
    expect(gate).toEqual({ required: true, reason: "first_shift_on_device" });
  });

  it("samples roughly one shift in ten after that, deterministically", async () => {
    const driver = await createDriver();
    const deviceId = `dev_liveness_${Math.random().toString(36).slice(2, 12)}`;
    await prisma.stepUpChallenge.create({
      data: {
        id: `suc_live_${Math.random().toString(36).slice(2, 12)}`,
        userId: driver.id,
        method: "selfie_nin",
        status: "passed",
        score: 0.95,
        createdAt: NOW,
        resolvedAt: NOW,
      },
    });
    // The challenge above has no device, so attach one that matches.
    await prisma.device.create({
      data: { id: deviceId, userId: driver.id, trusted: true, enrolledAt: NOW },
    });
    await prisma.stepUpChallenge.updateMany({
      where: { userId: driver.id },
      data: { deviceId },
    });

    const first = await livenessRequiredForShift(
      harness.deps,
      driver.driverId,
      driver.id,
      deviceId,
    );
    const second = await livenessRequiredForShift(
      harness.deps,
      driver.driverId,
      driver.id,
      deviceId,
    );
    // Same shift, same answer — never a coin flip the app can reroll.
    expect(first).toEqual(second);
    expect(["random_sample", "not_required"]).toContain(first.reason);
  });

  it("challenges close to one shift in ten across many drivers", () => {
    let challenged = 0;
    const shifts = 5_000;
    for (let index = 0; index < shifts; index += 1) {
      if (samplingBucket(`drv_${index}`, "dev_1", "2026-08-01") < 10) challenged += 1;
    }
    const rate = challenged / shifts;
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.13);
  });
});
