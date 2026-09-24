// A04.1/A04.2 on the real containers: the feed card and the request detail render the
// server's breakdown fields, the homeward tag and the preferences note exactly as served;
// "Show all" re-asks the SERVER with preferences=ignore (the client never filters); a
// pre-filled "Your minimum trip" preset is just a preset — rendering places no bid.
import React, { type ReactNode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { formatMinor, installFixtures } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MpEarningsBreakdown } from "../../../api/marketplace";
import { setMotionForDev, resetMotionForDev } from "../../../lib/motion";
import { RequestFeedContainer } from "../RequestFeedContainer";
import { RequestDetailContainer } from "../RequestDetailContainer";
import { MP_DRIVER_TID } from "../testIds";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { requestId: "req_min_1" } }),
}));

const NGN = (amountMinor: number) => ({ amountMinor, currency: "NGN" });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const breakdown = (
  gross: number,
  fee: number,
  net: number,
  perHour: number,
): MpEarningsBreakdown => ({
  grossMinor: NGN(gross),
  grossBasis: "requested_fare",
  commissionMinor: NGN(fee),
  commissionBps: 1_000,
  fleetRemittance: {
    status: "none",
    amountMinor: null,
    reason:
      "No fleet arrangement applies to marketplace jobs, so nothing from this fare is remitted to a fleet.",
  },
  estimatedNetMinor: NGN(net),
  pickup: {
    distanceMeters: 1_200,
    distanceBasis: "straight_line",
    durationSec: 180,
    durationBasis: "straight_line_estimate",
    estimate: true,
    paid: false,
    label: "Unpaid pickup · 1.2 km · ~3 min (estimate)",
  },
  route: {
    distanceMeters: 5_003,
    durationSec: 600,
    stopCount: 0,
    stopsWaitingSec: 0,
    estimate: true,
    label: "Paid trip · 5.0 km · ~10 min driving (estimate)",
    waitingLabel: "No stops",
  },
  estimatedNetPerHour: {
    amountMinor: NGN(perHour),
    estimate: true,
    basisSec: 780,
    basis:
      "Estimate: net over pickup ~3 min + trip ~10 min. Excludes fuel/energy and time between jobs.",
  },
  runningCosts: {
    status: "not_estimated",
    reason:
      "No fuel or energy cost input is disclosed, so running costs are not estimated.",
  },
  disclaimer: "Net = fare − 10% UBI commission − fleet remittance (none).",
});

const feedItem = (id: string, homeward: boolean) => ({
  requestId: id,
  revision: 1,
  service: "ride",
  title: "Ride request · go",
  meta: "Area 6.52, 3.37 → Area 6.56, 3.37 · 1.2 km from you",
  askedMinor: NGN(45_000),
  askedByLabel: "Requester asks",
  capabilityBadge: null,
  expiresAt: iso(300_000),
  earnings: breakdown(45_000, 4_500, 40_500, 186_923),
  ...(homeward ? { preferenceTags: ["homeward"] } : {}),
});

const client = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

const wrap = (node: ReactNode) =>
  render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client()}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );

const textOf = (testID: string) => {
  const children = screen.getByTestId(testID).props.children as unknown;
  return Array.isArray(children) ? children.join("") : String(children);
};

describe("offer earnings on the driver containers", () => {
  beforeEach(() => {
    resetMotionForDev();
    act(() => setMotionForDev("parked_confirmed"));
  });

  it("feed: renders each card's server breakdown and asks the server to show all", async () => {
    const paths: string[] = [];
    installFixtures(async ({ method, path }) => {
      if (method !== "GET") return undefined;
      paths.push(path);
      if (path === "/v1/mp/feed")
        return {
          status: 200,
          json: {
            items: [feedItem("req_home", true)],
            nextCursor: null,
            availabilityEpoch: 0,
            preferences: {
              version: 2,
              applied: true,
              hiddenCount: 1,
              note: "Filtered and sorted by your preferences. They never bid for you.",
            },
          },
        };
      if (path === "/v1/mp/feed?preferences=ignore")
        return {
          status: 200,
          json: {
            items: [feedItem("req_home", true), feedItem("req_far", false)],
            nextCursor: null,
            availabilityEpoch: 0,
            preferences: {
              version: 2,
              applied: false,
              hiddenCount: 0,
              note: "Showing every request in your area; your preferences are not applied.",
            },
          },
        };
      if (path === "/v1/mp/bids/mine")
        return { status: 200, json: { bids: [] } };
      return undefined;
    });
    const view = wrap(<RequestFeedContainer />);
    await screen.findByTestId(
      dynamicTestId(TEST_IDS.mp.driver.feed.card, "req_home"),
    );
    expect(textOf(dynamicTestId(MP_DRIVER_TID.earnings.net, "req_home"))).toBe(
      formatMinor(NGN(40_500)),
    );
    expect(
      textOf(dynamicTestId(MP_DRIVER_TID.earnings.pickup, "req_home")),
    ).toBe("Unpaid pickup · 1.2 km · ~3 min (estimate)");
    expect(
      screen.getByTestId(
        dynamicTestId(MP_DRIVER_TID.feed.homewardTag, "req_home"),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("1 request hidden by your preferences"),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId(MP_DRIVER_TID.feed.prefsToggle));
    await screen.findByTestId(
      dynamicTestId(TEST_IDS.mp.driver.feed.card, "req_far"),
    );
    expect(paths).toContain("/v1/mp/feed?preferences=ignore");
    expect(
      screen.queryByTestId(
        dynamicTestId(MP_DRIVER_TID.feed.homewardTag, "req_far"),
      ),
    ).toBeNull();
    expect(screen.getByText("Apply preferences")).toBeTruthy();
    view.unmount(); // stop the feed's refetch interval
  });

  it("detail: full breakdown, per-preset estimate and the preference notice — and no bid", async () => {
    const posts: string[] = [];
    installFixtures(async ({ method, path }) => {
      if (method === "POST") posts.push(path);
      if (method === "GET" && path === "/v1/mp/requests/req_min_1/driver-view")
        return {
          status: 200,
          json: {
            item: feedItem("req_min_1", false),
            eligibility: {
              eligible: true,
              slot: "current",
              reasons: [],
              policyVersion: 1,
              availabilityEpoch: 0,
              evaluatedAt: iso(0),
              predictedPickupSec: 180,
              predictedPickupBasis: "routed_leg",
            },
            presets: [
              {
                key: "requested:45000",
                amountMinor: NGN(45_000),
                commissionMinor: NGN(4_500),
                netMinor: NGN(40_500),
                title: "Accept asking price",
                feeNetLabel: "Fee NGN 45.00 · You receive NGN 405.00",
                affordable: true,
                shortfallLabel: null,
                emphasized: true,
                source: "requested",
                earnings: {
                  ...breakdown(45_000, 4_500, 40_500, 186_923),
                  grossBasis: "preset_amount",
                },
              },
              {
                key: "preference_minimum:60000",
                amountMinor: NGN(60_000),
                commissionMinor: NGN(6_000),
                netMinor: NGN(54_000),
                title: "Your minimum trip",
                feeNetLabel: "Fee NGN 60.00 · You receive NGN 540.00",
                affordable: true,
                shortfallLabel: null,
                emphasized: false,
                source: "preference_minimum",
                earnings: {
                  ...breakdown(60_000, 6_000, 54_000, 249_231),
                  grossBasis: "preset_amount",
                },
              },
            ],
            profileLine: null,
            ceilingNotice: null,
            preferenceNotice: "This trip does not end in your homeward area.",
            currentClaimId: null,
          },
        };
      return undefined;
    });
    const view = wrap(<RequestDetailContainer />);
    await screen.findByTestId(MP_DRIVER_TID.earnings.card);
    expect(textOf(MP_DRIVER_TID.earnings.gross)).toBe(formatMinor(NGN(45_000)));
    expect(textOf(MP_DRIVER_TID.earnings.commission)).toBe(
      formatMinor(NGN(4_500)),
    );
    expect(textOf(MP_DRIVER_TID.earnings.net)).toBe(formatMinor(NGN(40_500)));
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Your minimum trip")).toBeTruthy();
    expect(textOf(dynamicTestId(MP_DRIVER_TID.detail.presetPerHour, 1))).toBe(
      formatMinor(NGN(249_231)),
    );
    expect(
      screen.getByTestId(MP_DRIVER_TID.detail.preferenceNotice),
    ).toBeTruthy();
    expect(
      screen.getByText("This trip does not end in your homeward area."),
    ).toBeTruthy();
    await waitFor(() => expect(posts).toHaveLength(0));
    view.unmount(); // stop the driver-view's refetch interval
  });
});
