import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme, FlagGate } from '@ubi/mobile-ui';
import { linking } from './linking';
import type { RootStackParamList, MainTabParamList, AskStackParamList, TravelStackParamList, AccountStackParamList } from './routes';
import { HomeScreen } from '../screens/home/HomeScreen';
import { AskScreen } from '../screens/ask/AskScreen';
import { ExecutionStatusScreen } from '../screens/ask/ExecutionStatusScreen';
import { MandatesScreen } from '../screens/automation/MandatesScreen';
import { MandateEditorScreen } from '../screens/automation/MandateEditorScreen';
import { MandateReceiptScreen } from '../screens/automation/MandateReceiptScreen';
import { BenefitsScreen } from '../screens/benefits/BenefitsScreen';
import { ReferralsScreen } from '../screens/benefits/ReferralsScreen';
import { FlightSearchScreen } from '../screens/travel/FlightSearchScreen';
import { FlightResultsScreen } from '../screens/travel/FlightResultsScreen';
import { StayRoomsScreen } from '../screens/travel/StayRoomsScreen';
import { PassengerDetailsScreen } from '../screens/travel/PassengerDetailsScreen';
import { TravelCheckoutScreen } from '../screens/travel/TravelCheckoutScreen';
import { OrderStatusScreen } from '../screens/travel/OrderStatusScreen';
import { ItineraryScreen } from '../screens/travel/ItineraryScreen';
import { RefundStatusScreen } from '../screens/travel/RefundStatusScreen';
import { DisruptionScreen } from '../screens/travel/DisruptionScreen';
import { AttachAirportRideScreen } from '../screens/travel/AttachAirportRideScreen';
import { LinkedOrdersScreen } from '../screens/travel/LinkedOrdersScreen';
// RN-01 ports: Splash, Onboarding, Auth, Ride, Bites, Send, Wallet, Activity, Account.Profile/Edit/Places/Payments/Settings, Sos, SecureConfirm (see MIGRATION_MAP.md).
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const AskStack = createNativeStackNavigator<AskStackParamList>();
const TravelStack = createNativeStackNavigator<TravelStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();

function AccountNavigator() {
  return (
    <AccountStack.Navigator screenOptions={{ headerShown: false }}>
      <AccountStack.Screen name="Profile" component={PlaceholderScreen} initialParams={{ port: 'RN-01 profile 13a' } as never} />
      <AccountStack.Screen name="Benefits" component={BenefitsScreen} />
      <AccountStack.Screen name="Referrals" component={ReferralsScreen} />
      <AccountStack.Screen name="Automation" component={MandatesScreen} />
      <AccountStack.Screen name="MandateEditor" component={MandateEditorScreen} />
      <AccountStack.Screen name="MandateReceipt" component={MandateReceiptScreen} />
      <AccountStack.Screen name="Edit" component={PlaceholderScreen} />
      <AccountStack.Screen name="Places" component={PlaceholderScreen} />
      <AccountStack.Screen name="Payments" component={PlaceholderScreen} />
      <AccountStack.Screen name="Settings" component={PlaceholderScreen} />
    </AccountStack.Navigator>
  );
}
function MainTabs() {
  const t = useTheme();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: t.colors.text, tabBarInactiveTintColor: t.colors.text3, tabBarStyle: { backgroundColor: t.colors.bg, borderTopColor: t.colors.border, height: 84, paddingTop: 8 }, tabBarLabelStyle: { fontFamily: 'Inter-SemiBold', fontSize: 10.5 } }}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Activity" component={PlaceholderScreen} />
      <Tabs.Screen name="Wallet" component={PlaceholderScreen} />
      <Tabs.Screen name="Account" component={AccountNavigator} />
    </Tabs.Navigator>
  );
}
function AskNavigator({ navigation }: { navigation: { navigate: (s: 'Main') => void } }) {
  return (
    <FlagGate flag="ai_assistant" featureName="Ask UBI" onDismiss={() => navigation.navigate('Main')}>
      <AskStack.Navigator screenOptions={{ headerShown: false }}>
        <AskStack.Screen name="Thread" component={AskScreen} />
        <AskStack.Screen name="Execution" component={ExecutionStatusScreen} />
      </AskStack.Navigator>
    </FlagGate>
  );
}
function TravelNavigator({ navigation }: { navigation: { navigate: (s: 'Main') => void } }) {
  return (
    <FlagGate flag="flights_booking" featureName="Flights & stays" onDismiss={() => navigation.navigate('Main')}>
      <TravelStack.Navigator screenOptions={{ headerShown: false }}>
        <TravelStack.Screen name="FlightSearch" component={FlightSearchScreen} />
        <TravelStack.Screen name="FlightResults" component={FlightResultsScreen} />
        <TravelStack.Screen name="StaySearch" component={PlaceholderScreen} />
        <TravelStack.Screen name="StayRooms" component={StayRoomsScreen} />
        <TravelStack.Screen name="PassengerDetails" component={PassengerDetailsScreen} />
        <TravelStack.Screen name="Checkout" component={TravelCheckoutScreen} />
        <TravelStack.Screen name="OrderStatus" component={OrderStatusScreen} />
        <TravelStack.Screen name="Itinerary" component={ItineraryScreen} />
        <TravelStack.Screen name="Servicing" component={PlaceholderScreen} />
        <TravelStack.Screen name="RefundStatus" component={RefundStatusScreen} />
        <TravelStack.Screen name="Disruption" component={DisruptionScreen} />
        <TravelStack.Screen name="AttachAirportRide" component={AttachAirportRideScreen} />
        <TravelStack.Screen name="LinkedOrders" component={LinkedOrdersScreen} />
      </TravelStack.Navigator>
    </FlagGate>
  );
}
export function RootNavigator() {
  const t = useTheme();
  const navTheme = t.mode === 'dark' ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.colors.bg } } : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: t.colors.bg2 } };
  return (
    <NavigationContainer linking={linking} theme={navTheme}>
      <Root.Navigator screenOptions={{ headerShown: false }} initialRouteName="Main">
        <Root.Screen name="Splash" component={PlaceholderScreen} />
        <Root.Screen name="Onboarding" component={PlaceholderScreen} />
        <Root.Screen name="Auth" component={PlaceholderScreen} />
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Ride" component={PlaceholderScreen} />
        <Root.Screen name="Bites" component={PlaceholderScreen} />
        <Root.Screen name="Send" component={PlaceholderScreen} />
        <Root.Screen name="Ask" component={AskNavigator as never} />
        <Root.Screen name="Travel" component={TravelNavigator as never} />
        <Root.Screen name="FlagOff" component={PlaceholderScreen} />
        <Root.Group screenOptions={{ presentation: 'modal' }}>
          <Root.Screen name="Sos" component={PlaceholderScreen} />
          <Root.Screen name="SecureConfirm" component={PlaceholderScreen} />
        </Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
