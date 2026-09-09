import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, MoneyText, Row, Skeleton, FlagGate, useTheme } from '@ubi/mobile-ui';
import { TID, track } from '@ubi/mobile-core';
import { benefitsApi } from '../../api/benefits';

/** Board 22b — credit (multi-expiry), offers with their status, recent changes with reason + terms. */
export function BenefitsScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const q = useQuery({ queryKey: ['benefits'], queryFn: benefitsApi.get });
  React.useEffect(() => { if (q.data) track('benefits_viewed', { credits: q.data.credits.length, offers: q.data.offers.length }); }, [q.data]);
  const b = q.data;
  return (
    <FlagGate flag="rider_promotions" featureName="Benefits" onDismiss={nav.goBack}>
      <Screen title="Benefits" onBack={nav.goBack} action={{ label: 'Referrals', onPress: () => nav.navigate('Referrals') }}>
        {!b ? <><Skeleton height={120} /><Skeleton height={90} /></> : (<>
          <Card tone="inverse" testID={TID.benefits.credit.card} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="label" tone="onInverse2">Ride credit</Text><StatusPill status={b.credits.length ? 'active' : 'expired'} /></View>
            <MoneyText money={b.creditTotal} variant="money" tone="onInverse" />
            <Text variant="caption" tone="onInverse2">{b.credits.map(c => new Intl.NumberFormat('en-NG').format(c.amount.amountMinor / 100) + ' expires ' + c.expiresAt).join(' · ')}{b.credits[0] ? ' · use up to ' + new Intl.NumberFormat('en-NG').format(b.credits[0].perRideCap.amountMinor / 100) + ' per ride · ' + (b.credits[0].restrictions ?? []).join(' · ') : ''}</Text>
          </Card>
          <Text variant="label" tone="text3">Offers for you</Text>
          {b.offers.map(o => (
            <Card key={o.id} testID={TID.benefits.offer.card} style={{ gap: 4, opacity: o.status === 'used_up' || o.status === 'expired' ? 0.85 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="bodyStrong" style={{ flex: 1 }}>{o.title}</Text><StatusPill status={o.status === 'active' ? 'active' : o.status === 'scheduled' ? 'scheduled' : o.status === 'used_up' ? 'used_up' : 'expired'} /></View>
              <Text variant="caption" tone="text2">{o.description}</Text>
            </Card>
          ))}
          <Text variant="label" tone="text3">Recent changes</Text>
          <Card style={{ paddingVertical: 2 }}>
            {b.changes.map((c, i) => (
              <Row key={c.id} testID={TID.benefits.change.row} last={i === b.changes.length - 1} onPress={() => track('benefit_change_viewed', { changeKind: c.kind })}>
                <StatusPill status={c.kind === 'reversed' ? 'reversed' : c.kind === 'earned' ? 'earned' : 'expired'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodySm">{(c.kind === 'reversed' ? '−' : '+') + new Intl.NumberFormat('en-NG').format(Math.abs(c.amount.amountMinor) / 100) + ' · ' + c.title}</Text>
                  <Text variant="caption" tone="text2">{c.explanation}</Text>
                  {c.termsRef ? <Pressable accessibilityRole="link" onPress={() => nav.navigate('PolicyDoc', { ref: c.termsRef!.url })}><Text variant="caption" tone="link">See the terms{c.disputable ? ' · Dispute' : ''}</Text></Pressable> : null}
                </View>
              </Row>
            ))}
          </Card>
        </>)}
      </Screen>
    </FlagGate>
  );
}
