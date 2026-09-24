/**
 * Shared wiring for the rate-limit suites: the REAL app (src/index.ts —
 * global middleware, the limiter registrations, the router registry) served
 * by @hono/node-server on a real TCP port, and a client that picks its own
 * source address.
 *
 * Distinct client addresses are real, not headers: Linux routes all of
 * 127.0.0.0/8 to loopback, so a request bound to `localAddress: 127.0.0.7`
 * reaches the server from peer 127.0.0.7 — exactly what the limiter reads
 * off the socket in production.
 *
 * The app reads its Prisma singleton and Redis client at import time, so it
 * is imported only after DATABASE_URL points at WALLET_TEST_DATABASE_URL and
 * REDIS_URL at the Redis the suite means (global-setup points it at
 * PAYMENT_TEST_REDIS_URL).
 *
 * This file sets INTERNAL_SERVICE_KEY / UBI_IDENTITY_SECRET / DATABASE_URL on
 * purpose, so the turbo env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { randomUUID } from "node:crypto";
import http from "node:http";

import { serve } from "@hono/node-server";
import * as jose from "jose";

import { createCityConfigProvider } from "../../src/ledger/city-config";
import { ensureWallet } from "../../src/ledger/wallets";
import {
  closeTestDb,
  fundWallet,
  seedUser,
  testDb,
  TEST_DATABASE_URL,
  type SeededCity,
} from "../ledger/helpers";

import type { Hono } from "hono";
import type Redis from "ioredis";
import type { AddressInfo } from "node:net";

export const INTERNAL_KEY = "rate-limit-suite-internal-service-key";
export const IDENTITY_SECRET =
  "rate-limit-suite-gateway-identity-secret-000000";

export interface BootedApp {
  readonly app: Hono;
  readonly redis: Redis;
  readonly port: number;
  close(): Promise<void>;
}

const SAVED = [
  "INTERNAL_SERVICE_KEY",
  "UBI_IDENTITY_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
] as const;

async function dropCachedPrisma(): Promise<void> {
  const holder = globalThis as {
    prisma?: { $disconnect(): Promise<void> };
  };
  if (holder.prisma !== undefined) {
    await holder.prisma.$disconnect().catch(() => undefined);
    delete holder.prisma;
  }
}

/**
 * Imports the real app and serves it on 127.0.0.1:<ephemeral>. `redisUrl`
 * overrides the Redis the app connects to (the Redis-down suite points it at
 * a port it controls).
 */
export async function bootApp(
  options: { readonly redisUrl?: string } = {},
): Promise<BootedApp> {
  const saved = new Map<string, string | undefined>(
    SAVED.map((name) => [name, process.env[name]]),
  );
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
  process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  if (options.redisUrl !== undefined) {
    process.env.REDIS_URL = options.redisUrl;
  }
  // Earlier suites in this worker may have imported the app against
  // global-setup's DATABASE_URL, and src/lib/prisma caches its client on
  // globalThis outside production; drop it so this import uses the test DB.
  await dropCachedPrisma();
  // vitest loads the module as ESM; the cast states that runtime shape.
  const service = (await import("../../src/index.js")) as unknown as {
    default: Hono;
  };
  const prismaModule = await import("../../src/lib/prisma.js");
  const redisModule = (await import("../../src/lib/redis.js")) as unknown as {
    redis: Redis;
  };
  const app = service.default;

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const started = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      () => resolve(started),
    );
  });
  const port = (server.address() as AddressInfo).port;

  return {
    app,
    redis: redisModule.redis,
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      redisModule.redis.disconnect();
      await prismaModule.disconnectPrisma();
      await dropCachedPrisma();
      await closeTestDb();
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    },
  };
}

export interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly elapsedMs: number;
}

export interface CallOptions {
  readonly method?: string;
  readonly path: string;
  /** The client's source address: the peer the server sees. */
  readonly from: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** One real HTTP exchange over a fresh TCP connection from `from`. */
export async function call(port: number, options: CallOptions): Promise<Reply> {
  const payload =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  const started = performance.now();
  return new Promise<Reply>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        localAddress: options.from,
        agent: false,
        headers: {
          ...(payload === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            body = {};
          }
          resolve({
            status: response.statusCode ?? 0,
            body,
            text,
            headers: response.headers,
            elapsedMs: performance.now() - started,
          });
        });
      },
    );
    request.on("error", reject);
    if (payload !== undefined) {
      request.write(payload);
    }
    request.end();
  });
}

/** Runs `run` over `items`, `width` at a time — rapid, like a busy caller. */
export async function inWaves<T, R>(
  items: readonly T[],
  width: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += width) {
    results.push(
      ...(await Promise.all(items.slice(start, start + width).map(run))),
    );
  }
  return results;
}

/** Signs an identity context exactly the way api-gateway does. */
export async function signedIdentity(
  userId: string,
  secret: string = IDENTITY_SECRET,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role: "driver",
    scp: [],
    mod: [],
    city: null,
    tenant: null,
    sid: null,
    dev: null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", typ: "UBI-IC" })
    .setSubject(userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(secret));
}

/** Deletes this service's limiter buckets in the suite's own Redis database. */
export async function clearPaymentBuckets(redis: Redis): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "ratelimit:payment:*",
      "COUNT",
      500,
    );
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

export interface Driver {
  readonly userId: string;
  readonly walletId: string;
}

/** A driver with a real wallet in `city`, funded from a top-up entry. */
export async function fundedDriver(
  city: SeededCity,
  amountMinor: number,
): Promise<Driver> {
  const db = testDb();
  const user = await seedUser(db, "Driver");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const wallet = await db.$transaction(async (tx) =>
    ensureWallet(tx, "user", user.id, config.city),
  );
  if (amountMinor > 0) {
    await fundWallet(db, wallet.id, city.currency, amountMinor);
  }
  return { userId: user.id, walletId: wallet.id };
}
