/**
 * A real local HTTP server standing in for a supplier's API in contract tests.
 *
 * The adapters under test make genuine `fetch` calls over TCP to it (their
 * `baseUrl` points here, which is only permitted outside production): the
 * request mapping — method, path, query, headers, JSON body — is recorded and
 * asserted exactly, and the responses are the example payloads from the
 * supplier's official documentation (tests/fixtures/supplier-docs), so the
 * response parsing is exercised against the documented shapes. Handlers can
 * delay (a timeout), answer 5xx, or answer from state (an order that exists
 * only after it was created), which is how the ambiguous-booking paths are
 * driven.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

export interface StubResponse {
  readonly status: number;
  readonly body?: unknown;
  /** Delay before answering, to drive client timeouts. */
  readonly delayMs?: number;
}

export type StubHandler = (request: StubRequest) => StubResponse;

interface Route {
  readonly method: string;
  readonly path: RegExp;
  handler: StubHandler;
}

export class SupplierStub {
  readonly requests: StubRequest[] = [];
  private readonly routes: Route[] = [];
  private server: Server | null = null;
  url = "";

  on(method: string, path: RegExp, handler: StubHandler): this {
    const existing = this.routes.find(
      (route) => route.method === method && route.path.source === path.source,
    );
    if (existing !== undefined) {
      existing.handler = handler;
    } else {
      this.routes.push({ method, path, handler });
    }
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.length = 0;
  }

  requestsTo(method: string, path: RegExp): StubRequest[] {
    return this.requests.filter(
      (request) => request.method === method && path.test(request.path),
    );
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        const url = new URL(req.url ?? "/", "http://stub.local");
        const request: StubRequest = {
          method: req.method ?? "GET",
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
        };
        this.requests.push(request);
        const route = this.routes.find(
          (candidate) =>
            candidate.method === request.method &&
            candidate.path.test(request.path),
        );
        const answer: StubResponse =
          route === undefined
            ? {
                status: 599,
                body: { error: "no stub route", path: request.path },
              }
            : route.handler(request);
        const send = (): void => {
          if (res.destroyed) return;
          if (answer.body === undefined) {
            res.writeHead(answer.status);
            res.end();
            return;
          }
          res.writeHead(answer.status, { "content-type": "application/json" });
          res.end(JSON.stringify(answer.body));
        };
        if (answer.delayMs !== undefined) {
          setTimeout(send, answer.delayMs);
        } else {
          send();
        }
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.server = null;
  }
}
