// One-time pickup-PIN vault (C05 secure-handling rule). The marketplace select
// response reveals the PIN exactly once (idempotent replays and award GETs
// never carry it — src/api/marketplace.ts), so process death would otherwise
// lose it for good. It is held ONLY in the device Keychain under its own
// service: never in MMKV/AsyncStorage, never logged, never sent to analytics.
// Cleared the moment the ride leaves the pre-trip states.
import * as Keychain from "react-native-keychain";

const SERVICE = "ubi.rider.pickupPin";

export async function storePickupPin(
  rideId: string,
  pin: string,
): Promise<void> {
  try {
    await Keychain.setGenericPassword(rideId, pin, {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Keychain refusal only costs death-recovery of the on-screen PIN.
  }
}

export async function loadPickupPin(rideId: string): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (creds && creds.username === rideId) return creds.password;
    return null;
  } catch {
    return null;
  }
}

export async function clearPickupPin(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // Already gone or locked; the PIN expires server-side with the ride anyway.
  }
}
