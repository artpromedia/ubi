// Ride.Rate (C05 / G01): honestly gated. ride-service's route table carries no
// rating endpoint (UNSUPPORTED registry: rideRating), so this screen does not
// pretend to collect stars it could never deliver — it states that plainly.
// When the endpoint ships, the stars UI plugs in here against the real route.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { Screen, Text, Card, Button } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { UNSUPPORTED } from "../../api/unsupported";

export function RateScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  return (
    <Screen title="Rate your trip" onBack={nav.goBack}>
      <Card testID={TEST_IDS.rider.rate.stars}>
        <Text variant="bodyStrong">Ratings aren’t available yet</Text>
        <Text variant="bodySm" tone="text2">
          UBI’s servers don’t accept trip ratings yet, so there’s nothing to
          submit here. Your trip is complete and nothing is pending on your
          side.
        </Text>
        <Text variant="caption" tone="text3">
          {UNSUPPORTED.rideRating.wanted}
        </Text>
      </Card>
      <Button
        label="Done"
        accessibilityLabel="Done"
        onPress={() => nav.navigate("Main" as never)}
      />
    </Screen>
  );
}
