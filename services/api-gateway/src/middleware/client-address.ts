/**
 * Who the client is, as far as the network can say.
 *
 * X-Forwarded-For and X-Real-IP are request headers: anyone can write them.
 * Before round 8 the gateway's limiter keyed every request on the LEFTMOST
 * X-Forwarded-For entry (or a shared "unknown"), the trip link did the same,
 * and the proxy passed the client's own X-Forwarded-For / X-Real-IP straight
 * to every downstream service. A client could therefore mint a fresh
 * rate-limit bucket per request, or land every request it made in someone
 * else's, and tell each service behind the gateway whatever address it liked.
 *
 * The rule now, for every consumer of a client address in the gateway (the
 * limiter, the trip link, the proxy):
 *
 *  - The socket peer is the client, unless the peer is listed in
 *    GATEWAY_TRUSTED_PROXIES (comma-separated IP addresses and/or CIDR
 *    ranges; unset — the default — trusts no one).
 *  - From a trusted peer, X-Forwarded-For is walked from the RIGHT, skipping
 *    trusted hops; the first address that is not one is the client, so
 *    entries a client prepends are never reached. X-Real-IP is read only when
 *    the chain names no client. List exactly the hops that record the address
 *    they received a request from: the ingress (Caddy / the load balancer).
 *  - A trusted peer that forwards no usable client address — or a chain that
 *    is malformed before a client is reached — is counted as itself: garbage
 *    in a forwarding header never buys a fresh bucket.
 *
 * What goes downstream (`forwardedFor`) is rebuilt from that result, never
 * copied: the resolved client, the trusted hops between it and the gateway,
 * then the socket peer the gateway saw. Anything the client wrote to the
 * left of its own address is dropped, so a downstream service that trusts the
 * gateway resolves the same client the gateway limited on, whichever end of
 * the chain it reads.
 *
 * `connection` separates the two ways a request can have no peer address. A
 * request dispatched in-process (`app.fetch(request)` / `app.request()` with
 * no environment, as most of the tests do) is code in this process: no remote
 * party can produce one. A request that arrived on a connection whose peer
 * cannot be read — a socket already torn down, or a server adapter that is not
 * @hono/node-server — has an address nobody can attribute, and the limiter
 * refuses it rather than forward it uncounted.
 */
import { BlockList, isIPv4, isIPv6 } from "node:net";

import { getConnInfo } from "@hono/node-server/conninfo";

import { rateLimitLogger } from "../lib/logger.js";

import type { Context } from "hono";

/** The env var naming the proxies allowed to say who the client is. */
export const TRUSTED_PROXIES_ENV = "GATEWAY_TRUSTED_PROXIES";

export interface ClientAddress {
  /** A connection, or in-process dispatch (no environment at all). */
  readonly connection: "socket" | "in-process";
  /**
   * The address this request is attributed to. Undefined only when there is
   * no peer address: in-process dispatch, or a connection whose peer cannot
   * be read.
   */
  readonly client: string | undefined;
  /**
   * The X-Forwarded-For chain to send downstream, left to right: the client,
   * any trusted hops after it, then the socket peer. Empty exactly when
   * `client` is undefined.
   */
  readonly forwardedFor: readonly string[];
}

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
export function normalizeAddress(raw: string | undefined): string | undefined {
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

/**
 * The rate-limit bucket for a client address: an IPv4 host, or an IPv6 /64 —
 * the block one subscriber is normally given, so rotating through it mints
 * nothing.
 */
export function clientBucketOf(address: string): string {
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

// ===========================================
// Resolution
// ===========================================

function peerOf(c: Context): {
  connection: ClientAddress["connection"];
  peer: string | undefined;
} {
  // `app.fetch(request)` / `app.request()` with no environment: code in this
  // process, not a connection. Every server adapter passes an environment
  // (@hono/node-server passes the Node request and response), so a request
  // that arrived over the network is never classified here — under any
  // adapter.
  if ((c.env as unknown) === undefined) {
    return { connection: "in-process", peer: undefined };
  }
  try {
    return {
      connection: "socket",
      peer: normalizeAddress(getConnInfo(c).remote.address),
    };
  } catch {
    // An environment without a readable Node socket: a connection whose peer
    // cannot be read, never a pass.
    return { connection: "socket", peer: undefined };
  }
}

/** At most one misconfiguration warning per interval. */
const UNTRUSTED_FORWARD_LOG_INTERVAL_MS = 60_000;
let lastUntrustedForwardLogAt = 0;

/**
 * Says, at most once a minute, that a peer forwarded client addresses while
 * no proxy is trusted — the deployment state in which every client behind
 * the ingress is one client here, sharing one anonymous budget.
 */
function warnUntrustedForward(peer: string): void {
  const now = Date.now();
  if (now - lastUntrustedForwardLogAt < UNTRUSTED_FORWARD_LOG_INTERVAL_MS) {
    return;
  }
  lastUntrustedForwardLogAt = now;
  rateLimitLogger.warn(
    { peer },
    `${TRUSTED_PROXIES_ENV} is unset: X-Forwarded-For is ignored and this peer is counted as one client`,
  );
}

function resolve(c: Context): ClientAddress {
  const { connection, peer } = peerOf(c);
  if (peer === undefined) {
    return { connection, client: undefined, forwardedFor: [] };
  }
  const proxies = trustedProxies();
  const self: ClientAddress = {
    connection,
    client: peer,
    forwardedFor: [peer],
  };
  if (!isTrusted(proxies, peer)) {
    if (proxies.size === 0 && c.req.header("X-Forwarded-For") !== undefined) {
      warnUntrustedForward(peer);
    }
    return self;
  }

  const entries = (c.req.header("X-Forwarded-For") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // The trusted hops walked so far, right to left.
  const hops: string[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const address = normalizeAddress(entries[index]);
    if (address === undefined) {
      // Malformed before a client was reached: nothing to the left of a bad
      // entry can be attributed to anyone, so the peer is counted.
      return self;
    }
    if (!isTrusted(proxies, address)) {
      return {
        connection,
        client: address,
        forwardedFor: [address, ...hops.reverse(), peer],
      };
    }
    hops.push(address);
  }

  const real = normalizeAddress(c.req.header("X-Real-IP"));
  if (real === undefined) {
    return self;
  }
  return {
    connection,
    client: real,
    forwardedFor: [real, ...hops.reverse(), peer],
  };
}

const resolved = new WeakMap<Request, ClientAddress>();

/**
 * The client address of this request, resolved once and shared by the
 * limiter, the trip link and the proxy so all three agree.
 */
export function clientAddressOf(c: Context): ClientAddress {
  const known = resolved.get(c.req.raw);
  if (known !== undefined) {
    return known;
  }
  const result = resolve(c);
  resolved.set(c.req.raw, result);
  return result;
}
