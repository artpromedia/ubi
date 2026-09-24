// C5 ReportVehicleIssue on the real wire. Covers stationary-only reporting (moving →
// no severity and no submit; stale → only the server's parked ack unlocks), the two
// choices with neutral "what happens" copy (a breakdown is NOT pro-rated — decisions
// Q8), the exact POST /v1/drivers/me/vehicle-issues body with an Idempotency-Key, the
// outcome with each booking decision the report opened (C3), the service request,
// the pointer to SOS for personal safety, the server's "not your vehicle" refusal,
// and the offline retry under the same key.
import React from "react";
import "@testing-library/react-native/extend-expect";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, type WireCall } from "../../../../jest/wire";
import {
  PARKED_ACK,
  arrangements,
  issue,
  schedule,
} from "../../../../jest/fleetFixtures";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import { FleetReportIssueScreen } from "../FleetReportIssueScreen";
import { FLEET_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

const REPORT = "/v1/drivers/me/vehicle-issues";
const VEHICLE = "11111111-1111-4111-8111-111111111111";

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
        <FleetReportIssueScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const keyOf = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

const serve = (report?: (call: WireCall) => unknown, list = arrangements()) =>
  installWire((call) => {
    if (call.method === "GET" && call.path === "/v1/drivers/me/fleet")
      return { status: 200, json: list };
    if (call.method === "GET" && call.path === "/v1/drivers/me/schedule")
      return { status: 200, json: schedule() };
    if (call.path === "/v1/mp/driver/parked")
      return { status: 200, json: PARKED_ACK };
    if (call.path === REPORT && report)
      return report(call) as { status: number; json?: unknown } | "offline";
    return undefined;
  });

describe("FleetReportIssueScreen (C5)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    resetMotionForDev();
  });

  it("while MOVING: nothing to choose or send — the lock, and SOS stays one tap away", async () => {
    const wire = serve();
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.motionLock)).toHaveTextContent(
      "Review when stopped",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.reportCannotDrive)).toBeNull();
    expect(screen.queryByTestId(FLEET_TID.reportIssue)).toBeNull();
    fireEvent.press(screen.getByTestId(FLEET_TID.reportSos));
    expect(mockNavigate).toHaveBeenCalledWith("Sos");
    expect(wire.writes()).toEqual([]);
    view.unmount();
  });

  it("stale location: only the server's parked ack opens the report", async () => {
    const wire = serve();
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.motionLock)).toBeTruthy();
    fireEvent.press(screen.getByTestId(FLEET_TID.motionParked));
    expect(await screen.findByTestId(FLEET_TID.reportCannotDrive)).toBeTruthy();
    expect(wire.writes().map((c) => c.path)).toEqual(["/v1/mp/driver/parked"]);
    view.unmount();
  });

  it("reports a breakdown: the exact POST with an Idempotency-Key, then each booking decision it opened", async () => {
    const wire = serve(() => ({ status: 201, json: issue() }));
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText("Your Example Fleet vehicle · Day · 06:00–18:00"),
    ).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.reportIssue)).toBeDisabled();
    fireEvent.press(screen.getByTestId(FLEET_TID.reportCannotDrive));
    expect(
      screen.getByText(
        "• Your fleet is alerted right away, and the vehicle is marked off-road.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "• Lost hours count under the shortfall rule in your signed terms.",
      ),
    ).toBeTruthy();
    // Decisions Q8: a breakdown is never described as pro-rated.
    expect(screen.queryByText(/pro-rated/i)).toBeNull();
    expect(
      screen.getByText(
        "If you’re unsafe, use the SOS button. This form only reports the vehicle.",
      ),
    ).toBeTruthy();
    fireEvent.changeText(
      screen.getByTestId(FLEET_TID.reportNote),
      "  Engine won't start ",
    );
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    const outcome = await screen.findByTestId(FLEET_TID.reportOutcome);
    expect(outcome).toHaveTextContent("Breakdown reported", { exact: false });
    expect(outcome).toHaveTextContent(
      "Your fleet has been alerted and the vehicle is marked off-road.",
      { exact: false },
    );
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].path).toBe(REPORT);
    expect(writes[0].body).toEqual({
      vehicleId: VEHICLE,
      severity: "cannot_drive",
      note: "Engine won't start",
    });
    keyOf(writes[0]);
    const decision = screen.getByTestId(
      dynamicTestId(FLEET_TID.reportDecision, "fcf_7"),
    );
    expect(decision).toHaveTextContent("Decide by 09:20", { exact: false });
    fireEvent.press(screen.getByText("Decide"));
    expect(mockNavigate).toHaveBeenCalledWith("FleetConflict", {
      conflictId: "fcf_7",
    });
    view.unmount();
  });

  it("asks the fleet for a service: the vehicle stays on the road and no booking changes", async () => {
    const wire = serve(() => ({
      status: 201,
      json: issue({
        severity: "service_soon",
        block: null,
        decisions: [],
        remittanceEffect: "none",
      }),
    }));
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.reportServiceSoon));
    expect(
      screen.getByText(
        "• The vehicle stays on the road and your bookings don’t change.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.reportIssue)).toHaveTextContent(
      "Tell my fleet",
    );
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    expect(
      await screen.findByTestId(FLEET_TID.reportOutcome),
    ).toHaveTextContent(
      "Your fleet has been asked to plan a service. The vehicle stays on the road.",
      { exact: false },
    );
    expect(wire.writes()[0].body).toEqual({
      vehicleId: VEHICLE,
      severity: "service_soon",
    });
    view.unmount();
  });

  it("with two fleet vehicles the driver picks which one", async () => {
    const wire = serve(
      () => ({ status: 201, json: issue() }),
      arrangements([
        {},
        { shift: { kind: "night", start: "18:00", end: "06:00" } },
      ]),
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.reportCannotDrive));
    expect(screen.getByTestId(FLEET_TID.reportIssue)).toBeDisabled();
    fireEvent.press(
      screen.getByTestId(
        dynamicTestId(
          FLEET_TID.reportVehicle,
          "11111111-1111-4111-8111-111111111112",
        ),
      ),
    );
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    await screen.findByTestId(FLEET_TID.reportOutcome);
    expect((wire.writes()[0].body as { vehicleId: string }).vehicleId).toBe(
      "11111111-1111-4111-8111-111111111112",
    );
    view.unmount();
  });

  it("the server's “not your vehicle” refusal is explained in plain words", async () => {
    serve(() => ({
      status: 403,
      json: {
        code: "forbidden",
        message:
          "You can only report the vehicle you're assigned to right now.",
        details: { reason: "not_assigned_to_vehicle" },
      },
    }));
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.reportCannotDrive));
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    const refusal = await screen.findByTestId(FLEET_TID.refusal);
    expect(refusal).toHaveTextContent("Not your vehicle right now", {
      exact: false,
    });
    expect(screen.queryByTestId(FLEET_TID.reportOutcome)).toBeNull();
    view.unmount();
  });

  it("offline: nothing reported, and the retry reuses the same Idempotency-Key", async () => {
    let offline = true;
    const wire = serve(() =>
      offline ? "offline" : { status: 201, json: issue() },
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.reportCannotDrive));
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    expect(await screen.findByTestId(FLEET_TID.refusal)).toHaveTextContent(
      "You’re offline",
      { exact: false },
    );
    offline = false;
    fireEvent.press(screen.getByTestId(FLEET_TID.reportIssue));
    await screen.findByTestId(FLEET_TID.reportOutcome);
    const [first, second] = wire.writes();
    expect(keyOf(second)).toBe(keyOf(first));
    view.unmount();
  });

  it("no fleet vehicle assigned: says so, offers no report, keeps SOS", async () => {
    serve(undefined, arrangements([{ status: "ended" }]));
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByText("No fleet vehicle assigned to you"),
    ).toBeTruthy();
    expect(screen.queryByTestId(FLEET_TID.reportIssue)).toBeNull();
    expect(screen.getByTestId(FLEET_TID.reportSos)).toBeTruthy();
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
