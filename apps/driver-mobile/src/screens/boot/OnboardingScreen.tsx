// First-run welcome (C05 / G01). One screen, no carousel: it states what works
// today and hands off to phone sign-in. Nothing here implies a feature that
// has not launched (vehicle/document onboarding is a separate, later step).
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Screen, Text, Button, Card } from "@ubi/mobile-ui";

export function OnboardingScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
  }>();
  return (
    <Screen
      footer={
        <Button
          testID="driver.onboarding.start"
          label="Continue with phone number"
          accessibilityLabel="Continue with phone number"
          onPress={() => nav.navigate("Auth", { screen: "Login" })}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 48 }}>
        <Text variant="display">Drive with UBI</Text>
        <Text tone="text2">
          Bid on nearby trips at a fare you set, get paid by wallet or cash, and
          see your commission before you accept.
        </Text>
        <Card>
          <Text variant="bodyStrong">How the marketplace works</Text>
          <Text variant="bodySm" tone="text2">
            Riders name a fare, you answer with your own offer, and you’re only
            shown a job once you’re confirmed for it. Bidding pauses
            automatically while you’re moving.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
