// Deny-by-default gate for the driver marketplace surfaces (task D). Mirrors
// @ubi/mobile-ui FlagGate (honest "not available here", launch CLAUDE.md #5, #8) but the
// marketplace is on when EITHER city-scoped service flag is on: rides and package
// delivery roll out independently (packages/contracts/src/flags.ts). Any flag-service
// failure means both read false — the gate never fails open.
import type React from "react";
import { View } from "react-native";
import { useFlag, useFlags, TID } from "@ubi/mobile-core";
import { useTheme, Text, Button, Skeleton } from "@ubi/mobile-ui";

export function MarketplaceGate({
  featureName,
  onDismiss,
  children,
}: {
  featureName: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const rides = useFlag("marketplace_rides");
  const delivery = useFlag("marketplace_delivery");
  const { status } = useFlags();
  const t = useTheme();
  if (status === "loading")
    return (
      <View style={{ padding: 20, gap: 10 }}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  if (rides || delivery) return <>{children}</>;
  return (
    <View
      testID={TID.common.flagOff.screen}
      style={{
        flex: 1,
        padding: 24,
        justifyContent: "center",
        gap: 12,
        backgroundColor: t.colors.bg,
      }}
    >
      <Text variant="display">{featureName} isn’t available here yet</Text>
      <Text variant="body" tone="text2">
        It’s not offered in your city right now. We’ll show it as soon as it is.
      </Text>
      <Button label="Back to home" kind="inverse" onPress={onDismiss} />
    </View>
  );
}
