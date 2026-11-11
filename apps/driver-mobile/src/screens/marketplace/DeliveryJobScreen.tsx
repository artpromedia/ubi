// Driver delivery custody & verified proof capture screen (CC-C04 / P1-07).
// All money values arrive as server Money objects and render exclusively via MoneyText.
// Custody transitions and photo capture require the server-acknowledged parked state
// (StopSafelyGate) so the driver never operates custody controls while moving.
import React from "react";
import { TextInput, View, type KeyboardTypeOptions } from "react-native";
import {
  Banner,
  Button,
  Card,
  Chip,
  Ladder,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import type { MotionState } from "../../lib/motion";
import type {
  CustodyContactView,
  CustodyProofView,
  DeliveryReturnChargeStatus,
} from "../../api/delivery";
import { MP_DRIVER_TID } from "./testIds";
import { StateTag, StopSafelyGate, type TagTone } from "./TripParts";

const TID = MP_DRIVER_TID.delivery;

function Input({
  testID,
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
}: {
  testID: string;
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
}) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 10 }}>
      <Text variant="caption" tone="text2" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      <TextInput
        testID={testID}
        placeholder={placeholder}
        placeholderTextColor={t.colors.text3}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={{
          backgroundColor: t.colors.bg,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: t.radius.card,
          color: t.colors.text,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
        }}
      />
    </View>
  );
}

export const UNREACHABLE_REASONS = [
  { code: "no_answer", label: "No answer at door or phone" },
  { code: "wrong_address", label: "Wrong or incomplete address" },
  { code: "refused", label: "Refused by recipient" },
  { code: "access_blocked", label: "Gate or building locked" },
] as const;

export type UnreachableReasonCode =
  (typeof UNREACHABLE_REASONS)[number]["code"];

export type DeliveryJobScreenProps = {
  deliveryId: string;
  state: string;
  stateLabel: string;
  stateTone: TagTone;
  isTerminal: boolean;
  delivery: {
    trackingNumber: string;
    pickupAddress: string;
    dropoffAddress: string;
    pickupContact: CustodyContactView | null;
    dropoffContact: CustodyContactView | null;
    package: {
      size: string;
      weightKg: number;
      description: string;
      fragile: boolean;
      requiresSignature: boolean;
    };
    agreedFare: Money;
    currency: string;
  } | null;
  openReturn: {
    returnId: string;
    reason: string;
    proposedByRole: string;
    chargeStatus: DeliveryReturnChargeStatus;
    consentState: "pending" | "consented" | "rejected" | "expired";
    consentExpiresAt: string;
    hasFee: boolean;
    fee: Money;
  } | null;
  returnPolicy: {
    chargedReturnsOffered: boolean;
    feeFreeOnly: boolean;
  };
  ladderSteps: {
    label: string;
    detail?: string;
    state: "done" | "active" | "pending" | "skipped";
  }[];
  proofs: CustodyProofView[];
  motion: MotionState;
  parked: {
    confirming: boolean;
    error: string | null;
    onConfirm: () => void;
  };
  capturedPhotoLabel: string | null;
  onCapturePhoto: () => void;
  onSubmitPickupProof: () => void;
  onSubmitDeliveryProof: () => void;
  onSubmitReturnProof: () => void;
  unreachableReason: UnreachableReasonCode;
  onSelectUnreachableReason: (r: UnreachableReasonCode) => void;
  onReportUnreachable: () => void;
  proposeReason: string;
  onChangeProposeReason: (v: string) => void;
  proposeFeeDigits: string;
  onChangeProposeFeeDigits: (v: string) => void;
  onProposeReturn: () => void;
  onConfirmCollected: () => void;
  onOpenProof: (proofId: string) => void;
  viewingProof: {
    proofId: string;
    type: string;
    url: string;
    expiresAt: string;
  } | null;
  onDismissProof: () => void;
  busyAction: string | null;
  actionError: { title: string; body: string } | null;
  outcomeBanner: {
    tone: "ok" | "info" | "warn";
    title: string;
    body: string;
  } | null;
  onBack: () => void;
};

export function DeliveryJobScreen(p: DeliveryJobScreenProps) {
  const parkedConfirmed = p.motion === "parked_confirmed";

  return (
    <Screen
      title="Delivery custody"
      subtitle={
        p.delivery?.trackingNumber
          ? "Tracking " + p.delivery.trackingNumber
          : "Every hand-off is verified"
      }
      onBack={p.onBack}
      bg="bg2"
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        {p.outcomeBanner ? (
          <Banner
            testID={TID.outcomeBanner}
            tone={p.outcomeBanner.tone}
            title={p.outcomeBanner.title}
            body={p.outcomeBanner.body}
          />
        ) : null}

        {p.actionError ? (
          <Banner
            testID={TID.actionError}
            tone="error"
            title={p.actionError.title}
            body={p.actionError.body}
          />
        ) : null}

        <Card emphasis>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <StateTag
              testID={TID.state}
              label={p.stateLabel}
              tone={p.stateTone}
            />
            {p.delivery?.trackingNumber ? (
              <Text variant="mono" tone="text2">
                {p.delivery.trackingNumber}
              </Text>
            ) : null}
          </View>
          {p.delivery ? (
            <Row
              testID={TID.fare}
              label="Agreed delivery fare"
              value={
                <MoneyText money={p.delivery.agreedFare} variant="heading" />
              }
              last
            />
          ) : null}
        </Card>

        {p.delivery ? (
          <Card testID={TID.packageCard}>
            <Text variant="bodyStrong">Route & package</Text>
            <Row label="Pickup" value={p.delivery.pickupAddress} />
            <Row label="Drop-off" value={p.delivery.dropoffAddress} />
            <Row
              label="Package"
              value={
                p.delivery.package.description +
                " · " +
                p.delivery.package.size +
                " · " +
                p.delivery.package.weightKg +
                " kg"
              }
            />
            <Row
              label="Handling"
              value={[
                p.delivery.package.fragile ? "Fragile" : "Standard",
                p.delivery.package.requiresSignature
                  ? "Photo proof required"
                  : "Verified custody",
              ].join(" · ")}
              last={!p.delivery.pickupContact && !p.delivery.dropoffContact}
            />
            {p.delivery.pickupContact ? (
              <Row
                testID={TID.pickupContact}
                label="Pickup contact (sender)"
                value={
                  [
                    p.delivery.pickupContact.name,
                    p.delivery.pickupContact.phone,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sender"
                }
                last={!p.delivery.dropoffContact}
              />
            ) : null}
            {p.delivery.dropoffContact ? (
              <Row
                testID={TID.dropoffContact}
                label="Drop-off contact (recipient)"
                value={
                  [
                    p.delivery.dropoffContact.name,
                    p.delivery.dropoffContact.phone,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Recipient"
                }
                last
              />
            ) : null}
          </Card>
        ) : null}

        {p.openReturn ? (
          <Card>
            <Text variant="bodyStrong">Return proposal</Text>
            <Row
              label="Reason"
              value={p.openReturn.reason || "Recipient unreachable"}
            />
            <Row
              label="Return fee"
              value={
                p.openReturn.hasFee ? (
                  <MoneyText money={p.openReturn.fee} variant="bodySmStrong" />
                ) : (
                  "Fee-free return"
                )
              }
            />
            <Row label="Fee status" value={p.openReturn.chargeStatus} last />
          </Card>
        ) : null}

        {!p.isTerminal ? (
          <StopSafelyGate
            motion={p.motion}
            title="Stop safely before updating parcel custody"
            body="Photo proof capture and custody transitions are locked while you are driving."
            confirming={p.parked.confirming}
            error={p.parked.error}
            onConfirm={p.parked.onConfirm}
            testID={TID.stopSafely}
            parkedTestID={TID.parked}
          />
        ) : null}

        {!p.isTerminal && parkedConfirmed ? (
          <>
            {p.state === "courier_assigned" ? (
              <Card>
                <Text variant="bodyStrong">1. Verify pickup with a photo</Text>
                <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                  Take a clear photo of the parcel at pickup. The server
                  verifies the image bytes before moving custody to in transit.
                </Text>
                {p.capturedPhotoLabel ? (
                  <Text variant="caption" tone="ok" style={{ marginTop: 6 }}>
                    {"Selected photo: " + p.capturedPhotoLabel}
                  </Text>
                ) : null}
                <View style={{ gap: 8, marginTop: 10 }}>
                  <Button
                    testID={TID.captureProof}
                    label={
                      p.capturedPhotoLabel
                        ? "Retake pickup photo"
                        : "Capture pickup photo"
                    }
                    kind="secondary"
                    onPress={p.onCapturePhoto}
                  />
                  <Button
                    testID={TID.submitPickupProof}
                    label="Upload & confirm pickup"
                    loading={p.busyAction === "pickup_proof"}
                    disabled={!p.capturedPhotoLabel}
                    onPress={p.onSubmitPickupProof}
                  />
                </View>
              </Card>
            ) : null}

            {p.state === "in_transit" ||
            p.state === "delivery_attempted" ||
            p.state === "delivery_retry" ? (
              <>
                <Card>
                  <Text variant="bodyStrong">
                    Complete delivery with photo proof
                  </Text>
                  <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                    Capture the parcel hand-off at the drop-off address to
                    complete delivery.
                  </Text>
                  {p.capturedPhotoLabel ? (
                    <Text variant="caption" tone="ok" style={{ marginTop: 6 }}>
                      {"Selected photo: " + p.capturedPhotoLabel}
                    </Text>
                  ) : null}
                  <View style={{ gap: 8, marginTop: 10 }}>
                    <Button
                      testID={TID.captureProof}
                      label={
                        p.capturedPhotoLabel
                          ? "Retake delivery photo"
                          : "Capture delivery photo"
                      }
                      kind="secondary"
                      onPress={p.onCapturePhoto}
                    />
                    <Button
                      testID={TID.submitDeliveryProof}
                      label="Upload & complete delivery"
                      loading={p.busyAction === "delivery_proof"}
                      disabled={!p.capturedPhotoLabel}
                      onPress={p.onSubmitDeliveryProof}
                    />
                  </View>
                </Card>

                <Card>
                  <Text variant="bodyStrong">Can’t reach the recipient?</Text>
                  <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                    Reporting the recipient unreachable starts the return or
                    hold-point resolution flow. Never mark a parcel delivered
                    without handing it over.
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    {UNREACHABLE_REASONS.map((r) => (
                      <Chip
                        key={r.code}
                        testID={dynamicTestId(TID.unreachableReason, r.code)}
                        label={r.label}
                        selected={p.unreachableReason === r.code}
                        onPress={() => p.onSelectUnreachableReason(r.code)}
                      />
                    ))}
                  </View>
                  <Button
                    testID={TID.reportUnreachable}
                    label="Report recipient unreachable"
                    kind="danger"
                    loading={p.busyAction === "unreachable"}
                    onPress={p.onReportUnreachable}
                    style={{ marginTop: 10 }}
                  />
                </Card>
              </>
            ) : null}

            {p.state === "recipient_unreachable" ? (
              <>
                <Card>
                  <Text variant="bodyStrong">
                    Option 1 · Retry delivery now
                  </Text>
                  <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                    If the recipient answered, capture the delivery photo to
                    finish normally.
                  </Text>
                  <View style={{ gap: 8, marginTop: 10 }}>
                    <Button
                      testID={TID.captureProof}
                      label={
                        p.capturedPhotoLabel
                          ? "Retake delivery photo"
                          : "Capture delivery photo"
                      }
                      kind="secondary"
                      onPress={p.onCapturePhoto}
                    />
                    <Button
                      testID={TID.submitDeliveryProof}
                      label="Upload & complete delivery"
                      loading={p.busyAction === "delivery_proof"}
                      disabled={!p.capturedPhotoLabel}
                      onPress={p.onSubmitDeliveryProof}
                    />
                  </View>
                </Card>

                <Card>
                  <Text variant="bodyStrong">
                    Option 2 · Propose return to sender
                  </Text>
                  <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                    The sender has 24 hours to approve the return before the
                    parcel defaults to a partner hold point.
                  </Text>
                  <Input
                    testID={TID.proposeReason}
                    label="Reason for return"
                    placeholder="e.g. Recipient did not answer after 3 calls"
                    value={p.proposeReason}
                    onChangeText={p.onChangeProposeReason}
                  />
                  {p.returnPolicy.chargedReturnsOffered ? (
                    <Input
                      testID={TID.proposeFee}
                      label={
                        "Return fee (" +
                        (p.delivery?.currency || "NGN") +
                        ", optional)"
                      }
                      placeholder="0"
                      keyboardType="numeric"
                      value={p.proposeFeeDigits}
                      onChangeText={p.onChangeProposeFeeDigits}
                    />
                  ) : (
                    <Banner
                      testID={TID.feeFreeNotice}
                      tone="info"
                      title="Fee-free returns only in this market"
                      body="Charged returns aren’t enabled here yet. Proposing a return is fee-free, or you can hand the parcel off at a partner hold point below."
                    />
                  )}
                  <Button
                    testID={TID.proposeReturn}
                    label="Propose return to sender"
                    loading={p.busyAction === "propose_return"}
                    disabled={!p.proposeReason.trim()}
                    onPress={p.onProposeReturn}
                    style={{ marginTop: 10 }}
                  />
                </Card>

                <Card>
                  <Text variant="bodyStrong">
                    Option 3 · Partner hold point
                  </Text>
                  <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                    Leave the parcel at a partner pickup point so the sender or
                    recipient can collect it.
                  </Text>
                  <Button
                    testID={TID.confirmCollected}
                    label="Hand off at partner hold point"
                    kind="secondary"
                    loading={p.busyAction === "collected"}
                    onPress={p.onConfirmCollected}
                    style={{ marginTop: 10 }}
                  />
                </Card>
              </>
            ) : null}

            {p.state === "return_proposed" ? (
              <Card>
                <Text variant="bodyStrong">Waiting on sender consent</Text>
                <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                  The sender has until{" "}
                  {p.openReturn?.consentExpiresAt || "the 24-hour deadline"} to
                  approve the return. If you are diverting to a partner pickup
                  point instead, confirm the hand-off below.
                </Text>
                <Button
                  testID={TID.confirmCollected}
                  label="Hand off at partner hold point"
                  kind="secondary"
                  loading={p.busyAction === "collected"}
                  onPress={p.onConfirmCollected}
                  style={{ marginTop: 10 }}
                />
              </Card>
            ) : null}

            {p.state === "returning" ? (
              <Card>
                <Text variant="bodyStrong">
                  Hand parcel back to sender with photo proof
                </Text>
                <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                  {p.openReturn?.chargeStatus === "reserved"
                    ? "The sender’s return fee is reserved in their wallet and will be captured as soon as this return photo is verified."
                    : "Capture a clear photo handing the parcel back to the sender to complete the return."}
                </Text>
                {p.capturedPhotoLabel ? (
                  <Text variant="caption" tone="ok" style={{ marginTop: 6 }}>
                    {"Selected photo: " + p.capturedPhotoLabel}
                  </Text>
                ) : null}
                <View style={{ gap: 8, marginTop: 10 }}>
                  <Button
                    testID={TID.captureProof}
                    label={
                      p.capturedPhotoLabel
                        ? "Retake return photo"
                        : "Capture return photo"
                    }
                    kind="secondary"
                    onPress={p.onCapturePhoto}
                  />
                  <Button
                    testID={TID.submitReturnProof}
                    label="Upload & complete return"
                    loading={p.busyAction === "return_proof"}
                    disabled={!p.capturedPhotoLabel}
                    onPress={p.onSubmitReturnProof}
                  />
                </View>
              </Card>
            ) : null}

            {p.state === "held_at_point" ? (
              <Card>
                <Text variant="bodyStrong">Held at partner pickup point</Text>
                <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
                  Confirm once the parcel has been handed over at the partner
                  pickup point.
                </Text>
                <Button
                  testID={TID.confirmCollected}
                  label="Confirm hand-off at hold point"
                  loading={p.busyAction === "collected"}
                  onPress={p.onConfirmCollected}
                  style={{ marginTop: 10 }}
                />
              </Card>
            ) : null}
          </>
        ) : null}

        {p.proofs.length > 0 ? (
          <Card>
            <Text variant="bodyStrong">Verified custody proofs</Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 2 }}>
              Proof links expire in 60 seconds and are fetched on demand.
            </Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              {p.proofs.map((pr) => (
                <Button
                  key={pr.proofId}
                  testID={dynamicTestId(TID.proofItem, pr.proofId)}
                  label={
                    "View " +
                    pr.type +
                    " proof (" +
                    (pr.verified ? "verified" : "unverified") +
                    ")"
                  }
                  kind="secondary"
                  size="md"
                  loading={p.busyAction === "proof:" + pr.proofId}
                  onPress={() => p.onOpenProof(pr.proofId)}
                />
              ))}
            </View>
            {p.viewingProof ? (
              <Card testID={TID.proofViewer} style={{ marginTop: 10 }}>
                <Text variant="bodyStrong">
                  {"Proof · " + p.viewingProof.type}
                </Text>
                <Text variant="mono" tone="text2" style={{ marginTop: 4 }}>
                  {p.viewingProof.url}
                </Text>
                <Text variant="caption" tone="text3" style={{ marginTop: 2 }}>
                  {"Expires at " + p.viewingProof.expiresAt}
                </Text>
                <Button
                  label="Close proof"
                  kind="secondary"
                  size="md"
                  onPress={p.onDismissProof}
                  style={{ marginTop: 8 }}
                />
              </Card>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <Text variant="bodyStrong" style={{ marginBottom: 8 }}>
            Custody timeline
          </Text>
          <Ladder steps={p.ladderSteps} />
        </Card>
      </View>
    </Screen>
  );
}
