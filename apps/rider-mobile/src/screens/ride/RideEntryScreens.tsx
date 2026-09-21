// Pre-marketplace Ride routes (C05 rule: thin redirects, never a parallel
// quote flow). Search / Pickup / Quote all funnel into the marketplace
// FareEditor journey, which is the one real pricing surface. Matching routes a
// rideId (e.g. the home/ride/:rideId/tracking deep link) to whichever real
// screen matches the server state.
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Text, useTheme } from "@ubi/mobile-ui";
import { useRideView, rideScreenFor } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";
import { ErrorState } from "../../components/states";

function Redirecting({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: t.colors.bg,
      }}
    >
      <ActivityIndicator color={t.colors.text2} />
      <Text variant="bodySm" tone="text2">
        {label}
      </Text>
    </View>
  );
}

/** Search / Pickup / Quote → Marketplace.Details (the fare editor journey). */
export function RideToMarketplaceRedirect() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
  }>();
  useEffect(() => {
    nav.navigate("Marketplace", { screen: "Details" });
  }, [nav]);
  return <Redirecting label="Opening the fare marketplace…" />;
}

/** Matching — resolves the server state and lands on the right real screen. */
export function RideStateRouterScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "Matching">>();
  const q = useRideView(params.rideId);
  useEffect(() => {
    if (q.data) {
      nav.navigate(rideScreenFor(q.data), { rideId: q.data.rideId });
    }
  }, [q.data, nav]);
  if (q.isError)
    return (
      <Screen title="Your ride" onBack={nav.goBack}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  return <Redirecting label="Checking your ride…" />;
}
