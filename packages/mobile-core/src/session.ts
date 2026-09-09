// Secure session. Keychain (iOS) / Keystore-backed (Android) via react-native-keychain. Upgrade bridge from Flutter secure storage documented in MIGRATION_MAP.md.
import * as Keychain from 'react-native-keychain';
const SERVICE = 'ubi.session';
type Session = { accessToken: string; refreshToken: string; userId: string; role: 'rider' | 'driver'; deviceId: string; expiresAt: number };
let cached: Session | undefined;

export async function loadSession(): Promise<Session | undefined> {
  if (cached) return cached;
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  if (!creds) return undefined;
  cached = JSON.parse(creds.password) as Session;
  return cached;
}
export async function saveSession(s: Session) { cached = s; await Keychain.setGenericPassword('session', JSON.stringify(s), { service: SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
export async function clearSession() { cached = undefined; await Keychain.resetGenericPassword({ service: SERVICE }); }
export async function getAccessToken(): Promise<string | undefined> {
  const s = await loadSession();
  if (!s) return undefined;
  if (s.expiresAt - Date.now() < 30_000) { await refresh(); }
  return cached?.accessToken;
}
async function refresh() {
  const s = cached; if (!s) return;
  const res = await fetch('https://api.ubi.africa/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken, deviceId: s.deviceId }) });
  if (!res.ok) { await clearSession(); return; }
  const j = await res.json() as { accessToken: string; refreshToken: string; expiresIn: number };
  await saveSession({ ...s, accessToken: j.accessToken, refreshToken: j.refreshToken, expiresAt: Date.now() + j.expiresIn * 1000 });
}
// Flutter → RN upgrade bridge. Key names must be confirmed from mobile/packages/storage + api_client interceptors during RN-01.
export async function tryImportLegacySession(): Promise<boolean> {
  try {
    const legacy = await Keychain.getGenericPassword({ service: 'flutter_secure_storage_service' }); // TODO(RN-01): exact legacy service/key names
    if (!legacy) return false;
    // Parse legacy payload → Session; on any failure fall back to controlled re-auth (OTP) that restores server-owned state.
    return false;
  } catch { return false; }
}
