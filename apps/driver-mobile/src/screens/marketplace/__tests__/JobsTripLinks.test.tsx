// Entry points into the A02/A03 screens from Jobs. The trip links open only from the
// SERVER's own requestId on the current job (never inferred from bids) and only while
// the market offers the capability; the calendar entry only where advance bookings are
// on. Deny-by-default: with the flags off nothing new renders.
import React from "react";
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
import { TEST_IDS } from "@ubi/contracts";
import { installWire, NGN } from "../../../../jest/wire";
import { JobsTimelineContainer } from "../JobsTimelineContainer";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const JOBS = TEST_IDS.mp.driver.jobs;
const FLAGS_PATH = "/v1/config/flags?cityId=LOS";

const jobs = (requestId?: string) => ({
  current: {
    claimId: "clm_cur",
    ...(requestId ? { requestId } : {}),
    slot: "current",
    service: "ride",
    state: "in trip",
    fareMinor: NGN(6000_00),
    commissionMinor: NGN(600_00),
    receiptId: "rcpt_1",
    executionRef: { service: "ride", id: "ride_1" },
  },
  promotion: "none",
});

/** Let an in-flight flag response land before asserting on what it hides. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <FlagsProvider cityId="LOS">
        <QueryClientProvider client={client}>
          <JobsTimelineContainer />
        </QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
};

describe("Jobs → trip stops, route changes and bookings", () => {
  beforeEach(() => mockNavigate.mockReset());

  it("opens the trip screens from the server's requestId when the flags are on", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: {
            marketplace_rides: true,
            marketplace_multi_stop: true,
            marketplace_trip_amendments: true,
            marketplace_advance_reservations: true,
          },
        };
      if (call.path === "/v1/mp/driver/jobs")
        return { status: 200, json: jobs("req_1") };
      return undefined;
    });
    const view = harness();
    fireEvent.press(await screen.findByTestId(JOBS.stops));
    expect(mockNavigate).toHaveBeenLastCalledWith("MpTrip", {
      requestId: "req_1",
    });
    fireEvent.press(screen.getByTestId(JOBS.changes));
    expect(mockNavigate).toHaveBeenLastCalledWith("MpAmendments", {
      requestId: "req_1",
    });
    fireEvent.press(screen.getByTestId(JOBS.calendar));
    expect(mockNavigate).toHaveBeenLastCalledWith("Calendar");
    view.unmount();
  });

  it("offers no trip entry when the server names no request, and nothing new with the flags off", async () => {
    let withRequest = false;
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: withRequest
            ? { marketplace_rides: true }
            : {
                marketplace_rides: true,
                marketplace_multi_stop: true,
                marketplace_trip_amendments: true,
              },
        };
      if (call.path === "/v1/mp/driver/jobs")
        return {
          status: 200,
          json: jobs(withRequest ? "req_1" : undefined),
        };
      return undefined;
    });
    const first = harness();
    await screen.findByTestId(JOBS.current);
    await waitFor(() =>
      expect(wire.calls.some((c) => c.path === FLAGS_PATH)).toBe(true),
    );
    await flush();
    expect(screen.queryByTestId(JOBS.stops)).toBeNull();
    expect(screen.queryByTestId(JOBS.calendar)).toBeNull();
    first.unmount();

    withRequest = true; // requestId present, but every capability flag off
    const second = harness();
    await screen.findByTestId(JOBS.current);
    await waitFor(() =>
      expect(
        wire.calls.filter((c) => c.path === FLAGS_PATH).length,
      ).toBeGreaterThan(1),
    );
    await flush();
    expect(screen.queryByTestId(JOBS.stops)).toBeNull();
    expect(screen.queryByTestId(JOBS.changes)).toBeNull();
    expect(screen.queryByTestId(JOBS.calendar)).toBeNull();
    second.unmount();
  });
});
