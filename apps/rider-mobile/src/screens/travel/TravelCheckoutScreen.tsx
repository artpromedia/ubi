import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { TravelStackParamList } from '../../navigation/routes';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, Row, MoneyText, Button, Banner, Skeleton } from '@ubi/mobile-ui';
import { ApiError, TID, track, formatMinor } from '@ubi/mobile-core';
import { travelApi, type Cart } from '../../api/travel';

/** Board 21b — full price and every term before pay. 409 repriced ⇒ show the diff, never charge. */
export function TravelCheckoutScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'Checkout'>>();
  const q = useQuery({ queryKey: ['cart', params.cartId], queryFn: () => travelApi.cart(params.cartId) });
  const [cart, setCart] = useState<Cart | undefined>(); const [repriced, setRepriced] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | undefined>();
  const c = cart ?? q.data;
  React.useEffect(() => { if (c) track('travel_checkout_viewed', { cartId: c.id, items: c.items.length, totalMinor: c.total.amountMinor }); }, [c?.id]);
  const pay = () => { if (!c) return; nav.navigate('SecureConfirm', { purpose: 'Pay ' + formatMinor(c.total), onProof: async (proof: string) => {
    setBusy(true); setErr(undefined);
    try { const r = await travelApi.checkout(c.id, c.paymentMethod.id, proof, c.total); track('travel_checkout_paid', { cartId: c.id, totalMinor: c.total.amountMinor }); nav.navigate('OrderStatus', { orderId: r.orders[0].id }); }
    catch (e) { if (e instanceof ApiError && e.status === 409) { const fresh = e.details as Cart; setCart(fresh); setRepriced(true); track('travel_checkout_repriced', { cartId: c.id, diffMinor: fresh.total.amountMinor - c.total.amountMinor }); } else setErr('Payment could not start. Nothing was charged.'); }
    finally { setBusy(false); }
  } }); };
  return (
    <Screen title="Review & pay" onBack={nav.goBack} footer={c ? <View style={{ gap: 8 }}><Button testID={TID.travel.checkout.payPin} label={'Pay ' + formatMinor(c.total) + ' with PIN'} loading={busy} onPress={pay} /><Text variant="caption" tone="text2" align="center">Prices are checked once more with the suppliers before charging. If anything changed, you'll see it first.</Text></View> : undefined}>
      {!c ? <Skeleton height={260} /> : (<>
        {repriced ? <Banner tone="warn" title="A price changed before booking" body={'Was ' + formatMinor(c.previousTotal) + ', now ' + formatMinor(c.total) + '. Nothing was charged. Review and pay again if you agree.'} /> : null}
        {err ? <Banner tone="error" body={err} /> : null}
        <Card testID={TID.travel.checkout.breakdown} style={{ paddingVertical: 2 }}>
          {c.items.map(it => <Row key={it.title}><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodySmStrong">{it.title}</Text><View style={{ alignItems: 'flex-end' }}>{it.previousPrice ? <MoneyText money={it.previousPrice} variant="caption" tone="text3" struck /> : null}<MoneyText money={it.price} variant="bodySmStrong" /></View></View><Text variant="caption" tone="text2">{it.detail}</Text></View></Row>)}
          {c.fees.map(fe => <Row key={fe.label} label={fe.label} value={<MoneyText money={fe.amount} variant="bodySmStrong" />} />)}
          {c.adjustments.map(a => <Row key={a.label} label={a.label} value={a.amount ? <MoneyText money={a.amount} variant="bodySmStrong" tone="primaryInk" /> : <Text variant="bodySmStrong" tone="text2">{a.note}</Text>} />)}
          <Row last><Text variant="bodyStrong" style={{ flex: 1 }}>Total now</Text><MoneyText money={c.total} variant="bodyStrong" /></Row>
        </Card>
        <Card style={{ gap: 6 }}><Text variant="label" tone="text2">Terms you're agreeing to</Text>{c.termsSummary.map(s => <Text key={s} variant="caption">{s}</Text>)}<Text variant="caption" tone="link">{c.termsLinks.join(' · ')}</Text></Card>
        <Card><Row last onPress={() => nav.navigate('PaymentMethodPicker', { cartId: c.id })}><View style={{ flex: 1 }}><Text variant="bodySmStrong">{c.paymentMethod.label}</Text><Text variant="caption" tone="text2">{c.paymentMethod.detail}</Text></View><Text variant="bodySmStrong" tone="link">Change</Text></Row></Card>
      </>)}
    </Screen>
  );
}
