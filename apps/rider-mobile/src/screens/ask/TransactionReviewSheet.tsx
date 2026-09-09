import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Sheet, Text, StatusPill, MoneyText, Button, Row, Skeleton, Banner, useTheme } from '@ubi/mobile-ui';
import { ApiError, track, TID } from '@ubi/mobile-core';
import { askApi, type Review, type ReviewItem } from '../../api/ask';

function useCountdown(iso?: string) { const [left, setLeft] = useState(0); useEffect(() => { if (!iso) return; const id = setInterval(() => setLeft(Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000))), 500); return () => clearInterval(id); }, [iso]); return left; }
const mmss = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

function ItemBlock({ item }: { item: ReviewItem }) {
  const t = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.card, padding: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodySmStrong">{item.title}</Text><MoneyText money={item.price} variant="bodySmStrong" /></View>
      {item.detail ? <Text variant="caption" tone="text2">{item.detail}</Text> : null}
      {item.priceBreakdown?.length ? <Text variant="caption" tone="text2">{item.priceBreakdown.map(b => b.label).join(' · ')}</Text> : null}
      {item.terms.map(tm => <Text key={tm.text} variant="caption" tone={tm.tone === 'warning' ? 'errorInk' : tm.tone === 'positive' ? 'primaryInk' : 'text2'}>{tm.text}</Text>)}
    </View>
  );
}
/** Board 20b — AWAITING YOUR CONFIRMATION. Exact terms, terms version, countdown; PIN via SecureConfirm; 409 ⇒ show the new review, never charge. */
export function TransactionReviewSheet({ reviewId, onDismiss, onExecuting }: { reviewId: string; onDismiss: () => void; onExecuting: (executionId: string) => void }) {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const [id, setId] = useState(reviewId);
  const q = useQuery({ queryKey: ['review', id], queryFn: () => askApi.getReview(id) });
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | undefined>();
  const left = useCountdown(q.data?.expiresAt);
  const expired = q.data ? left === 0 || q.data.status !== 'awaiting_confirmation' : false;
  useEffect(() => { if (left === 60 || left === 10) { /* announce via AccessibilityInfo.announceForAccessibility in RN-01 */ } if (expired && q.data) track('ask_review_expired', { reviewId: id }); }, [left, expired]);

  const confirm = () => {
    if (!q.data) return;
    nav.navigate('SecureConfirm', { purpose: 'Confirm booking · ' + q.data.total.amountMinor, onProof: async (proof: string) => {
      setBusy(true);
      try { const r = await askApi.confirmReview(id, q.data!.termsVersion, proof); track('ask_review_confirmed', { reviewId: id, items: q.data!.items.length, totalMinor: q.data!.total.amountMinor, termsVersion: q.data!.termsVersion }); onExecuting(r.executionId); }
      catch (e) { if (e instanceof ApiError && e.status === 409) { const fresh = e.details as Review; setId(fresh.id); setNotice('A price or term changed before booking. Nothing was charged — here are the new terms.'); } else if (e instanceof ApiError && e.status === 410) { setNotice('This review expired. Ask again for fresh prices.'); } else { setNotice('We could not confirm right now. Nothing was charged.'); } }
      finally { setBusy(false); }
    } });
  };
  const r = q.data;
  return (
    <Sheet visible onDismiss={onDismiss} testID={TID.ask.review.sheet}>
      {!r ? <View style={{ gap: 10 }}><Skeleton height={20} width="50%" /><Skeleton height={90} /><Skeleton height={90} /></View> : (
        <View style={{ gap: 8 }}>
          {notice ? <Banner tone="warn" body={notice} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><StatusPill status={expired ? 'expired' : 'awaiting_confirmation'} /><Text variant="caption" tone="text2">Terms v. {r.termsVersion}{!expired ? ' · prices held for ' + mmss(left) : ''}</Text></View>
          <Text variant="title">Book {String(r.items.length)} {r.items.length === 1 ? 'item' : 'items'} · <MoneyText money={r.total} variant="title" /></Text>
          {r.items.map(it => <ItemBlock key={it.title} item={it} />)}
          <View>
            <Row label="Savings applied" value={r.adjustments?.length ? <MoneyText money={{ amountMinor: -r.adjustments.reduce((_, a) => a.amount.amountMinor, 0), currency: r.total.currency }} variant="bodySmStrong" tone="primaryInk" /> : <Text variant="bodySmStrong" tone="text2">none eligible</Text>} />
            <Row label="Pay with" value={r.paymentMethod.label} last />
          </View>
          {(r.notes ?? ['Each item is booked separately. If one fails, you are charged only for what was confirmed. If a price changes before booking, we stop and ask you again.']).map(n => <Text key={n} variant="caption" tone="text2">{n}</Text>)}
          <Button testID={TID.ask.review.confirmPin} label={expired ? 'Ask again for fresh prices' : 'Confirm with PIN'} trailing={expired ? undefined : undefined} loading={busy} kind={expired ? 'inverse' : 'primary'} onPress={expired ? onDismiss : confirm} />
          <Button testID={TID.ask.review.dismiss} label="Not now" kind="ghost" size="md" onPress={onDismiss} />
        </View>
      )}
    </Sheet>
  );
}
