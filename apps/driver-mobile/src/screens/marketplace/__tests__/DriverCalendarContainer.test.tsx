// A03 driver booking calendar against GET /v1/mp/driver/calendar (fixtures parsed with
// @ubi/contracts MpAdvanceBookingSchema): window, coarse route, net earnings and status
// in words; the reconfirmation-required state + the exact reconfirm POST; withdrawal
// with its financial outcome explained BEFORE and reported AFTER from the server's
// flags; the overlap warning; activated bookings linking to the trip; loading / empty /
// offline / unavailable states; and no acceptance-rate metric or decline-penalty copy.
import React from "react";
import "@testing-library/react-native/extend-expect";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { FlagsProvider } from "@ubi/mobile-core";
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, isoIn, type WireCall } from "../../../../jest/wire";
import { booking } from "../../../../jest/mpFixtures";
import { DriverCalendarContainer } from "../DriverCalendarContainer";
import { MP_DRIVER_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const TID = MP_DRIVER_TID.calendar;
const CAL_PATH = "/v1/mp/driver/calendar";
const FLAGS_PATH = "/v1/config/flags?cityId=LOS";
const NOTE =
  "Future bookings live on this calendar, not in your current/next jobs. Each enters your live jobs near its pickup, and only if you are free or finishing a trip that ends in time.";

let client: QueryClient;
const harness = () => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <FlagsProvider cityId="LOS">
        <QueryClientProvider client={client}>
          <DriverCalendarContainer />
        </QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
};

const keyOf = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

const calendarOf = (bookings: ReturnType<typeof booking>[]) => ({
  bookings,
  note: NOTE,
});

describe("DriverCalendarContainer (A03 booking calendar)", () => {
  beforeEach(() => mockNavigate.mockReset());

  it("renders each booking's window, route, net earnings and status in words — and no acceptance rate", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.path === CAL_PATH)
        return { status: 200, json: calendarOf([booking()]) };
      return undefined;
    });
    const view = harness();
    expect(await screen.findByTestId(TID.note)).toHaveTextContent(NOTE);
    expect(
      screen.getByTestId(dynamicTestId(TID.window, "bkg_1")),
    ).toHaveTextContent("Thu 24 Sep 2026, 07:30 (UTC+01:00)");
    expect(
      screen.getByTestId(dynamicTestId(TID.route, "bkg_1")),
    ).toHaveTextContent("Lekki Phase 1 → Yaba");
    expect(
      screen.getByTestId(dynamicTestId(TID.net, "bkg_1")),
    ).toHaveTextContent(/You keep.*₦5,040/);
    expect(
      screen.getByTestId(dynamicTestId(TID.status, "bkg_1")).props
        .accessibilityLabel,
    ).toBe(
      "Status: Driver reserved — awaiting the driver's reconfirmation before pickup",
    );
    expect(screen.queryByText(/acceptance/i)).toBeNull();
    expect(screen.queryByText(/penalt/i)).toBeNull();
    view.unmount();
  });

  it("shows reconfirmation as required inside its window and reconfirms with the exact POST", async () => {
    let current = booking();
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.method === "GET" && call.path === CAL_PATH)
        return { status: 200, json: calendarOf([current]) };
      if (call.path === "/v1/mp/advance-bookings/bkg_1/reconfirm") {
        current = booking({
          state: "reconfirmed",
          version: 3,
          statusLabel: "Driver reserved and reconfirmed",
          reconfirmation: {
            opensAt: isoIn(-3_600_000),
            deadline: isoIn(12 * 3_600_000),
            reconfirmedAt: isoIn(0),
          },
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    const view = harness();
    expect(
      await screen.findByTestId(dynamicTestId(TID.reconfirmState, "bkg_1")),
    ).toHaveTextContent(/^Reconfirmation needed — closes in 12 h/);
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.reconfirm, "bkg_1")));
    await waitFor(() =>
      expect(
        screen.getByTestId(dynamicTestId(TID.reconfirmState, "bkg_1")),
      ).toHaveTextContent("Reconfirmed"),
    );
    expect(screen.getByTestId(TID.actionError)).toHaveTextContent(
      /won’t be charged again at pickup/,
    );
    const [reconfirm] = wire.writes();
    expect(reconfirm.method).toBe("POST");
    expect(reconfirm.path).toBe("/v1/mp/advance-bookings/bkg_1/reconfirm");
    expect(reconfirm.body).toBeUndefined();
    keyOf(reconfirm);
    expect(
      screen.queryByTestId(dynamicTestId(TID.reconfirm, "bkg_1")),
    ).toBeNull();
    view.unmount();
  });

  it("before its window, reconfirmation shows when it opens and offers no button", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.path === CAL_PATH)
        return {
          status: 200,
          json: calendarOf([
            booking({
              reconfirmation: {
                opensAt: isoIn(3 * 3_600_000 + 5 * 60_000),
                deadline: isoIn(20 * 3_600_000),
                reconfirmedAt: null,
              },
            }),
          ]),
        };
      return undefined;
    });
    const view = harness();
    expect(
      await screen.findByTestId(dynamicTestId(TID.reconfirmState, "bkg_1")),
    ).toHaveTextContent("Reconfirmation opens in 3 h 5 min");
    expect(
      screen.queryByTestId(dynamicTestId(TID.reconfirm, "bkg_1")),
    ).toBeNull();
    view.unmount();
  });

  it("explains the financial outcome before withdrawing, sends the reason, and reports the server's outcome", async () => {
    let current = booking();
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.method === "GET" && call.path === CAL_PATH)
        return { status: 200, json: calendarOf([current]) };
      if (call.path === "/v1/mp/advance-bookings/bkg_1/withdraw") {
        current = booking({
          state: "failed",
          version: 3,
          driverReserved: false,
          fullySecured: false,
          statusLabel: "Booking failed — no driver",
          funding: {
            state: "released",
            label: "Payment hold released",
            dueAt: null,
            deadline: null,
          },
          failure: {
            reason: "driver_withdrew",
            message:
              "Your driver withdrew from this booking and cannot attend. Nothing was charged to you and any payment hold was released.",
            financialOutcome: {
              commissionReversed: true,
              riderFundingReleased: true,
              riderCharged: false,
            },
            rematchAvailable: true,
          },
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    const view = harness();
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.withdraw, "bkg_1")),
    );
    expect(
      screen.getByText(/returned to your wallet as a linked reversal/),
    ).toBeTruthy();
    // No reason yet: the confirm does nothing.
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.withdrawConfirm, "bkg_1")),
    );
    expect(wire.writes()).toEqual([]);
    fireEvent.changeText(
      screen.getByTestId(dynamicTestId(TID.withdrawReason, "bkg_1")),
      "Car in for repair",
    );
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.withdrawConfirm, "bkg_1")),
    );
    const outcome = await screen.findByTestId(
      dynamicTestId(TID.outcome, "bkg_1"),
    );
    const [withdraw] = wire.writes();
    expect(withdraw.path).toBe("/v1/mp/advance-bookings/bkg_1/withdraw");
    expect(withdraw.body).toEqual({ reason: "Car in for repair" });
    keyOf(withdraw);
    expect(outcome).toHaveTextContent(/You withdrew from this booking/);
    expect(outcome).toHaveTextContent(
      /Your commission was returned to your wallet \(linked reversal\)/,
    );
    expect(outcome).toHaveTextContent(/The rider was not charged/);
    expect(outcome).toHaveTextContent(/no one is substituted/);
    expect(
      screen.queryByTestId(dynamicTestId(TID.withdraw, "bkg_1")),
    ).toBeNull();
    view.unmount();
  });

  it("a refused reconfirm is shown in plain words (window closed) and keeps the booking visible", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.method === "GET" && call.path === CAL_PATH)
        return { status: 200, json: calendarOf([booking()]) };
      if (call.path === "/v1/mp/advance-bookings/bkg_1/reconfirm")
        return {
          status: 409,
          json: {
            code: "conflict",
            message: "the reconfirmation deadline has passed",
            details: { deadline: isoIn(-1_000) },
          },
        };
      return undefined;
    });
    const view = harness();
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.reconfirm, "bkg_1")),
    );
    expect(await screen.findByTestId(TID.actionError)).toHaveTextContent(
      /the reconfirmation deadline has passed/,
    );
    expect(
      screen.getByTestId(dynamicTestId(TID.booking, "bkg_1")),
    ).toBeTruthy();
    view.unmount();
  });

  it("flags overlapping pickup windows and links an activated booking to its trip", async () => {
    const start = isoIn(30 * 3_600_000);
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: { marketplace_rides: true, marketplace_multi_stop: true },
        };
      if (call.path === CAL_PATH)
        return {
          status: 200,
          json: calendarOf([
            booking({
              bookingId: "bkg_a",
              schedule: {
                windowStart: start,
                windowEnd: new Date(
                  Date.parse(start) + 30 * 60_000,
                ).toISOString(),
                label: "Fri 25 Sep 2026, 12:00 (UTC+01:00)",
              } as never,
            }),
            booking({
              bookingId: "bkg_b",
              schedule: {
                windowStart: new Date(
                  Date.parse(start) + 20 * 60_000,
                ).toISOString(),
                label: "Fri 25 Sep 2026, 12:20 (UTC+01:00)",
              } as never,
            }),
            booking({
              bookingId: "bkg_live",
              requestId: "req_live",
              state: "activated",
              statusLabel: "Trip started from your booking",
              activatedSlot: "current",
            }),
          ]),
        };
      return undefined;
    });
    const view = harness();
    expect(
      await screen.findByTestId(dynamicTestId(TID.conflict, 0)),
    ).toHaveTextContent(
      /Fri 25 Sep 2026, 12:00 \(UTC\+01:00\) and Fri 25 Sep 2026, 12:20/,
    );
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.openTrip, "bkg_live")),
    );
    expect(mockNavigate).toHaveBeenCalledWith("MpTrip", {
      requestId: "req_live",
    });
    view.unmount();
  });

  it("keeps the last bookings readable when a refresh fails, saying whether it was offline or a server error", async () => {
    let mode: "ok" | "offline" | "error" = "ok";
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.path === CAL_PATH) {
        if (mode === "offline") return "offline";
        if (mode === "error")
          return {
            status: 503,
            json: { code: "service_unavailable", message: "try later" },
          };
        return { status: 200, json: calendarOf([booking()]) };
      }
      return undefined;
    });
    const view = harness();
    await screen.findByTestId(dynamicTestId(TID.booking, "bkg_1"));
    mode = "offline";
    await act(async () => {
      await client.refetchQueries({ queryKey: ["mp", "calendar"] });
    });
    expect(await screen.findByTestId(TID.offline)).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(TID.booking, "bkg_1")),
    ).toBeTruthy();
    mode = "error";
    await act(async () => {
      await client.refetchQueries({ queryKey: ["mp", "calendar"] });
    });
    expect(await screen.findByTestId(TID.error)).toHaveTextContent(
      /Couldn’t refresh/,
    );
    expect(screen.queryByTestId(TID.offline)).toBeNull();
    expect(
      screen.getByTestId(dynamicTestId(TID.booking, "bkg_1")),
    ).toBeTruthy();
    view.unmount();
  });

  it("covers loading, offline with retry, unavailable and empty", async () => {
    let mode: "offline" | "off" | "empty" = "offline";
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.path === CAL_PATH) {
        if (mode === "offline") return "offline";
        if (mode === "off")
          return {
            status: 404,
            json: { code: "feature_disabled", message: "not available" },
          };
        return { status: 200, json: calendarOf([]) };
      }
      return undefined;
    });
    const view = harness();
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
    expect(await screen.findByTestId(TID.offline)).toBeTruthy();
    mode = "off";
    fireEvent.press(screen.getByTestId(TID.retry));
    expect(
      await screen.findByText("Bookings aren’t available here yet"),
    ).toBeTruthy();
    mode = "empty";
    fireEvent.press(screen.getByTestId(TID.retry));
    await waitFor(() => expect(screen.getByTestId(TID.empty)).toBeTruthy());
    expect(screen.getByText("No future bookings")).toBeTruthy();
    view.unmount();
  });
});
