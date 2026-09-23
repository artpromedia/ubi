// Airport transfers on the round-5/6 contract, against the REAL client path (travelApi → api()
// → fetch). Asserted on the wire: POST /v1/reservations carries EXACTLY the strict
// CreateAirportTransfer body (no pickup time, no class id, no city) with a caller-held
// Idempotency-Key; decisions and cancel are keyed too; the unserved client calls (cart GET,
// pickup "suggestion") are gone. Asserted on screen: pending "no driver yet", sent to drivers,
// DRIVER CONFIRMED only when awarded, labelled choices, the honest failed outcome, the linked
// item's own word, the flag-off fallback and the checkout that never invents a cart.
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { AttachAirportRideScreen } from "../src/screens/travel/AttachAirportRideScreen";
import { TransferStatusContainer } from "../src/screens/travel/TransferStatusScreen";
import { LinkedOrdersScreen } from "../src/screens/travel/LinkedOrdersScreen";
import { TravelCheckoutScreen } from "../src/screens/travel/TravelCheckoutScreen";
import { travelApi, cartKey, type Cart } from "../src/api/travel";
import { installWire, NGN, refusal } from "./helpers/wire";
import {
  clearClients,
  flagsSettled,
  newQueryClient,
  renderApp,
} from "./helpers/render";
import { transfer } from "./helpers/confidenceFixtures";

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: unknown = {};
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const TID = TEST_IDS.travel.transfer;
const PLACE = TEST_IDS.mp.rider.place;

beforeEach(() => {
  mockNavigate.mockReset();
  mockReplace.mockReset();
  mockGoBack.mockReset();
});
afterEach(clearClients);

const order = () => ({
  id: "ord_flt_1",
  tripId: "trip_1",
  kind: "flight",
  title: "Air Peace P47133 · ABV → LOS",
  state: "ticketed",
  headline: "Flight ticketed",
  body: "",
  ladder: [],
  supplierRefs: { pnr: "X7K2QZ" },
  price: NGN(185_000_00),
  policy: { cancellation: "Non-refundable" },
});

async function pickOnMap(
  openTestID: string,
  lat: number,
  lng: number,
  label: string,
) {
  fireEvent.press(screen.getByTestId(openTestID));
  fireEvent(await screen.findByTestId(PLACE.map), "press", {
    nativeEvent: { coordinate: { latitude: lat, longitude: lng } },
  });
  fireEvent.changeText(screen.getByTestId(PLACE.label), label);
  fireEvent.press(screen.getByTestId(PLACE.confirm));
  await waitFor(() => expect(screen.queryByTestId(PLACE.map)).toBeNull());
}

describe("travel client — only routes travel-service serves", () => {
  it("has no cart GET and no pickup suggestion; the transfer create is the strict intent", () => {
    const api = travelApi as Record<string, unknown>;
    expect(api.cart).toBeUndefined();
    expect(api.reservationSuggestion).toBeUndefined();
    expect(api.reserve).toBeUndefined();
    expect(typeof api.createTransfer).toBe("function");
  });
});

describe("Airport transfer intent", () => {
  beforeEach(() => {
    mockRouteParams = { orderId: "ord_flt_1", direction: "from_airport" };
  });

  it("sends exactly the strict CreateAirportTransfer body with an Idempotency-Key, then opens the pending transfer", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === "/v1/travel/orders/ord_flt_1")
          return { status: 200, json: order() };
        if (c.method === "POST" && c.path === "/v1/reservations")
          return { status: 202, json: transfer() };
        return undefined;
      },
      { reservations: true, flights_booking: true },
    );
    renderApp(<AttachAirportRideScreen />);
    expect(
      await screen.findByText("Air Peace P47133 · ABV → LOS"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.publishNote)).getByText(
        /Nothing is booked now\. UBI sends your request to drivers near your landing time.*No driver is secured until you choose a driver’s offer/,
      ),
    ).toBeTruthy();
    // Missing inputs are caught before anything is sent.
    fireEvent.press(screen.getByTestId(TID.submit));
    expect(screen.getByTestId(TID.fieldError).props.children).toBe(
      "Choose the airport point and your address — the ride links them.",
    );
    await pickOnMap(TID.airportPoint, 6.5774, 3.3211, "LOS airport — Door 3");
    await pickOnMap(TID.place, 6.4281, 3.4216, "Victoria Island");
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.vehicleClass, "comfort")),
    );
    fireEvent.press(screen.getByTestId(TID.submit));
    expect(screen.getByTestId(TID.fieldError).props.children).toMatch(
      /Enter the most you approve/,
    );
    fireEvent.changeText(screen.getByTestId(TID.limit), "15,000");
    fireEvent.press(screen.getByTestId(TID.submit));
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [call] = wire.writes();
    expect(call.path).toBe("/v1/reservations");
    expect(call.body).toEqual({
      linkedOrderId: "ord_flt_1",
      legIndex: 0,
      direction: "arrival_pickup",
      airportPoint: { lat: 6.5774, lng: 3.3211, label: "LOS airport — Door 3" },
      place: { lat: 6.4281, lng: 3.4216, label: "Victoria Island" },
      vehicleClass: "comfort",
      maxFareMinor: NGN(15_000_00),
      paymentMethodId: "wallet",
    });
    expect(call.headers["Idempotency-Key"]).toMatch(/^transfer_/);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("Transfer", {
        transferId: "atr_1",
      }),
    );
  });

  it("states a server refusal plainly (pickup_too_soon)", async () => {
    installWire(
      (c) => {
        if (c.path === "/v1/travel/orders/ord_flt_1")
          return { status: 200, json: order() };
        if (c.method === "POST" && c.path === "/v1/reservations")
          return refusal(422, "validation_failed", "too soon", {
            reason: "pickup_too_soon",
            minimumLeadMinutes: 90,
          });
        return undefined;
      },
      { reservations: true },
    );
    renderApp(<AttachAirportRideScreen />);
    await screen.findByText("Air Peace P47133 · ABV → LOS");
    await pickOnMap(TID.airportPoint, 6.5774, 3.3211, "Door 3");
    await pickOnMap(TID.place, 6.4281, 3.4216, "Home");
    fireEvent.changeText(screen.getByTestId(TID.limit), "15000");
    fireEvent.press(screen.getByTestId(TID.submit));
    const refused = await screen.findByTestId(TID.refusal);
    expect(
      within(refused).getByText(
        "This pickup is too soon to schedule. Request a ride in the ride app when you’re ready.",
      ),
    ).toBeTruthy();
  });

  it("is honestly unavailable with the reservations flag off — and calls nothing", async () => {
    const wire = installWire(() => undefined, { flights_booking: true });
    renderApp(<AttachAirportRideScreen />);
    await flagsSettled(wire.calls);
    expect(await screen.findByTestId(TID.unavailable)).toBeTruthy();
    expect(
      wire.calls.filter((c) => c.path !== "/v1/config/flags"),
    ).toHaveLength(0);
  });
});

describe("Airport transfer status", () => {
  beforeEach(() => {
    mockRouteParams = { transferId: "atr_1" };
  });
  const serve =
    (t: ReturnType<typeof transfer>) =>
    (c: { method: string; path: string }) =>
      c.method === "GET" && c.path === "/v1/reservations/atr_1"
        ? { status: 200, json: t }
        : undefined;

  it("pending: 'no driver yet', the server's window and limit, and a free cancel", async () => {
    const wire = installWire(
      (c) =>
        c.method === "POST" && c.path === "/v1/reservations/atr_1/cancel"
          ? {
              status: 200,
              json: transfer({
                status: "cancelled",
                statusLabel: "Cancelled",
                outcome: {
                  reason: "cancelled_by_traveller",
                  message:
                    "You cancelled this airport ride before any driver was secured. Nothing was charged for the ride.",
                },
              }),
            }
          : serve(transfer())(c),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    expect(
      within(await screen.findByTestId(TID.status)).getByText(
        "Pending · no driver yet",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.noDriver)).toBeTruthy();
    expect(screen.queryByTestId(TID.driverSecured)).toBeNull();
    expect(
      within(screen.getByTestId(TID.window)).getByText(
        "Pickup window Thu 25 Sep, 07:40 – 08:10 (Africa/Lagos)",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.limitApproved)).getByText("₦15,000"),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.choice, "cancel")));
    expect(
      screen.getByText("No driver is secured yet, so cancelling is free."),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.choice, "cancelConfirm")),
    );
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    expect(wire.writes()[0].headers["Idempotency-Key"]).toMatch(/^xfer_/);
    expect(
      within(await screen.findByTestId(TID.outcome)).getByText(
        /Nothing was charged for the ride\./,
      ),
    ).toBeTruthy();
  });

  it("requested: still no driver, and the rider is sent to the offers in the ride app", async () => {
    installWire(
      serve(
        transfer({
          status: "requested",
          statusLabel: "Sent to drivers — no driver secured yet",
          ride: {
            scheduledRequestId: "sr_1",
            requestId: "req_9",
            state: "published",
            requestState: "open",
          },
        }),
      ),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    expect(
      within(await screen.findByTestId(TID.status)).getByText(
        "Sent to drivers · no driver yet",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.noDriver)).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.openRide));
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Offers",
      params: { requestId: "req_9" },
    });
  });

  it("awarded: DRIVER CONFIRMED only with the traveller's own award", async () => {
    installWire(
      serve(
        transfer({
          status: "awarded",
          driverSecured: true,
          statusLabel: "Driver secured",
          ride: {
            scheduledRequestId: "sr_1",
            requestId: "req_9",
            state: "published",
            requestState: "awarded",
          },
        }),
      ),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    expect(
      within(await screen.findByTestId(TID.status)).getByText(
        "Driver confirmed",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.driverSecured)).toBeTruthy();
    expect(screen.queryByTestId(TID.noDriver)).toBeNull();
    fireEvent.press(screen.getByTestId(dynamicTestId(TID.choice, "cancel")));
    expect(
      screen.getByText(/the ride’s own cancellation rules apply/),
    ).toBeTruthy();
  });

  it("action required: the server's labelled choices, each keyed", async () => {
    const wire = installWire(
      (c) =>
        c.method === "POST" && c.path === "/v1/reservations/atr_1/decision"
          ? {
              status: 200,
              json: transfer({
                status: "requested",
                statusLabel: "Requested — no driver secured yet",
                retimedCount: 1,
              }),
            }
          : serve(
              transfer({
                status: "awarded",
                driverSecured: true,
                statusLabel: "Driver secured",
                actionRequired: {
                  reason: "flight_changed_after_award",
                  message:
                    "Your flight now lands at 09:20. Your driver was secured for the old time.",
                  choices: [
                    { key: "keep", label: "Keep the current pickup" },
                    {
                      key: "rerequest",
                      label: "Cancel and re-request for the new time",
                    },
                    { key: "cancel", label: "Cancel the airport ride" },
                  ],
                },
              }),
            )(c),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    const action = await screen.findByTestId(TID.action);
    expect(within(action).getByText(/lands at 09:20/)).toBeTruthy();
    expect(within(action).getByText("Keep the current pickup")).toBeTruthy();
    expect(within(action).getByText("Cancel the airport ride")).toBeTruthy();
    fireEvent.press(
      within(action).getByTestId(dynamicTestId(TID.choice, "rerequest")),
    );
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [call] = wire.writes();
    expect(call.body).toEqual({ choice: "rerequest" });
    expect(call.headers["Idempotency-Key"]).toMatch(/^xfer_/);
    expect(
      within(await screen.findByTestId(TID.status)).getByText(
        "Sent to drivers · no driver yet",
      ),
    ).toBeTruthy();
  });

  it("failed: the honest outcome, no live actions", async () => {
    installWire(
      serve(
        transfer({
          status: "failed",
          statusLabel: "Not booked — no driver",
          outcome: {
            reason: "unfulfilled",
            message:
              "No driver offered on this ride in time. Nothing was charged for the ride; your flight is unaffected.",
          },
        }),
      ),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    expect(
      within(await screen.findByTestId(TID.status)).getByText(
        "Not booked · no driver",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId(TID.outcome)).getByText(
        /No driver offered on this ride in time\. Nothing was charged/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(dynamicTestId(TID.choice, "cancel")),
    ).toBeNull();
  });

  it("offline: an error with retry, never a guessed status", async () => {
    installWire(
      (c) => (c.path === "/v1/reservations/atr_1" ? "offline" : undefined),
      { reservations: true },
    );
    renderApp(<TransferStatusContainer />);
    expect(await screen.findByTestId(TID.offline)).toBeTruthy();
    expect(screen.getByTestId(TID.retry)).toBeTruthy();
    expect(screen.queryByTestId(TID.status)).toBeNull();
  });
});

describe("Linked orders — an airport transfer is its own item with its own word", () => {
  it("prints 'Sent to drivers · no driver yet' and opens the transfer", async () => {
    mockRouteParams = { tripId: "trip_1" };
    installWire(
      (c) =>
        c.path === "/v1/travel/trips/trip_1/linked"
          ? {
              status: 200,
              json: {
                id: "trip_1",
                title: "Abuja → Lagos",
                dates: "25 Sep",
                timezone: "Africa/Lagos",
                items: [
                  {
                    kind: "flight",
                    orderId: "ord_flt_1",
                    title: "Air Peace P47133",
                    status: "ticketed",
                    dateLabel: "Thu 25 Sep",
                    actions: [],
                  },
                  {
                    kind: "airport_transfer",
                    transferId: "atr_1",
                    orderId: "ord_flt_1",
                    driverSecured: false,
                    title: "Ride from LOS airport",
                    status: "requested",
                  },
                ],
              },
            }
          : undefined,
      { flights_booking: true },
    );
    renderApp(<LinkedOrdersScreen />);
    const item = await screen.findByTestId(
      dynamicTestId(TID.linkedItem, "atr_1"),
    );
    expect(
      within(item).getByText("Sent to drivers · no driver yet"),
    ).toBeTruthy();
    expect(
      within(item).getByText("No driver is secured for this ride yet."),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByLabelText(
        "Ride from LOS airport. Sent to drivers · no driver yet",
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith("Transfer", {
      transferId: "atr_1",
    });
  });
});

describe("Checkout — reads the cart the create/passengers answer returned", () => {
  it("renders a held cart without any cart GET", async () => {
    mockRouteParams = { cartId: "cart_1" };
    const wire = installWire(() => undefined, { flights_booking: true });
    const qc = newQueryClient();
    const cart: Cart = {
      id: "cart_1",
      status: "priced",
      items: [
        {
          kind: "flight",
          title: "Air Peace P47133",
          detail: "Thu 25 Sep · Economy",
          price: NGN(185_000_00),
          previousPrice: null,
          terms: ["Non-refundable fare"],
        },
      ],
      fees: [],
      adjustments: [],
      total: NGN(185_000_00),
      previousTotal: null,
    };
    qc.setQueryData(cartKey("cart_1"), cart);
    renderApp(<TravelCheckoutScreen />, qc);
    expect(await screen.findByText("Non-refundable fare")).toBeTruthy();
    expect(screen.getByText("UBI Wallet")).toBeTruthy();
    await flagsSettled(wire.calls);
    expect(wire.calls.some((c) => c.path.startsWith("/v1/travel/carts"))).toBe(
      false,
    );
  });

  it("says the cart isn't on this device instead of inventing one", async () => {
    mockRouteParams = { cartId: "cart_gone" };
    const wire = installWire(() => undefined, { flights_booking: true });
    renderApp(<TravelCheckoutScreen />);
    expect(
      await screen.findByTestId(TEST_IDS.travel.cart.missing),
    ).toBeTruthy();
    await flagsSettled(wire.calls);
    expect(wire.calls.some((c) => c.path.startsWith("/v1/travel/carts"))).toBe(
      false,
    );
  });
});
