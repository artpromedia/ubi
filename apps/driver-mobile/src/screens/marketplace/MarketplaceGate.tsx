// Deny-by-default gate for the driver marketplace surfaces (task D). Mirrors
// @ubi/mobile-ui FlagGate (honest "not available here", launch CLAUDE.md #5, #8) but the
// marketplace is on when EITHER city-scoped service flag is on: rides and package
// delivery roll out independently (packages/contracts/src/flags.ts). Any flag-service
// failure means both read false — the gate never fails open.
//
// `requires` narrows a surface further (A02/A03): EVERY flag in `all` must be on, and
// when `any` is given at least one of those too — e.g. the trip-stops screen needs
// marketplace_rides AND (marketplace_multi_stop OR marketplace_trip_amendments). The
// same deny-by-default evaluation as useFlag: only an explicit `true` opens.
import type React from "react";
import { View } from "react-native";
import { useFlag, useFlags, TID, type AnyFlag } from "@ubi/mobile-core";
import { useTheme, Text, Button, Skeleton } from "@ubi/mobile-ui";

export type GateRequirement = { all: AnyFlag[]; any?: AnyFlag[] };

export function MarketplaceGate({
  featureName,
  onDismiss,
  requires,
  children,
}: {
  featureName: string;
  onDismiss: () => void;
  requires?: GateRequirement;
  children: React.ReactNode;
}) {
  const rides = useFlag("marketplace_rides");
  const delivery = useFlag("marketplace_delivery");
  const { status, flags } = useFlags();
  const t = useTheme();
  const on = (key: AnyFlag) =>
    (flags as Record<string, boolean | undefined>)[key] === true;
  // A requirement that names no flag at all never opens (deny-by-default, even when
  // misconfigured) — `[].every` would otherwise read as "all on".
  const open = requires
    ? (requires.all.length > 0 || !!requires.any?.length) &&
      requires.all.every(on) &&
      (!requires.any?.length || requires.any.some(on))
    : rides || delivery;
  if (status === "loading")
    return (
      <View style={{ padding: 20, gap: 10 }}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  if (open) return <>{children}</>;
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
