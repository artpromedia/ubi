// Honest gate for routes that are deliberately NOT built yet (C05 / G12).
// Replaces PlaceholderScreen everywhere a surface must not imply availability:
// it says plainly that the feature is not available in this app today, with no
// implication of a working port behind it. Deep links or navigations that land
// here get a clear message and a way back, never a broken or fake screen.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { Screen, Text, Button, Card } from "@ubi/mobile-ui";

const COPY: Record<string, { title: string; body: string }> = {
  Payouts: {
    title: "Payouts aren’t in this app yet",
    body: "Cashing out and viewing payout history isn’t wired up here yet — nothing is set up behind this screen.",
  },
  Cashout: {
    title: "Cashout isn’t in this app yet",
    body: "Requesting a cashout isn’t available in this app yet.",
  },
  EarningsOverview: {
    title: "Earnings overview isn’t in this app yet",
    body: "An aggregated earnings summary isn’t available yet — see your statement and marketplace jobs for what has actually settled.",
  },
  TripDetail: {
    title: "Trip detail isn’t in this app yet",
    body: "A dedicated past-trip detail view isn’t built yet — see your statement for the ledger record.",
  },
  Vehicle: {
    title: "Vehicle management isn’t in this app yet",
    body: "Managing your vehicle record isn’t wired up here yet.",
  },
  Documents: {
    title: "Documents aren’t in this app yet",
    body: "Document upload and status aren’t wired up in this app yet.",
  },
  UploadDocument: {
    title: "Document upload isn’t in this app yet",
    body: "Uploading a document isn’t wired up in this app yet.",
  },
  Ratings: {
    title: "Ratings aren’t in this app yet",
    body: "A ratings breakdown isn’t available in this app yet.",
  },
  Settings: {
    title: "Settings aren’t in this app yet",
    body: "App settings aren’t wired up here yet.",
  },
  FleetArrangement: {
    title: "Fleet arrangement isn’t in this app yet",
    body: "Fleet sign-off and arrangement management isn’t wired up in this app yet.",
  },
  LivenessCheck: {
    title: "Liveness check isn’t in this app yet",
    body: "This identity step isn’t wired up in this app yet.",
  },
  Ask: {
    title: "Ask UBI isn’t in this app yet",
    body: "The AI assistant isn’t available in the driver app yet.",
  },
  Referrals: {
    title: "Referrals aren’t in this app yet",
    body: "A referrals board isn’t wired up here yet.",
  },
  Window: {
    title: "This incentive window isn’t in this app yet",
    body: "Incentive-window detail isn’t wired up here yet.",
  },
  default: {
    title: "Not available yet",
    body: "This part of UBI Driver hasn’t launched. Nothing is set up behind this screen.",
  },
};

// `route` is given a default so this component type-checks as a screen for
// EVERY param list shape it is mounted under — including ones where React
// Navigation infers an all-optional props type and requires the component to
// be callable with no props at all.
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
