// C3 BookingImpact on the real wire: the conflict's options from fleet-service with
// the booking from the driver's own marketplace calendar. Covers the explained
// choices (swap disabled with the server's reason; keep and let the fleet move the
// service; withdraw with "Your {amount} commission is returned to your wallet" from
// the server's amount and NO rematch promise), the exact withdraw POST with an
// Idempotency-Key, the after-state where a rematch is mentioned only when the
// marketplace says it is available, a proposed vehicle swap accepted with the exact
// POST and the rider's consent still to come (decisions Q3), the motion lock, a
// marketplace refusal in plain words, and the offline retry under the same key.
import React from "react";
import "@testing-library/react-native/extend-expect";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, type WireCall } from "../../../../jest/wire";
import {
  booking,
  conflict,
  schedule,
  withdrawn,
} from "../../../../jest/fleetFixtures";
import {
  currentMotion,
  resetMotionForDev,
  setMotionForDev,
} from "../../../lib/motion";
import { FleetConflictScreen } from "../FleetConflictScreen";
import { FLEET_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { conflictId: "fcf_1" } }),
}));

const WITHDRAW = "/v1/mp/advance-bookings/bkg_1/withdraw";
const SWAP_ID = "33333333-3333-4333-8333-333333333333";
const ACCEPT =
  "/v1/mp/advance-bookings/bkg_1/vehicle-swaps/" + SWAP_ID + "/accept";

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
        <FleetConflictScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const keyOf = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

const serve = (
  handlers: Partial<Record<string, (call: WireCall) => unknown>> = {},
  view = { conflict: conflict(), booking: booking() },
) =>
  installWire((call) => {
    if (call.method === "GET" && call.path === "/v1/drivers/me/conflicts/fcf_1")
      return { status: 200, json: view.conflict };
    if (call.method === "GET" && call.path === "/v1/mp/driver/calendar")
      return {
        status: 200,
        json: { bookings: [view.booking], note: "Your committed bookings." },
      };
    if (call.method === "GET" && call.path === "/v1/drivers/me/schedule")
      return { status: 200, json: schedule() };
    const handler = handlers[call.path];
    return handler
      ? (handler(call) as { status: number; json?: unknown } | "offline")
      : undefined;
  });

describe("FleetConflictScreen (C3)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    resetMotionForDev();
  });

  it("explains each choice with the server's outcome — and promises no rematch before the marketplace says so", async () => {
    serve();
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(await screen.findByText("Booking 11:20–11:35")).toBeTruthy();
    expect(
      screen.getByText(
        "Your vehicle is booked in for service during this booking",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("LAG-118-AB is in service 10:00–15:00."),
    ).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.impactDeadline)).toHaveTextContent(
      "Decide by 09:20",
      { exact: false },
    );
    expect(
      screen.getByTestId(
        dynamicTestId(FLEET_TID.impactOption, "keep_on_swapped_vehicle"),
      ),
    ).toHaveTextContent(
      "Not available: No eligible vehicle: none with the same class and capacity and valid documents.",
      { exact: false },
    );
    expect(
      screen.getByTestId(
        dynamicTestId(FLEET_TID.impactOption, "ask_fleet_to_move"),
      ),
    ).toHaveTextContent("Your booking stays as it is.", { exact: false });
    const withdrawOption = screen.getByTestId(
      dynamicTestId(FLEET_TID.impactOption, "withdraw"),
    );
    expect(withdrawOption).toHaveTextContent(
      "Your ₦560 commission is returned to your wallet.",
      { exact: false },
    );
    expect(withdrawOption).toHaveTextContent("No penalty and no score.", {
      exact: false,
    });
    expect(screen.queryByText(/rematch/i)).toBeNull();
    expect(
      screen.getByText(
        "Amounts are from UBI. Nothing changes until you confirm.",
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it("withdraws only after confirming: the exact POST with a reason and an Idempotency-Key, then the marketplace's outcome", async () => {
    const wire = serve({
      [WITHDRAW]: () => ({ status: 200, json: withdrawn(false) }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.impactWithdraw));
    expect(wire.writes()).toEqual([]);
    expect(screen.getByText("Withdraw from this booking?")).toBeTruthy();
    fireEvent.press(screen.getByTestId(FLEET_TID.impactWithdrawConfirm));
    const outcome = await screen.findByTestId(FLEET_TID.impactOutcome);
    expect(outcome).toHaveTextContent(
      "Your ₦560 commission is returned to your wallet.",
      { exact: false },
    );
    expect(outcome).toHaveTextContent("They weren’t charged.", {
      exact: false,
    });
    // The marketplace said no rematch is available: none is mentioned.
    expect(outcome).not.toHaveTextContent("rematch", { exact: false });
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].path).toBe(WITHDRAW);
    expect(writes[0].body).toEqual({
      reason: "Fleet vehicle in planned service",
    });
    keyOf(writes[0]);
    view.unmount();
  });

  it("mentions a rematch only when the marketplace says one is available", async () => {
    serve({ [WITHDRAW]: () => ({ status: 200, json: withdrawn(true) }) });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.impactWithdraw));
    fireEvent.press(screen.getByTestId(FLEET_TID.impactWithdrawConfirm));
    expect(
      await screen.findByTestId(FLEET_TID.impactOutcome),
    ).toHaveTextContent("The rider can choose a rematch at the same fare.", {
      exact: false,
    });
    view.unmount();
  });

  it("accepts a proposed vehicle swap with the exact POST — and the rider still has to confirm it", async () => {
    const swap = {
      swapId: SWAP_ID,
      state: "proposed" as const,
      from: { label: "Comfort · 4 seats", classes: ["comfort"], capacity: 4 },
      to: {
        label: "Comfort · 4 seats · Corolla",
        classes: ["comfort"],
        capacity: 4,
      },
      expiresAt: "2026-09-30T08:00:00.000Z",
      notice: "Same fare. The rider confirms the new vehicle.",
    };
    const offered = booking({ vehicleSwap: swap });
    const wire = serve(
      {
        [ACCEPT]: () => ({
          status: 200,
          json: booking({
            vehicleSwap: {
              ...swap,
              state: "rider_consent_pending",
            },
          }),
        }),
      },
      {
        conflict: conflict({
          options: [
            {
              id: "keep_on_swapped_vehicle",
              enabled: true,
              reason:
                "Your fleet proposes the vehicle; you accept it, then the rider confirms.",
              outcome: null,
              next: null,
            },
            ...conflict().options.slice(1),
          ],
        }),
        booking: offered,
      },
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText(
        "Your fleet proposes Comfort · 4 seats · Corolla instead of Comfort · 4 seats.",
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(FLEET_TID.impactSwapAccept));
    expect(
      await screen.findByText("You accepted the other vehicle"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "UBI checks it, then the rider is asked to confirm it. Nothing changes until they do — the fare stays the same and your commission isn’t charged again.",
      ),
    ).toBeTruthy();
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(ACCEPT);
    expect(writes[0].body).toBeUndefined();
    keyOf(writes[0]);
    view.unmount();
  });

  it("while MOVING: the lock and the deadline, no choices", async () => {
    const wire = serve();
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.motionLock)).toHaveTextContent(
      "Review when stopped",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.motionDeadline)).toHaveTextContent(
      "Earliest deadline 09:20",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.impactWithdraw)).toBeNull();
    expect(
      screen.queryByTestId(dynamicTestId(FLEET_TID.impactOption, "withdraw")),
    ).toBeNull();
    expect(wire.writes()).toEqual([]);
    view.unmount();
  });

  it("stale location: the choices are readable, but only the parked ack shows the Withdraw control", async () => {
    serve();
    const view = harness();
    expect(
      await screen.findByTestId(
        dynamicTestId(FLEET_TID.impactOption, "withdraw"),
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId(FLEET_TID.impactWithdraw)).toBeNull();
    expect(screen.getByTestId(FLEET_TID.motionParked)).toBeTruthy();
    view.unmount();
  });

  it("a marketplace refusal (not parked) is explained and drops back to the stale lock", async () => {
    serve({
      [WITHDRAW]: () => ({
        status: 422,
        json: {
          code: "driver_ineligible",
          message: "not stationary",
          details: { reason: "NOT_STATIONARY" },
        },
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.impactWithdraw));
    fireEvent.press(screen.getByTestId(FLEET_TID.impactWithdrawConfirm));
    expect(await screen.findByTestId(FLEET_TID.refusal)).toHaveTextContent(
      "Stop safely first",
      { exact: false },
    );
    expect(currentMotion()).toBe("stale_location");
    view.unmount();
  });

  it("offline: nothing withdrawn, and the retry reuses the same Idempotency-Key", async () => {
    let offline = true;
    const wire = serve({
      [WITHDRAW]: () =>
        offline ? "offline" : { status: 200, json: withdrawn(false) },
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.impactWithdraw));
    fireEvent.press(screen.getByTestId(FLEET_TID.impactWithdrawConfirm));
    expect(await screen.findByTestId(FLEET_TID.refusal)).toHaveTextContent(
      "You’re offline",
      { exact: false },
    );
    offline = false;
    fireEvent.press(screen.getByTestId(FLEET_TID.impactWithdrawConfirm));
    await screen.findByTestId(FLEET_TID.impactOutcome);
    const [first, second] = wire.writes();
    expect(keyOf(second)).toBe(keyOf(first));
    view.unmount();
  });

  it("a time-off conflict offers to trim the time off in the editor", async () => {
    serve(
      {},
      {
        conflict: conflict({
          type: "time_off_overlaps_booking",
          severity: "medium",
          deadlineAt: null,
          options: [
            {
              id: "trim_time_off",
              enabled: true,
              reason: null,
              outcome: null,
              next: { method: "PUT", path: "/v1/drivers/me/availability" },
            },
            conflict().options[2],
          ],
        }),
        booking: booking({ risk: null }),
      },
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText("Your time off overlaps this booking"),
    ).toBeTruthy();
    fireEvent.press(screen.getByText("Edit time off"));
    expect(mockNavigate).toHaveBeenCalledWith("FleetAvailability");
    view.unmount();
  });

  it("fleet-service's feature_disabled is the honest not-available state", async () => {
    installWire(() => ({
      status: 404,
      json: {
        code: "feature_disabled",
        message: "fleet is not available here",
      },
    }));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.unavailable)).toBeTruthy();
    view.unmount();
  });
});
