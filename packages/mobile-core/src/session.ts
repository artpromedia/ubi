// Secure session. Keychain (iOS) / Keystore-backed (Android) via react-native-keychain. Upgrade bridge from Flutter secure storage documented in MIGRATION_MAP.md.
import * as Keychain from "react-native-keychain";
import { getApiBaseUrl, invokeFixture } from "./api";

const SERVICE = "ubi.session";
const DEVICE_SERVICE = "ubi.device";

export type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: "rider" | "driver";
  deviceId: string;
  expiresAt: number;
  cityId?: string | null;
  mode?: "full" | "limited";
};

let cached: Session | undefined;
let cachedDeviceId: string | undefined;

function generateDeviceId(): string {
  return (
    "rnd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Stable per-installation device identifier stored in Keychain so signing out
 * and signing back in on the same device keeps its trusted device record.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cached?.deviceId) {
    cachedDeviceId = cached.deviceId;
    return cached.deviceId;
  }
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const creds = await Keychain.getGenericPassword({
      service: DEVICE_SERVICE,
    });
    if (creds && creds.password) {
      cachedDeviceId = creds.password;
      return cachedDeviceId;
    }
  } catch {
    // Fall through to minting an installation id.
  }
  const next = generateDeviceId();
  cachedDeviceId = next;
  try {
    await Keychain.setGenericPassword("device", next, {
      service: DEVICE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Keep in-memory fallback when Keychain is unavailable.
  }
  return next;
}

export async function loadSession(): Promise<Session | undefined> {
  if (cached) return cached;
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  if (!creds) return undefined;
  cached = JSON.parse(creds.password) as Session;
  return cached;
}
export async function saveSession(s: Session) {
  cached = s;
  cachedDeviceId = s.deviceId;
  await Keychain.setGenericPassword("session", JSON.stringify(s), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function clearSession() {
  cached = undefined;
  await Keychain.resetGenericPassword({ service: SERVICE });
}
export async function getAccessToken(): Promise<string | undefined> {
  const s = await loadSession();
  if (!s) return undefined;
  if (s.expiresAt - Date.now() < 30_000) {
    await refresh();
  }
  return cached?.accessToken;
}

type RefreshTokenShape = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mode?: "full" | "limited";
};

type RefreshResponseShape = RefreshTokenShape & {
  tokens?: RefreshTokenShape;
  user?: { cityId?: string | null; homeCityId?: string | null };
  data?: {
    tokens?: RefreshTokenShape;
    user?: { cityId?: string | null; homeCityId?: string | null };
  };
};

function extractRefreshPayload(raw: unknown): {
  tokens: RefreshTokenShape | undefined;
  cityId: string | null | undefined;
} {
  const body = (raw ?? {}) as RefreshResponseShape;
  const tokens =
    body.data?.tokens ??
    body.tokens ??
    (typeof body.accessToken === "string" &&
    typeof body.refreshToken === "string" &&
    typeof body.expiresIn === "number"
      ? body
      : undefined);
  const user = body.data?.user ?? body.user;
  const cityId =
    user !== undefined ? (user.cityId ?? user.homeCityId ?? null) : undefined;
  return { tokens, cityId };
}

async function refresh() {
  const s = cached;
  if (!s) return;
  const path = "/v1/auth/refresh";
  const reqBody = {
    refreshToken: s.refreshToken,
    deviceId: s.deviceId,
  };

  const fixture = await invokeFixture({
    method: "POST",
    path,
    body: reqBody,
  });
  if (fixture) {
    if (fixture.status >= 400) {
      await clearSession();
      return;
    }
    const { tokens, cityId } = extractRefreshPayload(fixture.json);
    if (!tokens) {
      await clearSession();
      return;
    }
    await saveSession({
      ...s,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      cityId: cityId !== undefined ? cityId : s.cityId,
      mode: tokens.mode ?? s.mode,
    });
    return;
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    await clearSession();
    return;
  }
  const { tokens, cityId } = extractRefreshPayload(await res.json());
  if (!tokens) {
    await clearSession();
    return;
  }
  await saveSession({
    ...s,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    cityId: cityId !== undefined ? cityId : s.cityId,
    mode: tokens.mode ?? s.mode,
  });
}
// Flutter → RN upgrade bridge. Key names must be confirmed from mobile/packages/storage + api_client interceptors during RN-01.
export async function tryImportLegacySession(): Promise<boolean> {
  try {
    const legacy = await Keychain.getGenericPassword({
      service: "flutter_secure_storage_service",
    }); // TODO(RN-01): exact legacy service/key names
    if (!legacy) return false;
    // Parse legacy payload → Session; on any failure fall back to controlled re-auth (OTP) that restores server-owned state.
    return false;
  } catch {
    return false;
  }
}
