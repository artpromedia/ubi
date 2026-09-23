/**
 * Admin API client — the single network boundary for the growth + ops consoles.
 *
 * A small typed fetch wrapper (same shape as `apps/web-app/src/lib/api-client.ts`)
 * whose `get<T>` / `post<T>` resolve to the decoded, contract-shaped JSON body so
 * callers in `growth-api.ts` get typed values directly. Screens never fetch on
 * their own — they go through `growthApi`, which goes through this client.
 *
 * Auth: the admin bearer token is read at request time. The dashboard stores it
 * under `ubi_admin_token` after login; during SSR/prerender there is no token,
 * which is expected — data loads client-side.
 */

const ADMIN_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface RequestOptions {
  /** Extra headers merged onto the defaults. */
  headers?: Record<string, string>;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /**
   * Sent as the `idempotency-key` header. config-service requires it (min 8
   * chars, url-safe) on mutating routes like PUT /v1/flags/{key} and
   * POST /v1/config/change-requests — omit it and those calls 422.
   */
  idempotencyKey?: string;
}

/**
 * Fresh url-safe idempotency key satisfying the contract's IdempotencyKeySchema
 * (8–64 chars, `[A-Za-z0-9_.:-]`).
 */
export function newIdempotencyKey(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the non-crypto fallback */
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function authToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("ubi_admin_token");
  } catch {
    return null;
  }
}

/**
 * A non-2xx answer, carrying the HTTP status and the canonical error code
 * (`forbidden`, `limited_mode`, `feature_disabled`, …) so a screen can tell
 * "your role cannot see this" from "this device is not verified yet" without
 * reading message text. The message keeps the `"<status> <detail>"` shape the
 * consoles already display.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    detail: string,
  ) {
    super(`${status} ${detail}`);
    this.name = "ApiError";
  }
}

type ErrorShape = { message?: unknown; code?: unknown };

async function decode<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | null = null;
    try {
      // Services answer {code, message}; the gateway wraps it as
      // {success: false, error: {code, message}}.
      const raw = (await res.json()) as ErrorShape & { error?: ErrorShape };
      const body: ErrorShape =
        raw.error !== null && typeof raw.error === "object" ? raw.error : raw;
      if (typeof body.code === "string") {
        code = body.code;
      }
      if (typeof body.message === "string") {
        detail = body.message;
      } else if (code !== null) {
        detail = code;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, detail);
  }
  // 204 / empty body (e.g. void actions) — nothing to decode.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

class AdminApiClient {
  constructor(private readonly baseUrl: string) {}

  private headers(options?: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers,
    };
    if (options?.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }
    const token = authToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async get<T>(url: string, options?: RequestOptions): Promise<T> {
    const res = await fetch(this.baseUrl + url, {
      method: "GET",
      headers: this.headers(options),
      signal: options?.signal,
    });
    return decode<T>(res);
  }

  async post<T>(
    url: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + url, {
      method: "POST",
      headers: this.headers(options),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
    return decode<T>(res);
  }

  async put<T>(
    url: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + url, {
      method: "PUT",
      headers: this.headers(options),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
    return decode<T>(res);
  }
}

export const apiClient = new AdminApiClient(ADMIN_API_URL);

export default apiClient;
