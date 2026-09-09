/**
 * Integration-test harness. Real Postgres, real route handlers. The only thing
 * supplied is a mutable clock, so expiry and period windows are exercised
 * rather than slept through — the code under test is the production code.
 */
import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import * as jose from "jose";

import type { AiActionDeps } from "../../src/grants/types";
import { prisma } from "../../src/lib/prisma";
import { createGrantRoutes } from "../../src/routes/grants";
import { createMandateRoutes } from "../../src/routes/mandates";
import { INTERNAL_IDENTITY_SECRET, SERVICE_SECRET } from "./setup-env";

export interface Harness {
  readonly deps: AiActionDeps;
  readonly app: Hono;
  setNow(value: Date): void;
  now(): Date;
}

export function createHarness(start?: Date): Harness {
  let clock = start ?? new Date();
  const deps: AiActionDeps = { prisma, now: () => clock };

  const app = new Hono();
  app.route("/", createMandateRoutes(deps));
  app.route("/", createGrantRoutes(deps));

  return {
    deps,
    app,
    setNow: (value: Date) => {
      clock = value;
    },
    now: () => clock,
  };
}

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

export interface PrincipalInput {
  readonly userId: string;
  readonly role?: string;
  readonly scopes?: readonly string[];
  readonly cityId?: string | null;
}

/** Mints the signed identity header the API gateway would mint. */
export async function identityHeader(input: PrincipalInput): Promise<string> {
  const key = new TextEncoder().encode(INTERNAL_IDENTITY_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    role: input.role ?? "rider",
    scp: [...(input.scopes ?? ["profile:read", "profile:write"])],
    mod: [],
    city: input.cityId ?? "LOS",
    tenant: null,
    sid: null,
    dev: null,
    rid: `req_${randomUUID()}`,
  })
    .setProtectedHeader({ alg: "HS256", kid: "test", typ: "UBI-IC" })
    .setSubject(input.userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
}

export async function userHeaders(
  input: PrincipalInput,
  idempotencyKey?: string,
): Promise<Record<string, string>> {
  return {
    "content-type": "application/json",
    "x-ubi-identity": await identityHeader(input),
    ...(idempotencyKey === undefined
      ? {}
      : { "idempotency-key": idempotencyKey }),
  };
}

export function serviceHeaders(
  idempotencyKey?: string,
  overrides: { serviceKey?: string } = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-service-key": overrides.serviceKey ?? SERVICE_SECRET,
    ...(idempotencyKey === undefined
      ? {}
      : { "idempotency-key": idempotencyKey }),
  };
}

export function newUserId(): string {
  return `usr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function key(prefix = "idem"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export interface JsonResponse<T> {
  readonly status: number;
  readonly body: T;
}

export async function post<T>(
  app: Hono,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<JsonResponse<T>> {
  const response = await app.fetch(
    new Request(`http://user-service.test${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
  );
  return { status: response.status, body: (await response.json()) as T };
}

export async function patch<T>(
  app: Hono,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<JsonResponse<T>> {
  const response = await app.fetch(
    new Request(`http://user-service.test${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
  );
  return { status: response.status, body: (await response.json()) as T };
}

export async function get<T>(
  app: Hono,
  path: string,
  headers: Record<string, string>,
): Promise<JsonResponse<T>> {
  const response = await app.fetch(
    new Request(`http://user-service.test${path}`, {
      method: "GET",
      headers,
    }),
  );
  return { status: response.status, body: (await response.json()) as T };
}

export async function outboxNames(subjectId: string): Promise<string[]> {
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: subjectId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  return events.map((event) => event.name);
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
}
