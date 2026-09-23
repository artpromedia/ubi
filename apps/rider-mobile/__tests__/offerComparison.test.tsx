// A06 part A offer comparison on the rider's live inbox and offer detail, against the REAL
// client path (marketplaceApi → api() → fetch). Asserted on the wire: sorting is a request to
// the SERVER (`?sort=`), never a client ranking. Asserted on screen: the server's total and its
// note, the verified driver card or "details unavailable" (never the legacy placeholder rating
// or a 0-trip count), the rating with its count exactly as served, reliability with its window
// and sample or "not enough history", badges with their reasons, the preferred-driver window
// and its honest outcome, and the reconnecting state.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { OfferInboxContainer } from "../src/screens/marketplace/OfferInboxContainer";
import { BidDetailContainer } from "../src/screens/marketplace/BidDetailContainer";
import { BookingDetailContainer } from "../src/screens/marketplace/BookingDetail";
import { installWire, isoIn, type WireCall } from "./helpers/wire";
import { clearClients, renderApp } from "./helpers/render";
import { booking, request } from "./helpers/mpFixtures";
import {
  DRIVER_ID,
  offerOrder,
  unverifiedOffer,
  verifiedOffer,
} from "./helpers/confidenceFixtures";

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
const plain = request({ stops: undefined, routeRevision: undefined });

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRouteParams = { requestId: "req_1" };
});
afterEach(clearClients);

const cardOf = (bidId: string) =>
  screen.getByTestId(dynamicTestId(TID.offers.card, bidId));
const orderOnScreen = () =>
  screen
    .getAllByTestId(/^mp\.rider\.offers\.card\./)
    .map((n) => n.props.testID.replace("mp.rider.offers.card.", ""));

describe("Offer comparison — every figure is the server's", () => {
  it("shows the verified card with its rating count, and 'details unavailable' with no rating for an unresolved driver", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: plain,
                offers: [
                  verifiedOffer("bid_a", "Chidi Obi", {
                    badges: [
                      {
                        code: "earliest_pickup",
                        label: "Earliest estimated pickup of 2 offers",
                      },
                    ],
                  }),
                  unverifiedOffer("bid_b", {
                    badges: [
                      {
                        code: "lowest_total",
                        label: "Lowest total of 2 offers",
                      },
                    ],
                  }),
                ],
                seq: 3,
                offerOrder: offerOrder("offered"),
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    await screen.findByTestId(dynamicTestId(TID.offers.card, "bid_a"));

    // Verified: name, status word, the rating WITH its count, trips — all as served.
    const a = cardOf("bid_a");
    expect(within(a).getByText("Chidi Obi")).toBeTruthy();
    expect(within(a).getByText("Verified by UBI")).toBeTruthy();
    expect(
      within(a).getByText("4.80 from 212 ratings · 212 completed trips"),
    ).toBeTruthy();
    expect(within(a).getByText("₦6,500")).toBeTruthy();
    expect(
      within(a).getByText(
        "Reliability: Completed 39 of 40 marketplace rides in 90 days · 2.5% cancelled by the driver",
      ),
    ).toBeTruthy();
    expect(
      within(a).getByText("Last 90 days · 40 marketplace rides counted"),
    ).toBeTruthy();
    expect(
      within(a).getByText("Service fit: 1 of 2 criteria met"),
    ).toBeTruthy();
    expect(
      within(a).getByText("Earliest estimated pickup of 2 offers"),
    ).toBeTruthy();
    expect(within(a).getByText("Estimated pickup in ~4 min")).toBeTruthy();
    expect(
      within(a).getByText("Grey Toyota Corolla · standard · LAG ·· 42A"),
    ).toBeTruthy();

    // Unresolved card: the honest word, no name, no rating figure, no trip count, and
    // reliability below its minimum sample says so instead of showing a rate.
    const b = cardOf("bid_b");
    expect(within(b).getAllByText("Driver details unavailable").length).toBe(2);
    expect(within(b).getByText("Rating unavailable")).toBeTruthy();
    expect(within(b).queryByText(/–/)).toBeNull();
    expect(within(b).queryByText(/0 completed trips|0 trips/)).toBeNull();
    expect(within(b).queryByText(/Driver 4F2A/)).toBeNull();
    expect(
      within(b).getByText("Reliability: Not enough history yet"),
    ).toBeTruthy();
    expect(
      within(b).getByText(
        "Shown from 10 marketplace rides in 90 days · 3 so far",
      ),
    ).toBeTruthy();
    expect(within(b).getByText("Lowest total of 2 offers")).toBeTruthy();
    expect(within(b).getByText("Pickup estimate unavailable")).toBeTruthy();
    // No sponsored/unexplained winner: the neutral order and its note are printed.
    const order = screen.getByTestId(TID.offers.order);
    expect(
      within(order).getByText(
        "No offer is sponsored and none is chosen for you: you pick the winner.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/recommended/i)).toBeNull();
  });

  it("sorts by asking the server (?sort=price) and keeps that order while later offers append", async () => {
    let arrivals = [
      verifiedOffer("bid_a", "Chidi Obi"),
      unverifiedOffer("bid_b"),
    ];
    const snap = (sort: string | undefined) => {
      const offers =
        sort === "price"
          ? [...arrivals].reverse() // the server's price order: bid_b (₦6,200) first
          : arrivals;
      return {
        status: 200,
        json: {
          request: plain,
          offers,
          seq: 4,
          offerOrder: offerOrder((sort ?? "offered") as "offered"),
        },
      };
    };
    const wire = installWire(
      (c: WireCall) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? snap(c.query.sort)
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    await screen.findByTestId(dynamicTestId(TID.offers.card, "bid_a"));
    expect(orderOnScreen()).toEqual(["bid_a", "bid_b"]);

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.offers.sort, "price")),
    );
    await waitFor(() =>
      expect(
        wire.calls.some(
          (c) => c.path === "/v1/mp/requests/req_1" && c.query.sort === "price",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(orderOnScreen()).toEqual(["bid_b", "bid_a"]));
    const order = screen.getByTestId(TID.offers.order);
    expect(
      within(order).getByText(
        "Lowest total first (then earliest estimated pickup, then earliest offer)",
      ),
    ).toBeTruthy();
    // The client sent a sort key only — nothing it computed.
    const sorted = wire.calls.filter((c) => c.query.sort === "price");
    expect(Object.keys(sorted[0].query)).toEqual(["sort"]);

    // A later offer is appended after the server's order — nothing reshuffles under touch.
    arrivals = [
      ...arrivals,
      verifiedOffer("bid_c", "Ada Bello", {
        amountMinor: { amountMinor: 5_000_00, currency: "NGN" },
        totalMinor: { amountMinor: 5_000_00, currency: "NGN" },
      }),
    ];
    await waitFor(
      () => expect(orderOnScreen()).toEqual(["bid_b", "bid_a", "bid_c"]),
      {
        timeout: 8_000,
      },
    );
  }, 20_000);

  it("states the preferred-driver window with the rider's own fallback choice", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: request({
                  stops: undefined,
                  routeRevision: undefined,
                  preferredDriver: {
                    driverId: DRIVER_ID,
                    state: "exclusive",
                    windowSec: 120,
                    windowEndsAt: isoIn(90_000),
                    fallbackToMarket: false,
                    label: "Asking Chidi Obi first.",
                  },
                }),
                offers: [],
                seq: 1,
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    const banner = await screen.findByTestId(TID.offers.preferred);
    expect(
      within(banner).getByText("Asking your saved driver first"),
    ).toBeTruthy();
    expect(
      within(banner).getByText(
        /closes free of charge — you chose not to open it to other drivers\. Asking first never guarantees they’re available\./,
      ),
    ).toBeTruthy();
  });

  it("an expired preferred request says why, without saying whether the driver declined", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: request({
                  stops: undefined,
                  routeRevision: undefined,
                  state: "expired",
                  closeReason: "preferred_driver_unavailable",
                }),
                offers: [],
                seq: 5,
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    expect(
      await screen.findByText("Your saved driver didn’t offer in time"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.offers.preferredOutcome)).getByText(
        /closed without any charge.*doesn’t say whether they declined or were busy/,
      ),
    ).toBeTruthy();
  });

  it("keeps the last offers with a reconnecting notice when a refresh fails offline", async () => {
    let offline = false;
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? offline
            ? "offline"
            : {
                status: 200,
                json: {
                  request: plain,
                  offers: [verifiedOffer("bid_a", "Chidi Obi")],
                  seq: 1,
                },
              }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    await screen.findByTestId(dynamicTestId(TID.offers.card, "bid_a"));
    offline = true;
    expect(
      await screen.findByText(/Showing your last synced offers/, undefined, {
        timeout: 8_000,
      }),
    ).toBeTruthy();
    expect(cardOf("bid_a")).toBeTruthy();
  }, 15_000);
});

describe("Offer detail — reliability with its definition, fit with its criteria", () => {
  it("prints the definition, window, sample and every fit criterion; no placeholder figures for an unresolved card", async () => {
    mockRouteParams = { requestId: "req_1", bidId: "bid_b" };
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: plain,
                offers: [
                  verifiedOffer("bid_a", "Chidi Obi"),
                  unverifiedOffer("bid_b"),
                ],
                seq: 1,
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<BidDetailContainer />);
    expect(await screen.findByText("This offer")).toBeTruthy();
    expect(
      screen.getAllByText("Driver details unavailable").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Rating unavailable")).toBeTruthy();
    expect(screen.queryByText(/★/)).toBeNull();
    expect(
      screen.getByText("Reliability: Not enough history yet"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Of the marketplace rides this driver was awarded/),
    ).toBeTruthy();
    expect(screen.getByText("✓ Driver details verified by UBI")).toBeTruthy();
    expect(screen.getByText("– Not a driver you saved")).toBeTruthy();
    expect(
      screen.getByText(
        "This is the total you pay for this offer. No booking or service fee is added on top.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.bid.choose).props.accessibilityLabel).toBe(
      "Choose this offer",
    );
  });
});

describe("Saved driver marker and booking card — only what the server established", () => {
  it("marks an offer from a saved driver with the server's own criterion", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: plain,
                offers: [
                  verifiedOffer("bid_a", "Chidi Obi", {
                    serviceFit: {
                      score: 2,
                      maxScore: 2,
                      matched: [
                        {
                          code: "verified_details",
                          label: "Driver details verified by UBI",
                        },
                        { code: "saved_driver", label: "A driver you saved" },
                      ],
                      unmet: [],
                      definition: "One point per criterion.",
                    },
                  }),
                  verifiedOffer("bid_b", "Ada Bello"),
                ],
                seq: 1,
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    const a = await screen.findByTestId(
      dynamicTestId(TID.offers.card, "bid_a"),
    );
    expect(within(a).getByText("A driver you saved")).toBeTruthy();
    expect(
      within(cardOf("bid_b")).queryByText("A driver you saved"),
    ).toBeNull();
  });

  it("a reserved driver without a verified profile is 'details unavailable' — no pseudonym, no '–' rating", async () => {
    mockRouteParams = { bookingId: "bkg_1" };
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/advance-bookings/bkg_1"
          ? {
              status: 200,
              json: booking({
                driver: {
                  displayName: "Driver 4F2A",
                  initials: "D",
                  rating: "–",
                  completedTrips: 0,
                  vehicle: "standard",
                  plateMasked: "—",
                  profileStatus: "unavailable",
                },
              }),
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const card = await screen.findByTestId(TEST_IDS.mp.rider.booking.driver);
    expect(within(card).getByText("Driver details unavailable")).toBeTruthy();
    expect(within(card).queryByText(/Driver 4F2A|–|★/)).toBeNull();
  });
});
