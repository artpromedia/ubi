// C4 AvailabilityEditor on the real wire. Covers the local-clock form (a Lagos day and
// times → the exact UTC window sent), "Checking with UBI…" until the preview answers,
// the server's list (a signed shift's hours reduced; a booking conflict with the
// server's withdraw amount and no rematch promise), save blocked until each booking is
// chosen for, the exact PUT (the checked windows, the chosen withdrawals, the preview
// token, an Idempotency-Key), the saved state pointing to each withdrawal's own
// confirmation (C3), trimming re-checked with the new window, the explicit consent to
// replace availability saved before, a refused save, and the motion lock.
import React from "react";
import "@testing-library/react-native/extend-expect";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, type WireCall } from "../../../../jest/wire";
import {
  emptySchedule,
  preview,
  saved,
  schedule,
} from "../../../../jest/fleetFixtures";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import { FleetAvailabilityScreen } from "../FleetAvailabilityScreen";
import { FLEET_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

const PREVIEW = "/v1/drivers/me/availability:preview";
const PUT = "/v1/drivers/me/availability";
const SCHEDULE = "/v1/drivers/me/schedule";
// "Now" in these tests is 2026-09-30T07:00Z; the editor reads 30 days ahead.
const HORIZON_READ =
  SCHEDULE +
  "?from=" +
  encodeURIComponent("2026-09-30T07:00:00.000Z") +
  "&to=" +
  encodeURIComponent("2026-10-30T07:00:00.000Z");

const harness = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client}>
        <FleetAvailabilityScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const serve = (
  handlers: Partial<Record<string, (call: WireCall) => unknown>> = {},
  sched = emptySchedule(),
) =>
  installWire((call) => {
    if (call.method === "GET" && call.path === HORIZON_READ)
      return { status: 200, json: sched };
    const handler = handlers[call.path];
    return handler
      ? (handler(call) as { status: number; json?: unknown } | "offline")
      : undefined;
  });

/** Thu 1 Oct 2026, 07:00–23:00 Lagos (UTC+1). */
const OCT_1 = dynamicTestId(FLEET_TID.timeOffDay, "2026-10-01");
const WINDOW = {
  kind: "time_off",
  startsAt: "2026-10-01T06:00:00.000Z",
  endsAt: "2026-10-01T22:00:00.000Z",
};

describe("FleetAvailabilityScreen (C4)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    resetMotionForDev();
    // The form offers the next 14 days from "now" on the city's clock.
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-30T07:00:00.000Z"));
  });
  afterEach(() => jest.restoreAllMocks());

  it("sends the Lagos wall-clock window as UTC, and lists what it touches with the server's outcome", async () => {
    const wire = serve({ [PREVIEW]: () => ({ status: 200, json: preview() }) });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(OCT_1));
    expect(screen.getByTestId(FLEET_TID.timeOffForm)).toHaveTextContent(
      "Thu 1 Oct · 07:00",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.timeOffForm)).toHaveTextContent(
      "Thu 1 Oct · 23:00",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.timeOffSave)).toBeDisabled();
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    const result = await screen.findByTestId(FLEET_TID.timeOffPreview);
    const [call] = wire.writes();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(PREVIEW);
    expect(call.body).toEqual({ windows: [WINDOW] });
    expect(result).toHaveTextContent("Checked by UBI", { exact: false });
    expect(result).toHaveTextContent("Hours reduced · 11 h", { exact: false });
    expect(result).toHaveTextContent("Booking 08:00–09:30", { exact: false });
    expect(result).toHaveTextContent("Conflicts", { exact: false });
    expect(result).toHaveTextContent(
      "If you withdraw: ₦520 returned to your wallet · the rider’s funding is released · no penalty",
      { exact: false },
    );
    expect(result).not.toHaveTextContent("rematch", { exact: false });
    // Save waits for a choice on the booking.
    expect(screen.getByTestId(FLEET_TID.timeOffSave)).toBeDisabled();
    expect(
      screen.getByText(
        "Choose for each booking first: trim the time off, or withdraw.",
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it("saves with the exact checked windows, the chosen withdrawal, the preview token and an Idempotency-Key", async () => {
    const wire = serve({
      [PREVIEW]: () => ({ status: 200, json: preview() }),
      [PUT]: () => ({ status: 200, json: saved() }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(OCT_1));
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    await screen.findByTestId(FLEET_TID.timeOffPreview);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(FLEET_TID.timeOffWithdrawal, "bkg_2")),
    );
    expect(screen.getByTestId(FLEET_TID.timeOffSave)).toBeEnabled();
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffSave));
    const done = await screen.findByTestId(FLEET_TID.timeOffSaved);
    expect(done).toHaveTextContent("Time off saved", { exact: false });
    expect(done).toHaveTextContent(
      "Your fleet sees these hours only as “Unavailable”, with no reason.",
      { exact: false },
    );
    const put = wire.writes().find((c) => c.path === PUT);
    expect(put?.method).toBe("PUT");
    expect(put?.body).toEqual({
      windows: [WINDOW],
      withdrawals: ["bkg_2"],
      previewToken: "apv_1",
    });
    expect(
      IdempotencyKeySchema.safeParse(put?.headers["Idempotency-Key"]).success,
    ).toBe(true);
    // The withdrawal itself is confirmed on the booking (C3), never here.
    fireEvent.press(screen.getByText("Confirm the withdrawal"));
    expect(mockNavigate).toHaveBeenCalledWith("FleetConflict", {
      conflictId: "fcf_9",
    });
    view.unmount();
  });

  it("trimming keeps the booking: the time off starts after it and is checked again", async () => {
    const wire = serve({
      [PREVIEW]: (call) =>
        (call.body as { windows: { startsAt: string }[] }).windows[0]
          .startsAt === WINDOW.startsAt
          ? { status: 200, json: preview() }
          : {
              status: 200,
              json: preview({ previewToken: "apv_2", affects: [] }),
            },
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(OCT_1));
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    await screen.findByTestId(FLEET_TID.timeOffPreview);
    const trim = screen.getByTestId(
      dynamicTestId(FLEET_TID.timeOffTrim, "bkg_2"),
    );
    expect(trim).toHaveTextContent("Start time off at 09:30. Keep the booking");
    fireEvent.press(trim);
    expect(
      await screen.findByText("No clash with your shifts or bookings."),
    ).toBeTruthy();
    const previews = wire.writes().filter((c) => c.path === PREVIEW);
    expect(previews).toHaveLength(2);
    expect(previews[1].body).toEqual({
      windows: [{ ...WINDOW, startsAt: "2026-10-01T08:30:00.000Z" }],
    });
    expect(screen.getByTestId(FLEET_TID.timeOffForm)).toHaveTextContent(
      "Thu 1 Oct · 09:30",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.timeOffSave)).toBeEnabled();
    view.unmount();
  });

  it("availability saved before can't be read back, so replacing it needs the driver's explicit consent", async () => {
    const wire = serve(
      { [PREVIEW]: () => ({ status: 200, json: preview({ affects: [] }) }) },
      schedule(),
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText("You saved availability before"),
    ).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.timeOffCheck)).toBeDisabled();
    fireEvent(
      screen.getByTestId(FLEET_TID.timeOffReplace),
      "valueChange",
      true,
    );
    expect(screen.getByTestId(FLEET_TID.timeOffCheck)).toBeEnabled();
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    await screen.findByTestId(FLEET_TID.timeOffPreview);
    expect(wire.writes().map((c) => c.path)).toEqual([PREVIEW]);
    view.unmount();
  });

  it("time off saved beyond this week (outside C1's default range) still needs consent before it's replaced", async () => {
    // Saved in an earlier session for Mon 12 Oct — 12 days out, past the 7-day
    // schedule C1 shows, but inside what this form can save (16 days).
    const later = schedule({
      items: [
        {
          itemId: "dav_7@1760252400000",
          kind: "time_off",
          startsAt: "2026-10-12T07:00:00.000Z",
          endsAt: "2026-10-12T15:00:00.000Z",
          label: "Time off · only you can set this",
          vehicleId: null,
          bookingId: null,
          risk: null,
          decisionDeadline: null,
          conflictId: null,
        },
      ],
      alerts: [],
    });
    const wire = serve(
      { [PREVIEW]: () => ({ status: 200, json: preview({ affects: [] }) }) },
      later,
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText("You saved availability before"),
    ).toBeTruthy();
    // The editor read the whole range it can have saved into, not one week.
    expect(
      wire.calls.filter((c) => c.method === "GET").map((c) => c.path),
    ).toEqual([HORIZON_READ]);
    fireEvent.press(screen.getByTestId(OCT_1));
    expect(screen.getByTestId(FLEET_TID.timeOffCheck)).toBeDisabled();
    expect(wire.writes()).toEqual([]);
    view.unmount();
  });

  it("a refused save is explained and asks for a fresh check", async () => {
    serve({
      [PREVIEW]: () => ({ status: 200, json: preview() }),
      [PUT]: () => ({
        status: 409,
        json: {
          code: "unresolved_booking_overlap",
          message: "Your time off overlaps a booking.",
          details: { bookingIds: ["bkg_2"] },
        },
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(OCT_1));
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    await screen.findByTestId(FLEET_TID.timeOffPreview);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(FLEET_TID.timeOffWithdrawal, "bkg_2")),
    );
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffSave));
    expect(await screen.findByTestId(FLEET_TID.refusal)).toHaveTextContent(
      "Choose for each booking first",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.timeOffPreview)).toBeNull();
    expect(screen.getByTestId(FLEET_TID.timeOffSave)).toBeDisabled();
    view.unmount();
  });

  it("while MOVING: the form is visible but checking and saving are locked", async () => {
    const wire = serve();
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.motionLock)).toHaveTextContent(
      "Review when stopped",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.timeOffCheck)).toBeNull();
    expect(screen.queryByTestId(FLEET_TID.timeOffSave)).toBeNull();
    expect(wire.writes()).toEqual([]);
    view.unmount();
  });

  it("offline check: nothing sent is assumed, and the driver is told", async () => {
    serve({ [PREVIEW]: () => "offline" });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(OCT_1));
    fireEvent.press(screen.getByTestId(FLEET_TID.timeOffCheck));
    expect(await screen.findByTestId(FLEET_TID.refusal)).toHaveTextContent(
      "You’re offline",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.timeOffPreview)).toBeNull();
    view.unmount();
  });

  it("fleet-service's 404 feature_disabled renders the honest not-available state", async () => {
    installWire(() => ({
      status: 404,
      json: {
        code: "feature_disabled",
        message: "fleet is not available here",
      },
    }));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.unavailable)).toHaveTextContent(
      "Fleet tools aren’t available yet in your city",
      { exact: false },
    );
    view.unmount();
  });
});
