// A03 advance-bid terms on the bid screen: before a driver bids on an advance-booking
// request, Requests.Detail shows the future pickup window and what the bid commits the
// wallet to — the server's MpAdvanceCommitment rendered verbatim (held from the cleared
// balance, captured once at the advance award, never charged again at activation, the
// hold expiry, the server's own terms). A calendar conflict is the server's eligibility
// reason, shown with no offer controls. Fixtures are parsed with the contract schemas.
import React from "react";
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
import {
  MpAdvanceCommitmentSchema,
  MpRequestBookingSchema,
  TEST_IDS,
  dynamicTestId,
} from "@ubi/contracts";
import { installWire, NGN, isoIn } from "../../../../jest/wire";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import { RequestDetailContainer } from "../RequestDetailContainer";
import { MP_DRIVER_TID } from "../testIds";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { requestId: "req_adv_1" } }),
}));

const VIEW_PATH = "/v1/mp/requests/req_adv_1/driver-view";
const windowStart = isoIn(26 * 3_600_000);
const windowEnd = isoIn(26 * 3_600_000 + 20 * 60_000);

const booking = MpRequestBookingSchema.parse({
  kind: "advance",
  schedule: {
    localDate: "2026-09-24",
    localTime: "07:30",
    timeZone: "Africa/Lagos",
    utcOffset: "+01:00",
    dstResolution: "exact",
    pickupAt: windowStart,
    windowStart,
    windowEnd,
    windowMinutes: 20,
    label: "Thu 24 Sep 2026, 07:30 (UTC+01:00)",
  },
  scheduledRequestId: null,
  driverSecured: false,
  notice:
    "A future booking: no driver is secured until the rider selects an offer.",
});
const commitment = MpAdvanceCommitmentSchema.parse({
  commissionMinor: NGN(280_00),
  heldFrom: "cleared_balance",
  capturedAt: "advance_award",
  chargedAgainAtActivation: false,
  holdExpiresAt: isoIn(2 * 3_600_000),
  pickupWindowStart: windowStart,
  pickupWindowEnd: windowEnd,
  terms: [
    "₦280 is held from your cleared balance while your offer stands.",
    "If the rider selects you, it is captured once and not charged again when the trip starts.",
  ],
});

const driverView = (eligibility: Record<string, unknown> = {}) => ({
  item: {
    requestId: "req_adv_1",
    revision: 1,
    service: "ride",
    title: "Lekki → Yaba",
    meta: "Ride · Economy · future pickup",
    askedMinor: NGN(2800_00),
    askedByLabel: "rider asks",
    capabilityBadge: null,
    expiresAt: isoIn(3_600_000),
    booking,
  },
  eligibility: {
    eligible: true,
    slot: "advance",
    reasons: [],
    policyVersion: 3,
    availabilityEpoch: 7,
    evaluatedAt: isoIn(0),
    ...eligibility,
  },
  presets: [
    {
      key: "p1",
      source: "requested",
      amountMinor: NGN(2800_00),
      commissionMinor: NGN(280_00),
      netMinor: NGN(2520_00),
      title: "Offer ₦2,800 · rider's price",
      feeNetLabel: "fee ₦280 · you keep ₦2,520",
      affordable: true,
      shortfallMinor: null,
      shortfallLabel: null,
      emphasized: true,
    },
  ],
  profileLine: null,
  ceilingNotice: null,
  myBid: null,
  advanceCommitment: commitment,
});

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
        <RequestDetailContainer />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe("Advance-bid terms on the bid screen (A03)", () => {
  beforeEach(() => {
    resetMotionForDev();
    act(() => setMotionForDev("parked_confirmed"));
  });

  it("explains the advance wallet commitment and the pickup window BEFORE the driver bids", async () => {
    const wire = installWire((call) => {
      if (call.method === "GET" && call.path === VIEW_PATH)
        return { status: 200, json: driverView() };
      if (call.path === "/v1/mp/bids")
        return {
          status: 201,
          json: {
            bidId: "bid_adv",
            requestId: "req_adv_1",
            requestRevision: 1,
            bidVersion: 1,
            state: "submitted",
            driverId: "u_drv",
            amountMinor: NGN(2800_00),
            commissionMinor: NGN(280_00),
            netMinor: NGN(2520_00),
            slot: "advance",
            reservationId: "rsv_adv",
            expiresAt: isoIn(3_600_000),
            createdAt: isoIn(0),
          },
        };
      return undefined;
    });
    const view = harness();
    const terms = await screen.findByTestId(MP_DRIVER_TID.detail.advanceTerms);
    expect(terms).toHaveTextContent(/Held from your cleared balance.*₦280/);
    expect(terms).toHaveTextContent(/once, only if the rider selects you/);
    expect(terms).toHaveTextContent(/not charged again/);
    expect(terms).toHaveTextContent(/expires in 2 h/);
    for (const term of commitment.terms)
      expect(terms).toHaveTextContent(term, { exact: false });
    const windowCard = screen.getByTestId(MP_DRIVER_TID.detail.bookingWindow);
    expect(windowCard).toHaveTextContent(/Thu 24 Sep 2026, 07:30/);
    expect(windowCard).toHaveTextContent(/no driver is secured/);
    // Nothing was sent just by reading the terms.
    expect(wire.writes()).toEqual([]);

    fireEvent.press(
      screen.getByTestId(dynamicTestId(TEST_IDS.mp.driver.detail.preset, 0)),
    );
    await waitFor(() => expect(wire.writes()).toHaveLength(1));
    const [bid] = wire.writes();
    expect(bid.path).toBe("/v1/mp/bids");
    expect(bid.body).toMatchObject({
      requestId: "req_adv_1",
      requestRevision: 1,
      slot: "advance",
      availabilityEpoch: 7,
      amountMinor: NGN(2800_00),
    });
    expect(bid.headers["Idempotency-Key"]).toBeTruthy();
    view.unmount();
  });

  it("a calendar conflict is the server's reason, with no offer controls", async () => {
    installWire((call) => {
      if (call.method === "GET" && call.path === VIEW_PATH)
        return {
          status: 200,
          json: driverView({
            eligible: false,
            slot: null,
            reasons: [
              {
                code: "CALENDAR_CONFLICT",
                title: "Clashes with a booking you already have",
                detail:
                  "This pickup window, plus the trip, overlaps your 07:00 booking.",
              },
            ],
          }),
        };
      return undefined;
    });
    const view = harness();
    expect(
      await screen.findByTestId(
        dynamicTestId(TEST_IDS.mp.driver.detail.reason, "CALENDAR_CONFLICT"),
      ),
    ).toHaveTextContent(/overlaps your 07:00 booking/);
    expect(
      screen.queryByTestId(dynamicTestId(TEST_IDS.mp.driver.detail.preset, 0)),
    ).toBeNull();
    // The commitment is still explained, so the driver knows what bidding would mean.
    expect(screen.getByTestId(MP_DRIVER_TID.detail.advanceTerms)).toBeTruthy();
    view.unmount();
  });
});
