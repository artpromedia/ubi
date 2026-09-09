import React from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, Button, useTheme } from '@ubi/mobile-ui';
import { useFlag } from '@ubi/mobile-core';
import { TEST_IDS } from '@ubi/contracts';
import { incentivesApi } from '../../api/incentives';
import { IncentiveStrip } from '../../components/IncentiveStrip';

/** Board 22c (home portion). The map, online toggle, offers and trip execution are ported in RN-02 (boards 1b–1q); this shows where the strip sits. */
export function HomeScreen() {
  const t = useTheme();
  const rebates = useFlag('driver_commission_rebates');
  const inc = useQuery({ queryKey: ['driverIncentives'], queryFn: incentivesApi.overview, enabled: rebates, refetchInterval: 60_000 });
  return (
    <Screen scroll={false} bg="bg">
      <View style={{ flex: 1 }}>
        <View accessibilityLabel="Map" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: t.colors.bg2 }} />
        <View style={{ padding: 16, gap: 8 }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.ok }} /><Text variant="bodyStrong">Online · Lekki</Text><Text variant="bodySmStrong" tone="ok" style={{ marginLeft: 'auto' }} tabular>₦41,800 today</Text></Card>
          {rebates ? <IncentiveStrip strip={inc.data?.strip} /> : null}
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.colors.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, borderTopWidth: 1, borderTopColor: t.colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text variant="heading">Looking for trips</Text><Text variant="caption" tone="text2">Demand high around Lekki Phase 1 · 12 trips today</Text></View><Button testID={TEST_IDS.driver.home.filters} label="Filters" kind="secondary" size="md" onPress={() => {}} /></View>
          <Button testID={TEST_IDS.driver.home.goOffline} label="Go offline" kind="secondary" onPress={() => {}} />
        </View>
      </View>
    </Screen>
  );
}
