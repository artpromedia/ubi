// First-run welcome (C05 / G01). One screen, no carousel: it states what works
// today and hands off to phone sign-in. Nothing here implies a feature that
// has not launched.
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
          testID="rider.onboarding.start"
          label="Continue with phone number"
          accessibilityLabel="Continue with phone number"
          onPress={() => nav.navigate("Auth", { screen: "Login" })}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 48 }}>
        <Text variant="display">Move around your city</Text>
        <Text tone="text2">
          Request a ride, agree a fare with a driver, and pay from your UBI
          wallet or in cash.
        </Text>
        <Card>
          <Text variant="bodyStrong">How fares work</Text>
          <Text variant="bodySm" tone="text2">
            You name a fare within the city’s bounds, drivers answer with
            offers, and you pick one. The total you pay is always shown before
            you choose.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
