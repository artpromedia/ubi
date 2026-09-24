/**
 * Fleet portal API client — the single network boundary.
 *
 * The same shape as the admin dashboard's client
 * (apps/admin-dashboard/src/lib/api-client.ts): a small typed fetch wrapper
 * whose methods resolve to the decoded JSON body. Screens never fetch on
 * their own — they go through `fleet-api.ts`, which goes through this client.
 *
 * Every request goes to the API gateway (`/v1/fleets…`, proxied to
 * fleet-service) with the signed-in staff member's bearer token, read at
 * request time from `fleet_token`. The gateway turns it into the signed
 * identity fleet-service verifies; fleet-service then decides the caller's
 * role INSIDE the fleet. During SSR there is no token, which is expected —
 * data loads client-side.
 *
 * Every state-changing call carries an `idempotency-key`; the caller owns
 * the key (see `idempotency.ts`) so a retry after an unknown outcome re-sends
 * the SAME key and cannot apply twice.
 */

export const FLEET_TOKEN_KEY = "fleet_token";

const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Sent as `idempotency-key` (8–64 url-safe chars). */
  readonly idempotencyKey?: string;
}

/**
 * A non-2xx answer with the HTTP status, the canonical error `code`
 * (`feature_disabled`, `forbidden`, `needs_resolution`, `shift_overlap`, …)
 * and the server's `details`, so a screen branches on `code` and renders the
 * server's own facts (an overlapping shift, the city cap, the bookings that
 * block a maintenance block) — never on message text.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly detail: string,
    readonly details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(`${status} ${detail}`);
    this.name = "ApiError";
  }
}

type ErrorShape = { message?: unknown; code?: unknown; details?: unknown };

export async function decodeResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | null = null;
    let details: Record<string, unknown> | null = null;
    try {
      // Services answer {code, message, details}; the gateway wraps its own
      // refusals as {success: false, error: {code, message, details}}.
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
      if (body.details !== null && typeof body.details === "object") {
        details = body.details as Record<string, unknown>;
      }
    } catch {
      /* a non-JSON error body */
    }
    throw new ApiError(res.status, code, detail, details);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function storedToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(FLEET_TOKEN_KEY);
  } catch {
    return null;
  }
}

export interface FleetApiClientConfig {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly token?: () => string | null;
}

export interface FleetApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
}

export function createFleetApiClient(
  config: FleetApiClientConfig = {},
): FleetApiClient {
  const baseUrl = config.baseUrl ?? DEFAULT_API_URL;
  const token = config.token ?? storedToken;
  const send = <T>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<T> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.idempotencyKey !== undefined) {
      headers["idempotency-key"] = options.idempotencyKey;
    }
    const bearer = token();
    if (bearer !== null && bearer.length > 0) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    const doFetch = config.fetch ?? fetch;
    return doFetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
      // Fleet data names drivers and vehicles: never served from a cache.
      cache: "no-store",
    }).then((res) => decodeResponse<T>(res));
  };
  return {
    get: (path, options) => send("GET", path, undefined, options),
    post: (path, body, options) => send("POST", path, body, options),
    put: (path, body, options) => send("PUT", path, body, options),
    patch: (path, body, options) => send("PATCH", path, body, options),
  };
}

export const apiClient = createFleetApiClient();
