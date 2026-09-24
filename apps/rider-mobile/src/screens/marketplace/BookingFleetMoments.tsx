// A05 fleet calendar — the rider's only two moments (handoff D1/D2), in the Book-for-Later
// visual language of BookingDetail. Everything shown is the server's: the vehicle labels, the
// fare (MoneyText / formatMinor — formatting, never arithmetic), whether a rematch is offered.
//
// D1 BookingChangeConsent: the driver accepted a fleet's vehicle change and UBI revalidated
//   the vehicle; the rider sees before/after, "same driver", "fare unchanged", and nothing
//   changes unless they confirm (POST …/changes/:changeId/accept). "Cancel for free" is the
//   ordinary free cancellation of the booking (POST …/cancel).
// D2 BookingDriverLost: the driver can't make the trip. No reason is ever shown. The rider may
//   ask for another driver at the same fare ONLY when the server says a rematch is available
//   (POST …/rematch), or cancel and release (POST …/release) — they are never charged.
import React from "react";
import { View } from "react-native";
import { Button, Card, MoneyText, Row, Text } from "@ubi/mobile-ui";
import { formatMinor } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import type { MpAdvanceBooking } from "../../api/marketplace";
import { whenLabel } from "./riderCopy";
import { StateTag } from "./riderParts";

const TID = TEST_IDS.rider.booking;

export type PendingChange = NonNullable<MpAdvanceBooking["pendingChange"]>;

/** D1 — a revalidated vehicle change awaiting the rider's explicit consent. */
export function BookingChangeConsent({
  change,
  timeZone,
  confirming,
  onConfirm,
  onCancelFree,
}: {
  change: PendingChange;
  timeZone?: string;
  confirming: boolean;
  onConfirm: () => void;
  onCancelFree: () => void;
}) {
  return (
    <Card testID={TID.vehicleChange} tone="warn" style={{ gap: 8 }}>
      <StateTag label="Your confirmation needed" tone="warn" />
      <Text variant="title">Different vehicle, same driver</Text>
      <View>
        {change.from ? (
          <Row label="Booked vehicle" value={change.from.label} />
        ) : null}
        <Row label="New vehicle" value={change.to.label} />
        <Row
          label="Fare"
          value={
            <Text variant="bodyStrong">
              <MoneyText money={change.fareMinor} variant="bodyStrong" />
              {" · unchanged"}
            </Text>
          }
          last
        />
      </View>
      <Text variant="bodySm" tone="text2">
        Nothing changes unless you confirm. Cancelling is free.
      </Text>
      <Text variant="caption" tone="text2">
        {"Please answer by " + whenLabel(change.expiresAt, timeZone) + "."}
      </Text>
      <Button
        testID={TID.vehicleChangeConfirm}
        label="Confirm new vehicle"
        loading={confirming}
        onPress={onConfirm}
      />
      <Button
        testID={TID.vehicleChangeCancel}
        label="Cancel for free"
        kind="secondary"
        disabled={confirming}
        onPress={onCancelFree}
      />
    </Card>
  );
}

/** D2 — the driver can't make this trip. No reason is shown. */
export function BookingDriverLost({
  fare,
  rematchAvailable,
  released,
  rematching,
  releasing,
  onRematch,
  onRelease,
}: {
  fare: MpAdvanceBooking["fareMinor"];
  rematchAvailable: boolean;
  released: boolean;
  rematching: boolean;
  releasing: boolean;
  onRematch: () => void;
  onRelease: () => void;
}) {
  return (
    <Card testID={TID.driverLost} tone="error" style={{ gap: 8 }}>
      <StateTag label="Driver unavailable" tone="error" />
      <Text variant="title">Your driver can’t make this trip</Text>
      <Text variant="bodySm">You won’t be charged.</Text>
      {rematchAvailable ? (
        <>
          <Text variant="caption" tone="text2">
            {"Find another driver: same fare, " +
              formatMinor(fare) +
              ". You choose from the new offers."}
          </Text>
          <Button
            testID={TID.rematchSameFare}
            label="Find another driver"
            loading={rematching}
            disabled={releasing}
            onPress={onRematch}
          />
        </>
      ) : null}
      {released ? (
        <Text variant="caption" tone="text2">
          Your booking is released. Nothing was charged.
        </Text>
      ) : (
        <Button
          testID={TID.cancelRelease}
          label={"Cancel and release my " + formatMinor(fare)}
          kind={rematchAvailable ? "secondary" : "primary"}
          loading={releasing}
          disabled={rematching}
          onPress={onRelease}
        />
      )}
    </Card>
  );
}
