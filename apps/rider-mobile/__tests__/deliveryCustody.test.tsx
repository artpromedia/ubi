// Rider delivery custody timeline, post-award handoff, ephemeral proof viewer,
// sender-initiated return proposal, 402 wallet top-up gate, and final outcome copy (CC-C04 / P1-07).
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { FlagsProvider, installFixtures } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { BidDetailContainer } from "../src/screens/marketplace/BidDetailContainer";
import { OfferInboxContainer } from "../src/screens/marketplace/OfferInboxContainer";
import { DeliveryReturnContainer } from "../src/screens/marketplace/DeliveryReturnContainer";
import { riderDeliveryFinalOutcome } from "../src/api/marketplace";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const DEL = TEST_IDS.mp.rider.delivery;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const NGN = (major: number) => ({ amountMinor: major * 100, currency: "NGN" });

function renderWithFlags(
  el: React.ReactElement,
  cityId: string | undefined = "LOS",
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <ThemeProvider defaultMode="light">
      <FlagsProvider cityId={cityId}>
        <QueryClientProvider client={qc}>{el}</QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
}

describe("Rider delivery custody & post-award handoff (CC-C04 / P1-07)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockRouteParams = {};
  });

  afterEach(() => {
    installFixtures(async () => undefined);
  });

  it("hands off a confirmed current-slot delivery award from BidDetailContainer and OfferInboxContainer to DeliveryReturn", async () => {
    const deliveryAward = {
      awardId: "awd_del_1",
      requestId: "req_del_1",
      bidId: "bid_courier_1",
      state: "confirmed",
      requestVersion: 1,
      bidVersion: 1,
      driverId: "u_drv_1",
      requesterId: "u_rider_1",
      fareMinor: NGN(3200),
      commissionMinor: NGN(320),
      slot: "current",
      executionRef: { service: "delivery", id: "del_901" },
      createdAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    };

    const deliveryOffer = {
      bidId: "bid_courier_1",
      bidVersion: 1,
      requestRevision: 1,
      amountMinor: NGN(3200),
      kind: "immediate",
      driver: {
        displayName: "Tunde Bakare",
        initials: "TB",
        rating: "4.9",
        completedTrips: 840,
        vehicle: "Dispatch Bike · black",
        plateMasked: "•••89",
      },
      pickupLabel: "Pickup in 5 min · 1.1 km away",
      pickupWindow: null,
      expiresAt: iso(90_000),
      withdrawn: false,
      whyRecommended: null,
      bookingFeeMinor: NGN(100),
      totalMinor: NGN(3300),
      deltaLabel: null,
    };

    const deliveryRequest = {
      requestId: "req_del_1",
      state: "open",
      revision: 1,
      version: 1,
      service: "delivery",
      vehicleClass: "bike",
      cityId: "LOS",
      currency: "NGN",
      requesterId: "u_rider_1",
      quoteId: "q_del_1",
      requestedFareMinor: NGN(3200),
      suggestedFareMinor: NGN(3000),
      minimumFareMinor: NGN(2500),
      maximumFareMinor: NGN(4500),
      pickup: { label: "12 Marina Rd", lat: 6.45, lng: 3.39 },
      dropoff: { label: "44 Admiralty Way", lat: 6.44, lng: 3.47 },
      delivery: {
        packageSize: "SMALL",
        weightKg: 1.5,
        description: "Signed contract envelope",
      },
      searchEnvelope: { step: 0, radiusMeters: 3000, pickupEtaSec: 600 },
      policyVersion: 3,
      pricingVersion: "px_2026_09_1",
      expiresAt: iso(150_000),
      createdAt: new Date().toISOString(),
      closeReason: null,
    };

    let selected = false;
    installFixtures(async ({ method, path }) => {
      if (path.startsWith("/v1/config/flags")) {
        return {
          status: 200,
          json: {
            marketplace_rides: true,
            marketplace_delivery: true,
          },
        };
      }
      if (method === "GET" && path.startsWith("/v1/mp/requests/req_del_1")) {
        if (path.endsWith("/award")) {
          return { status: 200, json: deliveryAward };
        }
        return {
          status: 200,
          json: {
            request: deliveryRequest,
            offers: [deliveryOffer],
            ...(selected ? { award: deliveryAward } : {}),
            seq: selected ? 2 : 1,
          },
        };
      }
      if (method === "POST" && path === "/v1/mp/requests/req_del_1/select") {
        selected = true;
        return {
          status: 202,
          json: { award: deliveryAward },
        };
      }
      return undefined;
    });

    mockRouteParams = { requestId: "req_del_1", bidId: "bid_courier_1" };
    const bidView = renderWithFlags(<BidDetailContainer />);
    const chooseBtn = await screen.findByTestId(TEST_IDS.mp.rider.bid.choose);
    fireEvent.press(chooseBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("DeliveryReturn", {
        deliveryId: "del_901",
      });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith("Ride", expect.anything());
    bidView.unmount();

    // Also verify OfferInboxContainer converges on DeliveryReturn when award is confirmed on snapshot
    mockNavigate.mockReset();
    mockRouteParams = { requestId: "req_del_1" };
    const inboxView = renderWithFlags(<OfferInboxContainer />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("DeliveryReturn", {
        deliveryId: "del_901",
      });
    });
    inboxView.unmount();
  });

  it("renders package & route card, agreed fare, proof viewer, sender return proposal, and 402 wallet top-up gate", async () => {
    mockRouteParams = { deliveryId: "del_901" };
    let custodyState = "recipient_unreachable";
    let openReturn: Record<string, unknown> | null = null;
    let consentStatus = 402;
    const proposeBodies: unknown[] = [];

    installFixtures(async ({ method, path, body }) => {
      if (path.startsWith("/v1/config/flags")) {
        return {
          status: 200,
          json: {
            marketplace_delivery: true,
            provider_payments: true,
            wallet_p2p: true,
          },
        };
      }
      if (
        method === "GET" &&
        path === "/v1/delivery/deliveries/del_901/custody"
      ) {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              deliveryId: "del_901",
              state: custodyState,
              version: 2,
              delivery: {
                trackingNumber: "UBI-DEL-901",
                requestId: "req_del_1",
                pickupLocation: {
                  address: "12 Marina Rd, Lagos Island",
                  latitude: 6.45,
                  longitude: 3.39,
                },
                dropoffLocation: {
                  address: "44 Admiralty Way, Lekki Phase 1",
                  latitude: 6.44,
                  longitude: 3.47,
                },
                pickupContact: {
                  name: "Sender",
                  phone: "+234••••0001",
                },
                dropoffContact: {
                  name: "Adaeze",
                  phone: "+234••••0002",
                },
                package: {
                  size: "SMALL",
                  weightKg: 1.5,
                  description: "Signed contract envelope",
                  fragile: false,
                  requiresSignature: false,
                },
                agreedFareMinor: 320000,
                currency: "NGN",
              },
              openReturn,
              returnPolicy: {
                chargedReturnsOffered: true,
                feeFreeOnly: false,
              },
              proofs: [
                {
                  proofId: "prf_pickup_901",
                  type: "pickup",
                  contentType: "image/jpeg",
                  sizeBytes: 24500,
                  sha256:
                    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                  verified: true,
                  createdAt: iso(-600_000),
                },
              ],
              events: [
                {
                  toState: "picked_up",
                  actorType: "driver",
                  createdAt: iso(-600_000),
                },
                {
                  fromState: "in_transit",
                  toState: custodyState,
                  actorType: "driver",
                  reason: "No answer at door",
                  createdAt: iso(-120_000),
                },
              ],
            },
          },
        };
      }
      if (
        method === "GET" &&
        path ===
          "/v1/delivery/deliveries/del_901/custody/proofs/prf_pickup_901/url"
      ) {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              proofId: "prf_pickup_901",
              type: "pickup",
              contentType: "image/jpeg",
              url: "https://minio.local/ubi-proofs/del_901/prf_pickup_901.jpg?sig=ephemeral",
              expiresAt: iso(60_000),
            },
          },
        };
      }
      if (
        method === "POST" &&
        path === "/v1/delivery/deliveries/del_901/custody/return/propose"
      ) {
        proposeBodies.push(body);
        custodyState = "return_proposed";
        openReturn = {
          returnId: "ret_901",
          reason: "Return to sender office",
          proposedByRole: "sender",
          chargeStatus: "not_required",
          consentState: "pending",
          consentExpiresAt: "2026-06-02T12:00:00Z",
          feeMinor: 90000,
          currency: "NGN",
        };
        return {
          status: 201,
          json: {
            success: true,
            data: {
              returnId: "ret_901",
              deliveryId: "del_901",
              custodyState: "return_proposed",
              chargeStatus: "not_required",
              consentExpiresAt: "2026-06-02T12:00:00Z",
            },
          },
        };
      }
      if (
        method === "POST" &&
        path === "/v1/delivery/deliveries/del_901/custody/return/consent"
      ) {
        if (consentStatus === 402) {
          return {
            status: 402,
            json: {
              success: false,
              error: {
                code: "RETURN_FEE_INSUFFICIENT_FUNDS",
                message:
                  "Your wallet balance is lower than the return fee. Top up your wallet to approve this return.",
              },
            },
          };
        }
        custodyState = "return_consented";
        openReturn = {
          ...openReturn,
          chargeStatus: "reserved",
          consentState: "consented",
        };
        return {
          status: 200,
          json: {
            success: true,
            data: {
              deliveryId: "del_901",
              custodyState: "return_consented",
              consentState: "consented",
              chargeStatus: "reserved",
            },
          },
        };
      }
      return undefined;
    });

    const view = renderWithFlags(<DeliveryReturnContainer />);

    // 1. Package & route card and agreed fare
    expect(await screen.findByTestId(DEL.packageCard)).toBeTruthy();
    expect(screen.getByTestId(DEL.fare)).toBeTruthy();
    expect(screen.getByTestId(DEL.timeline)).toBeTruthy();

    // 2. Ephemeral proof viewer fetches short-lived URL on tap
    const proofBtn = screen.getByTestId(
      dynamicTestId(DEL.proofItem, "prf_pickup_901"),
    );
    fireEvent.press(proofBtn);
    await waitFor(() => {
      expect(screen.getByTestId(DEL.proofViewer)).toBeTruthy();
    });

    // 3. Sender-initiated return proposal at recipient_unreachable
    expect(screen.getByTestId(DEL.proposeReturn)).toBeTruthy();
    fireEvent.changeText(
      screen.getByTestId(DEL.proposeReason),
      "Return to sender office",
    );
    fireEvent.press(screen.getByTestId(DEL.proposeSubmit));
    await waitFor(() => {
      expect(proposeBodies).toEqual([
        { reason: "Return to sender office", feeMinor: 0 },
      ]);
    });

    // 4. Open return consent sheet -> 402 RETURN_FEE_INSUFFICIENT_FUNDS shows Top up wallet button
    fireEvent.press(screen.getByText("Resolve · recipient unreachable"));
    fireEvent.press(await screen.findByTestId(DEL.approveReturn));
    const topUpBtn = await screen.findByTestId(DEL.topUpWallet);
    expect(topUpBtn).toBeTruthy();

    // Pressing Top up wallet navigates to Main > Pay > TopUp
    fireEvent.press(topUpBtn);
    expect(mockNavigate).toHaveBeenCalledWith("Main", {
      screen: "Pay",
      params: { screen: "TopUp" },
    });

    // 5. Re-open consent sheet after funding -> 200 succeeds and transitions to return_approved
    consentStatus = 200;
    fireEvent.press(screen.getByText("Resolve · recipient unreachable"));
    fireEvent.press(await screen.findByTestId(DEL.approveReturn));
    await waitFor(() => {
      expect(
        screen.getByText(
          "The courier brings the package back to you. The return fee is reserved from your wallet and charged when the package is returned.",
        ),
      ).toBeTruthy();
    });

    view.unmount();
  });

  it("maps every final delivery outcome and chargeStatus honestly via riderDeliveryFinalOutcome", () => {
    expect(riderDeliveryFinalOutcome("delivered")).toEqual({
      tone: "ok",
      title: "Package delivered",
      body: "Delivery photo proof is verified. Your agreed fare is complete.",
    });
    expect(
      riderDeliveryFinalOutcome("return_to_sender", "captured", 90000),
    ).toEqual({
      tone: "ok",
      title: "Returned to you · return fee charged",
      body: "Your package was handed back with verified photo proof. The return fee was charged from your wallet.",
    });
    expect(
      riderDeliveryFinalOutcome("return_to_sender", "capture_pending", 90000),
    ).toEqual({
      tone: "warn",
      title: "Returned to you · return fee settling",
      body: "Your package was handed back with verified photo proof. Your reserved return fee is being settled.",
    });
    expect(
      riderDeliveryFinalOutcome("return_to_sender", "released", 90000),
    ).toEqual({
      tone: "info",
      title: "Returned to you · fee hold released",
      body: "Your package was handed back with verified photo proof. The return fee hold was released — no return fee was charged.",
    });
    expect(
      riderDeliveryFinalOutcome("return_to_sender", "not_required", 0),
    ).toEqual({
      tone: "ok",
      title: "Returned to you",
      body: "Your package was handed back with verified photo proof. No return fee was charged.",
    });
    expect(riderDeliveryFinalOutcome("held_at_point")).toEqual({
      tone: "info",
      title: "Held at partner pickup point",
      body: "The package waits at the pickup point. Collection details are in your messages.",
    });
    expect(riderDeliveryFinalOutcome("collected")).toEqual({
      tone: "ok",
      title: "Collected at partner pickup point",
      body: "The package has been handed over at the partner pickup point. No return fee was charged.",
    });
    expect(riderDeliveryFinalOutcome("cancelled")).toEqual({
      tone: "warn",
      title: "Delivery cancelled",
      body: "This delivery was cancelled before pickup.",
    });
  });
});
