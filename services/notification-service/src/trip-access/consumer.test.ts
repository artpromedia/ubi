/**
 * Passenger trip-link SMS consumer against REAL Redis (db 5): a real
 * `event:trip_access.*` pattern subscription through @ubi/outbox, the
 * Redis-backed claim/outcome/revocation markers and dead-letter list, and the
 * fail-closed start. Only the SMS provider is faked (it records sends).
 */
/* eslint-disable require-await, @typescript-eslint/require-await -- async fakes intentionally have no awaits */
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PASSENGER_TRIP_LINK_BASE_URL_ENV,
  loadTripAccessConfig,
  startTripAccessSms,
  type TripAccessSmsHandle,
} from "./consumer.js";
import {
  TEST_REDIS_URL,
  deleteKeys,
  runPrefix,
  sleep,
  waitFor,
} from "../test-support/redis.js";
import {
  issuedEnvelope,
  randomKeyBase64,
} from "../test-support/trip-access.js";

import type { SmsSender, SmsSendResult } from "../providers/sms.js";
import type { EventEnvelope } from "@ubi/contracts";

const KEY = randomKeyBase64();
const KID = "kid-consumer-test";
const LINK_BASE = "https://ride.ubi.africa/t";
const PHONE = "+2547001234567";

function uniqueToken(): string {
  return `uta_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function uniqueTokenId(): string {
  return `tac_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

interface Captured {
  sends: { to: string; message: string }[];
  logs: { level: string; obj: unknown; msg?: string }[];
  nextResult: SmsSendResult;
}

function capture(): { sms: SmsSender; logger: never; captured: Captured } {
  const captured: Captured = {
    sends: [],
    logs: [],
    nextResult: { success: true, provider: "fake", messageId: "M1" },
  };
  const log =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      captured.logs.push({ level, obj, msg });
    };
  return {
    sms: {
      send: async (to, message) => {
        captured.sends.push({ to, message });
        return captured.nextResult;
      },
    },
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    } as never,
    captured,
  };
}

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    TRIP_ACCESS_DELIVERY_KEY: KEY,
    TRIP_ACCESS_DELIVERY_KID: KID,
    [PASSENGER_TRIP_LINK_BASE_URL_ENV]: LINK_BASE,
    ...overrides,
  };
}

let publisher: Redis;

async function publish(envelope: EventEnvelope): Promise<void> {
  await publisher.publish(`event:${envelope.name}`, JSON.stringify(envelope));
}

beforeAll(() => {
  publisher = new Redis(TEST_REDIS_URL);
});

afterAll(async () => {
  await publisher.quit();
});

describe("trip access consumer (real Redis)", () => {
  const prefix = runPrefix("trip_access");
  const tap = capture();
  let handle: TripAccessSmsHandle | null = null;

  beforeAll(async () => {
    handle = await startTripAccessSms({
      redisUrl: TEST_REDIS_URL,
      env: env(),
      sms: tap.sms,
      logger: tap.logger,
      keyPrefix: prefix,
    });
  });

  afterAll(async () => {
    await handle?.stop();
    await deleteKeys(publisher, prefix);
  });

  const sendsTo = (token: string) =>
    tap.captured.sends.filter((s) => s.message.includes(`#t=${token}`));

  it("delivers one SMS per issued link, deduped across redeliveries", async () => {
    expect(handle).not.toBeNull();
    const tokenId = uniqueTokenId();
    const token = uniqueToken();
    const event = issuedEnvelope({
      keyBase64: KEY,
      kid: KID,
      tokenId,
      phone: PHONE,
      token,
      firstName: "Wanjiru",
    });

    await publish(event);
    await waitFor(
      () => sendsTo(token).length === 1,
      5_000,
      "the trip link SMS",
    );
    expect(sendsTo(token)[0]?.to).toBe(PHONE);
    expect(sendsTo(token)[0]?.message).toContain(
      `Wanjiru, a UBI rider has requested a ride for you`,
    );
    expect(sendsTo(token)[0]?.message).toContain(`${LINK_BASE}#t=${token}`);

    // The relay redelivers the same event; a second event for the same token.
    await publish(event);
    await publish({ ...event, id: `${event.id}_again` });
    await sleep(300);
    expect(sendsTo(token)).toHaveLength(1);
    expect(await publisher.get(`${prefix}sms:${tokenId}`)).toBe("sent");
  });

  it("dead-letters a permanent failure into the Redis DLQ without the phone or token", async () => {
    const tokenId = uniqueTokenId();
    const token = uniqueToken();
    tap.captured.nextResult = {
      success: false,
      permanent: true,
      error: `Invalid 'To' number ${PHONE}`,
    };
    try {
      await publish(
        issuedEnvelope({
          keyBase64: KEY,
          kid: KID,
          tokenId,
          phone: PHONE,
          token,
          firstName: "Otieno",
        }),
      );
      await waitFor(
        async () => (await publisher.get(`${prefix}sms:${tokenId}`)) === "dead",
        5_000,
        "the dead outcome marker",
      );
    } finally {
      tap.captured.nextResult = { success: true, provider: "fake" };
    }
    const entries = (await publisher.lrange(`${prefix}dlq`, 0, -1))
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .filter((entry) => entry.tokenId === tokenId);
    expect(entries).toHaveLength(1);
    expect(String(entries[0]?.reason)).toMatch(/^permanent_failure:/);
    const stored = JSON.stringify(entries);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(PHONE);
    expect(stored).not.toContain(PHONE.slice(1));
    expect(entries[0]?.maskedPhone).toBe("+254********67");
  });

  it("never sends a link revoked before delivery", async () => {
    const tokenId = uniqueTokenId();
    const token = uniqueToken();
    const issued = issuedEnvelope({
      keyBase64: KEY,
      kid: KID,
      tokenId,
      phone: PHONE,
      token,
      firstName: "Achieng",
    });
    await publish({
      ...issued,
      id: `${issued.id}_rev`,
      name: "trip_access.revoked",
      toVersion: 2,
      idempotencyKey: `trip_access.revoked:${tokenId}`.slice(0, 64),
      payload: { tokenId, requestId: "r1", reason: "replaced" },
    });
    await waitFor(
      async () => (await publisher.exists(`${prefix}revoked:${tokenId}`)) === 1,
      5_000,
      "the revocation marker",
    );
    await publish(issued);
    await waitFor(
      async () =>
        (await publisher.get(`${prefix}sms:${tokenId}`)) === "revoked",
      5_000,
      "the revoked outcome",
    );
    expect(sendsTo(token)).toHaveLength(0);
  });

  it("never logs the token or the full phone number", () => {
    const text = JSON.stringify(tap.captured.logs);
    for (const send of tap.captured.sends) {
      const token = /#t=([A-Za-z0-9_-]+)/.exec(send.message)?.[1];
      expect(token).toBeDefined();
      expect(text).not.toContain(token!);
    }
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(PHONE.slice(1));
  });
});

describe("fail closed", () => {
  it.each([
    ["no delivery key", { TRIP_ACCESS_DELIVERY_KEY: undefined }],
    ["no key id", { TRIP_ACCESS_DELIVERY_KID: undefined }],
    ["an unusable (short) key", { TRIP_ACCESS_DELIVERY_KEY: "c2hvcnQ=" }],
    ["no trip link base", { [PASSENGER_TRIP_LINK_BASE_URL_ENV]: undefined }],
    [
      "a link base with its own fragment",
      { [PASSENGER_TRIP_LINK_BASE_URL_ENV]: "https://ride.ubi.africa/t#x" },
    ],
  ])(
    "with %s the consumer is NOT started, an alert is logged, and nothing is ever sent",
    async (_label, overrides) => {
      const tap = capture();
      const prefix = runPrefix("trip_access_closed");
      const handle = await startTripAccessSms({
        redisUrl: TEST_REDIS_URL,
        env: env(overrides),
        sms: tap.sms,
        logger: tap.logger,
        keyPrefix: prefix,
      });
      expect(handle).toBeNull();
      const alert = tap.captured.logs.find(
        (l) =>
          l.level === "error" &&
          (l.obj as { alert?: string }).alert ===
            "trip_access_consumer_not_started",
      );
      expect(alert).toBeDefined();
      expect(JSON.stringify(tap.captured.logs)).not.toContain(KEY);

      // A contract-true event published now reaches no one.
      const token = uniqueToken();
      await publish(
        issuedEnvelope({
          keyBase64: KEY,
          kid: KID,
          tokenId: uniqueTokenId(),
          phone: PHONE,
          token,
          firstName: "Kamau",
        }),
      );
      await sleep(250);
      expect(tap.captured.sends).toHaveLength(0);
      expect(await publisher.keys(`${prefix}*`)).toEqual([]);
    },
  );

  it("requires https for the link base in production", () => {
    const result = loadTripAccessConfig(
      env({
        NODE_ENV: "production",
        [PASSENGER_TRIP_LINK_BASE_URL_ENV]: "http://ride.ubi.africa/t",
      }),
    );
    expect(result.ok).toBe(false);
  });
});
