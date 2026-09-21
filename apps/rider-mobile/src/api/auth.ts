// Real authentication against user-service THROUGH the api-gateway (C05 / G01).
// Routes (all verified in services/user-service/src/routes/auth.ts and public in
// services/api-gateway/src/middleware/auth.ts PUBLIC_ROUTES):
//   POST /v1/auth/login/otp   { phone }         -> { success, data: { message, expiresIn } }
//   POST /v1/auth/verify-otp  { phone, code }   -> { success, data: { user, tokens } }
//   POST /v1/auth/register    { phone, ... }    -> { success, data: { user, message } }
//   POST /v1/auth/refresh     { refreshToken }  -> { success, data: { tokens } }
//   POST /v1/auth/logout                        -> { success, data }
// Tokens live in the Keychain-backed session store (@ubi/mobile-core session.ts).
// The OTP code is never logged and never sent to analytics.
import { useEffect } from "react";
import {
  api,
  ApiError,
  clearSession,
  loadSession,
  saveSession,
} from "@ubi/mobile-core";

/** user-service wraps every body as { success, data } (UbiError -> { success:false, error }). */
export type Envelope<T> = { success: boolean; data: T };

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires (server-stated). */
  expiresIn: number;
};

export type AuthUser = {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
};

/** Which account role this app serves. A driver account must use UBI Driver. */
export const APP_ROLE = "rider" as const;

/**
 * Refresh ahead of mobile-core's 30s window: session.ts refresh() parses the
 * bare token shape while the server answers the { success, data } envelope, so
 * that path must never run (cross-tree finding, reported for the mobile-core
 * owner). Refreshing whenever less than 10 of the 15 token minutes remain
 * keeps the session comfortably clear of it.
 */
const REFRESH_AHEAD_MS = 10 * 60_000;

const newDeviceId = () =>
  "rnd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/**
 * user-service errors arrive as { success:false, error:{ code, message } };
 * ApiError keeps that body in `details`. Surface the server's own phrasing.
 */
export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as
      | { error?: { code?: string; message?: string } }
      | undefined;
    if (d?.error?.message) return d.error.message;
    if (e.message && !e.message.startsWith("http_")) return e.message;
  }
  return "That didn’t reach the server. Check your connection and try again.";
}

export type VerifyOutcome =
  | { result: "authenticated"; user: AuthUser }
  | { result: "wrong_app"; role: string };

async function adoptTokens(userId: string, tokens: AuthTokens) {
  const existing = await loadSession();
  await saveSession({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId,
    role: APP_ROLE,
    deviceId: existing?.deviceId ?? newDeviceId(),
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  });
}

export const authApi = {
  /** Sends a login code. The server never says whether the number exists. */
  requestOtp: async (phone: string): Promise<{ expiresIn: number }> => {
    const r = await api<Envelope<{ message: string; expiresIn: number }>>(
      "POST",
      "/v1/auth/login/otp",
      { phone },
    );
    return { expiresIn: r.data.expiresIn };
  },

  /** Registers a new rider account, which then verifies via the same OTP path. */
  register: async (input: {
    phone: string;
    firstName: string;
    lastName: string;
    country: string;
  }): Promise<void> => {
    await api<Envelope<{ user: AuthUser; message: string }>>(
      "POST",
      "/v1/auth/register",
      { ...input, role: "RIDER" },
    );
  },

  /**
   * Verifies the code. Success is ONLY the server's { user, tokens } body —
   * the session is persisted before this resolves. A non-rider account is
   * refused here (this app must not carry a driver session).
   */
  verifyOtp: async (phone: string, code: string): Promise<VerifyOutcome> => {
    const r = await api<Envelope<{ user: AuthUser; tokens: AuthTokens }>>(
      "POST",
      "/v1/auth/verify-otp",
      { phone, code },
    );
    const { user, tokens } = r.data;
    if (user.role.toLowerCase() !== APP_ROLE) {
      return { result: "wrong_app", role: user.role.toLowerCase() };
    }
    await adoptTokens(user.id, tokens);
    return { result: "authenticated", user };
  },

  /** Server-side session invalidation first; the local session goes regardless. */
  logout: async (): Promise<void> => {
    try {
      await api("POST", "/v1/auth/logout");
    } catch {
      // The server session expires on its own; the device must still forget.
    } finally {
      await clearSession();
    }
  },
};

export type BootDecision = "authenticated" | "unauthenticated";

async function refreshTokens(): Promise<BootDecision> {
  const s = await loadSession();
  if (!s) return "unauthenticated";
  try {
    const r = await api<Envelope<{ tokens: AuthTokens }>>(
      "POST",
      "/v1/auth/refresh",
      { refreshToken: s.refreshToken },
    );
    await adoptTokens(s.userId, r.data.tokens);
    return "authenticated";
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
      // The server refused the refresh token: the session is dead.
      await clearSession();
      return "unauthenticated";
    }
    // Network failure: keep the stored session; screens render their own
    // offline states rather than logging the person out over a dead radio.
    return "authenticated";
  }
}

/**
 * Cold-start restore (Splash). A stored session of the wrong role is cleared;
 * a near-expiry session is refreshed before any screen depends on it.
 */
export async function restoreSession(): Promise<BootDecision> {
  const s = await loadSession();
  if (!s) return "unauthenticated";
  if (s.role !== APP_ROLE) {
    await clearSession();
    return "unauthenticated";
  }
  if (s.expiresAt - Date.now() < REFRESH_AHEAD_MS) return refreshTokens();
  return "authenticated";
}

/**
 * Foreground token keeper: refreshes well before expiry so no request ever
 * rides on a stale token. Mounted once at the navigation root.
 */
export function useSessionKeeper(intervalMs = 4 * 60_000) {
  useEffect(() => {
    const tick = async () => {
      const s = await loadSession();
      if (s && s.expiresAt - Date.now() < REFRESH_AHEAD_MS) {
        await refreshTokens();
      }
    };
    void tick();
    const t = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}
