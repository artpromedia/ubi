/**
 * Redis client used for reading live identity risk state.
 *
 * Created lazily and never thrown away: a connection failure is handled by the
 * fail-closed read in `identity/state.ts`, not by crashing the gateway. When
 * REDIS_URL is unset there is no store at all, and every risk read fails closed.
 */
import Redis from "ioredis";

import type { IdentityStateStore } from "../identity/state";
import { logger } from "./logger.js";

let client: Redis | undefined;
let initialised = false;

export function getIdentityStateStore(): IdentityStateStore | undefined {
  if (initialised) return client;
  initialised = true;

  const url = process.env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    logger.warn(
      "REDIS_URL is not set — wallet safe mode cannot be read, so money movement fails closed",
    );
    return undefined;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", (err) => {
    logger.error({ err }, "Identity state Redis error");
  });
  return client;
}

/** Test seam: drops the memoised client so a new REDIS_URL takes effect. */
export function resetIdentityStateStore(): void {
  client?.disconnect();
  client = undefined;
  initialised = false;
}

process.on("SIGTERM", () => {
  client?.disconnect();
});
