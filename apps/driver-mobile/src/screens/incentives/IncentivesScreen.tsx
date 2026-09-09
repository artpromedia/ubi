import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, MoneyText, Skeleton, useTheme } from '@ubi/mobile-ui';
import { TID, track, bpsToPercent, formatMinor } from '@ubi/mobile-core';
import { incentivesApi, type Rebate, type Window } from '../../api/incentives';

const left = (iso: string) => { const ms = new Date(iso).getTime() - Date.now(); const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000); return (d > 0 ? d + 'd ' : '') + h + 'h left'; };
function RebateCard({ r, onPress }: { r: Rebate; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable testID={TID.driver.incentives.rebateCard} accessibilityRole="button" accessibilityLabel={r.title + '. Base ' + bpsToPercent(r.baseBps) + ', minus ' + (r.reductionBps / 100) + ' points, effective ' + bpsToPercent(r.effectiveBps)} onPress={onPress}>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="bodyStrong">{r.title}</Text><StatusPill status="active" suffix={left(r.endsAt)} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
          <View><Text variant="caption" tone="text3">Base</Text><Text variant="title" tone="text2">{bpsToPercent(r.baseBps)}</Text></View>
          <Text variant="heading" tone="text3" style={{ paddingBottom: 4 }}>{r.kind === 'percentage_points' ? '−' + (r.reductionBps / 100) + ' points' : '−' + bpsToPercent(r.reductionBps) + ' of commission'}</Text>
          <View><Text variant="caption" tone="text3">Effective</Text><Text variant="money" tone="ok" style={{ fontSize: 28, lineHeight: 32 }}>{bpsToPercent(r.effectiveBps)}</Text></View>
        </View>
        <Text variant="caption" tone="text2">On your {formatMinor(r.example.fare)} trip: commission {formatMinor(r.example.commissionBefore)} → <Text variant="caption">{formatMinor(r.example.commissionAfter)}</Text>. Rebate {formatMinor(r.example.rebate)} paid back on each eligible trip as its own line. Funded by {r.fundedBy}. {r.appliesTo}.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption" tone="text2">Eligible trips this week</Text><Text variant="caption" tabular>{r.eligible.used} of {r.eligible.cap} · {formatMinor(r.eligible.rebatedSoFar)} back so far</Text></View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.border, overflow: 'hidden' }}><View style={{ width: Math.round(100 * r.eligible.used / Math.max(1, r.eligible.cap)) + '%' as unknown as number, height: 6, backgroundColor: t.colors.ok }} /></View>
      </Card>
    </Pressable>
  );
}
function WindowCard({ w }: { w: Window }) {
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="bodyStrong">{w.title}</Text><StatusPill status={w.live ? 'active' : 'scheduled'} suffix={new Date(w.startsAt).toLocaleDateString('en-NG', { weekday: 'short' }) + ' ' + hm(w.startsAt) + '–' + hm(w.endsAt)} /></View>
      <Text variant="caption" tone="text2">0% commission on trips <Text variant="caption">{w.rule}</Text>, {w.zones.join(' & ')} · up to <Text variant="caption">{w.tripCap} trips</Text> or <Text variant="caption">{formatMinor(w.moneyCap)}</Text> of commission, whichever first · then your effective rate applies again{w.live ? ' · ' + w.used.trips + ' of ' + w.tripCap + ' used · ' + formatMinor(w.used.saved) + ' saved' : ''}</Text>
    </Card>
  );
}
/** Board 22c — parked view: rebate, window, referral milestones, quest. Server computes everything. */
export function IncentivesScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const q = useQuery({ queryKey: ['driverIncentives'], queryFn: incentivesApi.overview });
  React.useEffect(() => { if (q.data) track('driver_incentives_viewed', { rebates: q.data.rebates.length, windows: q.data.windows.length }); }, [q.data]);
  const d = q.data;
  return (
    <Screen title="Incentives">
      {!d ? <><Skeleton height={170} /><Skeleton height={90} /></> : (<>
        {d.rebates.map(r => <RebateCard key={r.id} r={r} onPress={() => nav.navigate('CommissionDetail', { incentiveId: r.id })} />)}
        {d.windows.map(w => <WindowCard key={w.id} w={w} />)}
        <Card testID={TID.driver.incentives.referrals} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="bodyStrong">Refer a driver · {formatMinor(d.referral.reward)}</Text><Text variant="bodySmStrong" tone="link">Share code {d.referral.code}</Text></View>
          {d.referral.referees.map(ref => (
            <View key={ref.name} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>{ref.milestones.map(m => <View key={m.label} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: m.done ? t.colors.ok : t.colors.border }} />)}</View>
              <Text variant="caption" tone="text2">{ref.name} · {ref.milestones.map(m => m.label + (m.done ? ' ✓' : '') + (m.paid ? ' (' + formatMinor(m.paid) + ' paid)' : '') + (m.progress !== undefined && !m.done ? ' · ' + m.progress + ' of ' + m.target : '')).join(' · ')}</Text>
            </View>
          ))}
        </Card>
        {d.quests.map(qu => <Card key={qu.title} style={{ gap: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodyStrong">{qu.title}</Text><Text variant="bodySmStrong" tabular>{qu.progress} / {qu.target}</Text></View><Text variant="caption" tone="text2">{formatMinor(qu.bonus)} bonus · completed trips only · pays {qu.paysOn}</Text></Card>)}
        <Text variant="caption" tone="text3">{d.footnote}</Text>
      </>)}
    </Screen>
  );
}
