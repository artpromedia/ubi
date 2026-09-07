import "./setup-env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sweepDocumentExpiry } from "../../src/identity/documents";
import { prisma } from "../../src/lib/prisma";
import {
  authedHeaders,
  closeConnections,
  createDriver,
  createHarness,
  FULL_SCOPES,
  type TestDriver,
  type TestHarness,
} from "./harness";

let harness: TestHarness;

const NOW = new Date("2026-05-01T08:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  harness = createHarness();
  harness.setNow(NOW);
});

afterAll(async () => {
  await closeConnections();
});

function isoDate(offsetDays: number): string {
  return new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
}

async function putDocument(
  ownerType: "driver" | "vehicle",
  ownerId: string,
  type: string,
  expiresInDays: number,
  status = "valid",
): Promise<string> {
  const id = `doc_test_${Math.random().toString(36).slice(2, 14)}`;
  await prisma.identityDocument.create({
    data: {
      id,
      ownerType,
      ownerId,
      type,
      fileRef: `s3://ubi-documents/${id}`,
      status,
      expiresAt: new Date(`${isoDate(expiresInDays)}T00:00:00Z`),
      createdAt: NOW,
    },
  });
  return id;
}

describe("driver documents", () => {
  it("lists the Lagos set and names what is still missing", async () => {
    const driver = await createDriver();
    await putDocument("driver", driver.driverId, "licence", 200);

    const response = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        headers: await authedHeaders({
          userId: driver.id,
          role: "driver",
          scopes: FULL_SCOPES,
        }),
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        documents: { type: string; label: string; daysUntilExpiry: number }[];
        missing: { type: string; label: string }[];
        appealPath: string;
      };
    };

    expect(body.data.documents.map((doc) => doc.type)).toEqual(["licence"]);
    expect(body.data.documents[0]?.daysUntilExpiry).toBe(200);
    // Honest unavailability: what is not on file is listed, not hidden.
    expect(body.data.missing.map((doc) => doc.type).sort()).toEqual([
      "background_check",
      "insurance",
      "lasdri",
      "roadworthiness",
      "vehicle_registration",
    ]);
    expect(body.data.appealPath).toBe("/support/cases?topic=identity_review");
  });

  it("takes an upload into the review queue as pending, and replays the same key", async () => {
    const driver = await createDriver();
    const headers = await authedHeaders(
      { userId: driver.id, role: "driver", scopes: FULL_SCOPES },
      { "idempotency-key": `upload-${driver.driverId.slice(0, 12)}` },
    );
    const body = JSON.stringify({
      type: "lasdri",
      fileRef: "s3://ubi-documents/lasdri-scan.jpg",
      expiresAt: isoDate(120),
    });

    const first = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        method: "POST",
        headers,
        body,
      }),
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as { data: { document: { id: string; status: string } } };
    expect(created.data.document.status).toBe("pending");

    const replay = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        method: "POST",
        headers,
        body,
      }),
    );
    const replayed = (await replay.json()) as { data: { document: { id: string } } };
    expect(replayed.data.document.id).toBe(created.data.document.id);

    expect(
      await prisma.identityDocument.count({
        where: { ownerType: "driver", ownerId: driver.driverId, type: "lasdri" },
      }),
    ).toBe(1);
  });

  it("refuses an upload without an Idempotency-Key", async () => {
    const driver = await createDriver();
    const response = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        method: "POST",
        headers: await authedHeaders({
          userId: driver.id,
          role: "driver",
          scopes: FULL_SCOPES,
        }),
        body: JSON.stringify({ type: "licence", fileRef: "s3://ubi-documents/lic.jpg" }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it("refuses an upload that is already expired", async () => {
    const driver = await createDriver();
    const response = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        method: "POST",
        headers: await authedHeaders(
          { userId: driver.id, role: "driver", scopes: FULL_SCOPES },
          { "idempotency-key": `stale-${driver.driverId.slice(0, 12)}` },
        ),
        body: JSON.stringify({
          type: "licence",
          fileRef: "s3://ubi-documents/old.jpg",
          expiresAt: isoDate(-1),
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it("refuses an upload from a limited-mode session", async () => {
    const driver = await createDriver();
    const response = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/documents", {
        method: "POST",
        headers: await authedHeaders(
          {
            userId: driver.id,
            role: "driver",
            scopes: ["profile:read", "ride:book:cash"],
            modes: ["limited"],
          },
          { "idempotency-key": `limited-${driver.driverId.slice(0, 12)}` },
        ),
        body: JSON.stringify({ type: "licence", fileRef: "s3://ubi-documents/lic.jpg" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "limited_mode",
    );
  });
});

describe("expiry reminders", () => {
  it("emits one reminder per threshold as each is crossed, and never twice", async () => {
    const driver = await createDriver();
    const documentId = await putDocument("driver", driver.driverId, "licence", 30);

    const reminders = async (): Promise<number[]> => {
      const events = await prisma.outboxEvent.findMany({
        where: { name: "document.expiring", aggregateId: documentId },
        orderBy: { createdAt: "asc" },
      });
      return events.map((event) => (event.payload as { days: number }).days);
    };

    await sweepDocumentExpiry(harness.deps);
    expect(await reminders()).toEqual([30]);

    // Running again on the same day says nothing new.
    await sweepDocumentExpiry(harness.deps);
    expect(await reminders()).toEqual([30]);

    for (const [offset, expected] of [
      [16, [30, 14]],
      [24, [30, 14, 7]],
      [29, [30, 14, 7, 1]],
    ] as const) {
      harness.setNow(new Date(NOW.getTime() + offset * DAY));
      await sweepDocumentExpiry(harness.deps);
      expect(await reminders()).toEqual([...expected]);
    }

    harness.setNow(NOW);
  });
});

describe("an expired document forces the driver offline", () => {
  let driver: TestDriver;
  let documentId: string;

  beforeAll(async () => {
    harness.setNow(NOW);
    driver = await createDriver({ online: true });
    documentId = await putDocument("driver", driver.driverId, "licence", 1);

    // The day after it lapses.
    harness.setNow(new Date(NOW.getTime() + 2 * DAY));
    await sweepDocumentExpiry(harness.deps);
  });

  afterAll(() => {
    harness.setNow(NOW);
  });

  it("marks the document expired", async () => {
    const document = await prisma.identityDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(document.status).toBe("expired");
  });

  it("writes is_online = false in the database, not just in an event", async () => {
    const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(row.isOnline).toBe(false);
    expect(row.isAvailable).toBe(false);
  });

  it("keeps the driver offline even if a client writes is_online back", async () => {
    // Simulate a client (or a stale write) putting the driver back online.
    await prisma.driver.update({
      where: { id: driver.driverId },
      data: { isOnline: true, isAvailable: true },
    });

    await sweepDocumentExpiry(harness.deps);

    // The document is already `expired`, so the sweep does not revisit it —
    // eligibility is what the server answers with, and it still refuses.
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
      data: { eligible: boolean; reasons: string[]; appealPath: string };
    };
    expect(body.data.eligible).toBe(false);
    expect(body.data.reasons.join(" ")).toContain("licence");
    expect(body.data.appealPath).toBe("/support/cases?topic=identity_review");
  });

  it("emits document.expired and the driver status change", async () => {
    const documentEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: documentId },
      select: { name: true, payload: true },
    });
    const names = documentEvents.map((event) => event.name);
    expect(names).toContain("document.expired");

    const expired = documentEvents.find((event) => event.name === "document.expired");
    expect(expired?.payload).toMatchObject({
      ownerType: "driver",
      ownerId: driver.driverId,
      docType: "licence",
    });

    const driverEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: driver.driverId },
      select: { name: true },
    });
    expect(driverEvents.map((event) => event.name)).toContain("driver.status_changed");
    expect(driverEvents.map((event) => event.name)).toContain("driver.eligibility_changed");
  });
});

describe("an expired vehicle document takes every driver of that vehicle offline", () => {
  it("emits vehicle.offline_for_all_drivers", async () => {
    harness.setNow(NOW);
    const driver = await createDriver({ online: true });
    const documentId = await putDocument("vehicle", driver.vehicleId, "insurance", 1);

    harness.setNow(new Date(NOW.getTime() + 3 * DAY));
    await sweepDocumentExpiry(harness.deps);
    harness.setNow(NOW);

    const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(row.isOnline).toBe(false);

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: documentId },
      select: { name: true, payload: true },
    });
    const names = events.map((event) => event.name);
    expect(names).toContain("vehicle.offline_for_all_drivers");

    const fleetEvent = events.find((event) => event.name === "vehicle.offline_for_all_drivers");
    expect((fleetEvent?.payload as { driverIds: string[] }).driverIds).toContain(driver.driverId);

    // The driver is told which document, even though it belongs to the vehicle.
    const eligibility = await harness.app.fetch(
      new Request("http://user-service.test/drivers/me/eligibility", {
        headers: await authedHeaders({
          userId: driver.id,
          role: "driver",
          scopes: FULL_SCOPES,
        }),
      }),
    );
    const body = (await eligibility.json()) as {
      data: { eligible: boolean; reasons: string[] };
    };
    expect(body.data.eligible).toBe(false);
    expect(body.data.reasons.join(" ")).toContain("insurance");
  });
});
