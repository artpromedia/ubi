// Saved drivers, the rider's receipt and the requester's passenger trip-link card, against the
// REAL client path (marketplaceApi → api() → fetch). Asserted on the wire: exact routes and
// caller-held Idempotency-Keys on every POST (remove / save / reissue / revoke). Asserted on
// screen: saved drivers stay readable with the flag off; the receipt itemises committed
// adjustments, included taxes and business fields and never a commission; "settling" and "not
// completed" are honest states, never a figure; the trip link's status, and the bounded reissue.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { FavouriteDriversContainer } from "../src/screens/marketplace/FavouriteDrivers";
import { ReceiptContainer } from "../src/screens/marketplace/ReceiptScreen";
import { OfferInboxContainer } from "../src/screens/marketplace/OfferInboxContainer";
import { RequestPassengerPanel } from "../src/screens/marketplace/PassengerLinkCard";
import { installWire, NGN, refusal } from "./helpers/wire";
import { clearClients, flagsSettled, renderApp } from "./helpers/render";
import { request } from "./helpers/mpFixtures";
import {
  DRIVER_ID,
  DRIVER_ID_2,
  favourite,
  requestPassenger,
  riderReceipt,
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

beforeEach(() => {
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});
afterEach(clearClients);

describe("Saved drivers", () => {
  const list = () => ({
    status: 200,
    json: {
      items: [
        favourite(DRIVER_ID, "Chidi Obi"),
        favourite(DRIVER_ID_2, "Ada Bello", {
          canRequest: false,
          canRequestLabel: "Can’t be asked first right now",
        }),
      ],
      note: "Saved drivers are visible only to you.",
    },
  });

  it("lists each driver with whether they can be asked first, and removes one with an Idempotency-Key", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/favourite-drivers")
          return list();
        if (
          c.method === "POST" &&
          c.path === "/v1/mp/favourite-drivers/" + DRIVER_ID_2 + "/remove"
        )
          return {
            status: 200,
            json: favourite(DRIVER_ID_2, "Ada Bello", { state: "removed" }),
          };
        return undefined;
      },
      { marketplace_rides: true, marketplace_preferred_drivers: true },
    );
    renderApp(<FavouriteDriversContainer />);
    const chidi = await screen.findByTestId(
      dynamicTestId(TID.favourites.item, DRIVER_ID),
    );
    expect(within(chidi).getByText("Chidi Obi")).toBeTruthy();
    expect(within(chidi).getByText("Can be asked first")).toBeTruthy();
    expect(
      within(
        screen.getByTestId(dynamicTestId(TID.favourites.item, DRIVER_ID_2)),
      ).getByText("Can’t be asked first right now"),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.favourites.book)).toBeTruthy();

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.favourites.remove, DRIVER_ID_2)),
    );
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [call] = wire.writes();
    expect(call.path).toBe(
      "/v1/mp/favourite-drivers/" + DRIVER_ID_2 + "/remove",
    );
    expect(call.body).toBeUndefined();
    expect(call.headers["Idempotency-Key"]).toMatch(/^fav_/);
    expect(
      await screen.findByText("Ada Bello was removed from your saved drivers."),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(dynamicTestId(TID.favourites.item, DRIVER_ID_2)),
    ).toBeNull();
  });

  it("stays readable with the flag off — and says asking first isn't available", async () => {
    const wire = installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/favourite-drivers"
          ? list()
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<FavouriteDriversContainer />);
    await screen.findByTestId(dynamicTestId(TID.favourites.item, DRIVER_ID));
    await flagsSettled(wire.calls);
    expect(
      within(screen.getByTestId(TID.favourites.note)).getByText(
        /Asking a saved driver first isn’t available in your city right now/,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.favourites.book)).toBeNull();
  });

  it("shows empty, error and offline states honestly", async () => {
    installWire(
      (c) =>
        c.path === "/v1/mp/favourite-drivers"
          ? {
              status: 200,
              json: {
                items: [],
                note: "Saved drivers are visible only to you.",
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    const first = renderApp(<FavouriteDriversContainer />);
    expect(await screen.findByTestId(TID.favourites.empty)).toBeTruthy();
    first.unmount();

    installWire(
      (c) => (c.path === "/v1/mp/favourite-drivers" ? "offline" : undefined),
      {
        marketplace_rides: true,
      },
    );
    const second = renderApp(<FavouriteDriversContainer />);
    expect(await screen.findByTestId(TID.favourites.offline)).toBeTruthy();
    second.unmount();

    installWire(
      (c) =>
        c.path === "/v1/mp/favourite-drivers"
          ? refusal(
              500,
              "internal_error",
              "the saved drivers could not be read",
            )
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<FavouriteDriversContainer />);
    expect(await screen.findByTestId(TID.favourites.error)).toBeTruthy();
    expect(screen.getByTestId(TID.favourites.retry)).toBeTruthy();
  });
});

describe("Receipt", () => {
  beforeEach(() => {
    mockRouteParams = { requestId: "req_1" };
  });

  it("itemises the agreed fare and each committed adjustment, the included taxes and the total — never a commission", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1/receipt"
          ? { status: 200, json: riderReceipt() }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<ReceiptContainer />);
    const fare = await screen.findByTestId(
      dynamicTestId(TID.receipt.line, "agreed_fare"),
    );
    expect(within(fare).getByText("Agreed fare")).toBeTruthy();
    expect(within(fare).getByText("₦6,000")).toBeTruthy();
    const change = screen.getByTestId(dynamicTestId(TID.receipt.line, "amd_1"));
    expect(within(change).getByText("Agreed route change")).toBeTruthy();
    expect(within(change).getByText("+₦750")).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.total)).getByText("₦6,750"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.taxes)).getByText(
        "VAT 7.5% (included)",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.payment)).getByText("UBI Wallet"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.trip)).getByText(
        "standard · 18.4 km · 1 of 2 stops visited · 1 skipped",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.reconciliation)).getByText(
        "Total = agreed fare + committed adjustments = the settled fare.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/commission/i)).toBeNull();
    expect(screen.queryByTestId(TID.receipt.business)).toBeNull();
    // Saving the driver is flag-gated.
    expect(screen.queryByTestId(TID.receipt.saveDriver)).toBeNull();
  });

  it("shows the business fields when an organization paid", async () => {
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1/receipt"
          ? {
              status: 200,
              json: riderReceipt({
                payment: { method: "business", label: "Acme Logistics budget" },
                business: {
                  organizationId: "org_acme",
                  organizationName: "Acme Logistics",
                  legalName: "Acme Logistics Nigeria Ltd",
                  taxId: "TIN-0099",
                  costCentre: { id: "occ_sales", code: "SAL", name: "Sales" },
                  expenseCategory: "Client visit",
                  bookingRef: "awd_1",
                  bookerId: "u_rider_1",
                  travellerId: "u_rider_1",
                  fundingState: "committed",
                  committedMinor: NGN(6_750_00),
                  ledgerTaxes: [],
                  note: "Charged once to the Sales budget for September.",
                },
              }),
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<ReceiptContainer />);
    const b = await screen.findByTestId(TID.receipt.business);
    expect(within(b).getByText("Acme Logistics Nigeria Ltd")).toBeTruthy();
    expect(within(b).getByText("TIN-0099")).toBeTruthy();
    expect(within(b).getByText("SAL · Sales")).toBeTruthy();
    expect(within(b).getByText("Client visit")).toBeTruthy();
    expect(
      within(b).getByText("Charged to the organization’s budget"),
    ).toBeTruthy();
    expect(within(b).getByText("₦6,750")).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.receipt.payment)).getByText(
        "Acme Logistics budget",
      ),
    ).toBeTruthy();
  });

  it("says 'being finalised' while money settles and 'no receipt yet' before completion — never a figure", async () => {
    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1/receipt"
          ? refusal(409, "conflict", "settling", { reason: "settling" })
          : undefined,
      { marketplace_rides: true },
    );
    const first = renderApp(<ReceiptContainer />);
    const settling = await screen.findByTestId(TID.receipt.settling);
    expect(
      within(settling).getByText("Your receipt is being finalised"),
    ).toBeTruthy();
    expect(screen.queryByText(/₦/)).toBeNull();
    first.unmount();

    installWire(
      (c) =>
        c.path === "/v1/mp/requests/req_1/receipt"
          ? refusal(409, "conflict", "not completed", {
              reason: "trip_not_completed",
            })
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<ReceiptContainer />);
    expect(await screen.findByTestId(TID.receipt.notCompleted)).toBeTruthy();
  });

  it("saves the driver with an Idempotency-Key, and states a refusal plainly", async () => {
    let refuse = false;
    const wire = installWire(
      (c) => {
        if (c.path === "/v1/mp/requests/req_1/receipt")
          return { status: 200, json: riderReceipt() };
        if (c.method === "POST" && c.path === "/v1/mp/favourite-drivers")
          return refuse
            ? refusal(409, "conflict", "That trip is not completed.", {
                reason: "trip_not_completed",
              })
            : { status: 201, json: favourite(DRIVER_ID, "Emeka Okafor") };
        return undefined;
      },
      { marketplace_rides: true, marketplace_preferred_drivers: true },
    );
    const first = renderApp(<ReceiptContainer />);
    fireEvent.press(await screen.findByTestId(TID.receipt.saveDriver));
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [call] = wire.writes();
    expect(call.body).toEqual({ requestId: "req_1" });
    expect(call.headers["Idempotency-Key"]).toMatch(/^favsave_/);
    expect(
      within(await screen.findByTestId(TID.receipt.saved)).getByText(
        /Emeka Okafor is saved\..*they may not always be available/,
      ),
    ).toBeTruthy();
    first.unmount();

    refuse = true;
    renderApp(<ReceiptContainer />);
    fireEvent.press(await screen.findByTestId(TID.receipt.saveDriver));
    expect(await screen.findByTestId(TID.receipt.refusal)).toBeTruthy();
    expect(screen.getByText("That trip is not completed.")).toBeTruthy();
  });
});

describe("Passenger trip link (requester's view)", () => {
  beforeEach(() => {
    mockRouteParams = { requestId: "req_1" };
  });
  const snap = (
    passenger: ReturnType<typeof requestPassenger> | null = requestPassenger(),
  ) => ({
    status: 200,
    json: {
      request: request({
        stops: undefined,
        routeRevision: undefined,
        ...(passenger ? { passenger } : {}),
      }),
      offers: [],
      seq: 1,
    },
  });

  it("shows the passenger and the link's status, and sends a fresh link with an Idempotency-Key", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/requests/req_1")
          return snap();
        if (
          c.method === "POST" &&
          c.path === "/v1/mp/requests/req_1/passenger/access/reissue"
        )
          return {
            status: 200,
            json: requestPassenger({ accessSentAt: new Date().toISOString() }),
          };
        return undefined;
      },
      { marketplace_rides: true, marketplace_guest_bookings: true },
    );
    renderApp(<OfferInboxContainer />);
    const card = await screen.findByTestId(TID.guest.link);
    expect(within(card).getByText("Ngozi Eze")).toBeTruthy();
    expect(within(card).getByText("+2348030000001 · You pay")).toBeTruthy();
    expect(within(card).getByText("Trip link sent · active")).toBeTruthy();
    expect(
      within(card).getByText(/nothing about you, the fare or your other trips/),
    ).toBeTruthy();
    fireEvent.press(within(card).getByTestId(TID.guest.reissue));
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [call] = wire.writes();
    expect(call.path).toBe("/v1/mp/requests/req_1/passenger/access/reissue");
    expect(call.headers["Idempotency-Key"]).toMatch(/^guest_/);
    expect(
      await screen.findByText("A fresh trip link is on its way to Ngozi."),
    ).toBeTruthy();
  });

  it("states the reissue bound (429 trip_link_limit) and withdraws the link on request", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/mp/requests/req_1")
          return snap();
        if (c.path === "/v1/mp/requests/req_1/passenger/access/reissue")
          return refusal(429, "rate_limited", "sent 5 times", {
            reason: "trip_link_limit",
            limit: 5,
          });
        if (c.path === "/v1/mp/requests/req_1/passenger/access/revoke")
          return {
            status: 200,
            json: requestPassenger({ accessStatus: "revoked" }),
          };
        return undefined;
      },
      { marketplace_rides: true, marketplace_guest_bookings: true },
    );
    renderApp(<OfferInboxContainer />);
    fireEvent.press(await screen.findByTestId(TID.guest.reissue));
    const refused = await screen.findByTestId(TID.guest.refusal);
    expect(within(refused).getByText("Link already sent 5 times")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.guest.revoke));
    await waitFor(() =>
      expect(wire.writes().map((c) => c.path)).toContain(
        "/v1/mp/requests/req_1/passenger/access/revoke",
      ),
    );
    expect(await screen.findByText("Trip link withdrawn")).toBeTruthy();
    expect(screen.queryByTestId(TID.guest.revoke)).toBeNull();
  });

  it("a declined passenger closes the request honestly, free", async () => {
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? {
              status: 200,
              json: {
                request: request({
                  stops: undefined,
                  routeRevision: undefined,
                  state: "cancelled",
                  closeReason: "passenger_declined",
                  passenger: requestPassenger({
                    accessStatus: "declined",
                    declinedAt: new Date().toISOString(),
                  }),
                }),
                offers: [],
                seq: 2,
              },
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<OfferInboxContainer />);
    expect(
      await screen.findByText("Your passenger declined this trip"),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing was charged to you/)).toBeTruthy();
  });

  it("follows the requester onto the ride: shown only for a request booked for someone else", async () => {
    let withPassenger = true;
    installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? snap(withPassenger ? requestPassenger() : null)
          : undefined,
      { marketplace_rides: true },
    );
    const first = renderApp(<RequestPassengerPanel requestId="req_1" />);
    expect(await screen.findByText("Trip link sent · active")).toBeTruthy();
    first.unmount();

    withPassenger = false;
    const wire = installWire(
      (c) =>
        c.method === "GET" && c.path === "/v1/mp/requests/req_1"
          ? snap(null)
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<RequestPassengerPanel requestId="req_1" />);
    await waitFor(() =>
      expect(wire.calls.some((c) => c.path === "/v1/mp/requests/req_1")).toBe(
        true,
      ),
    );
    await flagsSettled(wire.calls);
    expect(screen.queryByTestId(TID.guest.link)).toBeNull();
  });
});
