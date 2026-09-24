/**
 * Rate Limit Middleware
 *
 * WHO A REQUEST IS COUNTED AS (round 7, P0). src/index.ts registers the
 * payment limiter on /fraud, /safety, /admin, /v1/wallet, /v1/finance and
 * /v1/business BEFORE any authentication — the /v1 routers authenticate
 * inside themselves — so `c.get("userId")` is never set when it runs. The old
 * limiter keyed on it anyway, then fell back to X-Forwarded-For, X-Real-IP
 * and finally the literal "unknown". Service callers send none of those
 * (ride-service's wallet port sends X-Service-Key and nothing else; travel,
 * delivery and ask likewise), so every service money call platform-wide —
 * the commission reserve on each bid, the capture at award, releases,
 * adjustments, travel authorize/capture/refund — shared ONE key,
 * `ratelimit:payment:unknown`, at 30 a minute, and any unauthenticated
 * caller could fill it.
 *
 * The limiter now works out who the caller is itself, with the same
 * verification functions the routers authenticate with, and never writes
 * anything authentication reads: route authentication is unchanged and still
 * runs, in the routers, on every request this lets through.
 *
 *  1. A valid internal service key (`isValidServiceKey`, the constant-time
 *     check `internalServiceAuth` refuses with) is not throttled here — see
 *     SERVICE TRAFFIC.
 *  2. A verified gateway identity (`x-ubi-identity`, `verifyIdentityContext`
 *     — the JWS `serviceAuth` resolves) is counted as that user.
 *  3. Everything else is counted per client address — see CLIENT ADDRESSES.
 *     A forged service key, a JWS that does not verify and a bare X-User-ID
 *     all land here: the router refuses them, and they are still counted
 *     against their sender, never against the service or user they name.
 *
 * SERVICE TRAFFIC is exempt rather than given a service-tier bucket. The
 * internal key is one credential shared by every calling service, so a
 * "per-service" bucket could only be keyed by a header the caller declares
 * about itself; and a 429 here lands mid-saga on calls whose refusal costs
 * more than serving them (a refused release leaves a driver's commission
 * reserved, a refused capture fails an award the requester already chose, a
 * refused travel capture leaves a supplier booking unpaid). The key never
 * reaches clients — the gateway strips X-Service-Key and does not proxy
 * /v1/finance — so its holder is a platform service, whose load is bounded
 * by its own concurrency and retry budgets.
 *
 * CLIENT ADDRESSES. X-Forwarded-For and X-Real-IP are client-writable, so
 * they are read only when the socket peer is listed in
 * PAYMENT_TRUSTED_PROXIES (comma-separated IP addresses and/or CIDR ranges;
 * unset — the default — trusts no one and the peer is the client). List
 * exactly the hops that record the address they received a request from:
 * the ingress and the api-gateway pods behind it. X-Forwarded-For is walked
 * from the RIGHT, skipping trusted hops; the first address that is not one
 * is the client, so entries a client prepends are never reached. X-Real-IP
 * is read only when the chain names no client. A trusted peer that forwards
 * no usable client address is counted as itself: garbage in a forwarding
 * header never buys an uncounted request, and only requests with equally
 * unusable forwarding data share that bucket — never an authenticated user
 * or a service call. IPv6 clients are counted per /64, the block one
 * subscriber is normally given, so rotating through it mints nothing.
 *
 * NO DETERMINABLE ADDRESS. There is no shared "unknown" bucket. A request
 * with no service key, no verified identity and no peer address is not
 * counted here, and the router's authentication decides it. Under the TCP
 * listener src/index.ts starts, every live connection has a peer address;
 * one is missing only for in-process dispatch (`app.fetch`, as in tests) or
 * a socket already torn down, whose sender can no longer read any reply. No
 * shared state is consumed, so no party can starve another through it, and
 * an authenticated request never gets there.
 *
 * REDIS UNAVAILABLE. The limiter fails OPEN, the house convention
 * (ride-service's `AllowRate`, ask-service's `withinRateLimit`): when the
 * client is not connected, or the check errors or outlasts
 * REDIS_CHECK_BUDGET_MS, the request goes on uncounted and without
 * X-RateLimit-* headers. Authentication never fails open: the limiter grants
 * nothing, and the routers' guards run exactly as they would otherwise.
 */

import { BlockList, isIPv4, isIPv6 } from "node:net";

import { getConnInfo } from "@hono/node-server/conninfo";

import { isValidServiceKey, SERVICE_KEY_HEADER } from "./auth";
import { IDENTITY_HEADER, verifyIdentityContext } from "../identity/context";
import { logger } from "../lib/logger";
import { rateLimiter, redis } from "../lib/redis";

import type { Context, Next } from "hono";

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
}

/** The env var naming the proxies allowed to say who the client is. */
export const TRUSTED_PROXIES_ENV = "PAYMENT_TRUSTED_PROXIES";

/**
 * The longest the limiter waits on Redis before failing open. A healthy
 * in-cluster round trip is about a millisecond; this bounds what a hung or
 * blackholed Redis can add to a money call.
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

// ===========================================
// Addresses
// ===========================================

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

// ===========================================
// Trusted proxies
// ===========================================

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
 * names one — or when the chain is malformed before a client is reached,
 * since nothing to the left of a bad entry can be attributed to anyone.
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

function clientAddressOf(c: Context): string | undefined {
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

// ===========================================
// Subject
// ===========================================

/**
 * Who this request is counted as, resolved with the routers' own
 * verification — nothing here is written to the context, so it grants no
 * authentication.
 */
export async function resolveRateLimitSubject(
  c: Context,
): Promise<RateLimitSubject> {
  if (isValidServiceKey(c.req.header(SERVICE_KEY_HEADER))) {
    return { kind: "service" };
  }
  const signed = c.req.header(IDENTITY_HEADER);
  if (signed !== undefined && signed.length > 0) {
    try {
      const principal = await verifyIdentityContext(signed);
      return { kind: "user", key: `user:${principal.userId}` };
    } catch {
      // serviceAuth refuses it too (401, or 503 for a misconfigured
      // secret); it is counted against its sender below.
    }
  }
  const address = clientAddressOf(c);
  if (address === undefined) {
    return { kind: "unidentified" };
  }
  return { kind: "client", key: clientKeyOf(address) };
}

// ===========================================
// Redis, within a budget
// ===========================================

type CheckResult = Awaited<ReturnType<typeof rateLimiter.check>>;

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
  key: string,
  limit: number,
  windowSeconds: number,
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
  try {
    const result = await Promise.race([
      rateLimiter.check(key, limit, windowSeconds),
      budget,
    ]);
    if (result === undefined) {
      noteFailOpen(`redis did not answer within ${REDIS_CHECK_BUDGET_MS}ms`);
    }
    return result;
  } catch (error) {
    noteFailOpen("redis check failed", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create rate limit middleware
 */
export function rateLimit(options: RateLimitOptions) {
  return async (c: Context, next: Next): Promise<void | Response> => {
    const { limit, windowSeconds, keyPrefix = "global" } = options;

    const subject = await resolveRateLimitSubject(c);
    if (subject.kind === "service" || subject.kind === "unidentified") {
      await next();
      return;
    }

    const result = await checkWithinBudget(
      `${keyPrefix}:${subject.key}`,
      limit,
      windowSeconds,
    );
    if (result === undefined) {
      // Fail open; the routers' authentication still runs.
      await next();
      return;
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.resetIn.toString());

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            details: {
              limit,
              remaining: result.remaining,
              resetIn: result.resetIn,
            },
          },
        },
        429,
      );
    }

    await next();
  };
}

// Pre-configured rate limiters
export const standardRateLimit = rateLimit({
  limit: 100,
  windowSeconds: 60,
  keyPrefix: "standard",
});

export const strictRateLimit = rateLimit({
  limit: 10,
  windowSeconds: 60,
  keyPrefix: "strict",
});

export const paymentRateLimit = rateLimit({
  limit: 30,
  windowSeconds: 60,
  keyPrefix: "payment",
});

export const webhookRateLimit = rateLimit({
  limit: 1000,
  windowSeconds: 60,
  keyPrefix: "webhook",
});
