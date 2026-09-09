import React from 'react';
import { View } from 'react-native';
import { Card, Text, StatusPill, MoneyText, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { Card as CardDto } from '../../api/ask';

function ageLabel(iso?: string) { if (!iso) return undefined; const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? s + 's' : Math.round(s / 60) + 'm'; }
/** LIVE PRICE card (board 20a). Header carries the status word and the quote age; warnings come from the adapter, never client copy. */
export function QuoteCard({ card }: { card: CardDto }) {
  const t = useTheme();
  return (
    <View testID={TID.ask.plan.card} accessibilityLabel={card.title + ', ' + (card.status === 'live' ? 'live price' : card.status)} style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.cardLg, overflow: 'hidden' }}>
      <View style={{ backgroundColor: card.status === 'expired' ? t.colors.bg2 : t.colors.travelTint, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StatusPill status={card.status === 'live' ? 'live' : 'expired'} suffix={card.status === 'live' ? ageLabel(card.quotedAt) : undefined} />
        <Text variant="caption" tone="travelInk" style={{ flex: 1 }}>{card.subtitle}</Text>
        {card.price ? <MoneyText money={card.price} variant="bodySmStrong" /> : null}
      </View>
      <View style={{ padding: 12, gap: 4, backgroundColor: t.colors.card }}>
        <Text variant="bodyStrong">{card.title}</Text>
        {card.warnings?.map(w => <Text key={w} variant="caption" tone="warnInk">{w}</Text>)}
      </View>
    </View>
  );
}
export function SuggestionCard({ card }: { card: CardDto }) {
  const t = useTheme();
  return (
    <View testID={TID.ask.plan.card} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.text3, borderRadius: t.radius.cardLg, padding: 12, gap: 6, backgroundColor: t.colors.bg2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><StatusPill status="suggestion" /><Text variant="caption" tone="text2">{card.subtitle}</Text></View>
      <Text variant="bodySm">{card.title}</Text>
    </View>
  );
}
export function PlanCard({ card }: { card: CardDto }) { return card.status === 'suggestion' ? <SuggestionCard card={card} /> : <QuoteCard card={card} />; }
export { Card };
