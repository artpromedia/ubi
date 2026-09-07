/**
 * What the identity module needs from the outside world, and how production
 * wires it.
 *
 * Everything is passed in rather than imported at the point of use, so the
 * tests can run the real handlers against a real Postgres and a real Redis
 * while supplying a city config and an SMS sink of their own. No production
 * path contains a stub.
 */
import type { PrismaClient } from "@prisma/client";
import { ConfigClient } from "@ubi/config-client";

import { notificationClient } from "../lib/notification-client.js";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { createPolicyProvider, type PolicyProvider } from "./policy";

/** The subset of a Redis client the identity module uses. `ioredis` satisfies it. */
export interface IdentityCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export interface Notifier {
  sendSms(params: { userId?: string; phone: string; message: string }): Promise<void>;
}

export interface IdentityDeps {
  readonly prisma: PrismaClient;
  readonly cache: IdentityCache;
  readonly policy: PolicyProvider;
  readonly notifier: Notifier;
  readonly now: () => Date;
}

let cachedDeps: IdentityDeps | undefined;

export function defaultIdentityDeps(): IdentityDeps {
  if (cachedDeps !== undefined) return cachedDeps;

  const baseUrl = process.env.CONFIG_SERVICE_URL;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error(
      "CONFIG_SERVICE_URL is required — identity policy (PIN attempts, limits) comes from city config",
    );
  }

  cachedDeps = {
    prisma,
    cache: redis,
    policy: createPolicyProvider(new ConfigClient({ baseUrl, cache: redis })),
    notifier: {
      async sendSms(params) {
        await notificationClient.sendSMS(params);
      },
    },
    now: () => new Date(),
  };
  return cachedDeps;
}
