import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Button, MoneyText, Skeleton, Banner } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import { travelApi } from '../../api/travel';
import { AlternativeCard } from '../../components/travel/AlternativeCard';

/** Board 21d — one screen, two server-driven variants. Covered: ₦0 alternatives under a funded rule. Not covered: the airline's statutory options first, then paid alternatives. */
export function DisruptionScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { orderId: string } }>();
  const q = useQuery({ queryKey: ['disruption', params.orderId], queryFn: () => travelApi.disruption(params.orderId) });
  const [sel, setSel] = useState<string | 'refund' | undefined>();
  const sw = useMutation({ mutationFn: () => travelApi.switchTo(params.orderId, sel as string), onSuccess: (o) => { track('travel_switch_confirmed', { orderId: o.id }); nav.navigate('OrderStatus', { orderId: o.id }); } });
  const rf = useMutation({ mutationFn: () => travelApi.requestRefund(params.orderId), onSuccess: (r) => { track('travel_refund_requested', { orderId: params.orderId }); nav.navigate('RefundStatus', { refundId: r.id }); } });
  const d = q.data;
  React.useEffect(() => { if (d) track('travel_disruption_viewed', { orderId: params.orderId, covered: d.eligibility.covered, ruleId: d.eligibility.ruleId }); }, [d?.verifiedAt]);
  const chosen = d ? [...d.airlineOptions, ...d.alternatives].find(a => a.id === sel) : undefined;
  const cta = sel === 'refund' ? 'Take the full refund' : chosen ? (chosen.customerPays.amountMinor === 0 ? 'Switch to ' + chosen.flightNumber + ' · ₦0' : 'Book ' + chosen.flightNumber + ' · ' + formatMinor(chosen.customerPays)) : 'Choose an option';
  return (
    <Screen onBack={nav.goBack} footer={d ? <View style={{ gap: 8 }}><Button testID={TID.flights.switch.confirm} label={cta} disabled={!sel} loading={sw.isPending || rf.isPending} kind={d.eligibility.covered ? 'primary' : 'inverse'} onPress={() => sel === 'refund' ? rf.mutate() : sw.mutate()} />{d.linkedRideImpact ? <Text variant="caption" tone="text2" align="center">{d.linkedRideImpact}</Text> : null}</View> : undefined}>
      {!d ? <Skeleton height={260} /> : (<>
        <StatusPill status="cancelled" suffix="airline cancelled your flight" />
        <Text variant="display" accessibilityRole="header">{d.headline}</Text>
        <Text variant="bodySm" tone="text2">{d.body}</Text>
        <Card testID={TID.travel.disruption.eligibility} tone={d.eligibility.covered ? 'ok' : 'default'} style={d.eligibility.covered ? { backgroundColor: '#E8F8EE' } : undefined}><Text variant="bodySmStrong" tone={d.eligibility.covered ? 'primaryInk' : 'text'}>{d.eligibility.title}</Text><Text variant="caption">{d.eligibility.text}</Text></Card>
        {!d.eligibility.covered && d.airlineOptions.length ? <Text variant="label" tone="text3">From the airline · required by NCAA rules</Text> : null}
        {d.airlineOptions.map(a => <AlternativeCard key={a.id} a={a} selected={sel === a.id} onPress={() => setSel(a.id)} />)}
        {d.alternatives.length ? <Text variant="label" tone="text3">{d.eligibility.covered ? 'Switch at no cost' : 'Book another airline · you pay'}</Text> : null}
        {d.alternatives.map(a => <AlternativeCard key={a.id} a={a} selected={sel === a.id} onPress={() => setSel(a.id)} />)}
        <Card emphasis={sel === 'refund'} onTouchEnd={() => setSel('refund')} accessibilityRole="radio" accessibilityState={{ selected: sel === 'refund' }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodyStrong">{d.refund.title}</Text><MoneyText money={d.refund.amount} variant="bodySmStrong" /></View><Text variant="caption" tone="text2">{d.refund.path} · {d.refund.etaDays}</Text></Card>
        {d.footnote ? <Banner tone="neutral" body={d.footnote} /> : null}
      </>)}
    </Screen>
  );
}
