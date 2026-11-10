// Rider push registration, token rotation, logout deactivation, ids-only deep
// linking, and permission-denied Profile notice (CC-B04 / P1-13).
// NOTE: Native FCM SDK delivery is substituted with a clearly labeled mock
// PushMessagingAdapter here because Jest runs in Node without a real Firebase
// project or physical/emulator device (EXT-06).
import React from "react";
import { Linking, View } from "react-native";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { IdempotencyKeySchema } from "@ubi/contracts";
import {
  clearSession,
  configureApi,
  extractPushHint,
  resetPushStateForTests,
  resolvePushDeepLink,
  saveSession,
  setPushMessagingAdapter,
  usePushLifecycle,
  type PushMessagingAdapter,
  type PushPermissionState,
  type RemotePushMessage,
} from "@ubi/mobile-core";
import { authApi } from "../src/api/auth";
import { ProfileScreen } from "../src/screens/account/ProfileScreen";
import { clearClients, renderApp } from "./helpers/render";
import { installWire } from "./helpers/wire";

const mockNavigate = jest.fn();
const mockReset = jest.fn();
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: mockNavigate,
    reset: mockReset,
    getParent: () => ({
      navigate: mockNavigate,
      reset: mockReset,
      getParent: () => ({ navigate: mockNavigate, reset: mockReset }),
    }),
  }),
  useRoute: () => ({ params: {} }),
}));

function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

function createMockPushAdapter(
  options: {
    permission?: PushPermissionState;
    token?: string | null;
    initialNotification?: RemotePushMessage | null;
  } = {},
) {
  let permission: PushPermissionState = options.permission ?? "authorized";
  let currentToken: string | null =
    options.token !== undefined ? options.token : "fcm_rider_tok_1";
  const refreshListeners = new Set<(t: string) => void>();
  const openedListeners = new Set<(m: RemotePushMessage) => void>();

  const adapter: PushMessagingAdapter = {
    hasPermission: jest.fn(async () => permission),
    requestPermission: jest.fn(async () => permission),
    getToken: jest.fn(async () => currentToken),
    onTokenRefresh: jest.fn((fn) => {
      refreshListeners.add(fn);
      return () => refreshListeners.delete(fn);
    }),
    getInitialNotification: jest.fn(
      async () => options.initialNotification ?? null,
    ),
    onNotificationOpenedApp: jest.fn((fn) => {
      openedListeners.add(fn);
      return () => openedListeners.delete(fn);
    }),
  };

  return {
    adapter,
    setPermission(next: PushPermissionState) {
      permission = next;
    },
    emitTokenRefresh(nextToken: string) {
      currentToken = nextToken;
      refreshListeners.forEach((fn) => fn(nextToken));
    },
    emitNotificationOpened(msg: RemotePushMessage) {
      openedListeners.forEach((fn) => fn(msg));
    },
  };
}

function PushHost({ enabled }: { enabled: boolean }) {
  usePushLifecycle({ enabled, role: "rider", appVersion: "1.0.0" });
  return <View testID="push-host" />;
}

beforeEach(async () => {
  resetPushStateForTests();
  await clearSession();
  configureApi({ baseUrl: "http://gateway.test" });
});

afterEach(async () => {
  clearClients();
  resetPushStateForTests();
  await clearSession();
  mockNavigate.mockReset();
  mockReset.mockReset();
  jest.restoreAllMocks();
});

describe("Rider push lifecycle & deep linking (CC-B04)", () => {
  it("never requests permission or posts while unauthenticated, then registers POST /v1/push/devices with Idempotency-Key after sign-in and rotates on token refresh", async () => {
    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_rider_tok_1",
    });
    setPushMessagingAdapter(mockPush.adapter);

    const wire = installWire((call) => {
      if (call.method === "POST" && call.path === "/v1/push/devices") {
        return {
          status: 200,
          json: {
            success: true,
            data: { device: { id: "dev_row_1" }, flushed: 0 },
          },
        };
      }
      return undefined;
    });

    // Cold launch while signed out (Splash / Onboarding / Auth): enabled=false.
    const unauthView = renderApp(
      <PushHost enabled={false} />,
      makeTestQueryClient(),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockPush.adapter.requestPermission).not.toHaveBeenCalled();
    expect(wire.writes()).toHaveLength(0);
    unauthView.unmount();

    // Signed-in session enters MainTabs (enabled=true).
    await saveSession({
      accessToken: "rider-access-1",
      refreshToken: "rider-refresh-1",
      userId: "usr_rider_1",
      role: "rider",
      deviceId: "device_ios_1",
      cityId: "LOS",
      expiresAt: Date.now() + 900_000,
    });

    const authedView = renderApp(<PushHost enabled />, makeTestQueryClient());

    await waitFor(() => {
      expect(
        wire.calls.filter(
          (c) => c.method === "POST" && c.path === "/v1/push/devices",
        ),
      ).toHaveLength(1);
    });

    const firstReg = wire.calls.find(
      (c) => c.method === "POST" && c.path === "/v1/push/devices",
    );
    expect(firstReg).toBeDefined();
    expect(mockPush.adapter.requestPermission).toHaveBeenCalledTimes(1);
    expect(firstReg?.headers.authorization).toBe("Bearer rider-access-1");
    expect(
      IdempotencyKeySchema.safeParse(firstReg?.headers["Idempotency-Key"])
        .success,
    ).toBe(true);
    expect(firstReg?.body).toEqual({
      token: "fcm_rider_tok_1",
      platform: "ios",
      deviceId: "device_ios_1",
      appVersion: "1.0.0",
    });

    // Token refresh rotates registration with the new token.
    await act(async () => {
      mockPush.emitTokenRefresh("fcm_rider_tok_rotated_2");
    });

    await waitFor(() => {
      expect(
        wire.calls.filter(
          (c) => c.method === "POST" && c.path === "/v1/push/devices",
        ),
      ).toHaveLength(2);
    });
    const secondReg = wire.calls.filter(
      (c) => c.method === "POST" && c.path === "/v1/push/devices",
    )[1];
    expect(secondReg?.body).toMatchObject({
      token: "fcm_rider_tok_rotated_2",
      deviceId: "device_ios_1",
    });
    authedView.unmount();
  });

  it("deactivates the push token via DELETE /v1/push/devices BEFORE POST /v1/auth/logout and clears session", async () => {
    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_rider_logout_tok",
    });
    setPushMessagingAdapter(mockPush.adapter);

    await saveSession({
      accessToken: "rider-access-logout",
      refreshToken: "rider-refresh-logout",
      userId: "usr_rider_1",
      role: "rider",
      deviceId: "device_ios_1",
      cityId: "LOS",
      expiresAt: Date.now() + 900_000,
    });

    const wire = installWire((call) => {
      if (call.method === "DELETE" && call.path === "/v1/push/devices") {
        return { status: 200, json: { success: true } };
      }
      if (call.method === "POST" && call.path === "/v1/auth/logout") {
        return { status: 200, json: { success: true } };
      }
      return undefined;
    });

    await authApi.logout();

    const writes = wire.writes();
    const writeOrder = writes.map((c) => `${c.method} ${c.path}`);
    expect(writeOrder).toEqual([
      "DELETE /v1/push/devices",
      "POST /v1/auth/logout",
    ]);
    expect(writes[0]?.headers.authorization).toBe("Bearer rider-access-logout");
    expect(writes[0]?.body).toEqual({ token: "fcm_rider_logout_tok" });
  });

  it("treats push payloads strictly as ids-only hints and opens matching ubi:// routes on cold and warm tap", async () => {
    const openUrlSpy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as never);

    // Non-whitelisted PII/money keys are stripped by extractPushHint.
    expect(
      extractPushHint({
        kind: "marketplace",
        name: "mp.bid.submitted",
        subjectType: "mp_bid",
        subjectId: "bid_7",
        requestId: "req_42",
        seq: "3",
        amountMinor: "500000",
        driverPhone: "+2348000000000",
        pin: "1234",
      }),
    ).toEqual({
      kind: "marketplace",
      name: "mp.bid.submitted",
      subjectType: "mp_bid",
      subjectId: "bid_7",
      requestId: "req_42",
      seq: "3",
    });

    expect(
      resolvePushDeepLink(
        {
          kind: "airport_transfer",
          name: "reservation.assigned",
          subjectId: "trf_99",
        },
        "rider",
      ),
    ).toBe("ubi://travel/transfers/trf_99");

    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_rider_tok_dl",
      initialNotification: {
        messageId: "msg_cold_1",
        data: {
          kind: "marketplace",
          name: "mp.bid.submitted",
          subjectType: "mp_bid",
          subjectId: "bid_7",
          requestId: "req_42",
        },
      },
    });
    setPushMessagingAdapter(mockPush.adapter);

    await saveSession({
      accessToken: "rider-access-dl",
      refreshToken: "rider-refresh-dl",
      userId: "usr_rider_1",
      role: "rider",
      deviceId: "device_ios_1",
      cityId: "LOS",
      expiresAt: Date.now() + 900_000,
    });

    installWire((call) => {
      if (call.method === "POST" && call.path === "/v1/push/devices") {
        return { status: 200, json: { success: true } };
      }
      return undefined;
    });

    const dlView = renderApp(<PushHost enabled />, makeTestQueryClient());

    await waitFor(() => {
      expect(openUrlSpy).toHaveBeenCalledWith(
        "ubi://home/marketplace/req_42/offers",
      );
    });

    await act(async () => {
      mockPush.emitNotificationOpened({
        messageId: "msg_warm_2",
        data: {
          kind: "marketplace",
          name: "mp.settlement.posted",
          requestId: "req_42",
        },
      });
    });

    expect(openUrlSpy).toHaveBeenCalledWith(
      "ubi://home/marketplace/req_42/receipt",
    );
    dlView.unmount();
  });

  it("renders an honest Notifications are off card on ProfileScreen when OS permission is denied and opens system settings", async () => {
    const openSettingsSpy = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as never);
    const mockPush = createMockPushAdapter({
      permission: "denied",
      token: null,
    });
    setPushMessagingAdapter(mockPush.adapter);

    installWire((call) => {
      if (call.method === "GET" && call.path === "/v1/users/me") {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              user: {
                id: "usr_rider_1",
                firstName: "Ada",
                lastName: "Lovelace",
                phone: "+2348012345678",
                email: "ada@example.com",
                role: "RIDER",
                status: "ACTIVE",
                country: "NG",
              },
            },
          },
        };
      }
      return undefined;
    });

    const profileView = renderApp(<ProfileScreen />, makeTestQueryClient());

    const card = await screen.findByTestId("rider.profile.notificationsOff");
    expect(card).toBeTruthy();
    expect(screen.getByText("Notifications are off")).toBeTruthy();

    fireEvent.press(
      screen.getByTestId("rider.profile.openNotificationSettings"),
    );
    await waitFor(() => {
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    });
    profileView.unmount();
  });
});
