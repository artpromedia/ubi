// A04.2 preferences screen wired to the real GET/PATCH /v1/mp/driver/preferences shapes:
// loading → loaded, a save that sends expectedVersion + ONLY the changed fields, the
// offline retry that reuses its Idempotency-Key, the 409 reload, the 422 verbatim error,
// the homeward/availability editors, and the rule that no screen here ever bids.
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrentPosition } from "react-native-geolocation-service";
import { ThemeProvider } from "@ubi/mobile-ui";
import { installFixtures } from "@ubi/mobile-core";
import { MpDriverPreferencesSchema, dynamicTestId } from "@ubi/contracts";
import {
  marketplaceApi,
  type MpDriverPreferences,
} from "../../../api/marketplace";
import {
  DriverPreferencesContainer,
  parseClock,
} from "../DriverPreferencesContainer";
import { MP_DRIVER_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const NGN = (amountMinor: number) => ({ amountMinor, currency: "NGN" });

// The server's GET answer for a driver who never saved (version 0), as ride-service
// serves it for the fixture market.
const serverView = (
  over: Partial<MpDriverPreferences> = {},
): MpDriverPreferences => ({
  driverId: "drv_1",
  cityId: "LOS",
  version: 0,
  currency: "NGN",
  timezone: "Africa/Lagos",
  minimumTripAmountMinor: null,
  maxPickupDistanceMeters: null,
  acceptsDeliveries: true,
  acceptsStops: true,
  maxStops: null,
  homeward: null,
  homewardOnly: false,
  availabilityWindows: [],
  availabilityNote:
    "Stored for scheduled requests, which are not available yet. Windows are in Africa/Lagos local time.",
  bounds: {
    minimumTripAmountMaxMinor: NGN(500_000),
    maxPickupDistanceMeters: { min: 500, max: 9_000 },
    maxStopsCeiling: 3,
    homewardRadiusMeters: { min: 2_000, max: 50_000 },
    maxAvailabilityWindows: 28,
  },
  disclosure:
    "Preferences filter and sort the requests you see and suggest offers. They never bid for you and never change what you are eligible for.",
  updatedAt: null,
  ...over,
});

type Call = { method: string; path: string; body?: unknown };

const harness = () => {
  // gcTime Infinity: no cache-GC timer outlives the test and holds Jest open.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client}>
        <DriverPreferencesContainer />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const neverBids = (calls: Call[]) =>
  expect(calls.filter((c) => c.path.startsWith("/v1/mp/bids"))).toHaveLength(0);

describe("DriverPreferencesContainer", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    jest.restoreAllMocks();
  });

  it("the fixture is the contract's shape", () => {
    expect(() => MpDriverPreferencesSchema.parse(serverView())).not.toThrow();
  });

  it("loads, then saves expectedVersion plus only the changed fields", async () => {
    const calls: Call[] = [];
    installFixtures(async (call) => {
      calls.push(call);
      if (call.method === "GET" && call.path === "/v1/mp/driver/preferences")
        return { status: 200, json: serverView() };
      if (call.method === "PATCH" && call.path === "/v1/mp/driver/preferences")
        return {
          status: 200,
          json: serverView({
            version: 1,
            minimumTripAmountMinor: NGN(150_000),
            maxPickupDistanceMeters: 2_000,
            acceptsDeliveries: false,
            updatedAt: new Date().toISOString(),
          }),
        };
      return undefined;
    });
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    expect(screen.getByText(serverView().disclosure)).toBeTruthy();
    expect(
      screen.getByText("Not saved yet — nothing is filtered until you save."),
    ).toBeTruthy();

    // Only chips inside the SERVER's pickup bounds are offered (8 km ≤ 9 km max).
    expect(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.pickup, "8000")),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.pickup, "2000")),
    );
    fireEvent(
      screen.getByTestId(MP_DRIVER_TID.prefs.deliveries),
      "valueChange",
      false,
    );
    fireEvent.changeText(
      screen.getByTestId(MP_DRIVER_TID.prefs.minTrip),
      "1,500",
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    const patch = calls.find((c) => c.method === "PATCH")!.body;
    expect(patch).toEqual({
      expectedVersion: 0,
      minimumTripAmountMinor: { amountMinor: 150_000, currency: "NGN" },
      maxPickupDistanceMeters: 2_000,
      acceptsDeliveries: false,
    });
    await screen.findByText("Preferences saved");
    await screen.findByText(
      "Saved as version 1. Changes apply to your feed and suggestions only.",
    );
    neverBids(calls);
  });

  it("offline save keeps the draft and retries under the SAME Idempotency-Key", async () => {
    let attempts = 0;
    const calls: Call[] = [];
    installFixtures(async (call) => {
      calls.push(call);
      if (call.method === "GET") return { status: 200, json: serverView() };
      if (call.method === "PATCH") {
        attempts += 1;
        if (attempts === 1) throw new TypeError("Network request failed");
        return { status: 200, json: serverView({ version: 1, maxStops: 1 }) };
      }
      return undefined;
    });
    const spy = jest.spyOn(marketplaceApi, "patchPreferences");
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.maxStops, "1")),
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));
    await screen.findByTestId(MP_DRIVER_TID.prefs.offline);
    expect(screen.getByText(/Nothing was saved/)).toBeTruthy();

    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));
    await screen.findByText("Preferences saved");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toEqual({ expectedVersion: 0, maxStops: 1 });
    expect(spy.mock.calls[1][1]).toBe(spy.mock.calls[0][1]);
    neverBids(calls);
  });

  it("a 409 version conflict reloads the server's newer version", async () => {
    let gets = 0;
    installFixtures(async (call) => {
      if (call.method === "GET") {
        gets += 1;
        return {
          status: 200,
          json:
            gets === 1
              ? serverView()
              : serverView({ version: 3, maxPickupDistanceMeters: 5_000 }),
        };
      }
      if (call.method === "PATCH")
        return {
          status: 409,
          json: {
            code: "version_conflict",
            message:
              "your preferences changed since you last read them (now version 3)",
          },
        };
      return undefined;
    });
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.pickup, "1000")),
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));
    await screen.findByTestId(MP_DRIVER_TID.prefs.conflict);
    await screen.findByText(
      "Saved as version 3. Changes apply to your feed and suggestions only.",
    );
    // The draft is the server's truth again: 5 km selected, not the lost 1 km edit.
    expect(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.pickup, "5000"))
        .props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it("a 422 shows the server's message verbatim", async () => {
    installFixtures(async (call) => {
      if (call.method === "GET") return { status: 200, json: serverView() };
      if (call.method === "PATCH")
        return {
          status: 422,
          json: {
            code: "validation_failed",
            message:
              "the minimum trip amount must be between 1 and 500000 minor units",
          },
        };
      return undefined;
    });
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    fireEvent.changeText(
      screen.getByTestId(MP_DRIVER_TID.prefs.minTrip),
      "9999",
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));
    await screen.findByTestId(MP_DRIVER_TID.prefs.error);
    expect(
      screen.getByText(
        "the minimum trip amount must be between 1 and 500000 minor units",
      ),
    ).toBeTruthy();
  });

  it("load error shows the server message with a retry; offline says so", async () => {
    let gets = 0;
    installFixtures(async (call) => {
      if (call.method !== "GET") return undefined;
      gets += 1;
      if (gets === 1)
        return {
          status: 503,
          json: { code: "service_unavailable", message: "try again shortly" },
        };
      if (gets === 2) throw new TypeError("Network request failed");
      return { status: 200, json: serverView() };
    });
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.error);
    expect(screen.getByText("try again shortly")).toBeTruthy();
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.retry));
    await screen.findByTestId(MP_DRIVER_TID.prefs.offline);
    expect(screen.getByText("You’re offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.retry));
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
  });

  it("sets the homeward area from the current position and adds an availability window", async () => {
    (getCurrentPosition as jest.Mock).mockImplementation((success) =>
      success({ coords: { latitude: 6.5694, longitude: 3.3792, accuracy: 8 } }),
    );
    const calls: Call[] = [];
    installFixtures(async (call) => {
      calls.push(call);
      if (call.method === "GET") return { status: 200, json: serverView() };
      if (call.method === "PATCH")
        return { status: 200, json: serverView({ version: 1 }) };
      return undefined;
    });
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    await act(async () => {
      fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.homewardSet));
    });
    await screen.findByText("Home · within 5 km");
    fireEvent(
      screen.getByTestId(MP_DRIVER_TID.prefs.homewardOnly),
      "valueChange",
      true,
    );

    // A malformed time is refused on the device before any request.
    fireEvent.press(
      screen.getByTestId(dynamicTestId(MP_DRIVER_TID.prefs.windowDay, "wed")),
    );
    fireEvent.changeText(
      screen.getByTestId(MP_DRIVER_TID.prefs.windowStart),
      "7am",
    );
    fireEvent.changeText(
      screen.getByTestId(MP_DRIVER_TID.prefs.windowEnd),
      "10:00",
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.windowAdd));
    expect(
      screen.getByText("Use 24-hour times like 07:00 and 10:30."),
    ).toBeTruthy();
    fireEvent.changeText(
      screen.getByTestId(MP_DRIVER_TID.prefs.windowStart),
      "07:00",
    );
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.windowAdd));
    expect(screen.getByText("Wed 07:00–10:00 (unsaved)")).toBeTruthy();

    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.save));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
      expectedVersion: 0,
      homeward: {
        lat: 6.5694,
        lng: 3.3792,
        radiusMeters: 5_000,
        label: "Home",
      },
      homewardOnly: true,
      availabilityWindows: [{ day: "wed", startMinute: 420, endMinute: 600 }],
    });
    neverBids(calls);
  });

  it("links the per-km minimum to My rates instead of duplicating it", async () => {
    installFixtures(async (call) =>
      call.method === "GET" ? { status: 200, json: serverView() } : undefined,
    );
    harness();
    await screen.findByTestId(MP_DRIVER_TID.prefs.screen);
    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.prefs.rates));
    expect(mockNavigate).toHaveBeenCalledWith("Rates");
  });

  it("parses 24h clock times only", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("24:00")).toBe(1_440);
    expect(parseClock("24:01")).toBeNull();
    expect(parseClock("7:5")).toBeNull();
    expect(parseClock("noon")).toBeNull();
  });
});
