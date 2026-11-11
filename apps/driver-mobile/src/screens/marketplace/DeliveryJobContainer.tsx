// Driver delivery custody container (CC-C04 / P1-07).
// Reads `GET /v1/delivery/deliveries/:id/custody`, gates active custody mutations
// behind `useMotionGate()` (parked_confirmed), runs the verified 3-step S3/MinIO
// proof upload pipeline (`POST .../proof-uploads` → `PUT` presigned URL →
// `POST .../{pickup-proof,delivery-proof,return/complete}`), and fetches short-lived
// proof download URLs on demand without caching.
import React, { useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import type { RootStackParamList } from "../../navigation/routes";
import {
  deliveryApi,
  describeDeliveryError,
  type CustodyProofType,
  type DeliveryReturnChargeStatus,
  type DriverCustodyTimeline,
  type ProofPhotoCandidate,
} from "../../api/delivery";
import { useMotionGate } from "../../lib/motion";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";
import { MP_DRIVER_TID } from "./testIds";
import { LoadFailure, LoadingBlocks, type TagTone } from "./TripParts";
import { isOffline } from "./tripCopy";
import {
  DeliveryJobScreen,
  UNREACHABLE_REASONS,
  type UnreachableReasonCode,
} from "./DeliveryJobScreen";

const STATE_LABELS: Record<string, { label: string; tone: TagTone }> = {
  courier_assigned: {
    label: "Courier assigned · head to pickup",
    tone: "info",
  },
  picked_up: { label: "Picked up", tone: "info" },
  in_transit: { label: "In transit · head to drop-off", tone: "info" },
  delivery_attempted: { label: "Delivery attempted", tone: "warn" },
  delivery_retry: { label: "Retrying delivery", tone: "info" },
  recipient_unreachable: { label: "Recipient unreachable", tone: "warn" },
  return_proposed: {
    label: "Return proposed · waiting on sender",
    tone: "warn",
  },
  return_consented: { label: "Return approved", tone: "info" },
  returning: { label: "Returning to sender", tone: "info" },
  return_to_sender: { label: "Returned to sender", tone: "ok" },
  held_at_point: { label: "Held at partner point", tone: "warn" },
  collected: { label: "Collected at partner point", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "error" },
};

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "delivered",
  "return_to_sender",
  "collected",
  "cancelled",
]);

export function driverOutcomeBanner(
  state: string,
  chargeStatus?: DeliveryReturnChargeStatus,
): { tone: "ok" | "info" | "warn"; title: string; body: string } | null {
  switch (state) {
    case "delivered":
      return {
        tone: "ok",
        title: "Delivery completed",
        body: "Delivery proof verified. You keep the full agreed fare — no second commission is taken at completion.",
      };
    case "return_to_sender":
      if (chargeStatus === "captured") {
        return {
          tone: "ok",
          title: "Returned to sender · return fee settled",
          body: "Your return hand-back proof is verified and the return fee has been captured from the sender’s wallet.",
        };
      }
      if (chargeStatus === "capture_pending") {
        return {
          tone: "warn",
          title: "Returned to sender · return fee settling",
          body: "Your return hand-back proof is verified. The reserved return fee is being settled with payment service.",
        };
      }
      if (chargeStatus === "released") {
        return {
          tone: "info",
          title: "Returned to sender · fee hold released",
          body: "Your return hand-back proof is verified. The return fee hold was released, so no return fee was charged.",
        };
      }
      return {
        tone: "ok",
        title: "Returned to sender",
        body: "Your return hand-back proof is verified. This return completed fee-free.",
      };
    case "collected":
      return {
        tone: "ok",
        title: "Handed off at partner pickup point",
        body: "Partner hold-point custody is recorded. No return fee was charged.",
      };
    case "cancelled":
      return {
        tone: "warn",
        title: "Delivery cancelled",
        body: "This delivery was cancelled before pickup.",
      };
    default:
      return null;
  }
}

export type ProofCaptureAdapter = (
  proofType: CustodyProofType,
) => Promise<ProofPhotoCandidate | null>;

// Minimal 1x1 PNG header bytes and deterministic SHA-256 for the default camera capture stub when native camera module is not attached.
const DEFAULT_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const DEFAULT_PNG_SHA256 =
  "66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18";

let activeCaptureAdapter: ProofCaptureAdapter = async (proofType) => ({
  contentType: "image/png",
  sizeBytes: DEFAULT_PNG_BYTES.byteLength,
  sha256: DEFAULT_PNG_SHA256,
  bytes: DEFAULT_PNG_BYTES,
  label: proofType + "-photo.png",
});

export function setProofCaptureAdapter(adapter: ProofCaptureAdapter): void {
  activeCaptureAdapter = adapter;
}

export function resetProofCaptureAdapter(): void {
  activeCaptureAdapter = async (proofType) => ({
    contentType: "image/png",
    sizeBytes: DEFAULT_PNG_BYTES.byteLength,
    sha256: DEFAULT_PNG_SHA256,
    bytes: DEFAULT_PNG_BYTES,
    label: proofType + "-photo.png",
  });
}

export function DeliveryJobContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "DeliveryJob">>();
  const deliveryId = params.deliveryId;
  const qc = useQueryClient();
  const gate = useMotionGate();

  const [capturedPhoto, setCapturedPhoto] =
    useState<ProofPhotoCandidate | null>(null);
  const [unreachableReason, setUnreachableReason] =
    useState<UnreachableReasonCode>("no_answer");
  const [proposeReason, setProposeReason] = useState("");
  const [proposeFeeDigits, setProposeFeeDigits] = useState("");
  const [actionError, setActionError] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [viewingProof, setViewingProof] = useState<{
    proofId: string;
    type: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const queryKey = ["mp", "driverDeliveryCustody", deliveryId];
  const q = useQuery({
    queryKey,
    queryFn: () => deliveryApi.custody(deliveryId),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      if (s && TERMINAL_STATES.has(s)) return false;
      return 5_000;
    },
    retry: false,
  });

  const handleActionFailure = (err: unknown) => {
    const desc = describeDeliveryError(err);
    setActionError({ title: desc.title, body: desc.body });
    if (desc.shouldRefetch) {
      void q.refetch();
    }
  };

  const refreshAfterMutation = async () => {
    setActionError(null);
    setCapturedPhoto(null);
    await qc.invalidateQueries({ queryKey });
    await q.refetch();
  };

  const submitProof = useMutation({
    mutationFn: async (proofType: CustodyProofType) => {
      if (!capturedPhoto) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Capture a photo before uploading the proof.",
        );
      }
      setBusyAction(proofType + "_proof");
      return deliveryApi.uploadAndAttachProof(
        deliveryId,
        proofType,
        capturedPhoto,
      );
    },
    onSuccess: async (res, proofType) => {
      setBusyAction(null);
      track("driver_mp_delivery_proof_attached", {
        deliveryId,
        proofType,
        custodyState: res.custodyState,
      });
      await refreshAfterMutation();
    },
    onError: (err) => {
      setBusyAction(null);
      handleActionFailure(err);
    },
  });

  const reportUnreachable = useMutation({
    mutationFn: async () => {
      setBusyAction("unreachable");
      const label =
        UNREACHABLE_REASONS.find((r) => r.code === unreachableReason)?.label ??
        unreachableReason;
      return deliveryApi.reportRecipientUnreachable(deliveryId, label);
    },
    onSuccess: async (res) => {
      setBusyAction(null);
      track("driver_mp_delivery_unreachable", {
        deliveryId,
        custodyState: res.custodyState,
      });
      await refreshAfterMutation();
    },
    onError: (err) => {
      setBusyAction(null);
      handleActionFailure(err);
    },
  });

  const proposeReturn = useMutation({
    mutationFn: async (timeline: DriverCustodyTimeline) => {
      setBusyAction("propose_return");
      const currency = timeline.delivery?.currency || "NGN";
      const feeMoney =
        timeline.returnPolicy.chargedReturnsOffered && proposeFeeDigits.trim()
          ? typedMajorToMoney(proposeFeeDigits, currency)
          : null;
      return deliveryApi.proposeReturn(deliveryId, {
        reason: proposeReason.trim(),
        feeMoney,
      });
    },
    onSuccess: async (res) => {
      setBusyAction(null);
      setProposeReason("");
      setProposeFeeDigits("");
      track("driver_mp_delivery_return_proposed", {
        deliveryId,
        returnId: res.returnId,
        chargeStatus: res.chargeStatus,
      });
      await refreshAfterMutation();
    },
    onError: (err) => {
      setBusyAction(null);
      handleActionFailure(err);
    },
  });

  const confirmCollected = useMutation({
    mutationFn: async () => {
      setBusyAction("collected");
      return deliveryApi.confirmCollected(deliveryId);
    },
    onSuccess: async (res) => {
      setBusyAction(null);
      track("driver_mp_delivery_collected", {
        deliveryId,
        custodyState: res.custodyState,
      });
      await refreshAfterMutation();
    },
    onError: (err) => {
      setBusyAction(null);
      handleActionFailure(err);
    },
  });

  const openProof = async (proofId: string) => {
    setBusyAction("proof:" + proofId);
    setActionError(null);
    try {
      const signed = await deliveryApi.proofDownloadUrl(deliveryId, proofId);
      setViewingProof({
        proofId: signed.proofId,
        type: signed.type,
        url: signed.url,
        expiresAt: signed.expiresAt,
      });
    } catch (err) {
      handleActionFailure(err);
    } finally {
      setBusyAction(null);
    }
  };

  const timeline = q.data;
  if (!timeline) {
    const notFound =
      q.error instanceof ApiError &&
      (q.error.code === "NOT_FOUND" || q.error.status === 404);
    return (
      <Screen title="Delivery custody" onBack={nav.goBack} bg="bg2">
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title={
              notFound
                ? "This delivery isn’t available"
                : "Couldn’t load delivery custody"
            }
            body={
              notFound
                ? "No marketplace delivery custody record was found for your account."
                : (q.error as Error).message
            }
            onRetry={() => void q.refetch()}
            testIDs={MP_DRIVER_TID.delivery}
          />
        ) : (
          <LoadingBlocks heights={[110, 160, 140]} />
        )}
      </Screen>
    );
  }

  const stateMeta = STATE_LABELS[timeline.state] ?? {
    label: timeline.state,
    tone: "neutral" as const,
  };
  const isTerminal = TERMINAL_STATES.has(timeline.state);
  const currentProofType: CustodyProofType =
    timeline.state === "courier_assigned"
      ? "pickup"
      : timeline.state === "returning"
        ? "return"
        : "delivery";

  const handleCapturePhoto = async () => {
    setActionError(null);
    try {
      const candidate = await activeCaptureAdapter(currentProofType);
      if (candidate) {
        setCapturedPhoto(candidate);
      }
    } catch (err) {
      handleActionFailure(err);
    }
  };

  const ladderSteps = timeline.events.map((ev, idx) => ({
    label: STATE_LABELS[ev.toState]?.label ?? ev.toState,
    detail: ev.reason || undefined,
    state:
      idx === timeline.events.length - 1 && !isTerminal
        ? ("active" as const)
        : ("done" as const),
  }));

  return (
    <DeliveryJobScreen
      deliveryId={timeline.deliveryId}
      state={timeline.state}
      stateLabel={stateMeta.label}
      stateTone={stateMeta.tone}
      isTerminal={isTerminal}
      delivery={timeline.delivery}
      openReturn={timeline.openReturn}
      returnPolicy={timeline.returnPolicy}
      ladderSteps={ladderSteps}
      proofs={timeline.proofs}
      motion={gate.motion}
      parked={{
        confirming: gate.confirming,
        error: gate.confirmError,
        onConfirm: () => {
          void gate.confirmParked();
        },
      }}
      capturedPhotoLabel={
        capturedPhoto
          ? (capturedPhoto.label ??
            capturedPhoto.contentType + " · " + capturedPhoto.sizeBytes + " B")
          : null
      }
      onCapturePhoto={() => {
        void handleCapturePhoto();
      }}
      onSubmitPickupProof={() => submitProof.mutate("pickup")}
      onSubmitDeliveryProof={() => submitProof.mutate("delivery")}
      onSubmitReturnProof={() => submitProof.mutate("return")}
      unreachableReason={unreachableReason}
      onSelectUnreachableReason={setUnreachableReason}
      onReportUnreachable={() => reportUnreachable.mutate()}
      proposeReason={proposeReason}
      onChangeProposeReason={setProposeReason}
      proposeFeeDigits={proposeFeeDigits}
      onChangeProposeFeeDigits={(v) => setProposeFeeDigits(typedDigits(v))}
      onProposeReturn={() => proposeReturn.mutate(timeline)}
      onConfirmCollected={() => confirmCollected.mutate()}
      onOpenProof={(proofId) => {
        void openProof(proofId);
      }}
      viewingProof={viewingProof}
      onDismissProof={() => setViewingProof(null)}
      busyAction={busyAction}
      actionError={actionError}
      outcomeBanner={driverOutcomeBanner(
        timeline.state,
        timeline.openReturn?.chargeStatus,
      )}
      onBack={nav.goBack}
    />
  );
}
