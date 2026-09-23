// A03 Book for Later rider screens against the REAL client path (marketplaceApi → api()
// → fetch). Asserted on the wire: exact create/command bodies (local date + time +
// timezone, server-figure fares, expectedVersion) and caller-held Idempotency-Keys.
// Asserted on screen: "no driver secured yet" until a real award; DRIVER CONFIRMED vs
// payment pending; failure explanations with a CONSENTED rematch; a series never
// labelled confirmed; flag-off fallbacks and error/offline states.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { ScheduleRideContainer } from "../src/screens/marketplace/ScheduleRideContainer";
import { ScheduledDetailContainer } from "../src/screens/marketplace/ScheduledDetail";
import { AdvanceOffersContainer } from "../src/screens/marketplace/AdvanceOffers";
import { BookingDetailContainer } from "../src/screens/marketplace/BookingDetail";
import { RecurringSeriesContainer } from "../src/screens/marketplace/RecurringSeries";
import { LaterHubContainer } from "../src/screens/marketplace/LaterHub";
import { OfferInboxContainer } from "../src/screens/marketplace/OfferInboxContainer";
import { HomeScreen } from "../src/screens/home/HomeScreen";
import { installWire, NGN, isoIn, refusal } from "./helpers/wire";
import { clearClients, flagsSettled, renderApp } from "./helpers/render";
import {
  DROPOFF,
  PICKUP,
  advanceOffer,
  booking,
  quote,
  request,
  schedule,
  scheduled,
  series,
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
const QP = {
  service: "ride",
  vehicleClass: "standard",
  pickup: PICKUP,
  dropoff: DROPOFF,
  stops: [
    { lat: 6.452, lng: 3.435, label: "Ikoyi pharmacy", purpose: "errand" },
  ],
};
const quoteRoute = (c: { method: string; path: string }) =>
  c.method === "GET" && c.path === "/v1/mp/quote"
    ? ({ status: 200, json: quote() } as const)
    : undefined;

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});
afterEach(clearClients);

describe("ScheduleRide", () => {
  it("saves a scheduled request with local date/time, the server's figures and an Idempotency-Key — no driver secured", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(
      (c) => {
        const q = quoteRoute(c);
        if (q) return q;
        if (c.method === "POST" && c.path === "/v1/mp/scheduled-requests")
          return { status: 201, json: scheduled() };
        return undefined;
      },
      { marketplace_rides: true, scheduled_rides: true },
    );
    renderApp(<ScheduleRideContainer />);
    await screen.findByTestId(TID.schedule.screen);

    // The stops travel with the quote: the route shows them and the query carries them.
    expect(
      JSON.parse(
        wire.calls.find((c) => c.path === "/v1/mp/quote")!.query.stops,
      ),
    ).toEqual(QP.stops);
    expect(
      within(screen.getByTestId(TID.schedule.stops)).getByText(
        "Ikoyi pharmacy",
      ),
    ).toBeTruthy();
    const noDriver = screen.getByTestId(TID.schedule.noDriver);
    expect(within(noDriver).getByText("No driver secured yet")).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.schedule.bounds)).getByText("₦9,000"),
    ).toBeTruthy();
    // One accessibility element: the amounts are in its label, not only in its children.
    expect(
      screen.getByTestId(TID.schedule.bounds).props.accessibilityLabel,
    ).toBe(
      "Fare range today for this route, minimum 5,200 naira, suggested 6,000 naira, maximum 9,000 naira",
    );

    // Invalid time is caught before anything is sent.
    fireEvent.changeText(screen.getByTestId(TID.schedule.date), "2026-09-25");
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "7.30");
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    expect(screen.getByTestId(TID.schedule.fieldError).props.children).toBe(
      "Enter the pickup time as HH:MM (24-hour), e.g. 07:30.",
    );
    expect(wire.writes()).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "07:30");
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.schedule.window, 30)));
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Scheduled", {
        scheduledRequestId: "sr_1",
      }),
    );
    const post = wire
      .writes()
      .find((c) => c.path === "/v1/mp/scheduled-requests")!;
    expect(post.body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(6_000_00),
      maxFareMinor: NGN(9_000_00),
      paymentMethodId: "pm_wallet",
      schedule: {
        localDate: "2026-09-25",
        localTime: "07:30",
        windowMinutes: 30,
      },
    });
    expect(post.headers["Idempotency-Key"]).toMatch(/^later_/);
  });

  it("sends the pickup city's IANA timezone from city config and says so on screen", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(
      (c) => {
        const q = quoteRoute(c);
        if (q) return q;
        if (c.path === "/v1/config/cities/LOS")
          return {
            status: 200,
            json: {
              cityId: "LOS",
              countryCode: "NG",
              timezone: "Africa/Lagos",
              currency: "NGN",
              currencySymbol: "₦",
              minorDigitsShown: 0,
              locale: "en-NG",
              emergencyNumber: "112",
              offerTtlSec: 120,
              quoteTtlSec: 300,
              reservationFreeCancelMin: 30,
              supportPhone: "+234000",
            },
          };
        if (c.path === "/v1/mp/scheduled-requests")
          return { status: 201, json: scheduled() };
        return undefined;
      },
      { marketplace_rides: true, scheduled_rides: true },
    );
    renderApp(<ScheduleRideContainer />, undefined, { cityConfig: true });
    await waitFor(() =>
      expect(screen.getByTestId(TID.schedule.timeZone).props.children).toBe(
        "Times are local to the pickup (Africa/Lagos).",
      ),
    );
    fireEvent.changeText(screen.getByTestId(TID.schedule.date), "2026-10-04");
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "05:45");
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect((wire.writes()[0].body as { schedule: unknown }).schedule).toEqual({
      localDate: "2026-10-04",
      localTime: "05:45",
      timeZone: "Africa/Lagos",
    });
  });

  it("packages a typed approval only as input (whole naira) and keeps the server's refusal words", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(
      (c) => {
        const q = quoteRoute(c);
        if (q) return q;
        if (c.path === "/v1/mp/scheduled-requests")
          return refusal(
            422,
            "validation_failed",
            "pickup must be at least 2 hours ahead",
            {
              field: "schedule",
            },
          );
        return undefined;
      },
      { marketplace_rides: true, scheduled_rides: true },
    );
    renderApp(<ScheduleRideContainer />);
    await screen.findByTestId(TID.schedule.screen);
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "08:00");
    fireEvent.changeText(screen.getByTestId(TID.schedule.maxFare), "7,500");
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    const banner = await screen.findByTestId(TID.schedule.refusal);
    expect(
      within(banner).getByText("pickup must be at least 2 hours ahead"),
    ).toBeTruthy();
    const post = wire.writes()[0];
    expect((post.body as { maxFareMinor: unknown }).maxFareMinor).toEqual(
      NGN(7_500_00),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("a re-priced quote never widens the rider's approval: typed amounts stay, picked figures must be chosen again", async () => {
    mockRouteParams = { quoteParams: QP };
    let quotes = 0;
    let creates = 0;
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/quote") {
          quotes += 1;
          return quotes === 1
            ? { status: 200, json: quote() }
            : {
                status: 200,
                json: quote({
                  quoteId: "q_route_2",
                  suggestedFareMinor: NGN(6_400_00),
                  maximumFareMinor: NGN(9_800_00),
                }),
              };
        }
        if (c.path === "/v1/mp/scheduled-requests") {
          creates += 1;
          return creates === 1
            ? refusal(409, "quote_expired", "this quote has expired")
            : { status: 201, json: scheduled() };
        }
        return undefined;
      },
      { marketplace_rides: true, scheduled_rides: true },
    );
    renderApp(<ScheduleRideContainer />);
    await screen.findByTestId(TID.schedule.screen);
    fireEvent.changeText(screen.getByTestId(TID.schedule.date), "2026-09-25");
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "07:30");
    // The rider TYPES the most they approve; the asked fare is the suggestion chip.
    fireEvent.changeText(screen.getByTestId(TID.schedule.maxFare), "7,500");
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    expect(
      within(await screen.findByTestId(TID.schedule.refusal)).getByText(
        "The price expired",
      ),
    ).toBeTruthy();
    // The expired quote is re-priced; the suggestion chip picked from the OLD quote no
    // longer stands, so nothing is sent until the rider chooses again.
    await waitFor(() =>
      expect(screen.getByTestId(TID.schedule.fieldError).props.children).toBe(
        "The price was updated — choose your fare and the most you approve again.",
      ),
    );
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    expect(screen.getByTestId(TID.schedule.fieldError).props.children).toBe(
      "Enter the fare you want to ask.",
    );
    expect(creates).toBe(1);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.schedule.fareChip, "suggested")),
    );
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Scheduled", {
        scheduledRequestId: "sr_1",
      }),
    );
    const posts = wire
      .writes()
      .filter((c) => c.path === "/v1/mp/scheduled-requests");
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toMatchObject({
      quoteId: "q_route_2",
      requestedFareMinor: NGN(6_400_00),
      // Exactly what the rider typed — never the new quote's higher maximum.
      maxFareMinor: NGN(7_500_00),
    });
  });

  it("reserve-a-driver publishes an advance request and opens its offer inbox", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(
      (c) => {
        const q = quoteRoute(c);
        if (q) return q;
        if (c.path === "/v1/mp/advance-requests")
          return { status: 201, json: request({ requestId: "req_adv_1" }) };
        return undefined;
      },
      { marketplace_rides: true, marketplace_advance_reservations: true },
    );
    renderApp(<ScheduleRideContainer />);
    await screen.findByTestId(TID.schedule.screen);
    // Only the advance product is on: no approval field (drivers offer at the asked fare).
    expect(screen.queryByTestId(TID.schedule.maxFare)).toBeNull();
    expect(
      within(screen.getByTestId(TID.schedule.noDriver)).getByText(
        /No driver is secured until you choose/,
      ),
    ).toBeTruthy();
    fireEvent.changeText(screen.getByTestId(TID.schedule.date), "2026-09-26");
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "06:15");
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.schedule.fareChip, "minimum")),
    );
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("AdvanceOffers", {
        requestId: "req_adv_1",
      }),
    );
    expect(wire.writes()[0].body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(5_200_00),
      paymentMethodId: "pm_wallet",
      schedule: { localDate: "2026-09-26", localTime: "06:15" },
    });
  });

  it("a recurring journey sends its weekday pattern and product", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(
      (c) => {
        const q = quoteRoute(c);
        if (q) return q;
        if (c.path === "/v1/mp/recurring-templates")
          return { status: 201, json: series() };
        return undefined;
      },
      {
        marketplace_rides: true,
        scheduled_rides: true,
        marketplace_recurring_journeys: true,
      },
    );
    renderApp(<ScheduleRideContainer />);
    await screen.findByTestId(TID.schedule.screen);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.schedule.product, "series")),
    );
    expect(
      within(screen.getByTestId(TID.schedule.noDriver)).getByText(
        /Each trip in the series is booked on its own/,
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.schedule.day, "fri")));
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.schedule.day, "mon")));
    fireEvent.changeText(screen.getByTestId(TID.schedule.date), "2026-09-28");
    fireEvent.changeText(screen.getByTestId(TID.schedule.time), "07:30");
    fireEvent.press(screen.getByTestId(TID.schedule.submit));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Series", {
        templateId: "tpl_1",
      }),
    );
    expect(wire.writes()[0].body).toEqual({
      quoteId: "q_route_1",
      product: "scheduled_request",
      daysOfWeek: ["mon", "fri"],
      localTime: "07:30",
      startsOn: "2026-09-28",
      requestedFareMinor: NGN(6_000_00),
      maxFareMinor: NGN(9_000_00),
      paymentMethodId: "pm_wallet",
    });
  });

  it("every Book for Later flag off: an honest fallback to booking now, and no quote", async () => {
    mockRouteParams = { quoteParams: QP };
    const wire = installWire(() => undefined, { marketplace_rides: true });
    renderApp(<ScheduleRideContainer />);
    fireEvent.press(
      within(await screen.findByTestId(TID.schedule.unavailable)).getByText(
        "Book it now instead",
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith("Fare", { quoteParams: QP });
    expect(wire.calls.filter((c) => c.path === "/v1/mp/quote")).toHaveLength(0);
  });

  it("offline pricing offers a retry", async () => {
    mockRouteParams = { quoteParams: QP };
    installWire((c) => (c.path === "/v1/mp/quote" ? "offline" : undefined), {
      marketplace_rides: true,
      scheduled_rides: true,
    });
    renderApp(<ScheduleRideContainer />);
    expect(await screen.findByTestId(TID.schedule.offline)).toBeTruthy();
    expect(screen.getByTestId(TID.schedule.retry)).toBeTruthy();
  });
});

describe("Scheduled request detail", () => {
  it("says no driver is secured and cancels an unpublished intent with an Idempotency-Key", async () => {
    mockRouteParams = { scheduledRequestId: "sr_1" };
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/scheduled-requests/sr_1")
          return { status: 200, json: scheduled() };
        if (c.path === "/v1/mp/scheduled-requests/sr_1/cancel")
          return {
            status: 200,
            json: scheduled({
              state: "cancelled",
              statusLabel: "Cancelled",
              version: 4,
            }),
          };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<ScheduledDetailContainer />);
    expect(await screen.findByText("Scheduled · no driver yet")).toBeTruthy();
    expect(screen.getByText("Scheduled — no driver secured yet")).toBeTruthy();
    expect(screen.getByTestId(TID.scheduled.noDriver)).toBeTruthy();
    expect(screen.getByTestId(TID.scheduled.publishAt)).toBeTruthy();
    expect(screen.queryByText("Driver secured")).toBeNull();

    fireEvent.press(screen.getByTestId(TID.scheduled.cancel));
    fireEvent.press(await screen.findByTestId(TID.scheduled.cancelConfirm));
    expect(
      await screen.findByText("Nothing was reserved or charged."),
    ).toBeTruthy();
    const post = wire.writes().find((c) => c.path.endsWith("/cancel"))!;
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^sched_/);
  });

  it("needs_rider_approval shows the refreshed terms and approves with expectedVersion and a server figure", async () => {
    mockRouteParams = { scheduledRequestId: "sr_1" };
    const needs = scheduled({
      state: "needs_rider_approval",
      version: 6,
      statusLabel: "Needs your approval — no driver secured yet",
      notice: "Fares on this route moved above what you approved.",
      approval: {
        reason: "fare_above_approval",
        message: "Fares on this route moved above what you approved.",
        refreshedTerms: {
          minimumFareMinor: NGN(6_100_00),
          maximumFareMinor: NGN(9_800_00),
          suggestedFareMinor: NGN(7_000_00),
        },
      },
    });
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/scheduled-requests/sr_1")
          return { status: 200, json: needs };
        if (c.path === "/v1/mp/scheduled-requests/sr_1/approve")
          return { status: 200, json: scheduled({ version: 7 }) };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<ScheduledDetailContainer />);
    const approval = await screen.findByTestId(TID.scheduled.approval);
    expect(
      within(approval).getAllByText(
        "Fares on this route moved above what you approved.",
      ).length,
    ).toBeGreaterThan(0);
    const refreshed = screen.getByTestId(TID.scheduled.refreshed);
    expect(within(refreshed).getByText("₦6,100")).toBeTruthy();
    expect(within(refreshed).getByText("₦9,800")).toBeTruthy();
    expect(screen.getByText("Needs your approval")).toBeTruthy();

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.scheduled.approveChoice, "maximum")),
    );
    fireEvent.press(screen.getByTestId(TID.scheduled.approve));
    expect(await screen.findByText("Approved")).toBeTruthy();
    const post = wire.writes().find((c) => c.path.endsWith("/approve"))!;
    expect(post.body).toEqual({
      expectedVersion: 6,
      maxFareMinor: NGN(9_800_00),
    });
    expect(post.headers["Idempotency-Key"]).toMatch(/^sched_/);
  });

  it("a stale approval (version_conflict) is refused in plain words", async () => {
    mockRouteParams = { scheduledRequestId: "sr_1" };
    const needs = scheduled({
      state: "needs_rider_approval",
      approval: {
        reason: "payment_method_unavailable",
        message: "Your saved payment method can't be used in this city.",
        refreshedTerms: null,
      },
    });
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/scheduled-requests/sr_1")
          return { status: 200, json: needs };
        if (c.path.endsWith("/approve"))
          return refusal(409, "version_conflict", "the intent changed");
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<ScheduledDetailContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.scheduled.approveChoice, "current"),
      ),
    );
    fireEvent.press(screen.getByTestId(TID.scheduled.approve));
    const banner = await screen.findByTestId(TID.scheduled.refusal);
    expect(within(banner).getByText("Things changed")).toBeTruthy();
    // Answering a payment-method approval switches to the wallet explicitly.
    expect(wire.writes()[0].body).toEqual({
      expectedVersion: 3,
      maxFareMinor: NGN(9_000_00),
      paymentMethodId: "pm_wallet",
    });
  });

  it("offline on load offers a retry", async () => {
    mockRouteParams = { scheduledRequestId: "sr_1" };
    installWire(() => "offline", { marketplace_rides: true });
    renderApp(<ScheduledDetailContainer />);
    expect(await screen.findByTestId(TID.scheduled.offline)).toBeTruthy();
  });
});

describe("Advance offers — choosing a driver in advance", () => {
  const advanceRequest = () =>
    request({
      requestId: "req_adv_1",
      version: 2,
      stops: undefined,
      routeRevision: undefined,
      routeFingerprint: undefined,
      booking: {
        kind: "advance",
        schedule: schedule(),
        scheduledRequestId: null,
        driverSecured: false,
        notice:
          "Drivers are offering on your future pickup window. No driver is secured until you choose an offer.",
      },
    });

  it("lists future-window offers apart from live pickups and reserves the chosen driver (expected versions + key)", async () => {
    mockRouteParams = { requestId: "req_adv_1" };
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/requests/req_adv_1")
          return {
            status: 200,
            json: {
              request: advanceRequest(),
              offers: [],
              advanceOffers: [
                advanceOffer("bid_a", "Chidi Obi"),
                advanceOffer("bid_b", "Tunde Ade", { withdrawn: true }),
              ],
              seq: 3,
            },
          };
        if (c.path === "/v1/mp/requests/req_adv_1/select")
          return {
            status: 202,
            json: {
              award: {
                awardId: "awd_adv_1",
                requestId: "req_adv_1",
                bidId: "bid_a",
                state: "confirmed",
                requestVersion: 2,
                bidVersion: 2,
                driverId: "u_drv_chidi",
                requesterId: "u_rider_1",
                fareMinor: NGN(5_600_00),
                commissionMinor: NGN(560_00),
                slot: "advance",
                executionRef: null,
                createdAt: isoIn(0),
                resolvedAt: isoIn(0),
              },
              booking: booking({
                state: "payment_pending",
                fullySecured: false,
              }),
            },
          };
        return undefined;
      },
      { marketplace_rides: true, marketplace_advance_reservations: true },
    );
    renderApp(<AdvanceOffersContainer />);
    const card = await screen.findByTestId(
      dynamicTestId(TID.advance.card, "bid_a"),
    );
    expect(
      within(screen.getByTestId(TID.advance.noDriver)).getByText(
        "No driver secured yet",
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText("Booked window Thu 25 Sep, 07:30–07:50"),
    ).toBeTruthy();
    expect(within(card).getByText("₦5,600")).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(TID.advance.choose, "bid_b")).props
        .accessibilityState?.disabled,
    ).toBe(true);

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.advance.choose, "bid_a")),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Booking", {
        bookingId: "bkg_1",
      }),
    );
    const post = wire.writes().find((c) => c.path.endsWith("/select"))!;
    expect(post.body).toEqual({
      bidId: "bid_a",
      requestVersion: 2,
      bidVersion: 2,
    });
    expect(post.headers["Idempotency-Key"]).toMatch(/^advsel_/);
  });

  it("a stale offer is refused in plain words and the offers refresh", async () => {
    mockRouteParams = { requestId: "req_adv_1" };
    installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/requests/req_adv_1")
          return {
            status: 200,
            json: {
              request: advanceRequest(),
              offers: [],
              advanceOffers: [advanceOffer("bid_a", "Chidi Obi")],
              seq: 3,
            },
          };
        if (c.path.endsWith("/select"))
          return refusal(409, "version_conflict", "the offer changed");
        return undefined;
      },
      { marketplace_rides: true, marketplace_advance_reservations: true },
    );
    renderApp(<AdvanceOffersContainer />);
    fireEvent.press(
      await screen.findByTestId(dynamicTestId(TID.advance.choose, "bid_a")),
    );
    const banner = await screen.findByTestId(TID.advance.refusal);
    expect(within(banner).getByText("Things changed")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith("Booking", expect.anything());
  });
});

describe("Advance vs live inboxes never mix", () => {
  const advanceSnap = (award?: unknown) => ({
    request: request({
      requestId: "req_adv_1",
      stops: undefined,
      routeRevision: undefined,
      routeFingerprint: undefined,
      state: award ? "awarded" : "open",
      booking: {
        kind: "advance",
        schedule: schedule(),
        scheduledRequestId: null,
        driverSecured: !!award,
        notice: "No driver is secured until you choose an offer.",
      },
    }),
    offers: [],
    advanceOffers: [],
    ...(award ? { award } : {}),
    seq: 1,
  });

  it("the live inbox hands an advance-booking request to the advance inbox", async () => {
    mockRouteParams = { requestId: "req_adv_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_adv_1"
          ? { status: 200, json: advanceSnap() }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("AdvanceOffers", {
        requestId: "req_adv_1",
      }),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith("Ride", expect.anything());
  });

  it("an activated booking hands over to the ride with the real execution id and the request id", async () => {
    mockRouteParams = { requestId: "req_adv_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_adv_1"
          ? {
              status: 200,
              json: advanceSnap({
                awardId: "awd_adv_1",
                requestId: "req_adv_1",
                bidId: "bid_a",
                state: "confirmed",
                requestVersion: 2,
                bidVersion: 2,
                driverId: "u_drv",
                requesterId: "u_rider_1",
                fareMinor: NGN(5_600_00),
                commissionMinor: NGN(560_00),
                slot: "advance",
                executionRef: { service: "ride", id: "ride_adv_9" },
                createdAt: isoIn(-86_400_000),
                resolvedAt: isoIn(-86_000_000),
              }),
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<AdvanceOffersContainer />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Ride", {
        screen: "Assigned",
        params: { rideId: "ride_adv_9", requestId: "req_adv_1" },
      }),
    );
  });
});

describe("Reservation detail", () => {
  it("DRIVER CONFIRMED only when committed AND funded", async () => {
    mockRouteParams = { bookingId: "bkg_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/advance-bookings/bkg_1"
          ? { status: 200, json: booking() }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const status = await screen.findByTestId(TID.booking.status);
    expect(status.props.accessibilityLabel).toBe("Status: Driver confirmed");
    expect(
      screen.getByText(
        "Chidi Obi has committed to this specific trip and your payment is secured.",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.booking.fare)).getByText("₦5,600"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.booking.notices)).getByText(
        /does not guarantee pickup/,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.booking.terms)).toBeTruthy();
  });

  it("payment pending is a reserved driver, never 'Driver confirmed'", async () => {
    mockRouteParams = { bookingId: "bkg_1" };
    installWire(
      (c) =>
        c.path === "/v1/mp/advance-bookings/bkg_1"
          ? {
              status: 200,
              json: booking({
                state: "payment_pending",
                fullySecured: false,
                statusLabel: "Driver reserved — payment pending",
                funding: {
                  state: "pending",
                  label: "Payment will be secured closer to pickup",
                  dueAt: isoIn(20 * 3_600_000),
                  deadline: isoIn(22 * 3_600_000),
                },
              }),
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const status = await screen.findByTestId(TID.booking.status);
    expect(status.props.accessibilityLabel).toBe(
      "Status: Driver reserved · payment pending",
    );
    expect(screen.queryByText(/Driver confirmed/)).toBeNull();
    expect(
      screen.getByText(
        "Your driver is reserved, but this booking isn’t fully secured until your payment is.",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.booking.funding)).getByText(
        /Must be secured by/,
      ),
    ).toBeTruthy();
  });

  it("a failed booking explains the outcome and rematches only with consent", async () => {
    mockRouteParams = { bookingId: "bkg_1" };
    const failed = booking({
      state: "failed",
      driverReserved: false,
      fullySecured: false,
      statusLabel: "Booking failed — no driver",
      funding: {
        state: "released",
        label: "Payment hold released",
        dueAt: null,
        deadline: null,
      },
      failure: {
        reason: "driver_withdrew",
        message:
          "Your driver can no longer make this trip. Their commission was returned and your payment hold released.",
        financialOutcome: {
          commissionReversed: true,
          riderFundingReleased: true,
          riderCharged: false,
        },
        rematchAvailable: true,
      },
    });
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/advance-bookings/bkg_1")
          return { status: 200, json: failed };
        if (c.path === "/v1/mp/advance-bookings/bkg_1/rematch")
          return { status: 201, json: request({ requestId: "req_adv_2" }) };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const failure = await screen.findByTestId(TID.booking.failure);
    expect(
      within(failure).getByText(/Your driver can no longer make this trip/),
    ).toBeTruthy();
    const outcome = screen.getByTestId(TID.booking.outcome);
    expect(
      within(outcome).getByText("• You were not charged for this booking."),
    ).toBeTruthy();
    expect(
      within(outcome).getByText("• Your payment hold was released."),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.booking.cancel)).toBeNull();

    // Nothing is re-published until the rider consents in the sheet.
    fireEvent.press(screen.getByTestId(TID.booking.rematch));
    expect(wire.writes()).toHaveLength(0);
    fireEvent.press(await screen.findByTestId(TID.booking.rematchConfirm));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("AdvanceOffers", {
        requestId: "req_adv_2",
      }),
    );
    const post = wire.writes()[0];
    expect(post.path).toBe("/v1/mp/advance-bookings/bkg_1/rematch");
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^booking_/);
  });

  it("cancels before activation with an Idempotency-Key", async () => {
    mockRouteParams = { bookingId: "bkg_1" };
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/advance-bookings/bkg_1")
          return { status: 200, json: booking() };
        if (c.path.endsWith("/cancel"))
          return {
            status: 200,
            json: booking({
              state: "cancelled",
              driverReserved: false,
              fullySecured: false,
              statusLabel: "Cancelled",
            }),
          };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    fireEvent.press(await screen.findByTestId(TID.booking.cancel));
    fireEvent.press(await screen.findByTestId(TID.booking.cancelConfirm));
    expect(await screen.findByText("Reservation cancelled")).toBeTruthy();
    const post = wire.writes().find((c) => c.path.endsWith("/cancel"))!;
    expect(post.headers["Idempotency-Key"]).toMatch(/^booking_/);
  });
});

describe("Recurring series", () => {
  it("never labels the series confirmed; each occurrence keeps its own status; skip one and pause with expectedVersion", async () => {
    mockRouteParams = { templateId: "tpl_1" };
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/recurring-templates/tpl_1")
          return { status: 200, json: series() };
        if (
          c.path ===
          "/v1/mp/recurring-templates/tpl_1/occurrences/2026-09-30/skip"
        )
          return { status: 200, json: scheduled({ state: "skipped" }) };
        if (c.path === "/v1/mp/recurring-templates/tpl_1/pause")
          return { status: 200, json: series({ state: "paused", version: 6 }) };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<RecurringSeriesContainer />);
    const status = await screen.findByTestId(TID.series.status);
    // One occurrence has a driver — the series is still only "active".
    expect(status.props.accessibilityLabel).toBe(
      "Status: Active · each trip books separately",
    );
    expect(screen.queryByText("Confirmed")).toBeNull();
    expect(screen.queryByText(/series confirmed/i)).toBeNull();
    expect(
      screen.getByText(
        "1 of 3 trips have a driver secured. The series itself isn’t confirmed — each trip books on its own.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        dynamicTestId(TID.series.occurrenceStatus, "2026-09-28"),
      ).props.accessibilityLabel,
    ).toBe("Status: Driver secured");
    expect(
      screen.getByTestId(
        dynamicTestId(TID.series.occurrenceStatus, "2026-09-30"),
      ).props.accessibilityLabel,
    ).toBe("Status: Scheduled · no driver yet");
    expect(
      screen.getByTestId(
        dynamicTestId(TID.series.occurrenceStatus, "2026-10-02"),
      ).props.accessibilityLabel,
    ).toBe("Status: Skipped");
    // Only a trip not yet sent to drivers can be skipped.
    expect(
      screen.queryByTestId(dynamicTestId(TID.series.skip, "2026-09-28")),
    ).toBeNull();

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.series.skip, "2026-09-30")),
    );
    expect(await screen.findByText("Trip skipped")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.series.pause));
    expect(await screen.findByText("Series paused")).toBeTruthy();

    const skip = wire.writes().find((c) => c.path.endsWith("/skip"))!;
    expect(skip.body).toBeUndefined();
    expect(skip.headers["Idempotency-Key"]).toMatch(/^series_/);
    const pause = wire.writes().find((c) => c.path.endsWith("/pause"))!;
    expect(pause.body).toEqual({ expectedVersion: 5 });
    expect(pause.headers["Idempotency-Key"]).toMatch(/^series_/);
  });

  it("cancelling the series asks first and pins the version", async () => {
    mockRouteParams = { templateId: "tpl_1" };
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/recurring-templates/tpl_1")
          return { status: 200, json: series({ state: "paused", version: 9 }) };
        if (c.path.endsWith("/cancel"))
          return {
            status: 200,
            json: series({ state: "cancelled", version: 10 }),
          };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<RecurringSeriesContainer />);
    expect(await screen.findByTestId(TID.series.resume)).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.series.cancel));
    expect(wire.writes()).toHaveLength(0);
    fireEvent.press(await screen.findByTestId(TID.series.cancelConfirm));
    expect(await screen.findByText("Series cancelled")).toBeTruthy();
    expect(wire.writes()[0].body).toEqual({ expectedVersion: 9 });
  });
});

describe("Booked-for-later hub", () => {
  it("lists every product with its own status word, reads even with the products switched off", async () => {
    const wire = installWire(
      (c) => {
        if (c.path === "/v1/mp/scheduled-requests")
          return { status: 200, json: { items: [scheduled()] } };
        if (c.path === "/v1/mp/advance-bookings")
          return {
            status: 200,
            json: {
              items: [
                booking({ state: "payment_pending", fullySecured: false }),
              ],
            },
          };
        if (c.path === "/v1/mp/recurring-templates")
          return { status: 200, json: { items: [series()] } };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<LaterHubContainer />);
    expect(
      await screen.findByTestId(dynamicTestId(TID.later.scheduled, "sr_1")),
    ).toBeTruthy();
    expect(screen.getByText("Driver reserved · payment pending")).toBeTruthy();
    expect(
      screen.getByText("Active · each trip books separately"),
    ).toBeTruthy();
    await flagsSettled(wire.calls);
    // Products off: existing bookings stay readable, new ones can't be started here.
    expect(screen.queryByTestId(TID.later.book)).toBeNull();
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.later.series, "tpl_1")),
    );
    expect(mockNavigate).toHaveBeenCalledWith("Series", {
      templateId: "tpl_1",
    });
  });

  it("empty and offline states", async () => {
    installWire(
      (c) =>
        c.path === "/v1/mp/scheduled-requests" ||
        c.path === "/v1/mp/advance-bookings" ||
        c.path === "/v1/mp/recurring-templates"
          ? { status: 200, json: { items: [] } }
          : undefined,
      { marketplace_rides: true, scheduled_rides: true },
    );
    const first = renderApp(<LaterHubContainer />);
    expect(await screen.findByTestId(TID.later.empty)).toBeTruthy();
    expect(await screen.findByTestId(TID.later.book)).toBeTruthy();
    first.unmount();

    installWire(() => "offline", { marketplace_rides: true });
    renderApp(<LaterHubContainer />);
    expect(await screen.findByTestId(TID.later.offline)).toBeTruthy();
  });
});

describe("Home — Booked for later tile", () => {
  const LISTS = [
    "/v1/mp/scheduled-requests",
    "/v1/mp/advance-bookings",
    "/v1/mp/recurring-templates",
  ];
  const lists = (items: Record<string, unknown[]>) => (c: { path: string }) =>
    LISTS.includes(c.path)
      ? { status: 200, json: { items: items[c.path] ?? [] } }
      : undefined;

  it("a product on: the tile shows without reading the rider's lists", async () => {
    const wire = installWire(lists({}), {
      marketplace_rides: true,
      scheduled_rides: true,
    });
    renderApp(<HomeScreen />);
    fireEvent.press(await screen.findByTestId(TID.later.entry));
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Later",
    });
    expect(wire.calls.some((c) => LISTS.includes(c.path))).toBe(false);
  });

  it("every product off: a rider with a live reservation still reaches it from Home", async () => {
    installWire(
      lists({
        "/v1/mp/advance-bookings": [booking({ state: "confirmed" })],
      }),
      { marketplace_rides: true },
    );
    renderApp(<HomeScreen />);
    expect(await screen.findByTestId(TID.later.entry)).toBeTruthy();
  });

  it("every product off and nothing live: no tile", async () => {
    const wire = installWire(
      lists({
        "/v1/mp/advance-bookings": [booking({ state: "cancelled" })],
        "/v1/mp/scheduled-requests": [scheduled({ state: "expired" })],
      }),
      { marketplace_rides: true },
    );
    renderApp(<HomeScreen />);
    await flagsSettled(wire.calls);
    await waitFor(() =>
      expect(
        LISTS.every((path) => wire.calls.some((c) => c.path === path)),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText("Name your fare")).toBeTruthy(),
    );
    expect(screen.queryByTestId(TID.later.entry)).toBeNull();
  });
});
