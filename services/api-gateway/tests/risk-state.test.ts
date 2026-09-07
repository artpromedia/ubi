import "./env";

import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readRiskState, safeModeKey } from "../src/identity/state";

/**
 * Against a real Redis. The gateway reads exactly the key user-service writes,
 * so a mismatch in either direction fails here rather than in production.
 */
const REDIS_URL = process.env.IDENTITY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
const USER_ID = `usr_risk_${process.pid}`;

let redis: Redis;

beforeAll(() => {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
});

afterAll(async () => {
  await redis.del(safeModeKey(USER_ID));
  await redis.quit();
});

describe("live risk state", () => {
  it("reads an absent key as no hold", async () => {
    await redis.del(safeModeKey(USER_ID));
    const state = await readRiskState(redis, USER_ID);
    expect(state).toEqual({ safeMode: false, safeModeUntil: null, degraded: false });
  });

  it("reads a live safe-mode hold and reports when it lifts", async () => {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await redis.set(safeModeKey(USER_ID), until.toISOString(), "EX", 24 * 60 * 60);

    const state = await readRiskState(redis, USER_ID);
    expect(state.safeMode).toBe(true);
    expect(state.degraded).toBe(false);
    expect(state.safeModeUntil).toBe(until.toISOString());
  });

  it("treats a hold whose window has passed as lifted", async () => {
    const until = new Date(Date.now() - 1_000);
    await redis.set(safeModeKey(USER_ID), until.toISOString(), "EX", 60);
    const state = await readRiskState(redis, USER_ID);
    expect(state.safeMode).toBe(false);
  });

  it("fails closed on an unreadable value", async () => {
    await redis.set(safeModeKey(USER_ID), "not-a-timestamp", "EX", 60);
    const state = await readRiskState(redis, USER_ID);
    expect(state).toEqual({ safeMode: true, safeModeUntil: null, degraded: true });
  });

  it("fails closed when there is no store at all", async () => {
    const state = await readRiskState(undefined, USER_ID);
    expect(state).toEqual({ safeMode: true, safeModeUntil: null, degraded: true });
  });

  it("fails closed when the store throws", async () => {
    const state = await readRiskState(
      {
        get: async () => {
          throw new Error("connection refused");
        },
      },
      USER_ID,
    );
    expect(state.safeMode).toBe(true);
    expect(state.degraded).toBe(true);
  });
});
