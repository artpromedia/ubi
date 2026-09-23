// A05 fleet calendar — the rider's two moments on an advance booking, against the REAL
// client path (marketplaceApi → api() → fetch). D1 BookingChangeConsent: a vehicle change
// the driver accepted and UBI revalidated is shown before/after with the server's labels,
// same driver, fare unchanged; nothing is sent until the rider confirms (POST …/changes/
// :changeId/accept, Idempotency-Key, no body) and "Cancel for free" is the ordinary free
// cancellation. D2 BookingDriverLost: no reason is ever shown, "You won't be charged",
// a same-fare rematch ONLY when the server says rematchAvailable, and "cancel and
// release" (POST …/release).
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS } from "@ubi/contracts";
import { BookingDetailContainer } from "../src/screens/marketplace/BookingDetail";
import { installWire, isoIn, NGN } from "./helpers/wire";
import { clearClients, renderApp } from "./helpers/render";
import { booking, request } from "./helpers/mpFixtures";

const mockNavigate = jest.fn();
let mockRouteParams: unknown = {};
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: jest.fn(),
    goBack: jest.fn(),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const TID = TEST_IDS.rider.booking;
const MP = TEST_IDS.mp.rider.booking;
const PATH = "/v1/mp/advance-bookings/bkg_1";

const withChange = () =>
  booking({
    vehicle: { label: "Go · 4 seats", classes: ["go"], capacity: 4 },
    pendingChange: {
      changeId: "swp_1",
      kind: "vehicle_swap",
      sameDriver: true,
      from: { label: "Go · 4 seats", classes: ["go"], capacity: 4 },
      to: { label: "Comfort · 4 seats", classes: ["comfort"], capacity: 4 },
      fareMinor: NGN(5_600_00),
      fareUnchanged: true,
      expiresAt: isoIn(20 * 3_600_000),
      notice:
        "Different vehicle, same driver. Your fare is unchanged. Nothing changes unless you confirm, and cancelling is free.",
    },
  });

const lost = (
  over: { rematchAvailable: boolean; released?: boolean },
  reason = "risk_unresolved",
) =>
  booking({
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
      reason: reason as "risk_unresolved",
      message:
        "Your driver withdrew from this booking because the vehicle was reported off the road.",
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
      rematchAvailable: over.rematchAvailable,
      driverLost: true,
      released: over.released ?? false,
    },
  });

beforeEach(() => {
  mockNavigate.mockReset();
  mockRouteParams = { bookingId: "bkg_1" };
});
afterEach(clearClients);

describe("D1 BookingChangeConsent", () => {
  it("shows before/after, same driver, fare unchanged — and sends nothing until the rider confirms", async () => {
    const confirmed = booking({
      vehicle: {
        label: "Comfort · 4 seats",
        classes: ["comfort"],
        capacity: 4,
      },
    });
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === PATH)
          return { status: 200, json: withChange() };
        if (c.path === PATH + "/changes/swp_1/accept")
          return { status: 200, json: confirmed };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const card = await screen.findByTestId(TID.vehicleChange);
    expect(within(card).getByText("Your confirmation needed")).toBeTruthy();
    expect(
      within(card).getByText("Different vehicle, same driver"),
    ).toBeTruthy();
    expect(within(card).getByText("Go · 4 seats")).toBeTruthy();
    expect(within(card).getByText("Comfort · 4 seats")).toBeTruthy();
    expect(within(card).getByText(/₦5,600/)).toBeTruthy();
    expect(within(card).getByText(/unchanged/)).toBeTruthy();
    expect(
      within(card).getByText(
        "Nothing changes unless you confirm. Cancelling is free.",
      ),
    ).toBeTruthy();
    expect(wire.writes()).toHaveLength(0);

    fireEvent.press(screen.getByTestId(TID.vehicleChangeConfirm));
    expect(await screen.findByText("New vehicle confirmed")).toBeTruthy();
    const post = wire.writes()[0];
    expect(post.path).toBe(PATH + "/changes/swp_1/accept");
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^booking_/);
    await waitFor(() =>
      expect(screen.queryByTestId(TID.vehicleChange)).toBeNull(),
    );
  });

  it("cancel for free is the ordinary free cancellation, confirmed first", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === PATH)
          return { status: 200, json: withChange() };
        if (c.path === PATH + "/cancel")
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
    fireEvent.press(await screen.findByTestId(TID.vehicleChangeCancel));
    expect(wire.writes()).toHaveLength(0);
    fireEvent.press(await screen.findByTestId(MP.cancelConfirm));
    expect(await screen.findByText("Reservation cancelled")).toBeTruthy();
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(PATH + "/cancel");
    expect(writes[0].headers["Idempotency-Key"]).toMatch(/^booking_/);
  });

  it("no pending change, no consent card", async () => {
    installWire(
      (c) => (c.path === PATH ? { status: 200, json: booking() } : undefined),
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    await screen.findByTestId(MP.status);
    expect(screen.queryByTestId(TID.vehicleChange)).toBeNull();
  });
});

describe("D2 BookingDriverLost", () => {
  it("shows no reason, promises no charge, and rematches at the same fare when offered", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === PATH)
          return { status: 200, json: lost({ rematchAvailable: true }) };
        if (c.path === PATH + "/rematch")
          return { status: 201, json: request({ requestId: "req_adv_2" }) };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const card = await screen.findByTestId(TID.driverLost);
    expect(
      within(card).getByText("Your driver can’t make this trip"),
    ).toBeTruthy();
    expect(within(card).getByText("You won’t be charged.")).toBeTruthy();
    expect(
      within(card).getByText(
        "Find another driver: same fare, ₦5,600. You choose from the new offers.",
      ),
    ).toBeTruthy();
    // No reason, anywhere: the server's failure sentence is not rendered.
    expect(screen.queryByText(/off the road/)).toBeNull();
    expect(screen.queryByText(/withdrew/)).toBeNull();
    expect(screen.queryByTestId(MP.failure)).toBeNull();
    expect(screen.queryByTestId(MP.rematch)).toBeNull();

    fireEvent.press(screen.getByTestId(TID.rematchSameFare));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("AdvanceOffers", {
        requestId: "req_adv_2",
      }),
    );
    const post = wire.writes()[0];
    expect(post.path).toBe(PATH + "/rematch");
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^booking_/);
  });

  it("without a rematch from the server, only cancel and release", async () => {
    const wire = installWire(
      (c) => {
        if (c.method === "GET" && c.path === PATH)
          return { status: 200, json: lost({ rematchAvailable: false }) };
        if (c.path === PATH + "/release")
          return {
            status: 200,
            json: lost({ rematchAvailable: false, released: true }),
          };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    const card = await screen.findByTestId(TID.driverLost);
    expect(screen.queryByTestId(TID.rematchSameFare)).toBeNull();
    expect(within(card).queryByText(/Find another driver/)).toBeNull();
    const release = screen.getByTestId(TID.cancelRelease);
    expect(
      within(release).getByText("Cancel and release my ₦5,600"),
    ).toBeTruthy();

    fireEvent.press(release);
    expect(await screen.findByText("Booking released")).toBeTruthy();
    const post = wire.writes()[0];
    expect(post.path).toBe(PATH + "/release");
    expect(post.body).toBeUndefined();
    expect(post.headers["Idempotency-Key"]).toMatch(/^booking_/);
    await waitFor(() =>
      expect(screen.queryByTestId(TID.cancelRelease)).toBeNull(),
    );
    expect(
      screen.getByText("Your booking is released. Nothing was charged."),
    ).toBeTruthy();
  });

  it("a failure that is not the driver's (e.g. funding) keeps the explained failure card", async () => {
    installWire(
      (c) =>
        c.path === PATH
          ? {
              status: 200,
              json: booking({
                state: "failed",
                driverReserved: false,
                fullySecured: false,
                statusLabel: "Booking failed — no driver",
                failure: {
                  reason: "funding_not_secured",
                  message:
                    "We could not secure your payment for this booking in time, so it was released. Nothing was charged.",
                  financialOutcome: {
                    commissionReversed: true,
                    riderFundingReleased: false,
                    riderCharged: false,
                  },
                  rematchAvailable: false,
                  driverLost: false,
                },
              }),
            }
          : undefined,
      { marketplace_rides: true },
    );
    renderApp(<BookingDetailContainer />);
    expect(await screen.findByTestId(MP.failure)).toBeTruthy();
    expect(screen.queryByTestId(TID.driverLost)).toBeNull();
  });
});
