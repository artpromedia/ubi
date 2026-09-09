import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, Row, MoneyText, Skeleton, useTheme } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import type { IncentivesStackParamList } from '../../navigation/routes';
import { incentivesApi } from '../../api/incentives';

/** Board 22d — the exact wording of a reduction: rule table, worked example from the driver's last trip, pp-vs-% note. */
export function CommissionDetailScreen() {
  const t = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<IncentivesStackParamList, 'CommissionDetail'>>();
  const { params } = useRoute<RouteProp<IncentivesStackParamList, 'CommissionDetail'>>();
  const q = useQuery({ queryKey: ['incentive', params.incentiveId], queryFn: () => incentivesApi.detail(params.incentiveId) });
  const d = q.data;
  React.useEffect(() => { if (d) track('driver_commission_detail_viewed', { kind: d.kind }); }, [d?.id]);
  return (
    <Screen title={d?.title ?? 'Lower commission'} subtitle={d?.periodLabel} onBack={nav.goBack}>
      {!d ? <Skeleton height={300} /> : (<>
        <Text variant="caption" tone="text2">{d.intro}</Text>
        <Card testID={TID.driver.commission.detail} style={{ paddingVertical: 2 }}>{d.rules.map((r, i) => <Row key={r.label} label={r.label} value={r.value} valueTone={r.label === 'Reduction' ? 'ok' : 'text'} last={i === d.rules.length - 1} />)}</Card>
        <Text variant="label" tone="text3">Worked on your last trip · {d.example.tripRef} · {formatMinor(d.example.fare)}</Text>
        <Card style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption" tone="text2">Commission at {(d.baseBps / 100)}%</Text><MoneyText money={{ amountMinor: -d.example.commissionBefore.amountMinor, currency: d.example.fare.currency }} variant="caption" tone="errorInk" /></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption" tone="text2">Rebate · {d.kind === 'percentage_points' ? (d.reductionBps / 100) + ' points of ' + formatMinor(d.example.fare) : (d.reductionBps / 100) + '% of the commission'}</Text><MoneyText money={d.example.rebate} signed variant="caption" tone="ok" /></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: 6, marginTop: 4 }}><Text variant="bodySmStrong">You keep</Text><Text variant="bodySmStrong" tabular>{formatMinor({ amountMinor: d.example.fare.amountMinor - d.example.commissionAfter.amountMinor, currency: d.example.fare.currency })} of {formatMinor(d.example.fare)}</Text></View>
        </Card>
        <Card style={{ backgroundColor: t.colors.infoTint, borderColor: t.colors.info, gap: 2 }}><Text variant="bodySmStrong" tone="info">{d.note.title}</Text><Text variant="caption" tone="text2">{d.note.body}</Text></Card>
      </>)}
    </Screen>
  );
}
