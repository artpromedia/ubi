import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Row, MoneyText, Button, Skeleton } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import type { AccountStackParamList } from '../../navigation/routes';
import { mandatesApi } from '../../api/mandates';

/** Board 20d — receipt for one run (done or blocked, with reason) plus earlier runs. */
export function MandateReceiptScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<AccountStackParamList, 'MandateReceipt'>>();
  const q = useQuery({ queryKey: ['mandateExec', params.executionId], queryFn: () => mandatesApi.execution(params.executionId) });
  const hist = useQuery({ queryKey: ['mandateExecs', q.data?.mandateId], queryFn: () => mandatesApi.executions(q.data!.mandateId), enabled: !!q.data });
  React.useEffect(() => { if (q.data) track('mandate_receipt_viewed', { executionId: q.data.id, outcome: q.data.outcome }); }, [q.data?.id]);
  const e = q.data;
  return (
    <Screen onBack={nav.goBack} footer={e ? <View style={{ flexDirection: 'row', gap: 8 }}>{e.outcome === 'executed' ? <Button label="Cancel this pickup" kind="secondary" size="md" style={{ flex: 1 }} onPress={() => nav.navigate('Ride', { screen: 'Details', params: { rideId: e.resultRef } })} /> : null}<Button label="Pause automation" kind="danger" size="md" style={{ flex: 1 }} onPress={async () => { await mandatesApi.patch(e.mandateId, 'pause'); nav.goBack(); }} /></View> : undefined}>
      {!e ? <Skeleton height={200} /> : (<>
        <StatusPill status={e.outcome === 'executed' ? 'done' : 'blocked'} suffix="by automation" />
        <Text variant="display" accessibilityRole="header">{e.title}</Text>
        <Text variant="bodySm" tone="text2">{e.summary}</Text>
        <Card testID={TID.mandates.receipt.card} style={{ paddingVertical: 2 }}>
          {e.amount ? <Row label={e.outcome === 'executed' ? 'Reserved fare' : 'Lowest fare found'} value={<MoneyText money={e.amount} variant="bodySmStrong" />} /> : null}
          {e.outcome === 'executed' ? <Row label="Charged" value="₦0 now · on completion" /> : <Row label="Why it stopped" value={e.detail ?? e.reasonCode ?? ''} valueTone="warnInk" />}
          {e.allowance ? <Row label="Monthly allowance" value={formatMinor(e.allowance.used) + ' of ' + formatMinor(e.allowance.cap) + ' · ' + e.allowance.runsUsed + ' of ' + e.allowance.runs} /> : null}
          <Row label="Run at" value={new Date(e.at).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WAT'} />
          <Row label="Receipt" value={e.receiptRef ?? '—'} last />
        </Card>
        {hist.data?.filter(h => h.id !== e.id).length ? (<>
          <Text variant="label" tone="text3">Earlier runs</Text>
          <Card style={{ paddingVertical: 2 }}>{hist.data.filter(h => h.id !== e.id).map((h, i, arr) => (
            <Row key={h.id} last={i === arr.length - 1} onPress={() => nav.navigate('MandateReceipt', { executionId: h.id })}>
              <StatusPill status={h.outcome === 'executed' ? 'done' : 'blocked'} />
              <View style={{ flex: 1 }}><Text variant="bodySm">{h.title}</Text><Text variant="caption" tone="text2">{h.summary}</Text></View>
            </Row>
          ))}</Card>
        </>) : null}
      </>)}
    </Screen>
  );
}
