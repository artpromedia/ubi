/**
 * Shared helpers for the gateway tests: a real upstream service to proxy to,
 * and real client tokens signed with the same secret the gateway verifies.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

import * as jose from "jose";

import { CLIENT_JWT_SECRET } from "./env";

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
}

export interface Upstream {
  readonly url: string;
  readonly received: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * A real HTTP server standing in for a downstream service. It echoes back every
 * header it was given, which is how the forged-header tests observe exactly
 * what crossed the wire.
 */
export async function startUpstream(): Promise<Upstream> {
  const received: RecordedRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(",");
    }
    received.push({ method: req.method ?? "GET", url: req.url ?? "/", headers });

    // Drain the body so keep-alive sockets do not stall.
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { receivedHeaders: headers } }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface TokenClaims {
  readonly sub: string;
  readonly role: string;
  readonly email?: string;
  readonly permissions?: readonly string[];
  readonly scopes?: readonly string[];
  readonly mode?: "full" | "limited";
  readonly cityId?: string;
  readonly sid?: string;
  readonly deviceId?: string;
}

/** A client access token, signed exactly the way user-service signs one. */
export async function clientToken(claims: TokenClaims): Promise<string> {
  const secret = new TextEncoder().encode(CLIENT_JWT_SECRET);
  const payload: Record<string, unknown> = {
    email: claims.email ?? `${claims.sub}@example.test`,
    role: claims.role,
    permissions: [...(claims.permissions ?? [])],
  };
  if (claims.scopes !== undefined) payload.scopes = [...claims.scopes];
  if (claims.mode !== undefined) payload.mode = claims.mode;
  if (claims.cityId !== undefined) payload.cityId = claims.cityId;
  if (claims.sid !== undefined) payload.sid = claims.sid;
  if (claims.deviceId !== undefined) payload.deviceId = claims.deviceId;

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer("ubi.africa")
    .setAudience("ubi-api")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

/** A store that answers "no safe mode" for everyone. */
export const openRiskStore = {
  get: async (): Promise<string | null> => null,
};

/** A store that puts one user in safe mode until the given instant. */
export function safeModeStore(userId: string, until: Date) {
  return {
    get: async (key: string): Promise<string | null> =>
      key === `ubi:identity:safe_mode:${userId}` ? until.toISOString() : null,
  };
}

/** A store that is down. Every read must fail closed. */
export const brokenRiskStore = {
  get: async (): Promise<string | null> => {
    throw new Error("redis unreachable");
  },
};
