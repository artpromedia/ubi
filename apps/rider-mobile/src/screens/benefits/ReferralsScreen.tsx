import React from 'react';
import { View, Share, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Button, Row, Skeleton, FlagGate, useTheme } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import { benefitsApi, type Referral } from '../../api/benefits';

const pill = (s: Referral['stage']) => s === 'rewarded' ? 'rewarded' : s === 'in_review' ? 'in_review' : s === 'reversed' ? 'reversed' : s === 'expired' ? 'expired' : 'qualifying';
/** Board 22b — share + honest per-friend status. Household sharing never disqualifies by itself; a person reviews unusual patterns. */
export function ReferralsScreen() {
  const t = useTheme();
  const nav = useNavigation<{ goBack: () => void }>();
  const q = useQuery({ queryKey: ['referrals'], queryFn: benefitsApi.referrals });
  const p = q.data;
  const share = async (channel: string) => { if (!p) return; track('referral_shared', { channel }); await Share.share({ message: 'Ride with UBI — ' + formatMinor(p.refereeBenefit) + ' off your first ride: ' + p.url }); };
  return (
    <FlagGate flag="referrals" featureName="Referrals" onDismiss={nav.goBack}>
      <Screen title="Invite friends" onBack={nav.goBack}>
        {!p ? <Skeleton height={160} /> : (<>
          <Text variant="bodySm" tone="text2">You get <Text variant="bodySmStrong">{formatMinor(p.reward)} ride credit</Text> when a friend completes and pays for their first ride within 30 days. They get {formatMinor(p.refereeBenefit)} off it. Up to {String(p.monthlyCap)} friends a month.</Text>
          <Card testID={TID.referrals.share.card} style={{ gap: 10 }}>
            <Pressable testID={TID.referrals.share.link} accessibilityRole="button" accessibilityLabel={'Your code ' + p.code + '. Copy'} onPress={() => share('copy')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: t.radius.control, backgroundColor: t.colors.bg2 }}><Text variant="mono" style={{ letterSpacing: 1 }}>{p.code}</Text><Text variant="bodySmStrong" tone="link">Copy</Text></Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Share link" kind="inverse" size="md" style={{ flex: 1 }} onPress={() => share('system')} /><Button label="WhatsApp" kind="secondary" size="md" onPress={() => share('whatsapp')} /></View>
            <Text variant="caption" tone="text2">{p.url} · opens the app if installed, otherwise the store — your code carries over either way.</Text>
          </Card>
          <Text variant="label" tone="text3">Your referrals · {String(p.referrals.length)} · {formatMinor(p.earnedTotal)} earned</Text>
          <Card testID={TID.referrals.status.list} style={{ paddingVertical: 2 }}>
            {p.referrals.map((r, i) => (
              <Row key={r.id} last={i === p.referrals.length - 1}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: r.stage === 'rewarded' ? t.colors.primaryTint : t.colors.bg2, alignItems: 'center', justifyContent: 'center' }}><Text variant="label" tone={r.stage === 'rewarded' ? 'primaryInk' : 'text2'}>{r.initials}</Text></View>
                <View style={{ flex: 1 }}><Text variant="bodySm">{r.displayName}</Text><Text variant="caption" tone="text2">{r.detail}</Text></View>
                <StatusPill status={pill(r.stage)} />
              </Row>
            ))}
          </Card>
          <Text variant="caption" tone="text2">{p.note}</Text>
        </>)}
      </Screen>
    </FlagGate>
  );
}
