/**
 * A real HTTP server for the client tests: nothing about the transport is
 * mocked, so ETag revalidation, timeouts and refused connections are exercised
 * as they behave in production.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestServer {
  readonly url: string;
  readonly requests: Array<{ method: string; url: string; headers: Record<string, string> }>;
  close(): Promise<void>;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export async function startServer(handler: Handler): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server: Server = createServer((req, res) => {
    requests.push({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : (value ?? "")]),
      ),
    });
    handler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      }),
  };
}

/** A port nothing is listening on, for the unreachable-service cases. */
export async function closedPortUrl(): Promise<string> {
  const server = await startServer((_req, res) => {
    res.end();
  });
  const url = server.url;
  await server.close();
  return url;
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
