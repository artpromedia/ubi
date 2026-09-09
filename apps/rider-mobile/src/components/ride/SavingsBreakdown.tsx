import React from 'react';
import { View } from 'react-native';
import { Text, MoneyText, Banner, useTheme } from '@ubi/mobile-ui';
import { TID, type Money } from '@ubi/mobile-core';
import type { Adjustment } from '../../api/ask';

/** Board 22a — every saving is its own server line; the client never sums. Struck fee + "waived" for fee_waiver; reasonCode rows are struck with the reason. */
export function SavingsBreakdown({ fare, adjustments, payable, paymentLabel, note }: { fare: Money; adjustments: Adjustment[]; payable: Money; paymentLabel: string; note?: string }) {
  const t = useTheme();
  const row = (label: React.ReactNode, value: React.ReactNode) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>{label}{value}</View>;
  return (
    <View testID={TID.rider.quote.savings} style={{ borderTopWidth: 1, borderTopColor: t.colors.divider, paddingTop: 10, marginTop: 10 }}>
      {row(<Text variant="caption">Fare</Text>, <MoneyText money={fare} variant="caption" />)}
      {adjustments.map(a => a.reasonCode
        ? row(<Text variant="caption" tone="text3" style={{ textDecorationLine: 'line-through' }}>{a.label}</Text>, <Text variant="caption" tone="text3">{a.reasonCode === 'budget_exhausted' ? 'budget used up' : a.reasonCode === 'min_spend_not_met' ? 'min spend not met' : a.reasonCode.replace(/_/g, ' ')}</Text>)
        : a.type === 'fee_waiver'
          ? row(<Text variant="caption">{a.label}</Text>, <Text variant="caption"><MoneyText money={a.amount} variant="caption" tone="text3" struck /> <Text variant="caption" tone="primaryInk">waived</Text></Text>)
          : row(<Text variant="caption" tone="primaryInk">{a.label}{a.capNote ? ' (' + a.capNote + ')' : ''}</Text>, <MoneyText money={{ amountMinor: -Math.abs(a.amount.amountMinor), currency: a.amount.currency }} variant="caption" tone="primaryInk" />))}
      {row(<Text variant="bodySmStrong">You pay</Text>, <Text variant="bodySmStrong"><MoneyText money={payable} variant="bodySmStrong" /> · {paymentLabel}</Text>)}
      {note ? <Text variant="caption" tone="text2" style={{ marginTop: 6 }}>{note}</Text> : null}
    </View>
  );
}
export function SavingsChangedBanner({ text }: { text: string }) { return <Banner testID={TID.rider.quote.savingsChanged} tone="warn" body={text} />; }
