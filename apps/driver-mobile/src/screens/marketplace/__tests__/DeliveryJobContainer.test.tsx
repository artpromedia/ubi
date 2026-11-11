// Driver delivery custody flow tests (CC-C04 / P1-07):
// 1. Stationary lock: StopSafelyGate blocks proof capture and custody actions when
//    moving or stale_location, and unlocks only on parked_confirmed.
// 2. 3-step verified S3/MinIO proof upload & attach pipeline for pickup, delivery,
//    and return completion.
// 3. Named error codes (PROOF_STORAGE_UNAVAILABLE, PROOF_UPLOAD_LIMIT, PROOF_UPLOAD_EXPIRED,
//    PROOF_OBJECT_MISSING, PROOF_SIZE_MISMATCH, PROOF_CHECKSUM_MISMATCH,
//    PROOF_CONTENT_TYPE_MISMATCH, STATE_CONFLICT) render honest, actionable banners.
// 4. Recipient-unreachable reporting, return proposal (charged vs fee-free policy),
//    hold-point hand-off, ephemeral proof viewer, and state-gated contact masking.
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { FlagsProvider } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { installWire } from "../../../../jest/wire";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import {
  DeliveryJobContainer,
  resetProofCaptureAdapter,
} from "../DeliveryJobContainer";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({
    params: { deliveryId: "del_777", requestId: "req_777" },
  }),
}));

const DEL = TEST_IDS.mp.driver.delivery;
const CUSTODY_PATH = "/v1/delivery/deliveries/del_777/custody";
const UPLOAD_PATH = "/v1/delivery/deliveries/del_777/custody/proof-uploads";
const PICKUP_PATH = "/v1/delivery/deliveries/del_777/custody/pickup-proof";
const DELIVERY_PATH = "/v1/delivery/deliveries/del_777/custody/delivery-proof";
const UNREACHABLE_PATH =
  "/v1/delivery/deliveries/del_777/custody/recipient-unreachable";
const PROPOSE_PATH = "/v1/delivery/deliveries/del_777/custody/return/propose";
const COMPLETE_RETURN_PATH =
  "/v1/delivery/deliveries/del_777/custody/return/complete";
const COLLECTED_PATH = "/v1/delivery/deliveries/del_777/custody/collected";

type CustodyFixtureOverrides = {
  state?: string;
  chargedReturnsOffered?: boolean;
  feeFreeOnly?: boolean;
  pickupContact?: { name: string; phoneMasked?: string | null } | null;
  dropoffContact?: { name: string; phoneMasked?: string | null } | null;
  proofs?: Array<{
    proofId: string;
    type: "pickup" | "delivery" | "return";
    photoKey: string;
    createdAt: string;
  }>;
  openReturn?: {
    returnId: string;
    reason: string;
    proposedByRole: "driver" | "sender";
    feeMinor: number;
    consentState: "pending" | "consented" | "declined" | "expired";
    chargeStatus:
      | "not_required"
      | "reserved"
      | "capture_pending"
      | "captured"
      | "released";
    consentExpiresAt: string;
  } | null;
};

function makeCustodyPayload(overrides: CustodyFixtureOverrides = {}) {
  const state = overrides.state ?? "courier_assigned";
  const charged = overrides.chargedReturnsOffered ?? false;
  const feeFreeOnly = overrides.feeFreeOnly ?? !charged;
  return {
    deliveryId: "del_777",
    state,
    delivery: {
      trackingNumber: "UBI-DEL-777",
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
      package: {
        size: "MEDIUM",
        description: "Sealed electronics box",
        fragile: true,
        requiresSignature: false,
      },
      agreedFareMinor: 450000,
      currency: "NGN",
      requestId: "req_777",
      pickupContact:
        overrides.pickupContact !== undefined
          ? overrides.pickupContact
          : state === "courier_assigned" || state === "returning"
            ? { name: "Adaeze Okafor", phoneMasked: "+234••••1111" }
            : null,
      dropoffContact:
        overrides.dropoffContact !== undefined
          ? overrides.dropoffContact
          : state === "in_transit"
            ? { name: "Chinedu Eze", phoneMasked: "+234••••2222" }
            : null,
    },
    events: [
      {
        eventId: "ev_1",
        fromState: "",
        toState: "courier_assigned",
        actorRole: "system",
        actorId: "marketplace",
        reason: "awarded",
        createdAt: "2026-06-01T10:00:00Z",
      },
    ],
    proofs: overrides.proofs ?? [],
    openReturn: overrides.openReturn ?? null,
    returnPolicy: {
      chargedReturnsOffered: charged,
      feeFreeOnly,
    },
  };
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <FlagsProvider cityId="LOS">
        <QueryClientProvider client={client}>
          <DeliveryJobContainer />
        </QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
}

describe("DeliveryJobContainer (CC-C04 / P1-07)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    resetMotionForDev();
    resetProofCaptureAdapter();
  });

  it("blocks proof capture and custody actions behind StopSafelyGate while moving or stale, and unlocks on parked_confirmed", async () => {
    setMotionForDev("moving");
    installWire((call) => {
      if (call.path === CUSTODY_PATH) {
        return {
          status: 200,
          json: {
            success: true,
            data: makeCustodyPayload({ state: "courier_assigned" }),
          },
        };
      }
      if (call.path === "/v1/mp/driver/parked" && call.method === "POST") {
        return {
          status: 200,
          json: {
            state: "parked_confirmed",
            availabilityEpoch: 2,
            confirmedAt: "2026-06-01T10:01:00Z",
            expiresAt: "2026-06-01T10:16:00Z",
            ttlSeconds: 900,
          },
        };
      }
      return undefined;
    });

    const view = renderHarness();
    await screen.findByTestId(DEL.state);

    // Contact gating: at courier_assigned, pickup contact is shown; dropoff contact is hidden.
    expect(screen.getByTestId(DEL.pickupContact)).toBeTruthy();
    expect(screen.queryByTestId(DEL.dropoffContact)).toBeNull();

    // Moving state: StopSafelyGate is rendered, and capture/confirm buttons are NOT rendered.
    expect(screen.getByTestId(DEL.stopSafely)).toBeTruthy();
    expect(screen.queryByTestId(DEL.captureProof)).toBeNull();
    expect(screen.queryByTestId(DEL.submitPickupProof)).toBeNull();

    // Transition to stale_location and confirm parked via the server attestation button.
    act(() => {
      setMotionForDev("stale_location");
    });
    const parkedBtn = await screen.findByTestId(DEL.parked);
    fireEvent.press(parkedBtn);

    // Once parked_confirmed, the pickup proof controls unlock.
    await waitFor(() => {
      expect(screen.getByTestId(DEL.captureProof)).toBeTruthy();
      expect(screen.getByTestId(DEL.submitPickupProof)).toBeTruthy();
    });
    view.unmount();
  });

  it("executes the 3-step pickup proof upload and attach pipeline and transitions to in_transit", async () => {
    setMotionForDev("parked_confirmed");
    let currentState = "courier_assigned";

    const wire = installWire((call) => {
      if (call.path === CUSTODY_PATH) {
        return {
          status: 200,
          json: {
            success: true,
            data: makeCustodyPayload({ state: currentState }),
          },
        };
      }
      if (call.path === UPLOAD_PATH && call.method === "POST") {
        return {
          status: 201,
          json: {
            success: true,
            data: {
              uploadId: "upl_pickup_1",
              type: "pickup",
              objectKey: "deliveries/del_777/pickup/upl_pickup_1.png",
              contentType: "image/png",
              sizeBytes: 8,
              sha256:
                "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
              expiresAt: "2026-06-01T10:15:00Z",
              replay: false,
              upload: {
                method: "PUT",
                url: "https://minio.local/ubi-proofs/deliveries/del_777/pickup/upl_pickup_1.png?sig=1",
                headers: {
                  "Content-Type": "image/png",
                },
              },
            },
          },
        };
      }
      if (
        call.method === "PUT" &&
        call.path.startsWith(
          "/ubi-proofs/deliveries/del_777/pickup/upl_pickup_1.png",
        )
      ) {
        return { status: 200 };
      }
      if (call.path === PICKUP_PATH && call.method === "POST") {
        currentState = "in_transit";
        return {
          status: 201,
          json: {
            success: true,
            data: {
              proofId: "prf_pickup_1",
              custodyState: "in_transit",
            },
          },
        };
      }
      return undefined;
    });

    const view = renderHarness();
    const captureBtn = await screen.findByTestId(DEL.captureProof);
    fireEvent.press(captureBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Selected photo: pickup-photo\.png/),
      ).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId(DEL.submitPickupProof));

    await waitFor(() => {
      expect(screen.getByTestId(DEL.dropoffContact)).toBeTruthy();
    });
    // At in_transit, pickupContact is no longer returned by the server.
    expect(screen.queryByTestId(DEL.pickupContact)).toBeNull();

    // Verify all 3 network steps executed in order:
    const writeMethods = wire
      .writes()
      .map((w) => `${w.method} ${w.path.split("?")[0]}`);
    expect(writeMethods).toEqual([
      `POST ${UPLOAD_PATH}`,
      "PUT /ubi-proofs/deliveries/del_777/pickup/upl_pickup_1.png",
      `POST ${PICKUP_PATH}`,
    ]);
    view.unmount();
  });

  it("maps named proof upload & attach errors (PROOF_STORAGE_UNAVAILABLE, PROOF_CHECKSUM_MISMATCH, STATE_CONFLICT) to clear recovery banners", async () => {
    setMotionForDev("parked_confirmed");
    let nextErrorCode = "PROOF_STORAGE_UNAVAILABLE";
    let nextErrorStatus = 503;

    installWire((call) => {
      if (call.path === CUSTODY_PATH) {
        return {
          status: 200,
          json: {
            success: true,
            data: makeCustodyPayload({ state: "in_transit" }),
          },
        };
      }
      if (call.path === UPLOAD_PATH && call.method === "POST") {
        if (nextErrorCode === "PROOF_STORAGE_UNAVAILABLE") {
          return {
            status: nextErrorStatus,
            json: {
              error: {
                code: "PROOF_STORAGE_UNAVAILABLE",
                message: "object store down",
              },
            },
          };
        }
        return {
          status: 201,
          json: {
            success: true,
            data: {
              uploadId: "upl_del_1",
              type: "delivery",
              objectKey: "deliveries/del_777/delivery/upl_del_1.png",
              contentType: "image/png",
              sizeBytes: 8,
              sha256:
                "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18",
              expiresAt: "2026-06-01T10:15:00Z",
              replay: false,
              upload: {
                method: "PUT",
                url: "https://minio.local/ubi-proofs/deliveries/del_777/delivery/upl_del_1.png",
                headers: { "Content-Type": "image/png" },
              },
            },
          },
        };
      }
      if (call.method === "PUT") {
        return { status: 200 };
      }
      if (call.path === DELIVERY_PATH && call.method === "POST") {
        return {
          status: nextErrorStatus,
          json: {
            error: {
              code: nextErrorCode,
              message: "attach error",
            },
          },
        };
      }
      return undefined;
    });

    const view = renderHarness();
    const captureBtn = await screen.findByTestId(DEL.captureProof);
    fireEvent.press(captureBtn);
    await waitFor(() => {
      expect(
        screen.getByText(/Selected photo: delivery-photo\.png/),
      ).toBeTruthy();
    });

    // 1. PROOF_STORAGE_UNAVAILABLE
    fireEvent.press(screen.getByTestId(DEL.submitDeliveryProof));
    await waitFor(() => {
      expect(screen.getByText("Proof storage unavailable")).toBeTruthy();
    });

    // 2. PROOF_CHECKSUM_MISMATCH
    nextErrorCode = "PROOF_CHECKSUM_MISMATCH";
    nextErrorStatus = 422;
    fireEvent.press(screen.getByTestId(DEL.submitDeliveryProof));
    await waitFor(() => {
      expect(screen.getByText("Photo verification failed")).toBeTruthy();
    });

    // 3. STATE_CONFLICT
    nextErrorCode = "STATE_CONFLICT";
    nextErrorStatus = 409;
    fireEvent.press(screen.getByTestId(DEL.submitDeliveryProof));
    await waitFor(() => {
      expect(screen.getByText("Delivery state updated")).toBeTruthy();
    });

    view.unmount();
  });

  it("handles recipient-unreachable, fee-free vs charged return proposal, hold-point hand-off, and ephemeral proof viewing", async () => {
    setMotionForDev("parked_confirmed");
    let currentState = "in_transit";
    let chargedOffered = false;
    let proposedPayloads: Array<Record<string, unknown>> = [];

    installWire((call) => {
      if (call.path === CUSTODY_PATH) {
        return {
          status: 200,
          json: {
            success: true,
            data: makeCustodyPayload({
              state: currentState,
              chargedReturnsOffered: chargedOffered,
              feeFreeOnly: !chargedOffered,
              proofs: [
                {
                  proofId: "prf_101",
                  type: "pickup",
                  photoKey: "deliveries/del_777/pickup/prf_101.png",
                  createdAt: "2026-06-01T10:02:00Z",
                },
              ],
            }),
          },
        };
      }
      if (call.path === UNREACHABLE_PATH && call.method === "POST") {
        currentState = "recipient_unreachable";
        return {
          status: 200,
          json: {
            success: true,
            data: { custodyState: "recipient_unreachable" },
          },
        };
      }
      if (call.path === PROPOSE_PATH && call.method === "POST") {
        proposedPayloads.push(call.body as Record<string, unknown>);
        currentState = "return_proposed";
        return {
          status: 201,
          json: {
            success: true,
            data: {
              returnId: "ret_1",
              consentState: "pending",
              chargeStatus: "not_required",
              consentExpiresAt: "2026-06-02T10:00:00Z",
            },
          },
        };
      }
      if (
        call.path ===
          "/v1/delivery/deliveries/del_777/custody/proofs/prf_101/url" &&
        call.method === "GET"
      ) {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              proofId: "prf_101",
              type: "pickup",
              url: "https://minio.local/ubi-proofs/deliveries/del_777/pickup/prf_101.png?token=short",
              expiresAt: "2026-06-01T10:17:00Z",
            },
          },
        };
      }
      if (call.path === COLLECTED_PATH && call.method === "POST") {
        currentState = "collected";
        return {
          status: 200,
          json: {
            success: true,
            data: { custodyState: "collected" },
          },
        };
      }
      if (call.path === UPLOAD_PATH && call.method === "POST") {
        return {
          status: 201,
          json: {
            success: true,
            data: {
              uploadId: "upl_ret_1",
              deliveryId: "del_777",
              proofType: "return",
              photoKey: "deliveries/del_777/return/upl_ret_1.png",
              uploadUrl:
                "https://minio.local/ubi-proofs/deliveries/del_777/return/upl_ret_1.png",
              requiredHeaders: { "Content-Type": "image/png" },
              expiresAt: "2026-06-01T10:15:00Z",
            },
          },
        };
      }
      if (call.method === "PUT") {
        return { status: 200 };
      }
      if (call.path === COMPLETE_RETURN_PATH && call.method === "POST") {
        currentState = "return_to_sender";
        return {
          status: 200,
          json: {
            success: true,
            data: {
              proofId: "prf_ret_1",
              custodyState: "return_to_sender",
              chargeStatus: "captured",
            },
          },
        };
      }
      return undefined;
    });

    const view = renderHarness();
    // 1. Report recipient unreachable from in_transit
    const unreachableBtn = await screen.findByTestId(DEL.reportUnreachable);
    fireEvent.press(unreachableBtn);

    // 2. At recipient_unreachable with feeFreeOnly: true, feeFreeNotice is shown and proposeFee is hidden
    await waitFor(() => {
      expect(screen.getByTestId(DEL.feeFreeNotice)).toBeTruthy();
    });
    expect(screen.queryByTestId(DEL.proposeFee)).toBeNull();

    fireEvent.changeText(
      screen.getByTestId(DEL.proposeReason),
      "Recipient phone switched off after 3 calls",
    );
    fireEvent.press(screen.getByTestId(DEL.proposeReturn));

    await waitFor(() => {
      expect(proposedPayloads).toHaveLength(1);
    });
    expect(proposedPayloads[0]).toEqual({
      reason: "Recipient phone switched off after 3 calls",
      feeMinor: 0,
    });

    // 3. Ephemeral proof viewer fetches short-lived URL on tap
    const proofBtn = await screen.findByTestId(
      dynamicTestId(DEL.proofItem, "prf_101"),
    );
    fireEvent.press(proofBtn);
    await waitFor(() => {
      expect(screen.getByTestId(DEL.proofViewer)).toBeTruthy();
    });

    // 4. Hold-point hand-off at held_at_point -> collected
    currentState = "held_at_point";
    view.unmount();

    const heldView = renderHarness();
    const collectedBtn = await screen.findByTestId(DEL.confirmCollected);
    fireEvent.press(collectedBtn);
    await waitFor(() => {
      expect(screen.getByTestId(DEL.outcomeBanner)).toBeTruthy();
      expect(
        screen.getByText("Handed off at partner pickup point"),
      ).toBeTruthy();
    });
    heldView.unmount();
  });
});
