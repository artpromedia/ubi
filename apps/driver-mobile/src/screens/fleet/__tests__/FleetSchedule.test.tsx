// C1 DriverSchedule against the real wire (the production api() with only fetch
// stubbed; fixtures parsed through @ubi/contracts): the exact GETs, one agenda per
// local day on the city's clock with the zone named, every block's word printed, the
// at-risk booking with its deadline, the decision banner leading to the booking
// (C3), the C2b lock while moving (what's waiting + earliest deadline, no entry),
// empty / error / offline / stale states, fleet-service's own 404
// feature_disabled, and the deny-by-default `fleet` gate.
import React from "react";
import { Text } from "react-native";
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
import { FlagsProvider, installFixtures } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { installWire } from "../../../../jest/wire";
import {
  emptySchedule,
  offer,
  offers,
  schedule,
} from "../../../../jest/fleetFixtures";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import { FleetGate } from "../FleetParts";
import { FleetScheduleScreen } from "../FleetScheduleScreen";
import { FLEET_TID } from "../testIds";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

const SCHEDULE = "/v1/drivers/me/schedule";
const OFFERS = "/v1/drivers/me/fleet-offers";

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
        <FleetScheduleScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe("FleetScheduleScreen (C1)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    resetMotionForDev();
  });

  it("reads the server-composed schedule and renders one agenda per local day, every block with its word", async () => {
    const wire = installWire((call) =>
      call.path === SCHEDULE
        ? { status: 200, json: schedule() }
        : call.path === OFFERS
          ? { status: 200, json: offers([]) }
          : undefined,
    );
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.scheduleView)).toBeTruthy();
    expect(wire.calls.map((c) => c.method + " " + c.path).sort()).toEqual([
      "GET " + OFFERS,
      "GET " + SCHEDULE,
    ]);
    expect(screen.getByText("Times in Africa/Lagos")).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(FLEET_TID.scheduleDay, "2026-09-30")),
    ).toHaveTextContent("Wed 30 Sep", { exact: false });
    // Local wall-clock times (UTC+1), and the word on every block.
    const shift = screen.getByTestId(
      dynamicTestId(FLEET_TID.scheduleItem, "asg_1@1759208400000"),
    );
    expect(shift).toHaveTextContent("06:00–18:00", { exact: false });
    expect(shift).toHaveTextContent("Signed shift", { exact: false });
    expect(shift).toHaveTextContent("Example Fleet · LAG-118-AB · Day", {
      exact: false,
    });
    expect(
      screen.getByTestId(dynamicTestId(FLEET_TID.scheduleItem, "mnt_1")),
    ).toHaveTextContent("Vehicle in service", { exact: false });
    const booking = screen.getByTestId(
      dynamicTestId(FLEET_TID.scheduleItem, "bkg_1"),
    );
    expect(booking).toHaveTextContent("11:20–13:00", { exact: false });
    expect(booking).toHaveTextContent("At risk · decide by 09:20", {
      exact: false,
    });
    // A screen reader hears the same, as words.
    expect(
      screen.getByLabelText(
        "Booking, Wed 30 Sep · 11:20–11:35 · Confirmed, 11:20 to 13:00, at risk, decide by 09:20",
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it("the decision banner names what's waiting and its deadline, and opens the booking decision", async () => {
    installWire((call) =>
      call.path === SCHEDULE
        ? { status: 200, json: schedule() }
        : call.path === OFFERS
          ? { status: 200, json: offers([offer()]) }
          : undefined,
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    const bannerCard = await screen.findByTestId(FLEET_TID.decisionBanner);
    expect(bannerCard).toHaveTextContent("1 proposal and 1 booking decision", {
      exact: false,
    });
    expect(bannerCard).toHaveTextContent("Decide by 09:20 · Wed 30 Sep", {
      exact: false,
    });
    fireEvent.press(screen.getByText("Review booking"));
    expect(mockNavigate).toHaveBeenCalledWith("FleetConflict", {
      conflictId: "fcf_1",
    });
    fireEvent.press(screen.getByTestId(FLEET_TID.proposalEntry));
    expect(mockNavigate).toHaveBeenCalledWith("FleetProposal");
    view.unmount();
  });

  it("while MOVING shows the C2b lock instead: what's waiting and the earliest deadline, no way in", async () => {
    installWire((call) =>
      call.path === SCHEDULE
        ? { status: 200, json: schedule() }
        : call.path === OFFERS
          ? { status: 200, json: offers([offer()]) }
          : undefined,
    );
    act(() => setMotionForDev("moving"));
    const view = harness();
    const lock = await screen.findByTestId(FLEET_TID.motionLock);
    expect(lock).toHaveTextContent("Review when stopped", { exact: false });
    expect(lock).toHaveTextContent(
      "You have 1 proposal and 1 booking decision. They’ll open once you’re safely stationary.",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.motionDeadline)).toHaveTextContent(
      "Earliest deadline 09:20",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.decisionBanner)).toBeNull();
    expect(screen.queryByTestId(FLEET_TID.proposalEntry)).toBeNull();
    expect(screen.queryByText("Decide")).toBeNull();
    view.unmount();
  });

  it("says plainly when nothing is scheduled", async () => {
    installWire((call) =>
      call.path === SCHEDULE
        ? { status: 200, json: emptySchedule() }
        : call.path === OFFERS
          ? { status: 200, json: offers([]) }
          : undefined,
    );
    const view = harness();
    expect(
      await screen.findByTestId(FLEET_TID.scheduleEmpty),
    ).toHaveTextContent("Nothing scheduled this week", { exact: false });
    expect(screen.queryByTestId(FLEET_TID.decisionBanner)).toBeNull();
    view.unmount();
  });

  it("offline: says so, and retries the same read", async () => {
    let offline = true;
    const wire = installWire((call) =>
      offline
        ? "offline"
        : call.path === SCHEDULE
          ? { status: 200, json: schedule() }
          : { status: 200, json: offers([]) },
    );
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.offline)).toHaveTextContent(
      "You’re offline",
      { exact: false },
    );
    offline = false;
    fireEvent.press(screen.getByTestId(FLEET_TID.retry));
    expect(await screen.findByTestId(FLEET_TID.scheduleView)).toBeTruthy();
    expect(wire.calls.filter((c) => c.path === SCHEDULE)).toHaveLength(2);
    view.unmount();
  });

  it("a server error keeps the server's wording and offers a retry", async () => {
    installWire(() => ({
      status: 503,
      json: { code: "service_unavailable", message: "down" },
    }));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.error)).toHaveTextContent(
      "We couldn’t load your schedule",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.retry)).toBeTruthy();
    view.unmount();
  });

  it("fleet-service's 404 feature_disabled renders the honest not-available state, no data", async () => {
    installWire(() => ({
      status: 404,
      json: {
        code: "feature_disabled",
        message: "fleet is not available here",
        details: { feature: "fleet" },
      },
    }));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.unavailable)).toHaveTextContent(
      "Fleet tools aren’t available yet in your city",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.scheduleView)).toBeNull();
    view.unmount();
  });

  it("keeps the last good schedule after a failed refresh and says how old it is", async () => {
    let offline = false;
    installWire((call) =>
      offline
        ? "offline"
        : call.path === SCHEDULE
          ? { status: 200, json: schedule() }
          : { status: 200, json: offers([]) },
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <ThemeProvider defaultMode="dark">
        <QueryClientProvider client={client}>
          <FleetScheduleScreen />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await screen.findByTestId(FLEET_TID.scheduleView);
    offline = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ["fleet", "schedule"] });
    });
    await waitFor(() =>
      expect(screen.getByTestId(FLEET_TID.offline)).toHaveTextContent(
        "Offline · showing data from Wed 30 Sep · 08:12",
        { exact: false },
      ),
    );
    expect(screen.getByTestId(FLEET_TID.scheduleView)).toBeTruthy();
    view.unmount();
  });
});

describe("FleetGate (deny-by-default `fleet` flag)", () => {
  const setFlags = (map: Record<string, boolean> | "unreachable") =>
    installFixtures(async ({ path }) => {
      if (path.startsWith("/v1/config/flags")) {
        if (map === "unreachable")
          return {
            status: 503,
            json: { code: "unavailable", message: "down" },
          };
        return { status: 200, json: map };
      }
      return undefined;
    });
  const Gated = ({ cityId }: { cityId?: string }) => {
    return (
      <ThemeProvider defaultMode="dark">
        <FlagsProvider cityId={cityId}>
          <FleetGate onDismiss={() => {}}>
            <Text>FLEET CONTENT</Text>
          </FleetGate>
        </FlagsProvider>
      </ThemeProvider>
    );
  };

  it("opens only when the city has the fleet flag on", async () => {
    setFlags({ fleet: true });
    render(<Gated cityId="LOS" />);
    expect(await screen.findByText("FLEET CONTENT")).toBeTruthy();
  });

  it("flag off: the honest “not available yet” screen and none of the content", async () => {
    setFlags({ fleet: false, marketplace_rides: true });
    render(<Gated cityId="LOS" />);
    expect(
      await screen.findByTestId(TEST_IDS.common.flagOff.screen),
    ).toHaveTextContent("Fleet tools aren’t available yet in your city", {
      exact: false,
    });
    expect(screen.queryByText("FLEET CONTENT")).toBeNull();
  });

  it("an unreachable flag service or no city denies (never fails open)", async () => {
    setFlags("unreachable");
    const first = render(<Gated cityId="LOS" />);
    expect(
      await screen.findByTestId(TEST_IDS.common.flagOff.screen),
    ).toBeTruthy();
    first.unmount();
    render(<Gated cityId={undefined} />);
    expect(
      await screen.findByTestId(TEST_IDS.common.flagOff.screen),
    ).toBeTruthy();
    expect(screen.queryByText("FLEET CONTENT")).toBeNull();
  });
});
