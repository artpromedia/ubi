// Honest gate for routes that are deliberately NOT built yet (C05 / G12).
// Replaces PlaceholderScreen everywhere a surface must not imply availability:
// it says plainly that the feature is not available in this app today, with no
// "coming from RN-01" implication of a working port. Deep links that land here
// get a clear message and a way back, never a broken or fake screen.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { Screen, Text, Button, Card } from "@ubi/mobile-ui";

const COPY: Record<string, { title: string; body: string }> = {
  Bites: {
    title: "Food isn’t available yet",
    body: "Ordering food through UBI hasn’t launched. Nothing is set up behind this screen — when it launches it will appear here.",
  },
  Send: {
    title: "Parcel delivery isn’t available yet",
    body: "Sending packages through UBI hasn’t launched. Nothing is set up behind this screen — when it launches it will appear here.",
  },
  AccountPlaces: {
    title: "Saved places aren’t in this app yet",
    body: "Managing saved places isn’t wired up here yet — nothing you add would be kept.",
  },
  AccountPayments: {
    title: "Payment methods aren’t in this app yet",
    body: "Adding or managing payment methods isn’t available in this app — your wallet balance and statement are under Wallet.",
  },
  AccountSettings: {
    title: "Settings aren’t in this app yet",
    body: "Notification and app settings aren’t wired up here yet.",
  },
  WalletSend: {
    title: "Sending money isn’t in this app yet",
    body: "Wallet transfers aren’t available here — your balance and statement are read-only in this app for now.",
  },
  WalletRequest: {
    title: "Requesting money isn’t in this app yet",
    body: "Wallet payment requests aren’t available here yet.",
  },
  WalletNip: {
    title: "Bank transfers aren’t in this app yet",
    body: "Sending to a bank account isn’t available here yet.",
  },
  WalletTopUp: {
    title: "Topping up isn’t in this app yet",
    body: "Adding money to your wallet isn’t available here yet.",
  },
  default: {
    title: "Not available yet",
    body: "This part of UBI hasn’t launched. Nothing is set up behind this screen.",
  },
};

// `route` is given a default so this component type-checks as a screen for
// EVERY param list shape it is mounted under — including ones (like a nested
// NavigatorScreenParams union) where React Navigation infers an all-optional
// props type and requires the component to be callable with no props at all.
export function FeatureUnavailableScreen({
  route = { name: "default" },
}: {
  route?: { name: string; params?: { feature?: string } | undefined };
}) {
  const nav = useNavigation<{
    goBack: () => void;
    canGoBack: () => boolean;
    navigate: (n: string) => void;
  }>();
  const key = route.params?.feature ?? route.name;
  const copy = COPY[key] ?? COPY[route.name] ?? COPY.default;
  return (
    <Screen title={copy.title}>
      <Card testID="common.unavailable.screen">
        <Text tone="text2">{copy.body}</Text>
      </Card>
      <Button
        label="Back to Home"
        accessibilityLabel="Back to Home"
        onPress={() => {
          if (nav.canGoBack()) nav.goBack();
          else nav.navigate("Main");
        }}
      />
    </Screen>
  );
}
