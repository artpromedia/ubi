// Real authentication against user-service THROUGH the api-gateway (CC-B00 / P0-06 / P1-14 / P3-05).
// Routes (verified in services/user-service/src/routes/identity.ts and
// services/api-gateway/src/middleware/auth.ts + src/identity/scopes.ts):
//   GET  /v1/auth/cities      (public)         -> { success, data: { cities } }
//   POST /v1/auth/signup      (public)         -> { success, data: { user, expiresInSeconds } }
//   POST /v1/auth/otp         (public)         -> { success, data: { expiresInSeconds } }
//   POST /v1/auth/verify      (public)         -> { success, data: { user, tokens, citySelectionRequired } }
//   POST /v1/auth/city        (authenticated)  -> { success, data: { cityId, tokens } }
//   POST /v1/auth/refresh     (public)         -> { success, data: { tokens, user? } }
//   POST /v1/auth/logout      (authenticated)  -> { success, data }
// Tokens live in the Keychain-backed session store (@ubi/mobile-core session.ts).
// The OTP code is never logged and never sent to analytics.
import { useEffect } from "react";
import { Platform } from "react-native";
import {
  api,
  ApiError,
  clearSession,
  getOrCreateDeviceId,
  loadSession,
  saveSession,
  unregisterPushDevice,
} from "@ubi/mobile-core";

/** user-service wraps every body as { success, data } (UbiError -> { success:false, error }). */
export type Envelope<T> = { success: boolean; data: T };

export type LaunchedCity = {
  id: string;
  name: string;
  country: string;
  region?: string | null;
  timezone?: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires (server-stated). */
  expiresIn: number;
  mode?: "full" | "limited";
};

export type AuthUser = {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  cityId?: string | null;
  homeCityId?: string | null;
  avatarUrl?: string | null;
};

/** Which account role this app serves. A rider account must use the UBI app. */
export const APP_ROLE = "driver" as const;

const REFRESH_AHEAD_MS = 10 * 60_000;

function currentPlatform(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

export function isCitySelectionRequiredError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "city_selection_required";
}

/**
 * user-service errors arrive as { success:false, error:{ code, message } }.
 * Surface the server's own phrasing.
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
  | { result: "city_required"; user: AuthUser }
  | { result: "wrong_app"; role: string };

async function adoptTokens(
  userId: string,
  tokens: AuthTokens,
  cityId: string | null | undefined,
  explicitDeviceId?: string,
) {
  const existing = await loadSession();
  const deviceId =
    explicitDeviceId ?? existing?.deviceId ?? (await getOrCreateDeviceId());
  await saveSession({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId,
    role: APP_ROLE,
    deviceId,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    cityId: cityId !== undefined ? cityId : existing?.cityId,
    mode: tokens.mode ?? existing?.mode,
  });
}

export const authApi = {
  /** Fetches the launched city catalog from user-service (backed by config-service). */
  listCities: async (): Promise<LaunchedCity[]> => {
    const r = await api<Envelope<{ cities: LaunchedCity[] }>>(
      "GET",
      "/v1/auth/cities",
    );
    return r.data.cities;
  },

  /** Sends a login code. The server never says whether the number exists. */
  requestOtp: async (phone: string): Promise<{ expiresIn: number }> => {
    const r = await api<
      Envelope<{ expiresInSeconds?: number; expiresIn?: number }>
    >("POST", "/v1/auth/otp", { phone, purpose: "login" });
    return {
      expiresIn: r.data.expiresInSeconds ?? r.data.expiresIn ?? 300,
    };
  },

  /** Registers a new driver account in a launched home city and triggers verification OTP. */
  register: async (input: {
    phone: string;
    firstName: string;
    lastName: string;
    cityId: string;
    country?: string;
  }): Promise<void> => {
    await api<Envelope<{ user: AuthUser; expiresInSeconds?: number }>>(
      "POST",
      "/v1/auth/signup",
      {
        phone: input.phone,
        firstName: input.firstName,
        lastName: input.lastName,
        cityId: input.cityId,
        ...(input.country ? { country: input.country } : {}),
        role: "DRIVER",
      },
    );
  },

  /**
   * Verifies the code and enrolls this device (first device on a brand-new
   * account receives full trust per DEC-7). Cityless existing accounts receive
   * `city_required` so the app collects their home city before going online (DEC-8).
   */
  verifyOtp: async (phone: string, code: string): Promise<VerifyOutcome> => {
    const deviceId = await getOrCreateDeviceId();
    const r = await api<
      Envelope<{
        user: AuthUser;
        tokens: AuthTokens;
        citySelectionRequired?: boolean;
      }>
    >("POST", "/v1/auth/verify", {
      phone,
      code,
      deviceId,
      platform: currentPlatform(),
    });
    const { user, tokens, citySelectionRequired } = r.data;
    if (user.role.toLowerCase() !== APP_ROLE) {
      return { result: "wrong_app", role: user.role.toLowerCase() };
    }
    const resolvedCityId = user.cityId ?? user.homeCityId ?? null;
    await adoptTokens(user.id, tokens, resolvedCityId, deviceId);
    if (citySelectionRequired === true || resolvedCityId === null) {
      return { result: "city_required", user };
    }
    return { result: "authenticated", user };
  },

  /** Persists the driver's chosen home city and adopts the re-issued city-bound tokens. */
  selectCity: async (cityId: string): Promise<{ cityId: string }> => {
    const existing = await loadSession();
    const r = await api<Envelope<{ cityId: string; tokens: AuthTokens }>>(
      "POST",
      "/v1/auth/city",
      { cityId },
    );
    if (existing) {
      await adoptTokens(
        existing.userId,
        r.data.tokens,
        r.data.cityId,
        existing.deviceId,
      );
    }
    return { cityId: r.data.cityId };
  },

  /** Deactivate push device token first while access token is still valid, then invalidate session. */
  logout: async (): Promise<void> => {
    const existing = await loadSession();
    try {
      await unregisterPushDevice();
      await api("POST", "/v1/auth/logout", {
        ...(existing?.refreshToken
          ? { refreshToken: existing.refreshToken }
          : {}),
      });
    } catch {
      // The server session expires on its own; the device must still forget.
    } finally {
      await clearSession();
    }
  },
};

export type BootDecision =
  | "authenticated"
  | "city_required"
  | "unauthenticated";

async function refreshTokens(): Promise<BootDecision> {
  const s = await loadSession();
  if (!s) return "unauthenticated";
  try {
    const r = await api<
      Envelope<{
        tokens: AuthTokens;
        user?: { cityId?: string | null; homeCityId?: string | null };
      }>
    >("POST", "/v1/auth/refresh", {
      refreshToken: s.refreshToken,
      deviceId: s.deviceId,
    });
    const nextCityId =
      r.data.user !== undefined
        ? (r.data.user.cityId ?? r.data.user.homeCityId ?? null)
        : s.cityId;
    await adoptTokens(s.userId, r.data.tokens, nextCityId, s.deviceId);
    return nextCityId === null ? "city_required" : "authenticated";
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
      await clearSession();
      return "unauthenticated";
    }
    return s.cityId === null ? "city_required" : "authenticated";
  }
}

/**
 * Cold-start restore (Splash). A stored session of the wrong role is cleared;
 * a near-expiry session is refreshed before any screen depends on it; a
 * cityless session lands on CityPicker before Main.
 */
export async function restoreSession(): Promise<BootDecision> {
  const s = await loadSession();
  if (!s) return "unauthenticated";
  if (s.role !== APP_ROLE) {
    await clearSession();
    return "unauthenticated";
  }
  if (s.expiresAt - Date.now() < REFRESH_AHEAD_MS) return refreshTokens();
  return s.cityId === null ? "city_required" : "authenticated";
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
