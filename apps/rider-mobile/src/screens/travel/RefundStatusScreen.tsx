import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Ladder, Button, Skeleton } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import { travelApi } from '../../api/travel';

/** Board 21d — what comes back and where it is: supplier → UBI → wallet, with the expected date. */
export function RefundStatusScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { refundId: string } }>();
  const q = useQuery({ queryKey: ['refund', params.refundId], queryFn: () => travelApi.refund(params.refundId), refetchInterval: (query) => (query.state.data?.stage === 'refunded_to_wallet' || query.state.data?.stage === 'rejected' ? false : 60_000) });
  const r = q.data;
  return (
    <Screen onBack={nav.goBack} footer={<View style={{ flexDirection: 'row', gap: 8 }}><Button label="Get help" kind="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('Ask', { screen: 'Thread', params: { seed: 'Where is my refund?' } })} /><Button label="Find another stay" kind="inverse" style={{ flex: 1 }} onPress={() => nav.navigate('FlightSearch')} /></View>}>
      {!r ? <Skeleton height={220} /> : (<>
        <StatusPill status={r.stage === 'refunded_to_wallet' ? 'confirmed' : r.stage === 'rejected' ? 'failed' : 'refund_in_progress'} />
        <Text variant="display" accessibilityRole="header">{r.headline}</Text>
        <Text variant="bodySm" tone="text2">{r.body}</Text>
        <Card><Ladder testID={TID.travel.refund.tracker} steps={r.steps.map(s => ({ label: s.label, detail: s.detail, state: s.state }))} /></Card>
        {r.footnote ? <Text variant="caption" tone="text2">{r.footnote}</Text> : null}
      </>)}
    </Screen>
  );
}
