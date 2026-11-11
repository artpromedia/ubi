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
import { installFixtures, ApiError } from "@ubi/mobile-core";
import { BidDetailContainer } from "../src/screens/marketplace/BidDetailContainer";
import { FareEditorContainer } from "../src/screens/marketplace/FareEditorContainer";
import { DeliveryReturnContainer } from "../src/screens/marketplace/DeliveryReturnContainer";
import type * as marketplaceApiModule from "../src/api/marketplace";
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

describe("CC-A08 — delivery custody {success, data, error} envelope + return consent re-read", () => {
  const realMp = jest.requireActual(
    "../src/api/marketplace",
  ) as typeof marketplaceApiModule;

  afterEach(() => {
    installFixtures(async () => undefined);
  });

  const wrappedTimeline = (
    over: Partial<marketplaceApiModule.CustodyTimeline> = {},
  ) => ({
    success: true,
    data: {
      deliveryId: "del_901",
      state: "return_proposed",
      version: 2,
      delivery: {
        trackingNumber: "UBI-DEL-901",
        pickupLocation: {
          address: "Lekki Phase 1",
          latitude: 6.44,
          longitude: 3.47,
        },
        dropoffLocation: {
          address: "Victoria Island",
          latitude: 6.42,
          longitude: 3.42,
        },
        pickupContact: { name: "Sender", phone: "+2348010000001" },
        dropoffContact: { name: "Adaeze", phone: "+2348010000002" },
        package: {
          size: "SMALL",
          weightKg: 1.5,
          description: "Documents",
          fragile: false,
          requiresSignature: false,
        },
        agreedFareMinor: 280000,
        currency: "NGN",
      },
      openReturn: {
        returnId: "ret_901",
        chargeStatus: "reserved" as const,
        consentState: "pending" as const,
        consentExpiresAt: iso(86_400_000),
        feeMinor: 90000,
        currency: "NGN",
      },
      returnPolicy: {
        chargedReturnsOffered: true,
        feeFreeOnly: false,
      },
      proofs: [
        {
          proofId: "prf_1",
          type: "pickup" as const,
          contentType: "image/jpeg",
          sizeBytes: 31200,
          sha256:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          verified: true,
          createdAt: iso(-600_000),
        },
      ],
      events: [
        {
          toState: "recipient_unreachable",
          actorType: "driver",
          reason: "Recipient did not answer",
          createdAt: iso(-300_000),
        },
        {
          fromState: "recipient_unreachable",
          toState: "return_proposed",
          actorType: "driver",
          reason: "Proposing return to sender",
          createdAt: iso(-120_000),
        },
      ],
      ...over,
    },
  });

  it("loads the wrapped timeline, consents, and re-reads the updated timeline with real money outcome", async () => {
    let consented = false;
    const calls: string[] = [];
    installFixtures(async ({ method, path }) => {
      calls.push(method + " " + path);
      if (
        method === "GET" &&
        path === "/v1/delivery/deliveries/del_901/custody"
      ) {
        return {
          status: 200,
          json: consented
            ? wrappedTimeline({
                state: "return_consented",
                version: 3,
                openReturn: {
                  returnId: "ret_901",
                  chargeStatus: "reserved",
                  consentState: "consented",
                  consentExpiresAt: iso(86_400_000),
                  feeMinor: 90000,
                  currency: "NGN",
                },
                events: [
                  {
                    toState: "recipient_unreachable",
                    actorType: "driver",
                    reason: "Recipient did not answer",
                    createdAt: iso(-300_000),
                  },
                  {
                    fromState: "return_proposed",
                    toState: "return_consented",
                    actorType: "sender",
                    createdAt: new Date().toISOString(),
                  },
                ],
              })
            : wrappedTimeline(),
        };
      }
      if (
        method === "POST" &&
        path === "/v1/delivery/deliveries/del_901/custody/return/consent"
      ) {
        consented = true;
        return {
          status: 200,
          json: {
            success: true,
            data: {
              deliveryId: "del_901",
              custodyState: "return_consented",
              consentState: "consented",
              chargeStatus: "reserved",
              chargeRef: "hold_ret_901",
            },
          },
        };
      }
      return undefined;
    });

    const initial = await realMp.marketplaceApi.deliveryReturnState("del_901");
    expect(initial.state).toBe("unreachable");
    expect(initial.returnFeeMinor).toEqual({
      amountMinor: 90000,
      currency: "NGN",
    });
    expect(initial.delivery?.trackingNumber).toBe("UBI-DEL-901");
    expect(initial.returnPolicy).toEqual({
      chargedReturnsOffered: true,
      feeFreeOnly: false,
    });
    expect(initial.proofs).toHaveLength(1);

    const afterConsent = await realMp.marketplaceApi.deliveryReturnConsent(
      "del_901",
      "approve_return",
    );
    expect(afterConsent.state).toBe("return_approved");
    expect(afterConsent.approvedNotice).toBe(
      "The courier brings the package back to you. The return fee is reserved from your wallet and charged when the package is returned.",
    );
    expect(calls).toEqual([
      "GET /v1/delivery/deliveries/del_901/custody",
      "POST /v1/delivery/deliveries/del_901/custody/return/consent",
      "GET /v1/delivery/deliveries/del_901/custody",
    ]);
  });

  it("surfaces 409 RETURN_CHARGE_UNSUPPORTED server message from the error envelope", async () => {
    installFixtures(async ({ method, path }) => {
      if (
        method === "POST" &&
        path === "/v1/delivery/deliveries/del_901/custody/return/consent"
      ) {
        return {
          status: 409,
          json: {
            success: false,
            error: {
              code: "RETURN_CHARGE_UNSUPPORTED",
              message:
                "This return proposes a fee delivery-service cannot yet authorize. Reject it to hold the package at a pickup point instead.",
            },
          },
        };
      }
      return undefined;
    });

    await expect(
      realMp.marketplaceApi.deliveryReturnConsent("del_901", "approve_return"),
    ).rejects.toMatchObject({
      status: 409,
      code: "RETURN_CHARGE_UNSUPPORTED",
      message:
        "This return proposes a fee delivery-service cannot yet authorize. Reject it to hold the package at a pickup point instead.",
    });
  });

  it("negative control: rejects an old unwrapped fixture that lacks {success:true, data}", async () => {
    installFixtures(async () => ({
      status: 200,
      json: {
        // Old unwrapped fixture shape without {success: true, data: ...}
        deliveryId: "del_old",
        state: "recipient_unreachable",
        version: 1,
        openReturn: null,
        events: [],
      },
    }));

    await expect(
      realMp.marketplaceApi.deliveryReturnState("del_old"),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      realMp.marketplaceApi.deliveryReturnState("del_old"),
    ).rejects.toMatchObject({
      code: "invalid_delivery_envelope",
    });
  });

  it("DeliveryReturnContainer renders honest fee-free notice and omits removed Try recipient again button", async () => {
    mockRouteParams = { deliveryId: "del_901" };
    marketplaceApi.deliveryReturnState.mockResolvedValue({
      state: "unreachable",
      situation:
        "We could not reach the recipient. Choose how to resolve this delivery.",
      approvedNotice:
        "The courier brings the package back to you. No return fee was charged.",
      returnFeeMinor: { amountMinor: 0, currency: "NGN" },
      custody: [{ label: "Recipient unreachable", state: "active" }],
    });
    marketplaceApi.deliveryReturnConsent.mockResolvedValue({
      state: "return_approved",
      situation:
        "We could not reach the recipient. Choose how to resolve this delivery.",
      approvedNotice:
        "The courier brings the package back to you. No return fee was charged.",
      returnFeeMinor: { amountMinor: 0, currency: "NGN" },
      custody: [
        { label: "Recipient unreachable", state: "done" },
        { label: "Return approved", state: "active" },
      ],
    });

    const view = wrap(<DeliveryReturnContainer />);
    const resolveBtn = await screen.findByText(
      "Resolve · recipient unreachable",
    );
    fireEvent.press(resolveBtn);

    // "Try recipient again" is removed because only the driver's delivery proof retries delivery.
    expect(screen.queryByText("Try recipient again")).toBeNull();

    fireEvent.press(
      screen.getByTestId(TEST_IDS.mp.rider.delivery.approveReturn),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "The courier brings the package back to you. No return fee was charged.",
        ),
      ).toBeTruthy(),
    );
    view.unmount();
  });
});
