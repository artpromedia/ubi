// Design handoff R05 + R09 (handoff-marketplace/rn/rider/BidDetailScreen.tsx), adapted only for repo imports and contracts TEST_IDS.
import React from 'react';
import { View, Pressable } from 'react-native';
import { Screen, Text, Card, Button, Banner, Ladder, Row, MoneyText, useTheme, type LadderStep } from '@ubi/mobile-ui';
import type { Money } from '@ubi/mobile-core';
import { TEST_IDS, dynamicTestId } from '@ubi/contracts';

/** R05 + R09. Selection carries requestVersion + bidVersion; success renders ONLY on award.confirmed. */
export type BidDetailProps = {
  driver: { name: string; rating: string; trips: number; vehicle: string; plateMasked: string; initials: string };
  // bookingFee/total are server-computed; null renders "—" until the contract carries them (never client-added).
  bid: { bidId: string; bidVersion: number; requestVersion: number; amountMinor: Money; bookingFeeMinor: Money | null; totalMinor: Money | null; paymentLabel: string };
  slot: 'current' | 'next'; // 'next' → R09 finishing-trip variant
  window: { label: string; consentCopy: string; consented: boolean; onToggle: () => void } | null; // required when slot==='next'
  whyRecommended: string | null; // disclosed criteria, never sponsored
  widenedBanner: string | null;
  compareLine: string | null; // e.g. "Compare: Tunde (immediate) · ₦3,000 · 3 min"
  phase: 'detail' | 'award_pending' | 'award_failed';
  awardSteps: LadderStep[]; // server-driven: confirmed / authorizing / assigning
  failReason: string | null; // award_failed → request reopened if still valid
  onChoose: () => void; onBack: () => void;
};

export function BidDetailScreen(p: BidDetailProps) {
  const t = useTheme();
  const consentMissing = p.slot === 'next' && p.window ? !p.window.consented : false;
  return (
    <Screen title={p.driver.name.split(' ')[0] + '’s offer'} onBack={p.onBack}>
      {p.slot === 'next' && p.window ? <Banner tone="info" title="Finishing a trip nearby" body={'Pickup window ' + p.window.label + '. The driver can’t start toward you before finishing the current trip.'} /> : null}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}><Text variant="heading">{p.driver.initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{p.driver.name} · ★ {p.driver.rating} ({p.driver.trips.toLocaleString()} trips)</Text>
          <Text variant="caption" tone="text2">{p.driver.vehicle}</Text>
          <Text variant="mono">{p.driver.plateMasked}</Text>
        </View>
      </Card>
      <Card>
        <Row label={'Offer · v' + p.bid.bidVersion + ' (latest)'} value={<MoneyText money={p.bid.amountMinor} variant="bodySmStrong" />} />
        <Row label="Booking fee" value={<MoneyText money={p.bid.bookingFeeMinor} variant="bodySmStrong" />} />
        <Row label="Total you pay" value={<MoneyText money={p.bid.totalMinor} variant="heading" />} />
        <Row label="Payment" value={p.bid.paymentLabel} last />
      </Card>
      <Banner tone="ok" body="The agreed total is fixed. Traffic or a longer route won’t change it." />
      {p.compareLine ? <Text variant="caption" tone="text2">{p.compareLine}</Text> : null}
      {p.slot === 'next' && p.window ? (
        <Pressable testID={TEST_IDS.mp.rider.bid.windowConsent} accessibilityRole="checkbox" accessibilityState={{ checked: p.window.consented }} onPress={p.window.onToggle}>
          <Card style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: p.window.consented ? t.colors.primary : t.colors.border, backgroundColor: p.window.consented ? t.colors.primaryTint : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{p.window.consented ? <Text variant="label" tone="ok">✓</Text> : null}</View>
            <Text variant="bodySm" style={{ flex: 1 }}>{p.window.consentCopy}</Text>
          </Card>
        </Pressable>
      ) : null}
      {p.whyRecommended ? <Card testID={TEST_IDS.mp.rider.bid.whyRecommended} style={{ borderStyle: 'dashed', borderColor: t.colors.text3, borderWidth: 1 }}><Text variant="label" tone="text2">Why recommended</Text><Text variant="caption">{p.whyRecommended}</Text></Card> : null}
      {p.widenedBanner ? <Banner tone="warn" body={p.widenedBanner} /> : null}
      {p.phase === 'award_pending' ? (
        <Card><Ladder steps={p.awardSteps} /><Text variant="caption" tone="text2" style={{ marginTop: 8 }}>Usually takes a few seconds. Other offers stay open until this succeeds.</Text></Card>
      ) : null}
      {p.phase === 'award_failed' && p.failReason ? <Banner tone="error" title="Couldn’t confirm this driver" body={p.failReason} /> : null}
      <Button testID={TEST_IDS.mp.rider.bid.back} label="Back to offers" kind="secondary" onPress={p.onBack} />
      <Button
        testID={TEST_IDS.mp.rider.bid.choose}
        label={p.phase === 'award_pending' ? 'Choosing…' : 'Choose ' + p.driver.name.split(' ')[0] + (p.slot === 'next' ? ' · window accepted' : '')}
        loading={p.phase === 'award_pending'}
        disabled={consentMissing || p.phase === 'award_pending'}
        onPress={p.onChoose}
      />
    </Screen>
  );
}
