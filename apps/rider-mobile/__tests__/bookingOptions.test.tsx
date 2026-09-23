// Ride booking options on the fare editor, against the REAL client path (marketplaceApi /
// businessApi → api() → fetch). Asserted on the wire: the exact publish body per option
// (preferredDriver with the rider's explicit fallback, serviceNeeds, passenger with both
// attestations, business with paymentMethodId "business"), the city-config wallet id otherwise,
// and a caller-held Idempotency-Key. Asserted on screen: nothing sends until the rider chose a
// fallback / attested an adult; unavailable requirements say "Not available in this area";
// minors are refused in plain words; organization refusals (no budget / outside policy) are
// stated plainly; each surface is absent while its flag is off.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { FareEditorContainer } from "../src/screens/marketplace/FareEditorContainer";
import {
  installWire,
  NGN,
  refusal,
  type WireCall,
  type WireReply,
} from "./helpers/wire";
import { clearClients, flagsSettled, renderApp } from "./helpers/render";
import { DROPOFF, PICKUP, quote, request } from "./helpers/mpFixtures";
import {
  DRIVER_ID,
  DRIVER_ID_2,
  costCentre,
  favourite,
  organization,
  serviceNeedsCatalog,
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
const QP = {
  service: "ride",
  vehicleClass: "standard",
  pickup: PICKUP,
  dropoff: DROPOFF,
};
const plainQuote = (over = {}) =>
  quote({
    stops: undefined,
    stopsDwellSec: undefined,
    routeFingerprint: undefined,
    ...over,
  });
const published = () => ({
  status: 201,
  json: request({
    requestId: "req_new",
    stops: undefined,
    routeRevision: undefined,
  }),
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRouteParams = { quoteParams: QP };
});
afterEach(clearClients);

type Route = (c: WireCall) => WireReply | undefined;
const base =
  (extra: Route): Route =>
  (c) => {
    if (c.method === "GET" && c.path === "/v1/mp/quote")
      return { status: 200, json: plainQuote() };
    return extra(c);
  };
const publishCall = (calls: WireCall[]) =>
  calls.find((c) => c.method === "POST" && c.path === "/v1/mp/requests");

async function openReview() {
  fireEvent.press(await screen.findByTestId(TID.fare.review));
}

describe("Booking options are absent while their flags are off", () => {
  it("renders none of them, calls none of their reads, and publishes with the wallet id and a caller-held key", async () => {
    const wire = installWire(
      base((c) =>
        c.method === "POST" && c.path === "/v1/mp/requests"
          ? published()
          : undefined,
      ),
      { marketplace_rides: true },
    );
    renderApp(<FareEditorContainer />);
    await screen.findByTestId(TID.fare.review);
    await flagsSettled(wire.calls);
    for (const id of [
      TID.preferred.section,
      TID.needs.section,
      TID.guest.section,
      TID.business.section,
    ])
      expect(screen.queryByTestId(id)).toBeNull();
    expect(
      wire.calls.some((c) =>
        [
          "/v1/mp/favourite-drivers",
          "/v1/mp/service-needs",
          "/v1/organizations",
        ].includes(c.path),
      ),
    ).toBe(false);
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    const call = publishCall(wire.calls)!;
    expect(call.body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(6_000_00),
      paymentMethodId: "wallet",
    });
    expect(call.headers["Idempotency-Key"]).toMatch(/^publish_/);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Offers", {
        requestId: "req_new",
      }),
    );
  });
});

describe("Ask a saved driver first", () => {
  it("won't send until the rider chooses what happens if the driver doesn't offer, then publishes that choice", async () => {
    const wire = installWire(
      base((c) => {
        if (c.method === "GET" && c.path === "/v1/mp/favourite-drivers")
          return {
            status: 200,
            json: {
              items: [
                favourite(DRIVER_ID, "Chidi Obi"),
                favourite(DRIVER_ID_2, "Ada Bello", {
                  canRequest: false,
                  canRequestLabel: "Can't be asked first right now",
                }),
              ],
              note: "Saved drivers are yours alone.",
            },
          };
        if (c.method === "POST" && c.path === "/v1/mp/requests")
          return published();
        return undefined;
      }),
      { marketplace_rides: true, marketplace_preferred_drivers: true },
    );
    renderApp(<FareEditorContainer />);
    const section = await screen.findByTestId(TID.preferred.section);
    // Only drivers who can be asked are offered.
    expect(
      within(section).queryByTestId(
        dynamicTestId(TID.preferred.driver, DRIVER_ID_2),
      ),
    ).toBeNull();
    fireEvent.press(
      within(section).getByTestId(
        dynamicTestId(TID.preferred.driver, DRIVER_ID),
      ),
    );
    expect(screen.getByTestId(TID.preferred.note).props.children).toMatch(
      /doesn’t guarantee they’re available/,
    );
    await openReview();
    expect(
      screen.getByText(
        "Choose what happens if Chidi Obi doesn’t offer in time.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId(TID.review.edit));
    fireEvent.press(screen.getByTestId(TID.preferred.fallbackExpire));
    await openReview();
    expect(
      screen.getByText("Chidi Obi · closes free if they don’t offer"),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toMatchObject({
      preferredDriver: { driverId: DRIVER_ID, fallbackToMarket: false },
      paymentMethodId: "wallet",
    });
  });
});

describe("Service needs — verified requirements vs preferences", () => {
  it("offers only verified requirements, says 'Not available in this area' otherwise, and publishes codes only", async () => {
    const wire = installWire(
      base((c) => {
        if (c.method === "GET" && c.path === "/v1/mp/service-needs")
          return { status: 200, json: serviceNeedsCatalog() };
        if (c.method === "POST" && c.path === "/v1/mp/requests")
          return published();
        return undefined;
      }),
      { marketplace_rides: true, marketplace_accessibility_requirements: true },
    );
    renderApp(<FareEditorContainer />);
    await screen.findByTestId(TID.needs.section);
    expect(
      wire.calls.find((c) => c.path === "/v1/mp/service-needs")!.query,
    ).toEqual({ service: "ride", vehicleClass: "standard" });
    const wheelchair = screen.getByTestId(
      dynamicTestId(TID.needs.unavailable, "wheelchair_accessible_vehicle"),
    );
    expect(
      within(wheelchair).getByText("Not available in this area"),
    ).toBeTruthy();
    expect(
      within(wheelchair).getByText(
        "No verified wheelchair-accessible vehicle in this market yet.",
      ),
    ).toBeTruthy();
    // No checkbox exists for an unavailable requirement.
    expect(
      screen.queryByTestId(
        dynamicTestId(TID.needs.requirement, "wheelchair_accessible_vehicle"),
      ),
    ).toBeNull();
    expect(screen.getByTestId(TID.needs.fallback)).toBeTruthy();
    fireEvent.press(
      screen.getByTestId(
        dynamicTestId(TID.needs.requirement, "extra_luggage_capacity"),
      ),
    );
    fireEvent.press(
      screen.getByTestId(
        dynamicTestId(TID.needs.preference, "electric_vehicle"),
      ),
    );
    expect(
      screen.getByText(/Preferences change the order of offers only/),
    ).toBeTruthy();
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toMatchObject({
      serviceNeeds: {
        requirements: ["extra_luggage_capacity"],
        preferences: ["electric_vehicle"],
      },
    });
  });

  it("states a server refusal (409 service_need_unavailable) plainly — nothing was sent", async () => {
    installWire(
      base((c) => {
        if (c.method === "GET" && c.path === "/v1/mp/service-needs")
          return { status: 200, json: serviceNeedsCatalog() };
        if (c.method === "POST" && c.path === "/v1/mp/requests")
          return refusal(
            409,
            "conflict",
            "a requirement you stated cannot be met",
            {
              reason: "service_need_unavailable",
              requirements: [
                {
                  code: "extra_luggage_capacity",
                  title: "Extra luggage capacity",
                  availability: "unavailable",
                  detail: "No verified large vehicle is online right now.",
                },
              ],
              fallback:
                "Nothing was published. You can publish without the requirement, add it as a preference where one fits, or contact support to arrange the trip.",
            },
          );
        return undefined;
      }),
      { marketplace_rides: true, marketplace_accessibility_requirements: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.needs.requirement, "extra_luggage_capacity"),
      ),
    );
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    expect(await screen.findByText("Not available in this area")).toBeTruthy();
    expect(
      screen.getByText(
        /Extra luggage capacity: No verified large vehicle is online right now\. Nothing was published\./,
      ),
    ).toBeTruthy();
  });
});

describe("Book for another adult", () => {
  it("refuses minors in plain words, validates the phone, and sends both attestations", async () => {
    const wire = installWire(
      base((c) =>
        c.method === "POST" && c.path === "/v1/mp/requests"
          ? published()
          : undefined,
      ),
      { marketplace_rides: true, marketplace_guest_bookings: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(await screen.findByTestId(TID.guest.forOther));
    expect(screen.getByTestId(TID.guest.minors).props.children).toMatch(
      /can’t book a ride for a child travelling alone/,
    );
    fireEvent.changeText(screen.getByTestId(TID.guest.firstName), "Ngozi");
    fireEvent.changeText(screen.getByTestId(TID.guest.phone), "0803 000 0001");
    await openReview();
    // Not sendable: phone without the country code, no adult attestation, no consent.
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId(TID.review.edit));
    const errors = screen.getByTestId(TID.guest.fieldError);
    expect(
      within(errors).getByText(
        "Enter their mobile number with the country code, e.g. +2348012345678.",
      ),
    ).toBeTruthy();
    expect(within(errors).getByText(/child travelling alone/)).toBeTruthy();
    fireEvent.changeText(
      screen.getByTestId(TID.guest.phone),
      "+234 803 000 0001",
    );
    fireEvent.press(screen.getByTestId(TID.guest.adult));
    fireEvent.press(screen.getByTestId(TID.guest.consent));
    expect(screen.queryByTestId(TID.guest.fieldError)).toBeNull();
    await openReview();
    expect(screen.getByText("Ngozi · trip link by text")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toMatchObject({
      passenger: {
        firstName: "Ngozi",
        phone: "+2348030000001",
        isAdult: true,
        consentConfirmed: true,
      },
      paymentMethodId: "wallet",
    });
  });

  it("explains a paused trip-link service (503 trip_link_delivery_unavailable) honestly", async () => {
    installWire(
      base((c) =>
        c.method === "POST" && c.path === "/v1/mp/requests"
          ? refusal(503, "service_unavailable", "trip link cannot be sealed", {
              reason: "trip_link_delivery_unavailable",
            })
          : undefined,
      ),
      { marketplace_rides: true, marketplace_guest_bookings: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(await screen.findByTestId(TID.guest.forOther));
    fireEvent.changeText(screen.getByTestId(TID.guest.firstName), "Ngozi");
    fireEvent.changeText(screen.getByTestId(TID.guest.phone), "+2348030000001");
    fireEvent.press(screen.getByTestId(TID.guest.adult));
    fireEvent.press(screen.getByTestId(TID.guest.consent));
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    expect(
      await screen.findByText("Can’t send a trip link right now"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Booking for yourself still works\. Nothing was booked\./,
      ),
    ).toBeTruthy();
  });
});

describe("Bill an organization", () => {
  const orgRoutes =
    (check: object, publish: () => WireReply): Route =>
    (c) => {
      if (c.method === "GET" && c.path === "/v1/mp/quote")
        return {
          status: 200,
          json: plainQuote(
            c.query.organizationId ? { quoteId: "q_biz", business: check } : {},
          ),
        };
      if (c.method === "GET" && c.path === "/v1/organizations")
        return {
          status: 200,
          json: { success: true, data: { organizations: [organization()] } },
        };
      if (
        c.method === "GET" &&
        c.path === "/v1/organizations/org_acme/cost-centres"
      )
        return {
          status: 200,
          json: {
            success: true,
            data: {
              costCentres: [costCentre("occ_sales", "SAL", "Sales")],
            },
          },
        };
      if (c.method === "POST" && c.path === "/v1/mp/requests") return publish();
      return undefined;
    };

  it("re-quotes with the organization, shows the refusal reasons plainly and blocks sending", async () => {
    const wire = installWire(
      orgRoutes(
        {
          organizationId: "org_acme",
          status: "refused",
          reasons: ["budget_insufficient"],
          checkedAmountMinor: NGN(6_000_00),
          available: NGN(2_000_00),
          costCentreId: "occ_sales",
          policyVersion: 3,
          note: "Advisory: the budget is reserved only when you choose an offer.",
        },
        published,
      ),
      { marketplace_rides: true, business_travel: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.costCentre, "occ_sales"),
      ),
    );
    await waitFor(() =>
      expect(
        wire.calls.some(
          (c) =>
            c.path === "/v1/mp/quote" &&
            c.query.organizationId === "org_acme" &&
            c.query.costCentreId === "occ_sales",
        ),
      ).toBe(true),
    );
    const verdict = await screen.findByTestId(TID.business.verdict);
    expect(
      within(verdict).getByText("Not bookable on Acme Logistics"),
    ).toBeTruthy();
    expect(
      within(verdict).getByText(
        "There isn’t enough budget left on this cost centre for this fare.",
      ),
    ).toBeTruthy();
    await openReview();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("publishes on the organization's budget (never the wallet) and states a no-budget refusal plainly", async () => {
    const wire = installWire(
      orgRoutes(
        {
          organizationId: "org_acme",
          status: "allowed",
          reasons: [],
          checkedAmountMinor: NGN(6_000_00),
          available: NGN(50_000_00),
          costCentreId: "occ_sales",
          policyVersion: 3,
          note: "Advisory: the budget is reserved only when you choose an offer.",
        },
        () =>
          refusal(422, "insufficient_spendable", "no budget", {
            reason: "no_budget_for_period",
          }),
      ),
      { marketplace_rides: true, business_travel: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    fireEvent.changeText(
      await screen.findByTestId(TID.business.category),
      "Client visit",
    );
    const verdict = await screen.findByTestId(TID.business.verdict);
    expect(within(verdict).getByText("Within the travel policy")).toBeTruthy();
    await openReview();
    expect(screen.getByText("Acme Logistics budget")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    // The fare editor's own quote is published; the organization verdict was an advisory read.
    expect(publishCall(wire.calls)!.body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(6_000_00),
      paymentMethodId: "business",
      business: { organizationId: "org_acme", expenseCategory: "Client visit" },
    });
    expect(await screen.findByText("No budget for this trip")).toBeTruthy();
    expect(
      screen.getByText(
        /There is no budget on this cost centre for this month\. UBI never books a business trip on credit\./,
      ),
    ).toBeTruthy();
  });

  it("a check refused outright (403 booker_not_authorized) is stated plainly, keeps the fare editor, and paying personally still works", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/quote")
          return c.query.organizationId
            ? refusal(403, "forbidden", "not a booker", {
                reason: "booker_not_authorized",
              })
            : { status: 200, json: plainQuote() };
        if (c.method === "GET" && c.path === "/v1/organizations")
          return {
            status: 200,
            json: { success: true, data: { organizations: [organization()] } },
          };
        if (c.path === "/v1/organizations/org_acme/cost-centres")
          return {
            status: 200,
            json: { success: true, data: { costCentres: [] } },
          };
        if (c.method === "POST" && c.path === "/v1/mp/requests")
          return published();
        return undefined;
      },
      { marketplace_rides: true, business_travel: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    const verdict = await screen.findByTestId(TID.business.verdict);
    expect(
      within(verdict).getByText("Not bookable on Acme Logistics"),
    ).toBeTruthy();
    expect(
      within(verdict).getByText("You can’t book on this organization."),
    ).toBeTruthy();
    // The fare editor itself is still there.
    expect(screen.getByTestId(TID.fare.amountInput)).toBeTruthy();
    await openReview();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId(TID.review.edit));
    fireEvent.press(screen.getByTestId(TID.business.personal));
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toMatchObject({
      paymentMethodId: "wallet",
    });
    expect(publishCall(wire.calls)!.body).not.toHaveProperty("business");
  });

  it("a verdict refused only for the per-trip cap at the SUGGESTED fare doesn't block a different fare — the server checks the fare sent", async () => {
    const wire = installWire(
      orgRoutes(
        {
          organizationId: "org_acme",
          status: "refused",
          reasons: ["trip_cap_exceeded"],
          checkedAmountMinor: NGN(6_000_00),
          available: NGN(50_000_00),
          costCentreId: null,
          policyVersion: 3,
          note: "Advisory: the budget is reserved only when you choose an offer.",
        },
        published,
      ),
      { marketplace_rides: true, business_travel: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    // At the suggested fare (the one being sent) the refusal blocks.
    const verdict = await screen.findByTestId(TID.business.verdict);
    expect(
      within(verdict).getByText("Not bookable on Acme Logistics"),
    ).toBeTruthy();
    expect(
      within(verdict).getByText(/Checked at the suggested fare of/),
    ).toBeTruthy();
    await openReview();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId(TID.review.edit));
    // A lower fare is not what was checked: the verdict says so and sending is allowed.
    fireEvent.changeText(screen.getByTestId(TID.fare.amountInput), "5500");
    expect(
      await within(screen.getByTestId(TID.business.verdict)).findByText(
        "Over the policy at the suggested fare",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.business.verdict)).getByText(
        /Your fare is different, so it is checked again when you send/,
      ),
    ).toBeTruthy();
    await openReview();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).not.toBe(true);
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(5_500_00),
      paymentMethodId: "business",
      business: { organizationId: "org_acme" },
    });
  });

  it("a policy refusal that doesn't depend on the fare (vehicle class) still blocks at any fare", async () => {
    installWire(
      orgRoutes(
        {
          organizationId: "org_acme",
          status: "refused",
          reasons: ["class_not_allowed"],
          checkedAmountMinor: NGN(6_000_00),
          available: null,
          costCentreId: null,
          policyVersion: 3,
          note: "Advisory: the budget is reserved only when you choose an offer.",
        },
        published,
      ),
      { marketplace_rides: true, business_travel: true },
    );
    renderApp(<FareEditorContainer />);
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    await screen.findByTestId(TID.business.verdict);
    fireEvent.changeText(screen.getByTestId(TID.fare.amountInput), "5500");
    expect(
      within(screen.getByTestId(TID.business.verdict)).getByText(
        "Not bookable on Acme Logistics",
      ),
    ).toBeTruthy();
    await openReview();
    expect(
      screen.getByTestId(TID.review.send).props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("a colleague picked for 'Someone else' is never sent once the rider switches back to 'Me'", async () => {
    const COLLEAGUE = "7b2e4c1a-9f3d-4e8b-a6c5-1d2e3f4a5b6c";
    const org = orgRoutes(
      {
        organizationId: "org_acme",
        status: "allowed",
        reasons: [],
        checkedAmountMinor: NGN(6_000_00),
        available: NGN(50_000_00),
        costCentreId: null,
        policyVersion: 3,
        note: "Advisory: the budget is reserved only when you choose an offer.",
      },
      published,
    );
    const members = (c: WireCall): WireReply | undefined => {
      if (c.method === "GET" && c.path === "/v1/organizations/org_acme/members")
        return {
          status: 200,
          json: {
            success: true,
            data: {
              members: [
                {
                  memberId: "om_2",
                  userId: COLLEAGUE,
                  displayName: "Amaka Obi",
                  role: "traveller",
                  status: "active",
                  costCentreId: null,
                  joinedAt: new Date().toISOString(),
                },
              ],
            },
          },
        };
      if (c.method === "GET" && c.path === "/v1/users/me")
        return {
          status: 200,
          json: { success: true, data: { user: { id: "usr_booker" } } },
        };
      return undefined;
    };
    const wire = installWire((c) => members(c) ?? org(c), {
      marketplace_rides: true,
      business_travel: true,
      marketplace_guest_bookings: true,
    });
    renderApp(<FareEditorContainer />);
    fireEvent.press(await screen.findByTestId(TID.guest.forOther));
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.organization, "org_acme"),
      ),
    );
    fireEvent.press(
      await screen.findByTestId(
        dynamicTestId(TID.business.traveller, COLLEAGUE),
      ),
    );
    await waitFor(() =>
      expect(
        wire.calls.some(
          (c) => c.path === "/v1/mp/quote" && c.query.travellerId === COLLEAGUE,
        ),
      ).toBe(true),
    );
    // Back to "Me": the booker travels; no colleague, no passenger.
    fireEvent.press(screen.getByTestId(TID.guest.forMe));
    await openReview();
    fireEvent.press(screen.getByTestId(TID.review.send));
    await waitFor(() => expect(publishCall(wire.calls)).toBeTruthy());
    expect(publishCall(wire.calls)!.body).toEqual({
      quoteId: "q_route_1",
      requestedFareMinor: NGN(6_000_00),
      paymentMethodId: "business",
      business: { organizationId: "org_acme" },
    });
  });
});
