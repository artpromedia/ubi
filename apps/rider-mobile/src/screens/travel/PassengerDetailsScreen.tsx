import React, { useState } from 'react';
import { View, TextInput } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation } from '@tanstack/react-query';
import { Screen, Text, Button, Toggle, Card, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import { travelApi } from '../../api/travel';

/** Board 21b — as on the ID shown at the airport. Identity prefill comes from KYC as an opaque reference; documents are never forwarded. */
export function PassengerDetailsScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { cartId: string; index: number } }>();
  const [p, setP] = useState({ givenNames: 'Adaeze Chioma', surname: 'Nwosu', title: 'Ms', dateOfBirth: '1994-03-14', phone: '+234 813 ••• 2291', identityRef: 'kyc_ref', save: true, useVerified: true });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: () => travelApi.putPassengers(params.cartId, [p]), onSuccess: () => nav.navigate('Checkout', { cartId: params.cartId }) });
  const submit = () => { const e: Record<string, string> = {}; if (!/^[A-Za-z' -]{2,}$/.test(p.givenNames)) e.givenNames = 'Letters only, as on your ID'; if (!/^[A-Za-z' -]{2,}$/.test(p.surname)) e.surname = 'Letters only, as on your ID'; setErr(e); if (!Object.keys(e).length) save.mutate(); };
  const input = (label: string, key: keyof typeof p, testID?: string, extra?: object) => (
    <View style={{ gap: 6 }}><Text variant="label" tone="text2">{label}</Text>
      <TextInput testID={testID} accessibilityLabel={label} value={String(p[key])} onChangeText={v => setP({ ...p, [key]: v })} editable={!p.useVerified || (key !== 'givenNames' && key !== 'surname' && key !== 'dateOfBirth')} style={{ paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: err[key as string] ? t.colors.error : t.colors.border, borderRadius: t.radius.control, fontFamily: 'Inter-Medium', fontSize: 15, color: t.colors.text }} {...extra} />
      {err[key as string] ? <Text variant="caption" tone="errorInk">{err[key as string]}</Text> : null}
    </View>
  );
  return (
    <Screen title="Who's flying?" subtitle="Exactly as on the ID you'll show at the airport. Airlines charge to correct a name after ticketing." onBack={nav.goBack} bg="bg" footer={<Button testID={TID.flights.passenger.continue} label="Continue to payment" kind="inverse" loading={save.isPending} onPress={submit} />}>
      <Card tone="ok" style={{ backgroundColor: t.colors.primaryTint }}><Toggle label="Use my verified identity" detail="Name and date of birth from your NIN check · no document is sent to the airline" value={p.useVerified} onChange={v => setP({ ...p, useVerified: v })} /></Card>
      {input('Given names', 'givenNames', TID.flights.passenger.givenName)}
      {input('Surname', 'surname')}
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}>{input('Date of birth', 'dateOfBirth')}</View><View style={{ flex: 1 }}>{input('Title', 'title')}</View></View>
      {input('Phone for airline updates', 'phone', undefined, { keyboardType: 'phone-pad' })}
      <Toggle label="Save as a passenger" detail="For next time and for automations" value={p.save} onChange={v => setP({ ...p, save: v })} />
    </Screen>
  );
}
