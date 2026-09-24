// Regression tests for the corrected marketplace wire contract (contracts/openapi/marketplace.yaml):
// 1. POST /select answers the WRAPPER { award, pickupPin? } — the container parses it, holds the
//    one-time pickupPin and hands off with the REAL executionRef {service,id} ride id.
// 2. The fare editor never seeds/renders 'NaN' from a malformed (non-Money) quote envelope —
//    it stays on the skeleton instead.
// 3. The dev fixture serves the exact select wrapper shape.
import type React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { BidDetailContainer } from "../src/screens/marketplace/BidDetailContainer";
import { FareEditorContainer } from "../src/screens/marketplace/FareEditorContainer";
import type * as marketplaceFixturesModule from "../src/dev/fixtures/marketplace";

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

// The fixtures barrel imports every domain fixture at load time (travel.ts calls NGN at module
// top level, which trips the barrel's circular import under Jest); serve just the two helpers.
jest.mock("../src/dev/fixtures/index", () => ({
  __esModule: true,
  ok: (json: unknown) => ({ status: 200, json }),
  NGN: (major: number) => ({
    amountMinor: Math.round(major * 100),
    currency: "NGN",
  }),
}));

jest.mock("../src/api/marketplace", () => ({
  __esModule: true,
  marketplaceApi: {
    quote: jest.fn(),
    publish: jest.fn(),
    request: jest.fn(),
    revise: jest.fn(),
    cancel: jest.fn(),
    select: jest.fn(),
    award: jest.fn(),
    queue: jest.fn(),
    deliveryReturnState: jest.fn(),
    deliveryReturnConsent: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- require() after jest.mock so the mocked module instance is what the test holds
const { marketplaceApi } = require("../src/api/marketplace") as {
  marketplaceApi: Record<string, jest.Mock>;
};

const NGN = (major: number) => ({ amountMinor: major * 100, currency: "NGN" });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const wrap = (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultMode="light">{el}</ThemeProvider>
    </QueryClientProvider>,
  );
};

const offerEmeka = () => ({
  bidId: "bid_emeka",
  bidVersion: 1,
  requestRevision: 1,
  amountMinor: NGN(2800),
  kind: "immediate",
  driver: {
    displayName: "Emeka Okafor",
    initials: "EO",
    rating: "4.9",
    completedTrips: 2413,
    vehicle: "Toyota Corolla · grey",
    plateMasked: "LAG · 423 ··",
  },
  pickupLabel: "Pickup in 4 min · 1.2 km away",
  pickupWindow: null,
  expiresAt: iso(90_000),
  withdrawn: false,
  whyRecommended: null,
  bookingFeeMinor: NGN(200),
  totalMinor: NGN(3000),
  deltaLabel: null,
});

const requestBody = () => ({
  requestId: "req_mp_1",
  state: "open",
  revision: 1,
  version: 1,
  service: "ride",
  vehicleClass: "standard",
  cityId: "LOS",
  currency: "NGN",
  requesterId: "u_rider_1",
  quoteId: "q_mp_1",
  requestedFareMinor: NGN(2800),
  suggestedFareMinor: NGN(2600),
  minimumFareMinor: NGN(2400),
  maximumFareMinor: NGN(3900),
  pickup: { label: "Lekki", lat: 6.4, lng: 3.4 },
  dropoff: { label: "VI", lat: 6.42, lng: 3.42 },
  delivery: null,
  searchEnvelope: { step: 0, radiusMeters: 3000, pickupEtaSec: 600 },
  policyVersion: 3,
  pricingVersion: "px_2026_09_1",
  expiresAt: iso(150_000),
  createdAt: new Date().toISOString(),
  closeReason: null,
});

const confirmedAward = () => ({
  awardId: "awd_mp_1",
  requestId: "req_mp_1",
  bidId: "bid_emeka",
  state: "confirmed",
  requestVersion: 1,
  bidVersion: 1,
  driverId: "u_drv_emeka",
  requesterId: "u_rider_1",
  fareMinor: NGN(2800),
  commissionMinor: NGN(280),
  slot: "current",
  executionRef: { service: "ride", id: "ride_mp_901" },
  createdAt: new Date().toISOString(),
  resolvedAt: new Date().toISOString(),
});

describe("BidDetailContainer — select wrapper { award, pickupPin? } and executionRef handoff", () => {
  it("parses the wrapped 202 body, holds the one-time PIN and navigates with the real executionRef ride id", async () => {
    mockRouteParams = { requestId: "req_mp_1", bidId: "bid_emeka" };
    marketplaceApi.request.mockResolvedValue({
      request: requestBody(),
      offers: [offerEmeka()],
      seq: 1,
    });
    // The saga confirmed synchronously: the WRAPPER carries the one-time pickupPin.
    marketplaceApi.select.mockResolvedValue({
      award: confirmedAward(),
      pickupPin: "4831",
    });
    // Replays (award GET) never carry the PIN, by design.
    marketplaceApi.award.mockResolvedValue(confirmedAward());

    const view = wrap(<BidDetailContainer />);
    const choose = await screen.findByTestId(TEST_IDS.mp.rider.bid.choose);
    fireEvent.press(choose);

    // requestId rides along so the A02 trip screens (keyed by the request) are reachable
    // from the ride — the ride view itself does not carry it.
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("Ride", {
        screen: "Assigned",
        params: {
          rideId: "ride_mp_901",
          pickupPin: "4831",
          requestId: "req_mp_1",
        },
      });
    });
    view.unmount();
  });

  it("never navigates on a placeholder ride id when executionRef is absent", async () => {
    mockRouteParams = { requestId: "req_mp_1", bidId: "bid_emeka" };
    marketplaceApi.request.mockResolvedValue({
      request: requestBody(),
      offers: [offerEmeka()],
      seq: 1,
    });
    marketplaceApi.select.mockResolvedValue({
      award: { ...confirmedAward(), executionRef: null },
    });
    marketplaceApi.award.mockResolvedValue({
      ...confirmedAward(),
      executionRef: null,
    });

    const view = wrap(<BidDetailContainer />);
    fireEvent.press(await screen.findByTestId(TEST_IDS.mp.rider.bid.choose));
    await waitFor(() => expect(marketplaceApi.select).toHaveBeenCalled());
    // Confirmed without an executionRef stays honestly on the pending phase (choose button
    // disabled/loading) instead of handing off with rideId '' (the old placeholder behavior).
    await waitFor(() => {
      const btn = screen.getByTestId(TEST_IDS.mp.rider.bid.choose);
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });
    expect(mockNavigate).not.toHaveBeenCalledWith("Ride", expect.anything());
    view.unmount();
  });
});

describe("FareEditorContainer — malformed quote money never renders NaN", () => {
  it("keeps the skeleton (no amount input, no NaN) when the envelope carries bare-integer money", async () => {
    mockRouteParams = {
      quoteParams: {
        service: "ride",
        vehicleClass: "standard",
        pickup: { label: "A", lat: 1, lng: 2 },
        dropoff: { label: "B", lat: 3, lng: 4 },
      },
    };
    // Bare integers (old broken server shape) instead of contract Money objects.
    marketplaceApi.quote.mockResolvedValue({
      quoteId: "q_bad",
      service: "ride",
      vehicleClass: "standard",
      cityId: "LOS",
      currency: "NGN",
      suggestedFareMinor: 260000,
      minimumFareMinor: 240000,
      maximumFareMinor: 390000,
      expiresAt: iso(120_000),
      pricingVersion: "px",
      policyVersion: 3,
      breakdown: [],
    });
    const view = wrap(<FareEditorContainer />);
    await waitFor(() => expect(marketplaceApi.quote).toHaveBeenCalled());
    // Old behavior: an amount input seeded with the string 'NaN'. New: skeleton, no input at all.
    await waitFor(() =>
      expect(
        screen.queryByTestId(TEST_IDS.mp.rider.fare.amountInput),
      ).toBeNull(),
    );
    expect(screen.queryByDisplayValue("NaN")).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
    view.unmount();
  });

  it("seeds the editor from a valid contract Money quote", async () => {
    mockRouteParams = {
      quoteParams: {
        service: "ride",
        vehicleClass: "standard",
        pickup: { label: "A", lat: 1, lng: 2 },
        dropoff: { label: "B", lat: 3, lng: 4 },
      },
    };
    marketplaceApi.quote.mockResolvedValue({
      quoteId: "q_ok",
      service: "ride",
      vehicleClass: "standard",
      cityId: "LOS",
      currency: "NGN",
      suggestedFareMinor: NGN(2600),
      minimumFareMinor: NGN(2400),
      maximumFareMinor: NGN(3900),
      expiresAt: iso(120_000),
      pricingVersion: "px",
      policyVersion: 3,
      breakdown: [{ label: "Base", amountMinor: NGN(700) }],
    });
    const view = wrap(<FareEditorContainer />);
    const input = await screen.findByTestId(TEST_IDS.mp.rider.fare.amountInput);
    expect(input.props.value).toBe("2600");
    view.unmount();
  });
});

describe("dev fixture — select 202 body is the contract wrapper", () => {
  it("wraps the award ({ award }) instead of serving it bare", async () => {
    (globalThis as { __ubiMpFix?: unknown }).__ubiMpFix = undefined; // fixtures keep state on globalThis; reset it
    const { marketplaceFixtures } = jest.requireActual(
      "../src/dev/fixtures/marketplace",
    ) as typeof marketplaceFixturesModule;
    const res = await marketplaceFixtures({
      method: "POST",
      path: "/v1/mp/requests/req_mp_1/select",
      body: { bidId: "bid_emeka", requestVersion: 1, bidVersion: 1 },
    });
    expect(res?.status).toBe(202);
    const json = (
      res as {
        json: { award?: { awardId: string; bidId: string }; bidId?: string };
      }
    ).json;
    expect(json.award?.awardId).toBe("awd_mp_1");
    expect(json.award?.bidId).toBe("bid_emeka");
    expect(json.bidId).toBeUndefined(); // the bare-award shape is gone
    (globalThis as { __ubiMpFix?: unknown }).__ubiMpFix = undefined;
  });
});
