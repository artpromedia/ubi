// A02 rider trip + post-award amendments against the REAL client path (marketplaceApi →
// api() → fetch). Asserted on the wire: exact paths, bodies bound to the amendment's
// (routeRevision, fareRevision) / the cap revision / the committed fare revision, and a
// caller-held Idempotency-Key that survives an offline retry. Asserted on screen: the
// original agreement stays in force until commit, server-priced figures, plain-copy
// refusals (next_job_conflict, insufficient funds) and state words that never collapse.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { TripContainer } from "../src/screens/marketplace/TripContainer";
import { ProposeChangeContainer } from "../src/screens/marketplace/ProposeChangeContainer";
import { InTripScreen } from "../src/screens/ride/InTripScreen";
import { installWire, NGN, isoIn, refusal } from "./helpers/wire";
import { clearClients, flagsSettled, renderApp } from "./helpers/render";
import {
  DROPOFF,
  amendment,
  amendmentList,
  trip,
  tripStop,
} from "./helpers/mpFixtures";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: unknown = {};
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const TID = TEST_IDS.mp.rider;
const ALL_ON = {
  marketplace_rides: true,
  marketplace_multi_stop: true,
  marketplace_trip_amendments: true,
};
const TRIP = "/v1/mp/requests/req_1/trip";
const LIST = "/v1/mp/requests/req_1/amendments";

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRouteParams = { requestId: "req_1" };
});
afterEach(clearClients);

describe("Trip — a driver-proposed route change", () => {
  it("shows the proposal against the agreement in force and approves the EXACT revisions with an Idempotency-Key", async () => {
    let approvals = 0;
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: trip() };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([amendment()]) };
      if (c.path === LIST + "/amd_1/approve") {
        approvals += 1;
        if (approvals === 1) return "offline";
        return {
          status: 200,
          json: amendment({
            state: "committed",
            riderFunding: "committed",
            approvals: {
              rider: { approved: true, approvedAt: isoIn(0) },
              driver: { approved: true, approvedAt: isoIn(-20_000) },
            },
            resolvedAt: isoIn(0),
          }),
        };
      }
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    const card = await screen.findByTestId(
      dynamicTestId(TID.trip.amendment, "amd_1"),
    );

    expect(within(card).getByText("Awaiting your approval")).toBeTruthy();
    expect(within(card).getByText("Your driver proposed this")).toBeTruthy();
    expect(within(card).getByTestId(TID.trip.inForce)).toBeTruthy();
    expect(
      within(card).getByText(
        "Your current agreement stays in force until this change commits. Nothing is charged unless both of you approve.",
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText(
        "Lekki Phase 1 → Ikoyi pharmacy → Obalende → Victoria Island",
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText(
        "Lekki Phase 1 → Ikoyi pharmacy → Falomo mall → Obalende → Victoria Island",
      ),
    ).toBeTruthy();
    expect(within(card).getByText("+3.1 km")).toBeTruthy();
    expect(within(card).getByText("+6 min")).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.trip.revisedTotal)).getByText("₦6,750"),
    ).toBeTruthy();
    const delta = screen.getByTestId(TID.trip.fareDelta);
    expect(within(delta).getByText("Your fare goes up by")).toBeTruthy();
    expect(within(delta).getByText("+₦750")).toBeTruthy();
    const funding = screen.getByTestId(TID.trip.funding);
    expect(
      within(funding).getByText(
        "Reserved from your payment — only charged if this change commits",
      ),
    ).toBeTruthy();
    // Money is announced as words, not colour.
    expect(within(delta).getByLabelText("750 naira")).toBeTruthy();
    expect(screen.getByTestId(TID.trip.approvals).props.children).toBe(
      "You: not yet · Driver: approved",
    );

    fireEvent.press(screen.getByTestId(TID.trip.approve));
    const offline = await screen.findByTestId(TID.trip.banner);
    expect(within(offline).getByText("You’re offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.trip.approve));
    const done = await screen.findByText("Change committed");
    expect(done).toBeTruthy();

    const posts = wire
      .writes()
      .filter((c) => c.path === LIST + "/amd_1/approve");
    expect(posts).toHaveLength(2);
    for (const p of posts)
      expect(p.body).toEqual({ routeRevision: 2, fareRevision: 2 });
    expect(posts[0].headers["Idempotency-Key"]).toMatch(/^trip_/);
    expect(posts[1].headers["Idempotency-Key"]).toBe(
      posts[0].headers["Idempotency-Key"],
    );
  });

  it("rejects with the exact revisions and keeps the original agreement", async () => {
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: trip() };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([amendment()]) };
      if (c.path === LIST + "/amd_1/reject")
        return {
          status: 200,
          json: amendment({
            state: "rejected",
            reason: "rider_rejected",
            riderFunding: "released",
          }),
        };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    fireEvent.press(await screen.findByTestId(TID.trip.reject));
    expect(await screen.findByText("Change declined")).toBeTruthy();
    expect(
      screen.getByText(
        "Your original agreement stays in force. Anything reserved for the change is released.",
      ),
    ).toBeTruthy();
    const post = wire.writes().find((c) => c.path === LIST + "/amd_1/reject")!;
    expect(post.body).toEqual({ routeRevision: 2, fareRevision: 2 });
    expect(post.headers["Idempotency-Key"]).toMatch(/^trip_/);
  });

  it("an approval the commit could not apply says so — never 'committed'", async () => {
    installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: trip() };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([amendment()]) };
      if (c.path === LIST + "/amd_1/approve")
        return {
          status: 200,
          json: amendment({
            state: "rejected",
            reason: "next_job_conflict",
            riderFunding: "released",
          }),
        };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    fireEvent.press(await screen.findByTestId(TID.trip.approve));
    expect(await screen.findByText("The change didn’t go ahead")).toBeTruthy();
    expect(
      screen.getByText(
        "Declined automatically: it would have made your driver late for a pickup already promised to another rider.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Change committed")).toBeNull();
  });

  it("keeps state words distinct: securing funding, awaiting the driver, committed/rejected/expired history", async () => {
    installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return {
          status: 200,
          json: trip({
            agreedFareMinor: NGN(6_750_00),
            fareRevision: 2,
            routeRevision: 2,
            committedAdjustments: [
              {
                amendmentId: "amd_old",
                kind: "route",
                fareDeltaMinor: NGN(750_00),
                fareRevision: 2,
                committedAt: isoIn(-600_000),
              },
            ],
          }),
        };
      if (c.method === "GET" && c.path === LIST)
        return {
          status: 200,
          json: amendmentList(
            [
              amendment({
                amendmentId: "amd_wait",
                proposedByRole: "rider",
                approvals: {
                  rider: { approved: true, approvedAt: isoIn(-5_000) },
                  driver: { approved: false },
                },
              }),
              amendment({
                amendmentId: "amd_old",
                state: "committed",
                createdAt: isoIn(-900_000),
              }),
              amendment({
                amendmentId: "amd_expired",
                state: "expired",
                reason: "approval_window_elapsed",
                createdAt: isoIn(-800_000),
              }),
              amendment({
                amendmentId: "amd_conflict",
                state: "rejected",
                reason: "next_job_conflict",
                createdAt: isoIn(-700_000),
              }),
            ],
            {
              routeRevision: 2,
              fareRevision: 2,
              agreedFareMinor: NGN(6_750_00),
            },
          ),
        };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    const card = await screen.findByTestId(
      dynamicTestId(TID.trip.amendment, "amd_wait"),
    );
    expect(within(card).getByText("Awaiting the driver")).toBeTruthy();
    expect(within(card).queryByTestId(TID.trip.approve)).toBeNull();
    expect(
      within(card).getByText(
        "You approved. It commits when your driver approves too.",
      ),
    ).toBeTruthy();

    // The receipt reconciles as the server states it: original + committed = agreed.
    expect(
      within(screen.getByTestId(TID.trip.fare)).getByText("₦6,750"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.trip.original)).getByText("₦6,000"),
    ).toBeTruthy();
    expect(
      within(
        screen.getByTestId(dynamicTestId(TID.trip.adjustment, "amd_old")),
      ).getByText("+₦750"),
    ).toBeTruthy();

    const history = screen.getByTestId(TID.trip.history);
    expect(within(history).getByText("Committed")).toBeTruthy();
    expect(within(history).getByText("Expired")).toBeTruthy();
    expect(within(history).getByText("Rejected")).toBeTruthy();
    expect(
      within(history).getByText(
        "Expired before both of you approved. Nothing changed and anything reserved was released.",
      ),
    ).toBeTruthy();
    // One change open → no second proposal.
    expect(screen.queryByTestId(TID.trip.propose)).toBeNull();
  });

  it("a proposal still securing funds shows no approve control", async () => {
    installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: trip() };
      if (c.method === "GET" && c.path === LIST)
        return {
          status: 200,
          json: amendmentList([
            amendment({ state: "proposed", riderFunding: "pending" }),
          ]),
        };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    const card = await screen.findByTestId(
      dynamicTestId(TID.trip.amendment, "amd_1"),
    );
    expect(within(card).getByText("Securing funding")).toBeTruthy();
    expect(
      within(card).getByText("Reserving the extra from your payment…"),
    ).toBeTruthy();
    expect(within(card).queryByTestId(TID.trip.approve)).toBeNull();
    expect(within(card).getByTestId(TID.trip.reject)).toBeTruthy();
  });
});

describe("Trip — waiting, skip and early end", () => {
  it("approves extra waiting bound to the cap revision the rider saw", async () => {
    const arrived = trip({
      stops: [
        tripStop({
          stopId: "stp_1",
          order: 1,
          label: "Ikoyi pharmacy",
          state: "arrived",
          arrivedAt: isoIn(-600_000),
          waiting: {
            waitedSec: 600,
            includedSec: 120,
            allowanceRemainingSec: 0,
            paidSec: 480,
            feeMinor: NGN(1_500_00),
            accruing: false,
            approvalRequired: true,
            excessive: false,
            settlement: "pending",
          },
        }),
      ],
      waitingTerms: {
        includedBasis: "stop_dwell",
        perMinMinor: NGN(50_00),
        maxAuthorizedMinor: NGN(1_500_00),
        authorizedCapMinor: NGN(1_500_00),
        capRevision: 3,
        committedMinor: NGN(0),
        excessiveAfterSec: 1200,
        geofenceMeters: 150,
      },
    });
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: arrived };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([]) };
      if (c.path === "/v1/mp/requests/req_1/stops/stp_1/waiting-approval")
        return { status: 200, json: arrived };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    expect(
      await screen.findByTestId(dynamicTestId(TID.trip.waitingCap, "stp_1")),
    ).toBeTruthy();
    expect(
      within(
        screen.getByTestId(dynamicTestId(TID.trip.waitingFee, "stp_1")),
      ).getByText("₦1,500"),
    ).toBeTruthy();
    // The waiting block is ONE accessibility element: its label must carry the fee, the
    // settlement and the cap notice — not just the minutes.
    expect(
      screen.getByTestId(dynamicTestId(TID.trip.waiting, "stp_1")).props
        .accessibilityLabel,
    ).toBe(
      "Waited 10 min. Included in your fare 2 min. Paid waiting 1,500 naira. Waiting fee settling. Your approved waiting limit is reached. Nothing more is charged unless you approve more",
    );
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.trip.approveWaiting, "stp_1")),
    );
    expect(await screen.findByText("More waiting approved")).toBeTruthy();
    const post = wire
      .writes()
      .find((c) => c.path.endsWith("/waiting-approval"))!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ capRevision: 3 });
    expect(post.headers["Idempotency-Key"]).toMatch(/^trip_/);
  });

  it("skips a stop and says the fare doesn't drop", async () => {
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: trip() };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([]) };
      if (c.path === "/v1/mp/requests/req_1/stops/stp_2/skip")
        return { status: 200, json: trip() };
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.trip.skip, "stp_2")),
    );
    expect(
      await screen.findByText(
        "Skipping doesn’t lower your agreed fare. Waiting already earned there is kept.",
      ),
    ).toBeTruthy();
    const post = wire.writes().find((c) => c.path.endsWith("/stp_2/skip"))!;
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^trip_/);
  });

  it("explains the early-end outcome before confirming and binds to the committed fare revision (202 converging)", async () => {
    const ended = trip({ terminatedAt: isoIn(0), fareRevision: 1 });
    let terminated = false;
    const wire = installWire((c) => {
      // The server's trip read reflects the early end once it was recorded.
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: terminated ? ended : trip() };
      if (c.method === "GET" && c.path === LIST)
        return { status: 200, json: amendmentList([]) };
      if (c.path === "/v1/mp/requests/req_1/terminate") {
        terminated = true;
        return { status: 202, json: ended };
      }
      return undefined;
    }, ALL_ON);
    renderApp(<TripContainer />);
    fireEvent.press(await screen.findByTestId(TID.trip.terminate));
    expect(
      await screen.findByText(
        /never below the minimum for the distance you did travel/,
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.trip.terminateConfirm));
    expect(await screen.findByTestId(TID.trip.terminated)).toBeTruthy();
    const post = wire.writes().find((c) => c.path.endsWith("/terminate"))!;
    expect(post.body).toEqual({ expectedFareRevision: 1 });
    expect(post.headers["Idempotency-Key"]).toMatch(/^trip_/);
  });
});

describe("Trip — flags and load states", () => {
  it("both flags off: an honest unavailable state and no trip read", async () => {
    const wire = installWire(() => undefined, { marketplace_rides: true });
    renderApp(<TripContainer />);
    expect(await screen.findByTestId(TID.trip.unavailable)).toBeTruthy();
    expect(wire.calls.filter((c) => c.path === TRIP)).toHaveLength(0);
  });

  it("stops without amendments: stops show, but no propose / approve / end controls", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === TRIP)
          return { status: 200, json: trip() };
        return undefined;
      },
      { marketplace_rides: true, marketplace_multi_stop: true },
    );
    renderApp(<TripContainer />);
    await screen.findByTestId(dynamicTestId(TID.trip.stop, "stp_1"));
    await flagsSettled(wire.calls);
    expect(screen.queryByTestId(TID.trip.propose)).toBeNull();
    expect(screen.queryByTestId(TID.trip.terminate)).toBeNull();
    expect(wire.calls.filter((c) => c.path === LIST)).toHaveLength(0);
  });

  it("offline on first load offers a retry", async () => {
    installWire(
      (c) => (c.path === TRIP || c.path === LIST ? "offline" : undefined),
      ALL_ON,
    );
    renderApp(<TripContainer />);
    expect(await screen.findByTestId(TID.trip.offline)).toBeTruthy();
    expect(screen.getByTestId(TID.trip.retry)).toBeTruthy();
  });

  it("an ended or foreign trip (404) is explained, not an error", async () => {
    installWire(
      (c) =>
        c.path === TRIP || c.path === LIST
          ? refusal(404, "not_found", "that request does not exist")
          : undefined,
      ALL_ON,
    );
    renderApp(<TripContainer />);
    const card = await screen.findByTestId(TID.trip.unavailable);
    expect(
      within(card).getByText("Nothing to change on this trip"),
    ).toBeTruthy();
  });

  it("the in-trip screen links to the trip only with a request id and a flag on", async () => {
    mockRouteParams = { rideId: "ride_1", requestId: "req_1" };
    installWire(
      (c) =>
        c.path === "/v1/rides/ride_1"
          ? {
              status: 200,
              json: {
                rideId: "ride_1",
                state: "in_progress",
                status: "On the way",
                version: 4,
                cityId: "LOS",
                configVersion: 1,
                vehicleClass: "standard",
                paymentMethodId: "pm_wallet",
                pickup: { lat: 6.44, lng: 3.47 },
                dropoff: { lat: 6.43, lng: 3.42 },
                currency: "NGN",
                quotedFareMinor: 600000,
                waitFeeMinor: 0,
                pinRequired: true,
                pinVerified: true,
                pinLocked: false,
                requestedAt: isoIn(-900_000),
                updatedAt: isoIn(-1_000),
              },
            }
          : undefined,
      ALL_ON,
    );
    renderApp(<InTripScreen />);
    fireEvent.press(await screen.findByTestId(TID.trip.entry));
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Trip",
      params: { requestId: "req_1" },
    });
  });
});

describe("In-trip entry", () => {
  it("no marketplace request id (a ride opened by id alone): no trip entry", async () => {
    mockRouteParams = { rideId: "ride_1" };
    const wire = installWire(
      (c) =>
        c.path === "/v1/rides/ride_1"
          ? {
              status: 200,
              json: {
                rideId: "ride_1",
                state: "in_progress",
                status: "On the way",
                version: 4,
                cityId: "LOS",
                configVersion: 1,
                vehicleClass: "standard",
                paymentMethodId: "pm_wallet",
                pickup: { lat: 6.44, lng: 3.47 },
                dropoff: { lat: 6.43, lng: 3.42 },
                currency: "NGN",
                quotedFareMinor: 600000,
                waitFeeMinor: 0,
                pinRequired: true,
                pinVerified: true,
                pinLocked: false,
                requestedAt: isoIn(-900_000),
                updatedAt: isoIn(-1_000),
              },
            }
          : undefined,
      ALL_ON,
    );
    renderApp(<InTripScreen />);
    await screen.findByText("On the way");
    await flagsSettled(wire.calls);
    expect(screen.queryByTestId(TID.trip.entry)).toBeNull();
  });
});

describe("ProposeChange — the rider's proposal", () => {
  it("sends only the remaining stops + new destination with the committed revisions, then returns to the trip", async () => {
    const withReached = trip({
      stops: [
        tripStop({
          stopId: "stp_1",
          order: 1,
          label: "Ikoyi pharmacy",
          state: "departed",
        }),
        tripStop({
          stopId: "stp_2",
          order: 2,
          label: "Obalende",
          purpose: "drop_passenger",
          dwellSec: 180,
        }),
        tripStop({ stopId: "stp_3", order: 3, label: "CMS", dwellSec: 60 }),
      ],
      routeRevision: 2,
      fareRevision: 3,
    });
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === TRIP)
        return { status: 200, json: withReached };
      if (c.method === "POST" && c.path === LIST)
        return { status: 201, json: amendment({ proposedByRole: "rider" }) };
      return undefined;
    }, ALL_ON);
    renderApp(<ProposeChangeContainer />);
    await screen.findByTestId(dynamicTestId(TID.change.stop, "stp_2"));
    // The reached stop is history, not editable.
    expect(
      screen.queryByTestId(dynamicTestId(TID.change.stop, "stp_1")),
    ).toBeNull();
    expect(
      screen.getByText(
        "1 stop is already reached or passed — they stay as they are.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.change.inForce)).toBeTruthy();

    // Reorder: CMS before Obalende; add a pinned stop; move the destination.
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.change.up, "stp_3")));
    fireEvent.press(screen.getByTestId(TID.change.add));
    fireEvent(await screen.findByTestId(TID.place.map), "press", {
      nativeEvent: { coordinate: { latitude: 6.44, longitude: 3.43 } },
    });
    fireEvent.changeText(screen.getByTestId(TID.place.label), "Falomo mall");
    fireEvent.press(screen.getByTestId(TID.place.confirm));
    await screen.findByTestId(dynamicTestId(TID.change.stop, "new1"));
    fireEvent.press(screen.getByTestId(TID.change.editDropoff));
    fireEvent(await screen.findByTestId(TID.place.map), "press", {
      nativeEvent: { coordinate: { latitude: 6.43, longitude: 3.41 } },
    });
    fireEvent.press(screen.getByTestId(TID.place.confirm));
    await waitFor(() => expect(screen.queryByTestId(TID.place.map)).toBeNull());

    fireEvent.press(screen.getByTestId(TID.change.send));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Trip", { requestId: "req_1" }),
    );
    const post = wire.writes().find((c) => c.path === LIST)!;
    expect(post.body).toEqual({
      stops: [
        { lat: 6.48, lng: 3.43, label: "CMS", purpose: "errand", dwellSec: 60 },
        {
          lat: 6.47,
          lng: 3.43,
          label: "Obalende",
          purpose: "drop_passenger",
          dwellSec: 180,
        },
        { lat: 6.44, lng: 3.43, label: "Falomo mall", purpose: "errand" },
      ],
      dropoff: { lat: 6.43, lng: 3.41 },
      expectedRouteRevision: 2,
      expectedFareRevision: 3,
    });
    // No amount ever leaves the client.
    expect(JSON.stringify(post.body)).not.toMatch(/Minor/);
    expect(post.headers["Idempotency-Key"]).toMatch(/^amend_/);
  });

  it.each([
    [
      "next_job_conflict",
      refusal(
        409,
        "conflict",
        "this change would break the pickup window promised to the driver's next rider",
        {
          reason: "next_job_conflict",
        },
      ),
      "Your driver can’t take this change",
      "It would make your driver late for a pickup they’ve already promised to another rider, so it can’t go ahead. Nothing was reserved and your trip continues as agreed.",
    ],
    [
      "insufficient_funds",
      refusal(422, "insufficient_funds", "wallet balance too low", {
        reason: "insufficient_rider_funds",
      }),
      "Your payment can’t cover this change",
      "The higher fare doesn’t fit your wallet balance. Nothing was reserved and your trip continues as agreed. Top up and try again.",
    ],
  ])(
    "explains a %s refusal in plain words",
    async (_name, reply, title, body) => {
      installWire((c) => {
        if (c.method === "GET" && c.path === TRIP)
          return { status: 200, json: trip() };
        if (c.method === "POST" && c.path === LIST) return reply;
        return undefined;
      }, ALL_ON);
      renderApp(<ProposeChangeContainer />);
      fireEvent.press(
        await screen.findByTestId(dynamicTestId(TID.change.remove, "stp_1")),
      );
      fireEvent.press(screen.getByTestId(TID.change.send));
      const banner = await screen.findByTestId(TID.change.refusal);
      expect(within(banner).getByText(title)).toBeTruthy();
      expect(within(banner).getByText(body)).toBeTruthy();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it("without the multi-stop flag: reorder/remove/destination only, no adding stops", async () => {
    const wire = installWire(
      (c) =>
        c.method === "GET" && c.path === TRIP
          ? { status: 200, json: trip() }
          : undefined,
      { marketplace_rides: true, marketplace_trip_amendments: true },
    );
    renderApp(<ProposeChangeContainer />);
    await screen.findByTestId(dynamicTestId(TID.change.stop, "stp_1"));
    await flagsSettled(wire.calls);
    expect(screen.queryByTestId(TID.change.add)).toBeNull();
    expect(
      screen.getByText(
        "Adding stops isn’t offered in your city right now. You can still reorder, remove or change the destination.",
      ),
    ).toBeTruthy();
    // Nothing changed yet → nothing to send.
    expect(
      screen.getByTestId(TID.change.send).props.accessibilityState?.disabled,
    ).toBe(true);
    expect(screen.getByTestId(TID.change.dropoff).props.children).toBe(
      DROPOFF.label,
    );
  });

  it("amendments flag off: unavailable, no trip read", async () => {
    const wire = installWire(() => undefined, {
      marketplace_rides: true,
      marketplace_multi_stop: true,
    });
    renderApp(<ProposeChangeContainer />);
    expect(await screen.findByTestId(TID.change.unavailable)).toBeTruthy();
    expect(wire.calls.filter((c) => c.path === TRIP)).toHaveLength(0);
  });
});
