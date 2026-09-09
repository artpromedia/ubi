import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, Row, MoneyText, Skeleton, StatusPill } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import { incentivesApi, type StatementLine } from '../../api/incentives';

const toneOf = (l: StatementLine) => l.tone === 'positive' ? 'ok' : l.tone === 'negative' ? 'errorInk' : l.tone === 'warning' ? 'warnInk' : 'text';
/** Board 22d (statement) — every line is a ledger line; rebate, window waiver and reversal are their own rows; totals come from the server. */
export function StatementScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { periodId: string } }>();
  const q = useQuery({ queryKey: ['statement', params.periodId], queryFn: () => incentivesApi.statement(params.periodId) });
  const s = q.data;
  React.useEffect(() => { if (s) track('driver_statement_viewed', { periodId: s.periodId, status: s.status }); }, [s?.periodId]);
  return (
    <Screen title={s?.title ?? 'Statement'} subtitle={s ? 'Pays ' + new Date(s.paysAt).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' · ' + s.tripCount + ' trips so far' : undefined} onBack={nav.goBack} action={{ label: 'Export PDF', onPress: () => {}, testID: TID.driver.earnings.statement }}>
      {!s ? <Skeleton height={320} /> : (<>
        <StatusPill status={s.status === 'paid' ? 'done' : s.status === 'finalised' ? 'confirmed' : 'processing'} suffix={s.status} />
        <Card style={{ paddingVertical: 2 }}>
          {s.lines.map((l, i) => <Row key={l.ledgerLineId} label={l.label} value={<MoneyText money={l.amount} variant={l.kind === 'payout' ? 'bodyStrong' : 'bodySmStrong'} tone={toneOf(l)} signed={l.tone === 'positive'} />} last={i === s.lines.length - 1} />)}
        </Card>
        <Text variant="label" tone="text3">Trips · tap for each line</Text>
        <Card testID={TID.driver.earnings.breakdown} style={{ paddingVertical: 2 }}>
          {s.trips.map((tr, i) => (
            <Row key={tr.tripId} last={i === s.trips.length - 1} onPress={() => nav.navigate('TripDetail', { tripId: tr.tripId })}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodySm">{tr.title} · {tr.paymentMethod}</Text><Text variant="bodySm" tabular>{formatMinor(tr.fare)}{tr.refunded ? ' ' : ''}{tr.refunded ? <Text variant="bodySm" tone="errorInk">refunded</Text> : null}</Text></View>
                <Text variant="caption" tone="text2">Commission {formatMinor(tr.commission)}{tr.windowWaiver ? ' → ' : ''}{tr.windowWaiver ? <Text variant="caption" tone="ok">₦0 ({tr.windowNote})</Text> : null}{tr.rebate ? ' · rebate ' : ''}{tr.rebate ? <Text variant="caption" tone="ok">{formatMinor(tr.rebate, {}, { signed: true })}</Text> : null} · owed to UBI {formatMinor(tr.owedToUbi)}{tr.reversal ? ' · ' : ''}{tr.reversal ? <Text variant="caption" tone="errorInk">rebate reversed {formatMinor({ amountMinor: -tr.reversal.amount.amountMinor, currency: tr.reversal.amount.currency })} · {tr.reversal.reason}</Text> : null}</Text>
              </View>
            </Row>
          ))}
        </Card>
      </>)}
    </Screen>
  );
}
