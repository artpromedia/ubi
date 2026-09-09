import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, useTheme } from '@ubi/mobile-ui';
import { useFlag, track, TID, formatMinor } from '@ubi/mobile-core';
import { TEST_IDS } from '@ubi/contracts';
import { benefitsApi } from '../../api/benefits';

/** Board 20a. Tiles come from flags; Ask UBI is a peer of the conventional entry, never a replacement. */
export function HomeScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (name: string, params?: unknown) => void }>();
  const ask = useFlag('ai_assistant'); const travel = useFlag('flights_booking') || useFlag('stays_booking'); const bites = useFlag('bites'); const send = useFlag('send'); const promos = useFlag('rider_promotions');
  const benefits = useQuery({ queryKey: ['benefits'], queryFn: benefitsApi.get, enabled: promos });
  const tile = (label: string, detail: string, tint: string, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={{ flex: 1, minWidth: '46%' }}>
      <Card><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: tint, marginBottom: 10 }} /><Text variant="bodyStrong">{label}</Text><Text variant="caption" tone="text2">{detail}</Text></Card>
    </Pressable>
  );
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <View><Text variant="caption" tone="text2">Good morning</Text><Text variant="display">Adaeze</Text></View>
      </View>
      <Pressable testID={TEST_IDS.rider.home.whereTo} accessibilityRole="button" accessibilityLabel="Where to? Search a destination" onPress={() => nav.navigate('Ride', { screen: 'Search' })}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary }} /><Text variant="body" style={{ flex: 1 }}>Where to?</Text><View style={{ backgroundColor: t.colors.primaryTint, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 }}><Text variant="bodySmStrong" tone="link">Later</Text></View></Card>
      </Pressable>
      {ask ? (
        <Pressable testID={TID.rider.home.askUbi} accessibilityRole="button" accessibilityLabel="Ask UBI. Plan a trip, check a policy, book with a reviewed confirmation" onPress={() => { track('ask_thread_opened', { source: 'home' }); nav.navigate('Ask', { screen: 'Thread' }); }}>
          <Card tone="inverse" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}>
            <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: t.colors.primary, transform: [{ rotate: '45deg' }] }} />
            <View style={{ flex: 1 }}><Text variant="bodyStrong" tone="onInverse">Ask UBI</Text><Text variant="caption" tone="onInverse2">Plan a trip, check a policy, book with a reviewed confirmation</Text></View>
            <Text variant="heading" tone="onInverse2">›</Text>
          </Card>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {tile('Move', 'Rides now or later', t.colors.primaryTint, () => nav.navigate('Ride', { screen: 'Search' }))}
        {travel ? tile('Flights & stays', 'Domestic flights, hotels', t.colors.travelTint, () => nav.navigate('Travel', { screen: 'FlightSearch' })) : null}
        {bites ? tile('Bites', 'Food from nearby', t.colors.bitesTint, () => nav.navigate('Bites', { screen: 'Restaurants' })) : null}
        {send ? tile('Send', 'Packages across town', t.colors.sendTint, () => nav.navigate('Send', { screen: 'New' })) : null}
      </View>
      {promos && benefits.data ? (
        <Pressable testID={TID.rider.home.benefits} accessibilityRole="button" onPress={() => nav.navigate('Main', { screen: 'Account', params: { screen: 'Benefits' } })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text variant="bodySmStrong">Your benefits</Text><Text variant="caption" tone="text2">{formatMinor(benefits.data.creditTotal) + ' ride credit · ' + benefits.data.offers.filter(o => o.status === 'active').length + ' active offers'}</Text></View><Text variant="bodySmStrong" tone="link">View</Text></Card>
        </Pressable>
      ) : null}
    </Screen>
  );
}
