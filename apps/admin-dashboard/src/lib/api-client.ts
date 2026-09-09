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
}

function authToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("ubi_admin_token");
  } catch {
    return null;
  }
}

async function decode<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      detail = body.message ?? body.code ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${res.status} ${detail}`);
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

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    const token = authToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async get<T>(url: string, options?: RequestOptions): Promise<T> {
    const res = await fetch(this.baseUrl + url, {
      method: "GET",
      headers: this.headers(options?.headers),
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
      headers: this.headers(options?.headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
    return decode<T>(res);
  }
}

export const apiClient = new AdminApiClient(ADMIN_API_URL);

export default apiClient;
