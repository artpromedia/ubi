// Shared driver cancel-reason picker (C05). A driver cancellation MUST carry
// one of the server's closed reason codes (ride-service domain.ValidCancellationReason) —
// this is the one place that list is rendered, so every Trip screen offers the
// same honest, real set instead of inventing its own.
import React from "react";
import { View } from "react-native";
import { Card, Text, Button } from "@ubi/mobile-ui";
import { DRIVER_CANCEL_REASONS } from "../api/rides";

export function CancelReasonPicker({
  pending,
  onPick,
}: {
  pending: boolean;
  onPick: (reasonCode: string) => void;
}) {
  return (
    <Card testID="driver.cancel.reasons">
      <Text variant="bodyStrong">Why are you cancelling?</Text>
      <View style={{ gap: 8, marginTop: 8 }}>
        {DRIVER_CANCEL_REASONS.map((r) => (
          <Button
            key={r.code}
            label={r.label}
            kind="secondary"
            accessibilityLabel={r.label}
            loading={pending}
            onPress={() => onPick(r.code)}
          />
        ))}
      </View>
    </Card>
  );
}
