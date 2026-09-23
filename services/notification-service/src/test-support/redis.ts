/**
 * TEST SUPPORT ONLY — real Redis for the consumer suites.
 *
 * NOTIFY_TEST_REDIS_URL selects the server and logical database (default db
 * 5, this service's dedicated test database). Keys are namespaced per run and
 * removed afterwards. Pub/sub is NOT scoped by logical database, so other
 * processes' messages on the same channels can arrive during a test: suites
 * assert on their own ids only.
 */
import { randomBytes } from "node:crypto";

import type { Redis } from "ioredis";

export const TEST_REDIS_URL =
  process.env.NOTIFY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/5";

export function runPrefix(label: string): string {
  return `notif:test:${label}:${randomBytes(6).toString("hex")}:`;
}

export async function deleteKeys(redis: Redis, prefix: string): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      500,
    );
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

/** Poll until `check` holds (or fail after `timeoutMs`). */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  label = "condition",
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) {
      return;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
