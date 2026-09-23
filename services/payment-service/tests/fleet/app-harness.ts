/**
 * Boots the REAL payment-service app (src/index.ts: global middleware, the
 * `/v1/finance/*` rate limiter, the router registry) against the test
 * database, for the suites that prove routes through the app with the
 * credentials production uses. The app reads its Prisma singleton, Redis
 * client and configuration at import time, so the environment is set first
 * and restored afterwards. The rate limiter keys by client address; every
 * request uses its own.
 *
 * This file sets service credentials and DATABASE_URL on purpose, so the
 * turbo env-declaration lint does not apply.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { TEST_DATABASE_URL } from "../ledger/helpers";

import type { Hono } from "hono";

export interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface AppHarness {
  send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Reply>;
  identity(userId: string, role: string, secret?: string): Promise<string>;
  close(): Promise<void>;
}

async function dropCachedPrisma(): Promise<void> {
  const holder = globalThis as { prisma?: { $disconnect(): Promise<void> } };
  if (holder.prisma !== undefined) {
    await holder.prisma.$disconnect().catch(() => undefined);
    delete holder.prisma;
  }
}

function forwardedFor(): string {
  const octet = (): number => Math.floor(Math.random() * 250);
  return `10.${octet()}.${octet()}.${octet()}`;
}

export async function startApp(
  env: Readonly<Record<string, string>>,
): Promise<AppHarness> {
  const all = { ...env, DATABASE_URL: TEST_DATABASE_URL };
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(all)) {
    saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  await dropCachedPrisma();
  const service = (await import("../../src/index.js")) as unknown as {
    default: Hono;
  };
  const prismaModule = await import("../../src/lib/prisma.js");
  const redisModule = await import("../../src/lib/redis.js");
  const app = service.default;
  const secret = env.UBI_IDENTITY_SECRET ?? "";

  return {
    async send(method, path, headers, body) {
      const response = await app.fetch(
        new Request(`http://payment-service.test${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": forwardedFor(),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      return { status: response.status, body: parsed };
    },
    async identity(userId, role, signingSecret = secret) {
      const now = Math.floor(Date.now() / 1000);
      const token = await new jose.SignJWT({
        role,
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
        .sign(new TextEncoder().encode(signingSecret));
      return token;
    },
    async close() {
      await prismaModule.disconnectPrisma();
      await redisModule.disconnectRedis();
      await dropCachedPrisma();
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
