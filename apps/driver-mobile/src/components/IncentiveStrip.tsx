import React from 'react';
import { View } from 'react-native';
import { Card, Text, useTheme } from '@ubi/mobile-ui';
import { TID, track } from '@ubi/mobile-core';

/** Board 22c — one glanceable line while online. Read-only (no onPress), ≥ 15px, aria-live. Rendered only when the server sent a strip. */
export function IncentiveStrip({ strip }: { strip?: { headline: string; detail: string; badge: string } | null }) {
  const t = useTheme();
  React.useEffect(() => { if (strip) track('driver_incentive_strip_shown', { kind: strip.badge }); }, [strip?.headline]);
  if (!strip) return null;
  return (
    <Card testID={TID.driver.home.incentiveStrip} accessibilityLiveRegion="polite" accessibilityLabel={strip.headline + '. ' + strip.detail} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: t.colors.okTint, borderWidth: 1 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.okTint, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodySmStrong" tone="ok">{strip.badge}</Text></View>
      <View style={{ flex: 1 }}><Text variant="bodyStrong">{strip.headline}</Text><Text variant="caption" tone="text2">{strip.detail}</Text></View>
    </Card>
  );
}
