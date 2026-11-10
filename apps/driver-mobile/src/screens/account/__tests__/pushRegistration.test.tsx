// Driver push registration, token rotation, logout deactivation, ids-only deep
// linking, and permission-denied Profile notice (CC-B04 / P1-13).
// NOTE: Native FCM SDK delivery is substituted with a clearly labeled mock
// PushMessagingAdapter here because Jest runs in Node without a real Firebase
// project or physical/emulator device (EXT-06).
import type React from "react";
import "@testing-library/react-native/extend-expect";
import { Linking, View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { IdempotencyKeySchema } from "@ubi/contracts";
import {
  clearSession,
  ConfigProvider,
  configureApi,
  FlagsProvider,
  resetPushStateForTests,
  resolvePushDeepLink,
  saveSession,
  setPushMessagingAdapter,
  usePushLifecycle,
  type PushMessagingAdapter,
  type PushPermissionState,
  type RemotePushMessage,
} from "@ubi/mobile-core";
import { installWire } from "../../../../jest/wire";
import { authApi } from "../../../api/auth";
import { linking } from "../../../navigation/linking";
import { ProfileScreen } from "../ProfileScreen";

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

const clients: QueryClient[] = [];

function renderDriver(el: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(qc);
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={qc}>
        <ConfigProvider cityId="LOS">
          <FlagsProvider cityId="LOS">{el}</FlagsProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
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
    options.token !== undefined ? options.token : "fcm_driver_tok_1";
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

function DriverPushHost({ enabled }: { enabled: boolean }) {
  usePushLifecycle({ enabled, role: "driver", appVersion: "1.0.0" });
  return <View testID="driver-push-host" />;
}

beforeEach(async () => {
  resetPushStateForTests();
  await clearSession();
  configureApi({ baseUrl: "http://gateway.test" });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.clear();
  resetPushStateForTests();
  await clearSession();
  mockNavigate.mockReset();
  mockReset.mockReset();
  jest.restoreAllMocks();
});

describe("Driver push lifecycle & deep linking (CC-B04)", () => {
  it("keeps permission quiet pre-auth, registers POST /v1/push/devices with Idempotency-Key post-auth, and rotates on token refresh", async () => {
    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_driver_tok_1",
    });
    setPushMessagingAdapter(mockPush.adapter);

    const wire = installWire((call) => {
      if (call.path.startsWith("/v1/config/flags")) {
        return { status: 200, json: {} };
      }
      if (call.path.startsWith("/v1/config/city/")) {
        return { status: 404, json: { code: "not_found" } };
      }
      if (call.method === "POST" && call.path === "/v1/push/devices") {
        return {
          status: 200,
          json: {
            success: true,
            data: { device: { id: "drv_dev_1" }, flushed: 1 },
          },
        };
      }
      return undefined;
    });

    const unauth = renderDriver(<DriverPushHost enabled={false} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockPush.adapter.requestPermission).not.toHaveBeenCalled();
    expect(wire.writes()).toHaveLength(0);
    unauth.unmount();

    await saveSession({
      accessToken: "driver-access-1",
      refreshToken: "driver-refresh-1",
      userId: "usr_driver_1",
      role: "driver",
      deviceId: "device_drv_android_1",
      cityId: "LOS",
      expiresAt: Date.now() + 900_000,
    });

    const authed = renderDriver(<DriverPushHost enabled />);

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
    expect(firstReg?.headers.authorization).toBe("Bearer driver-access-1");
    expect(
      IdempotencyKeySchema.safeParse(firstReg?.headers["Idempotency-Key"])
        .success,
    ).toBe(true);
    expect(firstReg?.body).toMatchObject({
      token: "fcm_driver_tok_1",
      deviceId: "device_drv_android_1",
      appVersion: "1.0.0",
    });

    await act(async () => {
      mockPush.emitTokenRefresh("fcm_driver_tok_rotated_2");
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
      token: "fcm_driver_tok_rotated_2",
      deviceId: "device_drv_android_1",
    });
    authed.unmount();
  });

  it("deactivates the push token via DELETE /v1/push/devices BEFORE POST /v1/auth/logout", async () => {
    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_driver_logout_tok",
    });
    setPushMessagingAdapter(mockPush.adapter);

    await saveSession({
      accessToken: "driver-access-logout",
      refreshToken: "driver-refresh-logout",
      userId: "usr_driver_1",
      role: "driver",
      deviceId: "device_drv_android_1",
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
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /v1/push/devices",
      "POST /v1/auth/logout",
    ]);
    expect(writes[0]?.headers.authorization).toBe(
      "Bearer driver-access-logout",
    );
    expect(writes[0]?.body).toEqual({ token: "fcm_driver_logout_tok" });
  });

  it("maps ids-only driver notification hints to ubidriver:// routes registered in driver linking config", async () => {
    const openUrlSpy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(undefined as never);

    expect(linking.prefixes).toContain("ubidriver://");
    const screens = linking.config?.screens as Record<
      string,
      Record<string, Record<string, Record<string, Record<string, string>>>> &
        string
    >;
    expect(screens.Jobs).toBe("jobs");
    expect(screens.Calendar).toBe("calendar");
    expect(screens.MpTrip).toBe("trips/:requestId");
    expect(screens.MpAmendments).toBe("trips/:requestId/amendments");
    expect(screens.Main?.screens?.Requests?.screens?.Detail).toBe(
      "requests/:requestId",
    );
    expect(screens.Main?.screens?.Earnings?.screens?.Payouts).toBe(
      "earnings/payouts",
    );

    expect(
      resolvePushDeepLink(
        { kind: "marketplace", name: "mp.bid.won", requestId: "req_42" },
        "driver",
      ),
    ).toBe("ubidriver://jobs");
    expect(
      resolvePushDeepLink(
        {
          kind: "marketplace",
          name: "mp.advance_booking.confirmed",
          subjectId: "bkg_9",
        },
        "driver",
      ),
    ).toBe("ubidriver://calendar");
    expect(
      resolvePushDeepLink(
        {
          kind: "marketplace",
          name: "mp.amendment.proposed",
          requestId: "req_42",
        },
        "driver",
      ),
    ).toBe("ubidriver://trips/req_42/amendments");
    expect(
      resolvePushDeepLink(
        { kind: "marketplace", name: "mp.settlement.posted" },
        "driver",
      ),
    ).toBe("ubidriver://earnings/payouts");

    const mockPush = createMockPushAdapter({
      permission: "authorized",
      token: "fcm_driver_dl_tok",
      initialNotification: {
        messageId: "drv_msg_1",
        data: {
          kind: "marketplace",
          name: "mp.request.preferred_driver_invited",
          requestId: "req_42",
        },
      },
    });
    setPushMessagingAdapter(mockPush.adapter);

    await saveSession({
      accessToken: "driver-access-dl",
      refreshToken: "driver-refresh-dl",
      userId: "usr_driver_1",
      role: "driver",
      deviceId: "device_drv_android_1",
      cityId: "LOS",
      expiresAt: Date.now() + 900_000,
    });

    installWire((call) => {
      if (call.path.startsWith("/v1/config/flags")) {
        return { status: 200, json: {} };
      }
      if (call.path.startsWith("/v1/config/city/")) {
        return { status: 404, json: { code: "not_found" } };
      }
      if (call.method === "POST" && call.path === "/v1/push/devices") {
        return { status: 200, json: { success: true } };
      }
      return undefined;
    });

    const dlView = renderDriver(<DriverPushHost enabled />);

    await waitFor(() => {
      expect(openUrlSpy).toHaveBeenCalledWith("ubidriver://requests/req_42");
    });

    await act(async () => {
      mockPush.emitNotificationOpened({
        messageId: "drv_msg_2",
        data: {
          kind: "marketplace",
          name: "mp.bid.won",
          requestId: "req_42",
        },
      });
    });

    expect(openUrlSpy).toHaveBeenCalledWith("ubidriver://jobs");
    dlView.unmount();
  });

  it("renders an honest Notifications are off card on driver ProfileScreen when permission is denied and opens settings", async () => {
    const openSettingsSpy = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined as never);
    const mockPush = createMockPushAdapter({
      permission: "denied",
      token: null,
    });
    setPushMessagingAdapter(mockPush.adapter);

    installWire((call) => {
      if (call.path.startsWith("/v1/config/flags")) {
        return { status: 200, json: {} };
      }
      if (call.path.startsWith("/v1/config/city/")) {
        return { status: 404, json: { code: "not_found" } };
      }
      if (call.method === "GET" && call.path === "/v1/users/me") {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              user: {
                id: "usr_driver_1",
                firstName: "Emeka",
                lastName: "Okafor",
                phone: "+2348099999999",
                email: "emeka@example.com",
                role: "DRIVER",
                status: "ACTIVE",
              },
            },
          },
        };
      }
      return undefined;
    });

    const profileView = renderDriver(<ProfileScreen />);

    const card = await screen.findByTestId("driver.profile.notificationsOff");
    expect(card).toBeTruthy();
    expect(screen.getByText("Notifications are off")).toBeTruthy();

    fireEvent.press(
      screen.getByTestId("driver.profile.openNotificationSettings"),
    );
    await waitFor(() => {
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    });
    profileView.unmount();
  });
});
