// Push device registration, token refresh, sign-out unregistration, permission
// state, and ids-only deep-link routing (CC-B04 / P1-13).
//
// Security & UX invariants:
// 1. Permission is requested ONLY after authentication (`usePushLifecycle({ enabled: true })`
//    mounts inside `MainTabs`, never on Splash/Onboarding/Auth).
// 2. Device registration crosses api-gateway at `POST /v1/push/devices` (exact
//    route, `Idempotency-Key` attached automatically by `api()`), and sign-out
//    calls `DELETE /v1/push/devices` BEFORE `POST /v1/auth/logout` and
//    `clearSession()` so the server deactivates the caller's token while the
//    access token is still valid.
// 3. Push `data` payloads are treated strictly as ids-only hints
//    (`PUSH_HINT_DATA_KEYS`: `kind`, `name`, `subjectType`, `subjectId`,
//    `requestId`, `seq`); money, names, phones, and PINs are never read from
//    notification payloads.
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import { api } from "./api";
import { loadSession } from "./session";

export type PushPermissionState =
  | "authorized"
  | "provisional"
  | "denied"
  | "not_determined"
  | "unavailable";

export interface RemotePushMessage {
  readonly messageId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface PushMessagingAdapter {
  hasPermission(): Promise<PushPermissionState>;
  requestPermission(): Promise<PushPermissionState>;
  getToken(): Promise<string | null>;
  onTokenRefresh(listener: (token: string) => void): () => void;
  getInitialNotification(): Promise<RemotePushMessage | null>;
  onNotificationOpenedApp(
    listener: (message: RemotePushMessage) => void,
  ): () => void;
}

/** Structural contract satisfied by `@react-native-firebase/messaging` instance. */
export interface FirebaseMessagingLike {
  hasPermission(): Promise<number>;
  requestPermission(): Promise<number>;
  registerDeviceForRemoteMessages?(): Promise<void>;
  getToken(): Promise<string>;
  onTokenRefresh(listener: (token: string) => void): () => void;
  getInitialNotification(): Promise<RemotePushMessage | null>;
  onNotificationOpenedApp(
    listener: (message: RemotePushMessage) => void,
  ): () => void;
}

export const PUSH_HINT_DATA_KEYS = [
  "kind",
  "name",
  "subjectType",
  "subjectId",
  "requestId",
  "seq",
] as const;

export type PushHintKey = (typeof PUSH_HINT_DATA_KEYS)[number];
export type PushHintData = Partial<Record<PushHintKey, string>>;

// @react-native-firebase/messaging AuthorizationStatus numeric values:
// -1 = NOT_DETERMINED, 0 = DENIED, 1 = AUTHORIZED, 2 = PROVISIONAL, 3 = EPHEMERAL.
function mapFirebaseAuthStatus(status: number): PushPermissionState {
  if (status === 1 || status === 3) return "authorized";
  if (status === 2) return "provisional";
  if (status === 0) return "denied";
  if (status === -1) return "not_determined";
  return "unavailable";
}

function isAndroid13Plus(): boolean {
  return (
    Platform.OS === "android" &&
    typeof Platform.Version === "number" &&
    Platform.Version >= 33
  );
}

/**
 * Wraps `@react-native-firebase/messaging` (plus Android 13+ `POST_NOTIFICATIONS`
 * runtime permission) into a `PushMessagingAdapter`. Degrades cleanly to
 * `"unavailable"` when native Firebase is unconfigured (e.g., local Jest /
 * unsigned debug without `google-services.json`).
 */
export function createFirebaseMessagingAdapter(
  getMessaging: () => FirebaseMessagingLike,
): PushMessagingAdapter {
  return {
    async hasPermission(): Promise<PushPermissionState> {
      try {
        if (isAndroid13Plus()) {
          const granted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          return granted ? "authorized" : "denied";
        }
        const status = await getMessaging().hasPermission();
        return mapFirebaseAuthStatus(status);
      } catch {
        return "unavailable";
      }
    },
    async requestPermission(): Promise<PushPermissionState> {
      try {
        if (isAndroid13Plus()) {
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          return result === PermissionsAndroid.RESULTS.GRANTED
            ? "authorized"
            : "denied";
        }
        const status = await getMessaging().requestPermission();
        return mapFirebaseAuthStatus(status);
      } catch {
        return "unavailable";
      }
    },
    async getToken(): Promise<string | null> {
      try {
        const messaging = getMessaging();
        if (
          Platform.OS === "ios" &&
          messaging.registerDeviceForRemoteMessages
        ) {
          await messaging.registerDeviceForRemoteMessages();
        }
        const token = await messaging.getToken();
        return typeof token === "string" && token.trim().length > 0
          ? token.trim()
          : null;
      } catch {
        return null;
      }
    },
    onTokenRefresh(listener: (token: string) => void): () => void {
      try {
        return getMessaging().onTokenRefresh(listener);
      } catch {
        return () => {};
      }
    },
    async getInitialNotification(): Promise<RemotePushMessage | null> {
      try {
        return await getMessaging().getInitialNotification();
      } catch {
        return null;
      }
    },
    onNotificationOpenedApp(
      listener: (message: RemotePushMessage) => void,
    ): () => void {
      try {
        return getMessaging().onNotificationOpenedApp(listener);
      } catch {
        return () => {};
      }
    },
  };
}

const unavailableAdapter: PushMessagingAdapter = {
  hasPermission: async () => "unavailable",
  requestPermission: async () => "unavailable",
  getToken: async () => null,
  onTokenRefresh: () => () => {},
  getInitialNotification: async () => null,
  onNotificationOpenedApp: () => () => {},
};

let activeAdapter: PushMessagingAdapter = unavailableAdapter;
let lastRegisteredKey: string | null = null;
let lastRegisteredToken: string | null = null;
const handledInitialMessageIds = new Set<string>();
const permissionListeners = new Set<(state: PushPermissionState) => void>();
let cachedPermissionState: PushPermissionState = "not_determined";

function publishPermissionState(next: PushPermissionState) {
  cachedPermissionState = next;
  permissionListeners.forEach((fn) => fn(next));
}

export function setPushMessagingAdapter(adapter: PushMessagingAdapter): void {
  activeAdapter = adapter;
}

export function getPushMessagingAdapter(): PushMessagingAdapter {
  return activeAdapter;
}

/** Test-only reset for in-memory registration dedupe and permission cache. */
export function resetPushStateForTests(): void {
  activeAdapter = unavailableAdapter;
  lastRegisteredKey = null;
  lastRegisteredToken = null;
  handledInitialMessageIds.clear();
  cachedPermissionState = "not_determined";
  permissionListeners.clear();
}

function currentPlatform(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function isPermissionAllowed(state: PushPermissionState): boolean {
  return state === "authorized" || state === "provisional";
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  const state = await activeAdapter.hasPermission();
  publishPermissionState(state);
  return state;
}

export type PushSyncResult =
  | { status: "registered"; token: string; permission: PushPermissionState }
  | {
      status: "already_registered";
      token: string;
      permission: PushPermissionState;
    }
  | { status: "permission_off"; permission: PushPermissionState }
  | { status: "no_token"; permission: PushPermissionState }
  | { status: "unauthenticated" };

/**
 * Synchronises the current signed-in session's FCM token with
 * `POST /v1/push/devices` via api-gateway.
 */
export async function syncPushRegistration(
  options: {
    requestPermission?: boolean;
    explicitToken?: string;
    appVersion?: string;
  } = {},
): Promise<PushSyncResult> {
  const session = await loadSession();
  if (!session) {
    return { status: "unauthenticated" };
  }

  const permission =
    options.requestPermission !== false
      ? await activeAdapter.requestPermission()
      : await activeAdapter.hasPermission();
  publishPermissionState(permission);

  if (!isPermissionAllowed(permission)) {
    return { status: "permission_off", permission };
  }

  const token =
    options.explicitToken?.trim() || (await activeAdapter.getToken());
  if (!token) {
    return { status: "no_token", permission };
  }

  const registrationKey = `${session.userId}:${token}`;
  if (lastRegisteredKey === registrationKey) {
    lastRegisteredToken = token;
    return { status: "already_registered", token, permission };
  }

  await api<{ success: boolean; data?: { flushed?: number } }>(
    "POST",
    "/v1/push/devices",
    {
      token,
      platform: currentPlatform(),
      deviceId: session.deviceId,
      ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    },
    { idempotent: true },
  );

  lastRegisteredKey = registrationKey;
  lastRegisteredToken = token;
  return { status: "registered", token, permission };
}

/**
 * Deactivates the device's push token on sign-out BEFORE the access token is
 * revoked or cleared locally. Best-effort: network errors never block sign-out.
 */
export async function unregisterPushDevice(): Promise<void> {
  const session = await loadSession();
  const token = lastRegisteredToken ?? (await activeAdapter.getToken());
  lastRegisteredKey = null;
  lastRegisteredToken = null;

  if (!session || !token) {
    return;
  }

  try {
    await api("DELETE", "/v1/push/devices", { token }, { idempotent: true });
  } catch {
    // Sign-out must never fail if the device is offline; server token rotation
    // or invalid-token cleanup will deactivate stale tokens automatically.
  }
}

/**
 * Extracts ONLY the whitelisted ids-only hint keys (`PUSH_HINT_DATA_KEYS`) from
 * a remote notification's `data` dictionary.
 */
export function extractPushHint(
  rawData: Readonly<Record<string, unknown>> | undefined,
): PushHintData {
  if (!rawData) return {};
  const out: PushHintData = {};
  for (const key of PUSH_HINT_DATA_KEYS) {
    const val = rawData[key];
    if (typeof val === "string" && val.length > 0) {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Maps an ids-only notification hint to a deep-link URL matching each app's
 * React Navigation `linking` config (`ubi://...` for rider, `ubidriver://...`
 * for driver). Returns `null` when the hint carries no actionable target.
 */
export function resolvePushDeepLink(
  rawData: Readonly<Record<string, unknown>> | undefined,
  role: "rider" | "driver",
): string | null {
  const hint = extractPushHint(rawData);
  const { kind, name = "", subjectId, requestId } = hint;
  if (!kind && !name) {
    return null;
  }

  if (role === "rider") {
    if (kind === "airport_transfer" || name.startsWith("reservation.")) {
      return subjectId
        ? `ubi://travel/transfers/${encodeURIComponent(subjectId)}`
        : "ubi://travel";
    }
    if (kind === "delivery" || name.startsWith("shipment.")) {
      return subjectId
        ? `ubi://home/marketplace/delivery/${encodeURIComponent(subjectId)}/return`
        : "ubi://home/delivery";
    }
    if (name.startsWith("mp.scheduled_request.")) {
      return subjectId
        ? `ubi://home/marketplace/later/scheduled/${encodeURIComponent(subjectId)}`
        : "ubi://home/marketplace/later";
    }
    if (name.startsWith("mp.advance_booking.")) {
      return subjectId
        ? `ubi://home/marketplace/later/bookings/${encodeURIComponent(subjectId)}`
        : "ubi://home/marketplace/later";
    }
    if (
      (name === "mp.bid.submitted" ||
        name === "mp.request.opened_to_market" ||
        name === "mp.request.closed") &&
      requestId
    ) {
      return `ubi://home/marketplace/${encodeURIComponent(requestId)}/offers`;
    }
    if (name.startsWith("mp.queue.") && requestId) {
      return `ubi://home/marketplace/${encodeURIComponent(requestId)}/queued`;
    }
    if (name === "mp.settlement.posted" && requestId) {
      return `ubi://home/marketplace/${encodeURIComponent(requestId)}/receipt`;
    }
    if (requestId) {
      return `ubi://home/marketplace/${encodeURIComponent(requestId)}/trip`;
    }
    return "ubi://activity";
  }

  // Driver (`ubidriver://`)
  if (name === "mp.advance_booking.activated") {
    return "ubidriver://jobs";
  }
  if (name.startsWith("mp.advance_booking.")) {
    return "ubidriver://calendar";
  }
  if (name === "mp.bid.won") {
    return "ubidriver://jobs";
  }
  if (name === "mp.bid.lost") {
    return "ubidriver://requests";
  }
  if (
    (name === "mp.request.preferred_driver_invited" ||
      name === "mp.request.preferred_driver_declined") &&
    requestId
  ) {
    return `ubidriver://requests/${encodeURIComponent(requestId)}`;
  }
  if (name.startsWith("mp.amendment.") && requestId) {
    return `ubidriver://trips/${encodeURIComponent(requestId)}/amendments`;
  }
  if (name.startsWith("mp.stop.") && requestId) {
    return `ubidriver://trips/${encodeURIComponent(requestId)}`;
  }
  if (name === "mp.settlement.posted") {
    return "ubidriver://earnings/payouts";
  }
  if (requestId) {
    return `ubidriver://requests/${encodeURIComponent(requestId)}`;
  }
  return "ubidriver://home";
}

/**
 * Post-sign-in push lifecycle hook. Mounted inside `MainTabs` so unauthenticated
 * users are never prompted for notification permission on cold launch.
 */
export function usePushLifecycle(options: {
  enabled: boolean;
  role: "rider" | "driver";
  appVersion?: string;
  onDeepLink?: (url: string) => void;
}): void {
  const { enabled, role, appVersion, onDeepLink } = options;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const dispatchDeepLink = (msg: RemotePushMessage | null) => {
      if (cancelled || !msg) return;
      const url = resolvePushDeepLink(msg.data, role);
      if (!url) return;
      if (onDeepLink) {
        onDeepLink(url);
      } else {
        void Linking.openURL(url).catch(() => undefined);
      }
    };

    void syncPushRegistration({ requestPermission: true, appVersion }).catch(
      () => undefined,
    );

    void activeAdapter
      .getInitialNotification()
      .then((initial) => {
        if (!initial) return;
        const dedupeKey =
          initial.messageId ?? JSON.stringify(extractPushHint(initial.data));
        if (handledInitialMessageIds.has(dedupeKey)) return;
        handledInitialMessageIds.add(dedupeKey);
        dispatchDeepLink(initial);
      })
      .catch(() => undefined);

    const unsubRefresh = activeAdapter.onTokenRefresh((nextToken) => {
      if (cancelled || !nextToken) return;
      void syncPushRegistration({
        requestPermission: false,
        explicitToken: nextToken,
        appVersion,
      }).catch(() => undefined);
    });

    const unsubOpened = activeAdapter.onNotificationOpenedApp((msg) => {
      dispatchDeepLink(msg);
    });

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && !cancelled) {
        void syncPushRegistration({
          requestPermission: false,
          appVersion,
        }).catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
      unsubRefresh();
      unsubOpened();
      appStateSub.remove();
    };
  }, [enabled, role, appVersion, onDeepLink]);
}

/**
 * Exposes live OS push permission state so Account/Profile screens can show an
 * honest "Notifications are off" notice with an "Open settings" action when the
 * user has denied notifications, and automatically refreshes when returning
 * from OS Settings (`AppState === "active"`).
 */
export function usePushPermissionBanner(): {
  permissionState: PushPermissionState;
  isOff: boolean;
  openSettings: () => Promise<void>;
  refresh: () => Promise<PushPermissionState>;
} {
  const [permissionState, setPermissionState] = useState<PushPermissionState>(
    cachedPermissionState,
  );

  const refresh = useCallback(async () => {
    const next = await getPushPermissionState();
    setPermissionState(next);
    return next;
  }, []);

  useEffect(() => {
    const listener = (next: PushPermissionState) => {
      setPermissionState(next);
    };
    permissionListeners.add(listener);
    void refresh();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    return () => {
      permissionListeners.delete(listener);
      sub.remove();
    };
  }, [refresh]);

  const openSettings = useCallback(async () => {
    await Linking.openSettings();
  }, []);

  return {
    permissionState,
    isOff: permissionState === "denied",
    openSettings,
    refresh,
  };
}
