// A02 per-stop execution against the REAL ride-service shapes (fixtures are parsed with
// @ubi/contracts MpTripSchema, so they cannot drift from the contract): ordered stops
// with server status words, arrive → exact POST with a valid Idempotency-Key, the
// server's geofence refusal → disputed arrival, the waiting panel rendered from server
// figures (allowance, paid waiting, cap, rider approval, excessive → skip), the offline
// retry reusing its key, and early termination only once the server acknowledged the
// driver as parked (expectedFareRevision bound, plain-copy refusal when it isn't).
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
import { installWire, NGN, isoIn, type WireCall } from "../../../../jest/wire";
import {
  stop,
  trip,
  waitingAt,
  type StopWaiting,
  type TripStop,
} from "../../../../jest/mpFixtures";
import {
  currentMotion,
  resetMotionForDev,
  setMotionForDev,
} from "../../../lib/motion";
import { TripStopsContainer } from "../TripStopsContainer";
import { MP_DRIVER_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { requestId: "req_1" } }),
}));

const TID = MP_DRIVER_TID.trip;
const TRIP_PATH = "/v1/mp/requests/req_1/trip";
const FLAGS_PATH = "/v1/config/flags?cityId=LOS";

const arrivedTrip = (
  waiting: Partial<StopWaiting> = {},
  extra: Partial<TripStop> = {},
) =>
  trip({
    version: 4,
    stops: [
      stop({
        stopId: "stp_1",
        order: 1,
        label: "Ikoyi pharmacy",
        state: "arrived",
        arrivedAt: isoIn(-372_000),
        waiting: waitingAt(waiting),
        ...extra,
      }),
      stop({ stopId: "stp_2", order: 2, label: "Obalende" }),
    ],
  });

const flags = (on: Record<string, boolean>) => ({
  marketplace_rides: true,
  ...on,
});

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
          <TripStopsContainer />
        </QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
};

const expectKey = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

describe("TripStopsContainer (A02 per-stop execution)", () => {
  beforeEach(() => {
    resetMotionForDev();
    mockNavigate.mockReset();
  });

  it("renders the ordered stops with their status in words and arrives with the exact POST", async () => {
    let current = trip();
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH) return { status: 200, json: flags({}) };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: current };
      if (call.path === "/v1/mp/requests/req_1/stops/stp_1/arrive") {
        current = arrivedTrip({
          waitedSec: 15,
          allowanceRemainingSec: 105,
          paidSec: 0,
          feeMinor: NGN(0),
          accruing: false,
          settlement: "none",
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    const view = harness();
    expect(await screen.findByText("Stop 1 · Ikoyi pharmacy")).toBeTruthy();
    expect(screen.getByText("Stop 2 · Obalende")).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(TID.stopStatus, "stp_1")).props
        .accessibilityLabel,
    ).toBe("Status: Not reached yet");
    // Only the next stop in order can be arrived at.
    expect(screen.queryByTestId(dynamicTestId(TID.arrive, "stp_2"))).toBeNull();

    fireEvent.press(screen.getByTestId(dynamicTestId(TID.arrive, "stp_1")));
    await screen.findByTestId(dynamicTestId(TID.waiting, "stp_1"));
    const [arrive] = wire.writes();
    expect(arrive.method).toBe("POST");
    expect(arrive.path).toBe("/v1/mp/requests/req_1/stops/stp_1/arrive");
    expect(arrive.body).toBeUndefined(); // a confirmed arrival sends no body
    expectKey(arrive);
    expect(screen.getByText("Waiting · 0:15")).toBeTruthy();
    expect(screen.getByText("2:00 · 1:45 left")).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(TID.stopStatus, "stp_1")).props
        .accessibilityLabel,
    ).toBe("Status: Arrived · waiting");
    view.unmount();
  });

  it("shows the server's geofence refusal, then records a DISPUTED arrival that starts no paid waiting", async () => {
    let current = trip();
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH) return { status: 200, json: flags({}) };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: current };
      if (call.path === "/v1/mp/requests/req_1/stops/stp_1/arrive") {
        if (!(call.body as { disputed?: boolean } | undefined)?.disputed)
          return {
            status: 422,
            json: {
              code: "not_at_pickup",
              message: "the driver is not at this stop yet",
              details: {
                reason: "not_at_stop",
                distanceMeters: 420,
                geofenceMeters: 150,
                stopId: "stp_1",
              },
            },
          };
        current = trip({
          version: 4,
          stops: [
            stop({
              stopId: "stp_1",
              order: 1,
              label: "Ikoyi pharmacy",
              state: "arrived",
              arrivedAt: isoIn(0),
              arrivalDisputed: true,
              arrivalDistanceMeters: 420,
            }),
            stop({ stopId: "stp_2", order: 2, label: "Obalende" }),
          ],
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    const view = harness();
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.arrive, "stp_1")),
    );
    expect(await screen.findByText("You’re not at this stop yet")).toBeTruthy();
    expect(
      screen.getByText("The server places you 420 m away (stop area 150 m)."),
    ).toBeTruthy();

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.arriveDisputed, "stp_1")),
    );
    await screen.findByTestId(dynamicTestId(TID.disputed, "stp_1"));
    const [refused, disputed] = wire.writes();
    expect(disputed.body).toEqual({ disputed: true });
    expect(expectKey(disputed)).not.toBe(expectKey(refused));
    expect(
      screen.getByText(/paid waiting hasn’t started/, { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(TID.stopStatus, "stp_1")).props
        .accessibilityLabel,
    ).toBe("Status: Arrived · disputed");
    // A disputed arrival can be confirmed from inside the fence later.
    expect(screen.getByTestId(dynamicTestId(TID.arrive, "stp_1"))).toBeTruthy();
    expect(screen.getByText("Confirm arrival")).toBeTruthy();
    view.unmount();
  });

  it("renders waiting from server figures: paid fee, authorized cap, rider approval needed, excessive → skip", async () => {
    let current = arrivedTrip({ approvalRequired: true, excessive: true });
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH) return { status: 200, json: flags({}) };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: current };
      if (call.path === "/v1/mp/requests/req_1/stops/stp_1/skip") {
        current = trip({
          version: 5,
          stops: [
            stop({
              stopId: "stp_1",
              order: 1,
              label: "Ikoyi pharmacy",
              state: "skipped",
              skipReason: "excessive_waiting",
              waiting: waitingAt({ accruing: false, settlement: "committed" }),
            }),
            stop({ stopId: "stp_2", order: 2, label: "Obalende" }),
          ],
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    const view = harness();
    expect(await screen.findByText("Waiting · 6:12")).toBeTruthy();
    expect(screen.getByText("Paid waiting · 4:12 · accruing")).toBeTruthy();
    const paid = screen.getByTestId(dynamicTestId(TID.paidWaiting, "stp_1"));
    expect(paid).toHaveTextContent(/₦250/);
    expect(
      screen.getByTestId(dynamicTestId(TID.waitingCap, "stp_1")),
    ).toHaveTextContent(/₦1,500/);
    expect(screen.getByText("Rider approval needed")).toBeTruthy();
    expect(screen.getByText("Waiting is now excessive")).toBeTruthy();

    fireEvent.press(screen.getByTestId(dynamicTestId(TID.skip, "stp_1")));
    await waitFor(() =>
      expect(
        screen.getByTestId(dynamicTestId(TID.stopStatus, "stp_1")).props
          .accessibilityLabel,
      ).toBe("Status: Skipped · left after excessive waiting"),
    );
    const [skip] = wire.writes();
    expect(skip.path).toBe("/v1/mp/requests/req_1/stops/stp_1/skip");
    expect(skip.body).toEqual({ reason: "excessive_waiting" });
    expectKey(skip);
    expect(screen.getByText("Waiting fee settled")).toBeTruthy();
    view.unmount();
  });

  it("does not offer skip before waiting is excessive; an offline depart retries under the SAME key", async () => {
    let departs = 0;
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH) return { status: 200, json: flags({}) };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: arrivedTrip() };
      if (call.path === "/v1/mp/requests/req_1/stops/stp_1/depart") {
        departs += 1;
        if (departs === 1) return "offline";
        return {
          status: 200,
          json: trip({
            version: 5,
            stops: [
              stop({
                stopId: "stp_1",
                order: 1,
                label: "Ikoyi pharmacy",
                state: "departed",
                waiting: waitingAt({ accruing: false }),
              }),
              stop({ stopId: "stp_2", order: 2, label: "Obalende" }),
            ],
          }),
        };
      }
      return undefined;
    });
    const view = harness();
    await screen.findByTestId(dynamicTestId(TID.waiting, "stp_1"));
    expect(screen.queryByTestId(dynamicTestId(TID.skip, "stp_1"))).toBeNull();

    fireEvent.press(screen.getByTestId(dynamicTestId(TID.depart, "stp_1")));
    expect(await screen.findByText("You’re offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.depart, "stp_1")));
    await waitFor(() =>
      expect(
        screen.getByTestId(dynamicTestId(TID.stopStatus, "stp_1")).props
          .accessibilityLabel,
      ).toBe("Status: Departed"),
    );
    const [first, retry] = wire.writes();
    expect(first.path).toBe("/v1/mp/requests/req_1/stops/stp_1/depart");
    expect(first.body).toBeUndefined();
    expect(expectKey(retry)).toBe(expectKey(first));
    expect(screen.queryByTestId(TID.actionError)).toBeNull();
    // The next stop is now the one to arrive at.
    expect(screen.getByTestId(dynamicTestId(TID.arrive, "stp_2"))).toBeTruthy();
    view.unmount();
  });

  it("gates early termination on the server's parked acknowledgement and binds expectedFareRevision", async () => {
    let current = arrivedTrip();
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: flags({
            marketplace_multi_stop: true,
            marketplace_trip_amendments: true,
          }),
        };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: current };
      if (call.path === "/v1/mp/driver/parked")
        return {
          status: 200,
          json: {
            state: "parked_confirmed",
            availabilityEpoch: 9,
            confirmedAt: isoIn(0),
            expiresAt: isoIn(600_000),
            ttlSeconds: 600,
          },
        };
      if (call.path === "/v1/mp/requests/req_1/terminate") {
        current = trip({
          version: 6,
          fareRevision: 2,
          agreedFareMinor: NGN(4800_00),
          terminatedAt: isoIn(0),
          committedAdjustments: [
            {
              amendmentId: "amd_term",
              kind: "early_termination",
              fareDeltaMinor: NGN(-1200_00),
              fareRevision: 2,
              committedAt: isoIn(0),
            },
          ],
          stops: [
            stop({
              stopId: "stp_1",
              order: 1,
              label: "Ikoyi pharmacy",
              state: "departed",
            }),
            stop({
              stopId: "stp_2",
              order: 2,
              label: "Obalende",
              state: "skipped",
              skipReason: "trip_terminated",
            }),
          ],
        });
        return { status: 200, json: current };
      }
      return undefined;
    });
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(
      await screen.findByText("Stop safely to end the trip early"),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.terminateConfirm)).toBeNull();
    expect(
      screen.queryByTestId(dynamicTestId(TID.terminateReason, "rider_request")),
    ).toBeNull();

    // The attestation asks the SERVER; only its parked_confirmed unlocks the controls.
    fireEvent.press(screen.getByTestId(TID.parked));
    fireEvent.press(await screen.findByText("End trip early…"));
    expect(
      screen.getByText(/refunded to you — it’s never charged again/, {
        exact: false,
      }),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.terminateConfirm)); // disabled: no reason yet
    expect(wire.writes().filter((c) => c.path.endsWith("/terminate"))).toEqual(
      [],
    );
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.terminateReason, "rider_request")),
    );
    fireEvent.press(screen.getByTestId(TID.terminateConfirm));
    await screen.findByTestId(TID.terminated);
    const terminate = wire
      .writes()
      .find((c) => c.path === "/v1/mp/requests/req_1/terminate")!;
    expect(terminate.body).toEqual({
      reason: "rider_request",
      expectedFareRevision: 1,
    });
    expectKey(terminate);
    expect(
      screen.getByTestId(dynamicTestId(TID.adjustment, "amd_term")),
    ).toHaveTextContent(/Trip ended early.*−₦1,200/);
    expect(screen.getByTestId(TID.fare)).toHaveTextContent(/₦4,800/);
    view.unmount();
  });

  it("a 202 termination (money still converging) says it is being applied, keeps the entry closed, then reports the server's resolution", async () => {
    // The server answers 202 with the trip still running and the early_termination
    // adjustment open (terminatedAt is set only at commit).
    let current = trip({ version: 4 });
    let terminates = 0;
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: flags({ marketplace_trip_amendments: true }),
        };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: current };
      if (call.path === "/v1/mp/requests/req_1/terminate") {
        terminates += 1;
        current = trip({ version: 5, openAmendmentId: "amd_term" });
        return { status: 202, json: current };
      }
      return undefined;
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByText("End trip early…"));
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.terminateReason, "safety_concern")),
    );
    fireEvent.press(screen.getByTestId(TID.terminateConfirm));
    expect(await screen.findByText("Ending the trip early")).toBeTruthy();
    // No second entry point and no "approve it" banner for a server adjustment.
    expect(screen.queryByTestId(TID.terminate)).toBeNull();
    expect(screen.queryByTestId(TID.amendmentBanner)).toBeNull();
    expect(terminates).toBe(1);
    expectKey(wire.writes().find((c) => c.path.endsWith("/terminate"))!);

    // The adjustment is released without committing: the trip runs on as agreed.
    current = trip({ version: 6 });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["mp", "trip", "req_1"] });
    });
    expect(
      await screen.findByText("The early end wasn’t applied"),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.terminate)).toBeTruthy();
    view.unmount();
  });

  it("a NOT_STATIONARY refusal is shown in plain words and pauses the fare controls again", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: flags({ marketplace_trip_amendments: true }),
        };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return { status: 200, json: arrivedTrip() };
      if (call.path === "/v1/mp/requests/req_1/terminate")
        return {
          status: 403,
          json: {
            code: "driver_ineligible",
            message: "stop safely before ending the trip",
            details: { reason: "NOT_STATIONARY" },
          },
        };
      return undefined;
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByText("End trip early…"));
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.terminateReason, "vehicle_issue")),
    );
    fireEvent.press(screen.getByTestId(TID.terminateConfirm));
    expect(await screen.findByText("Stop safely first")).toBeTruthy();
    expect(currentMotion()).toBe("stale_location");
    expect(screen.queryByTestId(TID.terminateConfirm)).toBeNull();
    expect(screen.getByTestId(TID.parked)).toBeTruthy();
    view.unmount();
  });

  it("offers no termination or route-change entry while marketplace_trip_amendments is off", async () => {
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: flags({ marketplace_multi_stop: true }),
        };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return {
          status: 200,
          json: trip({ openAmendmentId: "amd_open" }),
        };
      return undefined;
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    await screen.findByTestId(TID.screen);
    // Let the flag map land before asserting on what it hides.
    await waitFor(() =>
      expect(wire.calls.some((c) => c.path === FLAGS_PATH)).toBe(true),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId(TID.terminate)).toBeNull();
    expect(screen.queryByTestId(TID.changes)).toBeNull();
    expect(screen.queryByTestId(TID.amendmentBanner)).toBeNull();
    view.unmount();
  });

  it("links an open amendment to the review screen when amendments are on", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: flags({ marketplace_trip_amendments: true }),
        };
      if (call.method === "GET" && call.path === TRIP_PATH)
        return {
          status: 200,
          json: trip({ openAmendmentId: "amd_open" }),
        };
      return undefined;
    });
    const view = harness();
    await screen.findByTestId(TID.amendmentBanner);
    fireEvent.press(screen.getByText("Review changes"));
    expect(mockNavigate).toHaveBeenCalledWith("MpAmendments", {
      requestId: "req_1",
    });
    view.unmount();
  });

  it("covers the load states: loading, offline with retry, unavailable, and a trip without stops", async () => {
    let mode: "offline" | "missing" | "empty" = "offline";
    installWire((call) => {
      if (call.path === FLAGS_PATH) return { status: 200, json: flags({}) };
      if (call.method === "GET" && call.path === TRIP_PATH) {
        if (mode === "offline") return "offline";
        if (mode === "missing")
          return {
            status: 404,
            json: { code: "not_found", message: "no such trip" },
          };
        return { status: 200, json: trip({ stops: [] }) };
      }
      return undefined;
    });
    const view = harness();
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
    expect(await screen.findByTestId(TID.offline)).toBeTruthy();
    mode = "missing";
    fireEvent.press(screen.getByTestId(TID.retry));
    expect(await screen.findByText("This trip isn’t available")).toBeTruthy();
    expect(screen.getByTestId(TID.error)).toBeTruthy();
    mode = "empty";
    fireEvent.press(screen.getByTestId(TID.retry));
    expect(await screen.findByTestId(TID.empty)).toBeTruthy();
    expect(screen.getByText("No stops on this trip")).toBeTruthy();
    view.unmount();
  });
});
