/**
 * Rate Limiting Middleware
 *
 * WHO A REQUEST IS COUNTED AS (round 8, P0). The limiter used to key on
 * `c.get("userId") || X-Forwarded-For || X-Real-IP || "unknown"`, and
 * getClientIP took the LEFTMOST X-Forwarded-For entry. userId is set only by
 * the `auth` middleware, so a limiter mounted before it (the usual place for
 * a limiter) never saw one; every forwarded header is written by the caller,
 * so any caller could mint a fresh bucket per request; and every caller
 * without those headers — each service calling with X-Service-Key — shared the
 * one "unknown" bucket that anyone could fill.
 *
 * The limiter now works out who the caller is itself, with the same
 * verification the route guards use, and never writes anything they read:
 *
 *  1. A valid internal service key (X-Service-Key equal to
 *     INTERNAL_SERVICE_KEY, compared in constant time) is not throttled here.
 *     The key is one credential shared by every calling service, so a
 *     "per-service" bucket could only be keyed by a name the caller declares
 *     about itself; its holders are platform services, whose load is bounded
 *     by their own concurrency, and a refusal here would drop a notification
 *     mid-saga. A forged key is not exempt: `serviceAuth` refuses it, and it
 *     is counted against its sender below.
 *  2. A verified user: the `userId` the `auth` middleware set, when it ran
 *     first, else a bearer token that verifies against JWT_SECRET exactly as
 *     `auth` verifies it.
 *  3. Everything else per client address: the socket peer, or — only when
 *     the peer is listed in NOTIFICATION_TRUSTED_PROXIES (comma-separated IP
 *     addresses and/or CIDR ranges; unset, the default, trusts no one) — the
 *     right-most X-Forwarded-For entry that is not itself a trusted hop, then
 *     X-Real-IP when the chain names no client. A trusted peer that forwards
 *     nothing usable, or a chain malformed before a client is reached, is
 *     counted as itself. IPv6 clients are counted per /64.
 *
 * NO DETERMINABLE ADDRESS. There is no shared "unknown" bucket. A request with
 * no service key, no verified user and no peer address (in-process dispatch,
 * or a socket already torn down) is not counted here; the route's own
 * authentication decides it, and every notification route authenticates.
 *
 * REDIS UNAVAILABLE. The limiter fails OPEN, the house convention: when Redis
 * is not connected, or the check errors or outlasts REDIS_CHECK_BUDGET_MS, the
 * request goes on uncounted and without X-RateLimit-* headers. Authentication
 * never fails open: the limiter grants nothing, and the route guards run
 * exactly as they would otherwise.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIPv4, isIPv6 } from "node:net";

import { getConnInfo } from "@hono/node-server/conninfo";
import { HTTPException } from "hono/http-exception";
import { verify } from "jsonwebtoken";

import { logger } from "../lib/logger.js";
import { RateLimiter, redis } from "../lib/redis";

import type { Context, Next } from "hono";

// ============================================
// Default Rate Limiters
// ============================================

// General API rate limiter
export const apiRateLimiter = new RateLimiter({
  keyPrefix: "ratelimit:api",
  limit: 100,
  windowSeconds: 60,
});

// SMS rate limiter (more restrictive)
export const smsRateLimiter = new RateLimiter({
  keyPrefix: "ratelimit:sms",
  limit: 10,
  windowSeconds: 60,
});

// OTP rate limiter (very restrictive)
export const otpRateLimiter = new RateLimiter({
  keyPrefix: "ratelimit:otp",
  limit: 3,
  windowSeconds: 600, // 10 minutes
});

// Email rate limiter
export const emailRateLimiter = new RateLimiter({
  keyPrefix: "ratelimit:email",
  limit: 20,
  windowSeconds: 60,
});

// Push notification rate limiter
export const pushRateLimiter = new RateLimiter({
  keyPrefix: "ratelimit:push",
  limit: 50,
  windowSeconds: 60,
});

// ============================================
// Who the caller is
// ============================================

/** The env var naming the proxies allowed to say who the client is. */
export const TRUSTED_PROXIES_ENV = "NOTIFICATION_TRUSTED_PROXIES";

/**
 * The longest the limiter waits on Redis before failing open; bounds what a
 * hung Redis can add to a request.
 */
const REDIS_CHECK_BUDGET_MS = 250;

/** At most one fail-open warning per interval: an outage is a line, not a flood. */
const FAIL_OPEN_LOG_INTERVAL_MS = 10_000;

const rateLimitLogger = logger.child({ component: "rate-limit" });

/** Who a request is counted as. `key` never collides across kinds. */
export type RateLimitSubject =
  | { readonly kind: "service" }
  | { readonly kind: "user"; readonly key: string }
  | { readonly kind: "client"; readonly key: string }
  | { readonly kind: "unidentified" };

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d+)?$/;
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const TRAILING_IPV4 = /(\d{1,3}(?:\.\d{1,3}){3})$/;

/**
 * A bare IP address from a socket or a header entry — port, brackets and
 * zone stripped, an IPv4-mapped IPv6 address unmapped — or undefined when
 * the value is not an IP address at all.
 */
function normalizeAddress(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let value = raw.trim();
  const bracketed = BRACKETED_IPV6.exec(value);
  const withPort = IPV4_WITH_PORT.exec(value);
  if (bracketed?.[1] !== undefined) {
    value = bracketed[1];
  } else if (withPort?.[1] !== undefined) {
    value = withPort[1];
  }
  value = value.split("%")[0] ?? "";
  if (isIPv4(value)) {
    return value;
  }
  if (!isIPv6(value)) {
    return undefined;
  }
  const mapped = MAPPED_IPV4.exec(value)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) {
    return mapped;
  }
  return value.toLowerCase();
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIPv4(address) ? "ipv4" : "ipv6";
}

/** The eight 16-bit groups of a valid IPv6 address, in hex. */
function ipv6Groups(address: string): string[] {
  let text = address;
  const tail = TRAILING_IPV4.exec(text)?.[1];
  if (tail !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, text.length - tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const headGroups = head.length > 0 ? head.split(":") : [];
  let groups = headGroups;
  if (rest !== undefined) {
    const restGroups = rest.length > 0 ? rest.split(":") : [];
    const zeros = Array.from(
      { length: 8 - headGroups.length - restGroups.length },
      () => "0",
    );
    groups = [...headGroups, ...zeros, ...restGroups];
  }
  return groups.map((group) => Number.parseInt(group, 16).toString(16));
}

/** The bucket for a client address: an IPv4 host, or an IPv6 /64. */
function clientKeyOf(address: string): string {
  if (isIPv4(address)) {
    return `ip:${address}`;
  }
  return `ip6:${ipv6Groups(address).slice(0, 4).join(":")}::/64`;
}

interface TrustedProxies {
  readonly raw: string;
  readonly list: BlockList;
  readonly size: number;
}

let trustedCache: TrustedProxies | undefined;

function addTrustedEntry(list: BlockList, entry: string): boolean {
  const slash = entry.indexOf("/");
  const address = normalizeAddress(
    slash === -1 ? entry : entry.slice(0, slash),
  );
  if (address === undefined) {
    return false;
  }
  const family = familyOf(address);
  if (slash === -1) {
    list.addAddress(address, family);
    return true;
  }
  const prefix = entry.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  if (bits > (family === "ipv4" ? 32 : 128)) {
    return false;
  }
  list.addSubnet(address, bits, family);
  return true;
}

/**
 * The configured trusted proxies, re-parsed only when the variable changes.
 * An entry that is not an address or CIDR range is ignored — trusting less,
 * never more — and logged.
 */
function trustedProxies(): TrustedProxies {
  const raw = process.env[TRUSTED_PROXIES_ENV] ?? "";
  if (trustedCache?.raw === raw) {
    return trustedCache;
  }
  const list = new BlockList();
  let size = 0;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (addTrustedEntry(list, trimmed)) {
      size += 1;
    } else {
      rateLimitLogger.error(
        { entry: trimmed },
        `${TRUSTED_PROXIES_ENV} entry is not an IP address or CIDR range; ignored`,
      );
    }
  }
  trustedCache = { raw, list, size };
  return trustedCache;
}

function isTrusted(proxies: TrustedProxies, address: string): boolean {
  return proxies.size > 0 && proxies.list.check(address, familyOf(address));
}

/** The socket peer, or undefined for in-process dispatch or a torn-down socket. */
function peerAddressOf(c: Context): string | undefined {
  try {
    return normalizeAddress(getConnInfo(c).remote.address);
  } catch {
    // No Node bindings: `app.fetch` / `app.request` called in-process.
    return undefined;
  }
}

/**
 * The client a trusted proxy forwarded: the right-most X-Forwarded-For entry
 * that is not itself a trusted hop, else X-Real-IP. Undefined when neither
 * names one — or when the chain is malformed before a client is reached.
 */
function forwardedClientOf(
  c: Context,
  proxies: TrustedProxies,
): string | undefined {
  const chain = (c.req.header("X-Forwarded-For") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = normalizeAddress(chain[index]);
    if (address === undefined) {
      return undefined;
    }
    if (!isTrusted(proxies, address)) {
      return address;
    }
  }
  return normalizeAddress(c.req.header("X-Real-IP"));
}

/**
 * Get the client IP: the socket peer, or what a trusted proxy forwarded
 * (NOTIFICATION_TRUSTED_PROXIES). Never a header an untrusted caller wrote —
 * CF-Connecting-IP included — and undefined, never "unknown", when there is
 * no peer address.
 */
export function getClientIP(c: Context): string | undefined {
  const peer = peerAddressOf(c);
  if (peer === undefined) {
    return undefined;
  }
  const proxies = trustedProxies();
  if (!isTrusted(proxies, peer)) {
    return peer;
  }
  return forwardedClientOf(c, proxies) ?? peer;
}

const SERVICE_KEY_HEADER = "X-Service-Key";

/** Constant-time: SHA-256 digests have one length whatever was presented. */
function isValidServiceKey(presented: string | undefined): boolean {
  const configured = process.env.INTERNAL_SERVICE_KEY;
  if (
    presented === undefined ||
    presented.length === 0 ||
    configured === undefined ||
    configured.length === 0
  ) {
    return false;
  }
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(configured).digest(),
  );
}

/** The user a bearer token names, verified exactly as `auth` verifies it. */
function verifiedBearerUser(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  const secret = process.env.JWT_SECRET;
  if (
    header === undefined ||
    !header.startsWith("Bearer ") ||
    secret === undefined ||
    secret.length === 0
  ) {
    return undefined;
  }
  try {
    const payload = verify(header.substring(7), secret);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return undefined;
    }
    return payload.sub.length > 0 ? payload.sub : undefined;
  } catch {
    // `auth` refuses it too; it is counted against its sender.
    return undefined;
  }
}

/**
 * Who this request is counted as, resolved with the route guards' own
 * verification — nothing here is written to the context, so it grants no
 * authentication.
 */
export function resolveRateLimitSubject(c: Context): RateLimitSubject {
  if (isValidServiceKey(c.req.header(SERVICE_KEY_HEADER))) {
    return { kind: "service" };
  }
  const authenticated = c.get("userId") as string | undefined;
  const user =
    authenticated !== undefined && authenticated.length > 0
      ? authenticated
      : verifiedBearerUser(c);
  if (user !== undefined) {
    return { kind: "user", key: `user:${user}` };
  }
  const address = getClientIP(c);
  if (address === undefined) {
    return { kind: "unidentified" };
  }
  return { kind: "client", key: clientKeyOf(address) };
}

// ============================================
// Redis, within a budget
// ============================================

type CheckResult = Awaited<ReturnType<RateLimiter["isAllowed"]>>;

let lastFailOpenLogAt = 0;

function noteFailOpen(reason: string, error?: unknown): void {
  const now = Date.now();
  if (now - lastFailOpenLogAt < FAIL_OPEN_LOG_INTERVAL_MS) {
    return;
  }
  lastFailOpenLogAt = now;
  rateLimitLogger.warn(
    { reason, err: error },
    "rate limiter unavailable; failing open (authentication is still enforced)",
  );
}

/** The sliding-window check, or undefined when Redis cannot answer in time. */
async function checkWithinBudget(
  limiter: RateLimiter,
  key: string,
): Promise<CheckResult | undefined> {
  if (redis.status !== "ready") {
    // Down or reconnecting: do not queue a command behind the outage.
    noteFailOpen(`redis is ${redis.status}`);
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), REDIS_CHECK_BUDGET_MS);
  });
  const check = limiter.isAllowed(key).catch((error: unknown) => {
    noteFailOpen("redis check failed", error);
    return undefined;
  });
  try {
    const result = await Promise.race([check, budget]);
    if (result === undefined) {
      noteFailOpen(`no answer within ${REDIS_CHECK_BUDGET_MS}ms`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// Middleware Factory
// ============================================

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  /**
   * Overrides who a request is counted as. Undefined means "not counted";
   * never return a shared placeholder, and never a header an untrusted
   * caller wrote.
   */
  keyGenerator?: (c: Context) => string | undefined;
  message?: string;
  skipFailedRequests?: boolean;
}

/**
 * Create rate limit middleware
 */
export function rateLimit(options: RateLimitOptions) {
  const limiter = new RateLimiter({
    keyPrefix: options.keyPrefix,
    limit: options.limit,
    windowSeconds: options.windowSeconds,
  });

  return async (c: Context, next: Next): Promise<void> => {
    let key: string | undefined;
    if (options.keyGenerator !== undefined) {
      key = options.keyGenerator(c);
    } else {
      const subject = resolveRateLimitSubject(c);
      key =
        subject.kind === "user" || subject.kind === "client"
          ? subject.key
          : undefined;
    }
    if (key === undefined) {
      // A service call, or no one to attribute: the route guard decides.
      await next();
      return;
    }

    const result = await checkWithinBudget(limiter, key);
    if (result === undefined) {
      // Fail open; the route guards still run.
      await next();
      return;
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", options.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      c.header(
        "Retry-After",
        Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)).toString(),
      );

      throw new HTTPException(429, {
        message: options.message || "Too many requests, please try again later",
      });
    }

    await next();
  };
}

/**
 * Create per-endpoint rate limiter
 */
export function createRateLimiter(
  endpoint: string,
  limit: number,
  windowSeconds: number,
) {
  return rateLimit({
    keyPrefix: `ratelimit:${endpoint}`,
    limit,
    windowSeconds,
  });
}

// ============================================
// Pre-configured Rate Limiters
// ============================================

/**
 * Strict rate limiter for sensitive operations
 */
export const strictRateLimit = rateLimit({
  keyPrefix: "ratelimit:strict",
  limit: 5,
  windowSeconds: 300, // 5 minutes
  message: "Too many attempts. Please wait 5 minutes before trying again.",
});

/**
 * Burst rate limiter (allows bursts but limits over time)
 */
export const burstRateLimit = rateLimit({
  keyPrefix: "ratelimit:burst",
  limit: 30,
  windowSeconds: 10,
});

/**
 * Daily rate limiter
 */
export const dailyRateLimit = rateLimit({
  keyPrefix: "ratelimit:daily",
  limit: 1000,
  windowSeconds: 86400, // 24 hours
});

// ============================================
// IP-based Rate Limiting
// ============================================

/**
 * IP-based rate limiter: per client address (getClientIP), whoever the
 * caller is. A request with no peer address is not counted.
 */
export function ipRateLimit(limit: number, windowSeconds: number) {
  return rateLimit({
    keyPrefix: "ratelimit:ip",
    limit,
    windowSeconds,
    keyGenerator: (c) => {
      const address = getClientIP(c);
      return address === undefined ? undefined : clientKeyOf(address);
    },
  });
}
