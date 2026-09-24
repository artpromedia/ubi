// A02 rider route builder + pre-award route edit, against the REAL client path: the
// containers call marketplaceApi → @ubi/mobile-core api() → fetch, and these tests read
// exactly what crosses the wire (method, path, the contract-encoded `stops` query,
// JSON body, Idempotency-Key). Only the network, navigation and analytics are stubbed;
// flags arrive over the same wire through the real FlagsProvider.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { RouteBuilderContainer } from "../src/screens/marketplace/RouteBuilderContainer";
import { FareEditorContainer } from "../src/screens/marketplace/FareEditorContainer";
import { OfferInboxContainer } from "../src/screens/marketplace/OfferInboxContainer";
import { RequestDetailsScreen } from "../src/screens/marketplace/RequestDetailsScreen";
import { installWire, NGN, refusal } from "./helpers/wire";
import { clearClients, flagsSettled, renderApp } from "./helpers/render";
import {
  DROPOFF,
  PICKUP,
  liveOffer,
  quote,
  request,
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
const ON = { marketplace_rides: true, marketplace_multi_stop: true };
const baseParams = {
  service: "ride",
  vehicleClass: "standard",
  pickup: PICKUP,
  dropoff: DROPOFF,
};

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});
afterEach(clearClients);

/** Adds a stop through the map pin picker (tap the map, name it, confirm). */
async function addStop(lat: number, lng: number, label?: string) {
  fireEvent.press(screen.getByTestId(TID.route.addStop));
  const map = await screen.findByTestId(TID.place.map);
  fireEvent(map, "press", {
    nativeEvent: { coordinate: { latitude: lat, longitude: lng } },
  });
  if (label) fireEvent.changeText(screen.getByTestId(TID.place.label), label);
  fireEvent.press(screen.getByTestId(TID.place.confirm));
  await waitFor(() => expect(screen.queryByTestId(TID.place.map)).toBeNull());
}

describe("RouteBuilder — new route", () => {
  it("prices the complete ordered route on the server and hands that exact envelope to the fare editor", async () => {
    mockRouteParams = { quoteParams: baseParams };
    const wire = installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/quote"
          ? { status: 200, json: quote() }
          : undefined,
      ON,
    );
    const view = renderApp(<RouteBuilderContainer />);
    await screen.findByTestId(TID.route.screen);

    await addStop(6.452, 3.435, "Ikoyi pharmacy");
    // Expected wait 5 min, purpose errand (the default for a new stop).
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.route.stopDwell, "s1.300")),
    );
    fireEvent.press(screen.getByTestId(TID.route.getQuote));
    await screen.findByTestId(TID.route.summary);

    const quoteCalls = wire.calls.filter((c) => c.path === "/v1/mp/quote");
    expect(quoteCalls).toHaveLength(1);
    const q = quoteCalls[0];
    expect(q.query).toMatchObject({
      service: "ride",
      vehicleClass: "standard",
      pickupLat: String(PICKUP.lat),
      pickupLng: String(PICKUP.lng),
      dropoffLat: String(DROPOFF.lat),
      dropoffLng: String(DROPOFF.lng),
    });
    // One JSON-encoded, contract-validated `stops` parameter — no id, no order, no price.
    expect(JSON.parse(q.query.stops)).toEqual([
      {
        lat: 6.452,
        lng: 3.435,
        label: "Ikoyi pharmacy",
        purpose: "errand",
        dwellSec: 300,
      },
    ]);

    // The server's full-route figures, rendered verbatim.
    const summary = screen.getByTestId(TID.route.summary);
    expect(within(summary).getByText("18.4 km")).toBeTruthy();
    expect(within(summary).getByText("52 min")).toBeTruthy();
    expect(within(summary).getByText("5 min across 1 stop")).toBeTruthy();
    const bounds = screen.getByTestId(TID.route.bounds);
    expect(within(bounds).getByText("₦5,200")).toBeTruthy();
    expect(within(bounds).getByText("₦6,000")).toBeTruthy();
    expect(within(bounds).getByText("₦9,000")).toBeTruthy();
    // The bounds are ONE accessibility element: a screen reader hears only its label,
    // so the label itself must carry the amounts.
    expect(bounds.props.accessibilityLabel).toBe(
      "Fare range for this route, minimum 5,200 naira, suggested 6,000 naira, maximum 9,000 naira",
    );
    expect(
      within(screen.getByTestId(TID.route.breakdown)).getByText("Stop waiting"),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId(TID.route.continue));
    const expected = {
      ...baseParams,
      stops: [
        {
          lat: 6.452,
          lng: 3.435,
          label: "Ikoyi pharmacy",
          purpose: "errand",
          dwellSec: 300,
        },
      ],
    };
    expect(mockNavigate).toHaveBeenCalledWith("Fare", {
      quoteParams: expected,
    });

    // The fare editor, opened with those params, publishes from the SAME envelope:
    // no second quote call, and it is seeded from that envelope's suggestion.
    view.unmount();
    mockRouteParams = { quoteParams: expected };
    renderApp(<FareEditorContainer />, view.queryClient);
    const input = await screen.findByTestId(TID.fare.amountInput);
    expect(input.props.value).toBe("6000");
    expect(wire.calls.filter((c) => c.path === "/v1/mp/quote")).toHaveLength(1);
  });

  it("a quote the server consumed on publish is never offered again: the next visit re-prices", async () => {
    const expected = {
      ...baseParams,
      stops: [{ lat: 6.452, lng: 3.435, label: "Ikoyi pharmacy" }],
    };
    mockRouteParams = { quoteParams: expected };
    let quotes = 0;
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === "/v1/mp/quote") {
        quotes += 1;
        return {
          status: 200,
          json: quote({ quoteId: quotes === 1 ? "q_route_1" : "q_route_2" }),
        };
      }
      if (c.method === "POST" && c.path === "/v1/mp/requests")
        return {
          status: 201,
          json: request({ requestId: "req_9", quoteId: "q_route_1" }),
        };
      return undefined;
    }, ON);
    const first = renderApp(<FareEditorContainer />);
    await screen.findByTestId(TID.fare.amountInput);
    fireEvent.press(screen.getByTestId(TID.fare.review));
    fireEvent.press(await screen.findByTestId(TID.review.send));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Offers", {
        requestId: "req_9",
      }),
    );
    expect(
      (
        wire.writes().find((c) => c.path === "/v1/mp/requests")!.body as {
          quoteId: string;
        }
      ).quoteId,
    ).toBe("q_route_1");
    first.unmount();

    // Same trip again (same client cache): the spent envelope is gone, a fresh one is used.
    mockNavigate.mockReset();
    renderApp(<FareEditorContainer />, first.queryClient);
    await screen.findByTestId(TID.fare.amountInput);
    fireEvent.press(screen.getByTestId(TID.fare.review));
    fireEvent.press(await screen.findByTestId(TID.review.send));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const publishes = wire.writes().filter((c) => c.path === "/v1/mp/requests");
    expect(publishes).toHaveLength(2);
    expect((publishes[1].body as { quoteId: string }).quoteId).toBe(
      "q_route_2",
    );
  });

  it("learns the market's stop limit from the server refusal and blocks adding more", async () => {
    mockRouteParams = { quoteParams: baseParams };
    installWire(
      (c) =>
        c.path === "/v1/mp/quote"
          ? refusal(
              422,
              "validation_failed",
              "this market allows at most 1 intermediate stops; you asked for 2",
              { field: "stops", maximum: 1, count: 2 },
            )
          : undefined,
      ON,
    );
    renderApp(<RouteBuilderContainer />);
    await screen.findByTestId(TID.route.screen);
    await addStop(6.452, 3.435, "Ikoyi pharmacy");
    await addStop(6.47, 3.43);
    fireEvent.press(screen.getByTestId(TID.route.getQuote));

    const banner = await screen.findByTestId(TID.route.refusal);
    expect(
      within(banner).getByText("Too many stops for this city"),
    ).toBeTruthy();
    expect(
      within(banner).getByText(
        "This city allows up to 1 stop between pickup and destination. Remove 1 to continue.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.route.stopLimit).props.children).toBe(
      "This city allows up to 1 stop.",
    );
    expect(
      screen.getByTestId(TID.route.addStop).props.accessibilityState?.disabled,
    ).toBe(true);
    expect(screen.queryByTestId(TID.route.summary)).toBeNull();
  });

  it("marks a price stale when the route changes after quoting and blocks continuing", async () => {
    mockRouteParams = { quoteParams: baseParams };
    installWire(
      (c) =>
        c.path === "/v1/mp/quote" ? { status: 200, json: quote() } : undefined,
      ON,
    );
    renderApp(<RouteBuilderContainer />);
    await screen.findByTestId(TID.route.screen);
    await addStop(6.452, 3.435, "Ikoyi pharmacy");
    fireEvent.press(screen.getByTestId(TID.route.getQuote));
    await screen.findByTestId(TID.route.summary);
    expect(screen.queryByTestId(TID.route.outdated)).toBeNull();

    fireEvent.press(
      screen.getByTestId(
        dynamicTestId(TID.route.stopPurpose, "s1.pickup_passenger"),
      ),
    );
    expect(await screen.findByTestId(TID.route.outdated)).toBeTruthy();
    expect(
      screen.getByTestId(TID.route.continue).props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("shows offline honestly when the quote never reaches the server", async () => {
    mockRouteParams = { quoteParams: baseParams };
    installWire((c) => (c.path === "/v1/mp/quote" ? "offline" : undefined), ON);
    renderApp(<RouteBuilderContainer />);
    await screen.findByTestId(TID.route.screen);
    fireEvent.press(screen.getByTestId(TID.route.getQuote));
    const banner = await screen.findByTestId(TID.route.refusal);
    expect(within(banner).getByText("You’re offline")).toBeTruthy();
  });

  it("flag off: no stop builder, a direct-ride fallback, and no stop quote is ever sent", async () => {
    mockRouteParams = {
      quoteParams: { ...baseParams, stops: [{ lat: 6.45, lng: 3.43 }] },
    };
    const wire = installWire(() => undefined, { marketplace_rides: true });
    renderApp(<RouteBuilderContainer />);
    const card = await screen.findByTestId(TID.route.unavailable);
    expect(
      within(card).getByText("Stops aren’t available here yet"),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.route.addStop)).toBeNull();
    fireEvent.press(screen.getByTestId(TID.route.direct));
    expect(mockNavigate).toHaveBeenCalledWith("Fare", {
      quoteParams: baseParams,
    });
    expect(wire.calls.filter((c) => c.path === "/v1/mp/quote")).toHaveLength(0);
  });
});

describe("RouteBuilder — pre-award route edit (revise)", () => {
  const snapshot = (over = {}) => ({
    request: request(over),
    offers: [liveOffer("bid_1"), liveOffer("bid_2"), liveOffer("bid_3", true)],
    seq: 7,
  });
  const newQuote = () =>
    quote({
      quoteId: "q_new",
      suggestedFareMinor: NGN(6_800_00),
      stops: [
        {
          stopId: "stp_a",
          order: 1,
          label: "Ikoyi pharmacy",
          lat: 6.452,
          lng: 3.435,
          purpose: "errand",
          dwellSec: 300,
        },
        {
          stopId: "stp_b",
          order: 2,
          label: "Obalende",
          lat: 6.47,
          lng: 3.43,
          purpose: "errand",
          dwellSec: 120,
        },
      ],
      stopsDwellSec: 420,
    });

  it("re-quotes the same endpoints, states that drivers must re-offer, and revises with expectedVersion + Idempotency-Key", async () => {
    mockRouteParams = { requestId: "req_1" };
    let revisions = 0;
    const wire = installWire((c) => {
      if (c.method === "GET" && c.path === "/v1/mp/requests/req_1")
        return { status: 200, json: snapshot() };
      if (c.path === "/v1/mp/quote") return { status: 200, json: newQuote() };
      if (c.method === "POST" && c.path === "/v1/mp/requests/req_1/revise") {
        revisions += 1;
        // First attempt: the response is lost (offline); the retry must replay the SAME key.
        if (revisions === 1) return "offline";
        return {
          status: 200,
          json: request({
            revision: 3,
            version: 5,
            routeRevision: 2,
            quoteId: "q_new",
          }),
        };
      }
      return undefined;
    }, ON);
    renderApp(<RouteBuilderContainer />);
    // Seeded from the request's own ordered stops; endpoints are fixed.
    await screen.findByTestId(dynamicTestId(TID.route.stop, "s1"));
    expect(screen.queryByTestId(TID.route.editPickup)).toBeNull();
    expect(screen.getByDisplayValue("Ikoyi pharmacy")).toBeTruthy();

    await addStop(6.47, 3.43, "Obalende");
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.route.stopDwell, "s2.120")),
    );
    fireEvent.press(screen.getByTestId(TID.route.getQuote));
    await screen.findByTestId(TID.route.summary);

    const q = wire.calls.find((c) => c.path === "/v1/mp/quote")!;
    expect(q.query.pickupLat).toBe(String(PICKUP.lat));
    expect(JSON.parse(q.query.stops)).toEqual([
      {
        lat: 6.452,
        lng: 3.435,
        label: "Ikoyi pharmacy",
        purpose: "errand",
        dwellSec: 300,
      },
      {
        lat: 6.47,
        lng: 3.43,
        label: "Obalende",
        purpose: "errand",
        dwellSec: 120,
      },
    ]);

    const notice = screen.getByTestId(TID.route.reoffer);
    expect(within(notice).getByText("Drivers must offer again")).toBeTruthy();
    expect(
      within(notice).getByText(/^Your 2 current offers will close\./),
    ).toBeTruthy();

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.route.fareChoice, "suggested")),
    );
    fireEvent.press(screen.getByTestId(TID.route.revise));
    expect(
      await screen.findByText(
        "Nothing was sent. Try again when you’re back online — retrying is safe, it can’t act twice.",
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.route.revise));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Offers", {
        requestId: "req_1",
      }),
    );

    const posts = wire
      .writes()
      .filter((c) => c.path === "/v1/mp/requests/req_1/revise");
    expect(posts).toHaveLength(2);
    for (const p of posts)
      expect(p.body).toEqual({
        requestedFareMinor: NGN(6_800_00),
        quoteId: "q_new",
        expectedVersion: 4,
      });
    expect(posts[0].headers["Idempotency-Key"]).toMatch(/^route_/);
    expect(posts[1].headers["Idempotency-Key"]).toBe(
      posts[0].headers["Idempotency-Key"],
    );
  });

  it("keeps the server's words when the kept fare is outside the new route's bounds", async () => {
    mockRouteParams = { requestId: "req_1" };
    installWire((c) => {
      if (c.method === "GET" && c.path === "/v1/mp/requests/req_1")
        return { status: 200, json: snapshot() };
      if (c.path === "/v1/mp/quote") return { status: 200, json: newQuote() };
      if (c.path === "/v1/mp/requests/req_1/revise")
        return refusal(
          422,
          "fare_out_of_bounds",
          "Enter at least ₦6,700 for this route.",
          {
            field: "requestedFareMinor",
          },
        );
      return undefined;
    }, ON);
    renderApp(<RouteBuilderContainer />);
    await screen.findByTestId(dynamicTestId(TID.route.stop, "s1"));
    fireEvent.press(screen.getByTestId(TID.route.getQuote));
    await screen.findByTestId(TID.route.summary);
    // "Keep my fare" is preselected.
    fireEvent.press(screen.getByTestId(TID.route.revise));
    const banner = await screen.findByTestId(TID.route.refusal);
    expect(
      within(banner).getByText("That fare is outside the allowed range"),
    ).toBeTruthy();
    expect(
      within(banner).getByText("Enter at least ₦6,700 for this route."),
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("refuses to edit a request that is no longer open", async () => {
    mockRouteParams = { requestId: "req_1" };
    const wire = installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1"
          ? { status: 200, json: snapshot({ state: "award_pending" }) }
          : undefined,
      ON,
    );
    renderApp(<RouteBuilderContainer />);
    const card = await screen.findByTestId(TID.route.unavailable);
    expect(
      within(card).getByText("This request can’t be changed now"),
    ).toBeTruthy();
    expect(wire.calls.filter((c) => c.path === "/v1/mp/quote")).toHaveLength(0);
  });

  it("shows offline when the request itself can't be loaded", async () => {
    mockRouteParams = { requestId: "req_1" };
    installWire(
      (c) => (c.path === "/v1/mp/requests/req_1" ? "offline" : undefined),
      ON,
    );
    renderApp(<RouteBuilderContainer />);
    expect(await screen.findByTestId(TID.route.offline)).toBeTruthy();
    expect(screen.getByTestId(TID.route.retry)).toBeTruthy();
  });
});

describe("Offer inbox — the route the offers are for", () => {
  it("names the multi-stop route and offers the pre-award edit only while open and flagged", async () => {
    mockRouteParams = { requestId: "req_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: request(),
                offers: [liveOffer("bid_1")],
                seq: 1,
              },
            }
          : undefined,
      ON,
    );
    renderApp(<OfferInboxContainer />);
    const ctx = await screen.findByTestId(TID.offersRoute.context);
    expect(
      within(ctx).getByText("Offers are for your route with 1 stop"),
    ).toBeTruthy();
    expect(
      within(ctx).getByText("Lekki Phase 1 → Ikoyi pharmacy → Victoria Island"),
    ).toBeTruthy();
    fireEvent.press(await screen.findByTestId(TID.offersRoute.editRoute));
    expect(mockNavigate).toHaveBeenCalledWith("Route", { requestId: "req_1" });
  });

  it("hides the route edit when marketplace_multi_stop is off", async () => {
    mockRouteParams = { requestId: "req_1" };
    const wire = installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1"
          ? { status: 200, json: { request: request(), offers: [], seq: 1 } }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    await screen.findByTestId(TID.offersRoute.context);
    await flagsSettled(wire.calls);
    expect(screen.queryByTestId(TID.offersRoute.editRoute)).toBeNull();
  });

  it("a repost after no offers keeps the same ordered stops (never silently a different route)", async () => {
    mockRouteParams = { requestId: "req_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: request({
                  state: "no_offers",
                  closeReason: "no_offers",
                }),
                offers: [],
                seq: 2,
              },
            }
          : undefined,
      ON,
    );
    renderApp(<OfferInboxContainer />);
    fireEvent.press(await screen.findByTestId(TID.offers.repost));
    expect(mockNavigate).toHaveBeenCalledWith("Fare", {
      quoteParams: {
        service: "ride",
        vehicleClass: "standard",
        pickup: PICKUP,
        dropoff: DROPOFF,
        stops: [
          {
            lat: 6.452,
            lng: 3.435,
            label: "Ikoyi pharmacy",
            purpose: "errand",
            dwellSec: 300,
          },
        ],
      },
    });
  });
});

describe("Request details — entry points follow their flags", () => {
  it("shows Add stops and Book for later only when their flags are on", async () => {
    installWire(() => undefined, {
      marketplace_rides: true,
      marketplace_multi_stop: true,
      scheduled_rides: true,
    });
    renderApp(<RequestDetailsScreen />);
    fireEvent.press(await screen.findByTestId(TID.details.addStops));
    expect(mockNavigate).toHaveBeenCalledWith(
      "Route",
      expect.objectContaining({
        quoteParams: expect.objectContaining({ service: "ride" }),
      }),
    );
    fireEvent.press(screen.getByTestId(TID.details.later));
    expect(mockNavigate).toHaveBeenCalledWith("Schedule", expect.anything());
  });

  it("hides both entry points under deny-by-default flags", async () => {
    // marketplace_delivery is on only so the test can SEE the flag map has loaded
    // (the Delivery chip appears) before asserting what stays hidden.
    installWire(() => undefined, {
      marketplace_rides: true,
      marketplace_delivery: true,
    });
    renderApp(<RequestDetailsScreen />);
    await screen.findByText("Delivery");
    expect(screen.queryByTestId(TID.details.addStops)).toBeNull();
    expect(screen.queryByTestId(TID.details.later)).toBeNull();
  });
});
