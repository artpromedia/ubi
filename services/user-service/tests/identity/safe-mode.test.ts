import "./setup-env";

import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { safeModeKey, sweepSafeModeExits } from "../../src/identity/safe-mode";
import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";
import {
  authedHeaders,
  closeConnections,
  createHarness,
  createUser,
  createWallet,
  FULL_SCOPES,
  type TestHarness,
} from "./harness";
import { TELCO_SECRET } from "./setup-env";

let harness: TestHarness;

const NOW = new Date("2026-06-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

beforeAll(() => {
  harness = createHarness();
  harness.setNow(NOW);
});

afterAll(async () => {
  await closeConnections();
});

async function simSwap(
  phone: string,
  options: { reportedAt?: Date; signature?: string; source?: string } = {},
) {
  const body = JSON.stringify({
    phone,
    reportedAt: (options.reportedAt ?? NOW).toISOString(),
    source: options.source ?? "mtn-ng",
  });
  const signature =
    options.signature ??
    createHmac("sha256", TELCO_SECRET).update(body).digest("hex");

  return harness.app.fetch(
    new Request("http://user-service.test/webhooks/telco/sim-swap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telco-signature": signature,
      },
      body,
    }),
  );
}

describe("the SIM-swap webhook", () => {
  it("refuses an unsigned report", async () => {
    const user = await createUser("RIDER");
    const response = await simSwap(user.phone, { signature: "" });
    expect(response.status).toBe(401);
    expect(
      await prisma.simSwapSignal.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("refuses a report whose body was edited after signing", async () => {
    const user = await createUser("RIDER");
    const honest = JSON.stringify({
      phone: user.phone,
      reportedAt: NOW.toISOString(),
      source: "mtn-ng",
    });
    const signature = createHmac("sha256", TELCO_SECRET)
      .update(honest)
      .digest("hex");

    const response = await harness.app.fetch(
      new Request("http://user-service.test/webhooks/telco/sim-swap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telco-signature": signature,
        },
        body: JSON.stringify({
          phone: user.phone,
          reportedAt: NOW.toISOString(),
          source: "attacker",
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("enters safe mode for 24 hours and emits wallet.safe_mode_entered", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id);

    const response = await simSwap(user.phone);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { held: boolean; until: string };
    };
    expect(body.data.held).toBe(true);
    expect(new Date(body.data.until).getTime() - NOW.getTime()).toBe(24 * HOUR);

    const wallet = await prisma.wallet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(wallet.safeModeUntil?.toISOString()).toBe(body.data.until);
    expect(wallet.version).toBe(2);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: user.id, name: "wallet.safe_mode_entered" },
    });
    expect(event.payload).toMatchObject({
      userId: user.id,
      method: "sim_swap",
      until: body.data.until,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { subjectId: user.id, action: "wallet.safe_mode_entered" },
    });
    expect(audit.reason).toBe("sim_swap_signal");

    // The gateway reads this key to refuse money movement one hop earlier.
    const cached = await redis.get(safeModeKey(user.id));
    expect(cached).toBe(body.data.until);
    const ttl = await redis.ttl(safeModeKey(user.id));
    expect(ttl).toBeGreaterThan(0);
  });

  it("is idempotent when the telco retries the same report", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id);

    await simSwap(user.phone);
    const retry = await simSwap(user.phone);
    expect(retry.status).toBe(200);

    expect(
      await prisma.simSwapSignal.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: user.id, name: "wallet.safe_mode_entered" },
      }),
    ).toBe(1);
  });

  it("says nothing about whether a number is on file", async () => {
    const response = await simSwap("+2348999999999");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { accepted: boolean; held: boolean };
    };
    expect(body.data).toEqual({ accepted: true, held: false });
  });

  it("records an old report as evidence without starting a hold", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id);

    const response = await simSwap(user.phone, {
      reportedAt: new Date(NOW.getTime() - 48 * HOUR),
    });
    const body = (await response.json()) as { data: { held: boolean } };
    expect(body.data.held).toBe(false);

    expect(
      await prisma.simSwapSignal.count({ where: { userId: user.id } }),
    ).toBe(1);
    const wallet = await prisma.wallet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(wallet.safeModeUntil).toBeNull();
  });
});

describe("what safe mode blocks and reports", () => {
  it("reports the hold and what it pauses", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id);
    await simSwap(user.phone);

    const response = await harness.app.fetch(
      new Request("http://user-service.test/identity/safe-mode", {
        headers: await authedHeaders({
          userId: user.id,
          role: "rider",
          scopes: FULL_SCOPES,
        }),
      }),
    );
    const body = (await response.json()) as {
      data: { active: boolean; until: string; blocks: string[] };
    };
    expect(body.data.active).toBe(true);
    expect(body.data.blocks).toContain("wallet:transfer:p2p");
    expect(body.data.blocks).toContain("wallet:transfer:nip");
    expect(body.data.blocks).toContain("security:pin:change");
  });
});

describe("leaving safe mode", () => {
  it("lifts the hold once the window has passed and emits wallet.safe_mode_exited", async () => {
    const user = await createUser("RIDER");
    await createWallet(user.id);
    await simSwap(user.phone);

    // Still held part-way through.
    harness.setNow(new Date(NOW.getTime() + 12 * HOUR));
    expect(await sweepSafeModeExits(harness.deps)).not.toContain(user.id);
    let wallet = await prisma.wallet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(wallet.safeModeUntil).not.toBeNull();

    // ...and lifted once it has elapsed.
    harness.setNow(new Date(NOW.getTime() + 25 * HOUR));
    const exited = await sweepSafeModeExits(harness.deps);
    expect(exited).toContain(user.id);

    wallet = await prisma.wallet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(wallet.safeModeUntil).toBeNull();

    const signal = await prisma.simSwapSignal.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(signal.handled).toBe(true);

    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: user.id, name: "wallet.safe_mode_exited" },
      }),
    ).toBe(1);
    expect(await redis.get(safeModeKey(user.id))).toBeNull();

    // A second sweep emits nothing further.
    await sweepSafeModeExits(harness.deps);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: user.id, name: "wallet.safe_mode_exited" },
      }),
    ).toBe(1);

    harness.setNow(NOW);
  });

  it("needs the service key to run the sweep over HTTP", async () => {
    const unauthorised = await harness.app.fetch(
      new Request("http://user-service.test/identity/jobs/safe-mode-exit", {
        method: "POST",
      }),
    );
    expect(unauthorised.status).toBe(401);

    const authorised = await harness.app.fetch(
      new Request("http://user-service.test/identity/jobs/safe-mode-exit", {
        method: "POST",
        headers: {
          "x-service-key": process.env.IDENTITY_JOB_SERVICE_KEY as string,
        },
      }),
    );
    expect(authorised.status).toBe(200);
  });
});
