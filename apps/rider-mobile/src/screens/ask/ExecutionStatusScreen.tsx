import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, MoneyText, Button, Skeleton, Banner, useTheme } from '@ubi/mobile-ui';
import { track, TID } from '@ubi/mobile-core';
import type { AskStackParamList } from '../../navigation/routes';
import { askApi, type ExecutionItem } from '../../api/ask';
import { PlanCard } from '../../components/ask/QuoteCard';

const pillFor = (s: ExecutionItem['state']) => s === 'confirmed' || s === 'authorized' || s === 'reserved' ? 'confirmed' : s === 'ticketed' ? 'ticketed' : s === 'failed_released' || s === 'reservation_failed' ? 'failed' : s === 'unknown_reconciling' ? 'processing' : 'supplier_pending';
/** Board 20c — PROCESSING / PARTLY BOOKED / CONFIRMED / FAILED. Polls 15 s (realtime in RN-01). Copy never says "pay again". */
export function ExecutionStatusScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<AskStackParamList, 'Execution'>>();
  const q = useQuery({ queryKey: ['execution', params.executionId], queryFn: () => askApi.getExecution(params.executionId), refetchInterval: (query) => (query.state.data?.status === 'processing' ? 15_000 : false) });
  const e = q.data;
  React.useEffect(() => { if (e) track('ask_execution_viewed', { executionId: e.id, outcome: e.status }); }, [e?.status]);
  const headline = e?.status === 'processing' ? 'Booking your trip' : e?.status === 'partly_booked' ? 'Some of it is booked. Some isn\u2019t.' : e?.status === 'confirmed' ? 'All booked' : 'Nothing was booked';
  const intro = e?.status === 'processing' ? 'We\u2019re booking each item with its supplier. You can leave — we\u2019ll notify you. Don\u2019t pay again if this takes a while.' : e?.status === 'partly_booked' ? 'Each item is its own order. Here is what happened to each; you were charged only for what was confirmed.' : e?.status === 'confirmed' ? 'Every item has a supplier confirmation. Your itinerary is ready.' : 'Nothing was charged. Every hold has been released to your wallet.';
  return (
    <Screen onBack={nav.goBack} footer={<View style={{ flexDirection: 'row', gap: 8 }}><Button label="Back to Ask UBI" kind="secondary" style={{ flex: 1 }} onPress={nav.goBack} /><Button label="View in Activity" kind="inverse" style={{ flex: 1 }} onPress={() => nav.navigate('Main', { screen: 'Activity' })} /></View>}>
      {!e ? <View style={{ gap: 10 }}><Skeleton height={24} width="40%" /><Skeleton height={140} /></View> : (
        <>
          <StatusPill status={e.status === 'processing' ? 'processing' : e.status === 'partly_booked' ? 'partly_booked' : e.status === 'confirmed' ? 'confirmed' : 'failed'} />
          <Text variant="display" accessibilityRole="header">{headline}</Text>
          <Text variant="bodySm" tone="text2">{intro}</Text>
          <Card testID={TID.ask.status.list} style={{ paddingVertical: 2 }}>
            {e.items.map((it, i) => (
              <View key={it.title} testID={TID.ask.status.item} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 14, borderBottomWidth: i === e.items.length - 1 ? 0 : 1, borderBottomColor: t.colors.divider }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: pillFor(it.state) === 'confirmed' || pillFor(it.state) === 'ticketed' ? t.colors.okTint : 'transparent', borderWidth: pillFor(it.state) === 'confirmed' || pillFor(it.state) === 'ticketed' ? 0 : 2, borderColor: pillFor(it.state) === 'failed' ? t.colors.error : t.colors.warn }}>
                  {pillFor(it.state) === 'confirmed' || pillFor(it.state) === 'ticketed' ? <Text variant="label" tone="ok">✓</Text> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: pillFor(it.state) === 'failed' ? t.colors.error : t.colors.warn }} />}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="bodySmStrong">{it.title}</Text>
                  {it.detail ? <Text variant="caption" tone="text2">{it.detail}</Text> : null}
                  {it.charged ? <Text variant="caption" tone="text2">Charged <MoneyText money={it.charged} variant="caption" /></Text> : null}
                  {it.released ? <Text variant="caption" tone="text2"><MoneyText money={it.released} variant="caption" /> released to your wallet</Text> : null}
                  {it.alternatives?.length ? <View style={{ gap: 8, marginTop: 6 }}>{it.alternatives.map(a => <PlanCard key={a.id} card={a} />)}<Button size="md" kind="inverse" label="Review an alternative" onPress={() => nav.navigate('Ask', { screen: 'Thread' })} /></View> : null}
                </View>
                {it.kind !== 'payment' ? <StatusPill status={pillFor(it.state)} /> : null}
              </View>
            ))}
          </Card>
          {e.status === 'processing' ? <Banner tone="neutral" body="If a supplier never answers, we cancel that request and release its hold back to your wallet — other items are unaffected." /> : null}
        </>
      )}
    </Screen>
  );
}
