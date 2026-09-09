import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme, FlagGate } from '@ubi/mobile-ui';
import type { RootStackParamList, MainTabParamList, IncentivesStackParamList, EarningsStackParamList } from './routes';
import { HomeScreen } from '../screens/home/HomeScreen';
import { IncentivesScreen } from '../screens/incentives/IncentivesScreen';
import { CommissionDetailScreen } from '../screens/incentives/CommissionDetailScreen';
import { StatementScreen } from '../screens/earnings/StatementScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen'; // RN-02 ports: auth, offer, trip execution, documents, profile, fleet arrangement, safety

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const Inc = createNativeStackNavigator<IncentivesStackParamList>();
const Earn = createNativeStackNavigator<EarningsStackParamList>();
function IncentivesNavigator({ navigation }: { navigation: { navigate: (s: 'Main') => void } }) {
  return (
    <FlagGate flag="driver_commission_rebates" featureName="Incentives" onDismiss={() => navigation.navigate('Main')}>
      <Inc.Navigator screenOptions={{ headerShown: false }}>
        <Inc.Screen name="Overview" component={IncentivesScreen} />
        <Inc.Screen name="CommissionDetail" component={CommissionDetailScreen} />
        <Inc.Screen name="Referrals" component={PlaceholderScreen} />
        <Inc.Screen name="Window" component={PlaceholderScreen} />
      </Inc.Navigator>
    </FlagGate>
  );
}
function EarningsNavigator() {
  return (<Earn.Navigator screenOptions={{ headerShown: false }}><Earn.Screen name="Overview" component={PlaceholderScreen} /><Earn.Screen name="Statement" component={StatementScreen} /><Earn.Screen name="TripDetail" component={PlaceholderScreen} /><Earn.Screen name="Payouts" component={PlaceholderScreen} /><Earn.Screen name="Cashout" component={PlaceholderScreen} /></Earn.Navigator>);
}
function MainTabs() {
  const t = useTheme();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: t.colors.text, tabBarInactiveTintColor: t.colors.text3, tabBarStyle: { backgroundColor: t.colors.bg2, borderTopColor: t.colors.border, height: 84, paddingTop: 8 }, tabBarLabelStyle: { fontFamily: 'Inter-SemiBold', fontSize: 10.5 } }}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Earnings" component={EarningsNavigator} />
      <Tabs.Screen name="Incentives" component={IncentivesNavigator as never} />
      <Tabs.Screen name="Account" component={PlaceholderScreen} />
    </Tabs.Navigator>
  );
}
export function RootNavigator() {
  const t = useTheme();
  return (
    <NavigationContainer theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: t.colors.bg } }}>
      <Root.Navigator screenOptions={{ headerShown: false }} initialRouteName="Main">
        <Root.Screen name="Splash" component={PlaceholderScreen} /><Root.Screen name="Onboarding" component={PlaceholderScreen} /><Root.Screen name="Auth" component={PlaceholderScreen} />
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Trip" component={PlaceholderScreen} />
        <Root.Screen name="FlagOff" component={PlaceholderScreen} />
        <Root.Group screenOptions={{ presentation: 'modal' }}><Root.Screen name="Sos" component={PlaceholderScreen} /><Root.Screen name="SecureConfirm" component={PlaceholderScreen} /></Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
