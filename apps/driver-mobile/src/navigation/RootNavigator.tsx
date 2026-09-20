import React from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  createBottomTabNavigator,
  type BottomTabScreenProps,
} from "@react-navigation/bottom-tabs";
import { useTheme, FlagGate } from "@ubi/mobile-ui";
import type {
  RootStackParamList,
  MainTabParamList,
  IncentivesStackParamList,
  EarningsStackParamList,
  RequestsStackParamList,
} from "./routes";
import { HomeScreen } from "../screens/home/HomeScreen";
import { IncentivesScreen } from "../screens/incentives/IncentivesScreen";
import { CommissionDetailScreen } from "../screens/incentives/CommissionDetailScreen";
import { StatementScreen } from "../screens/earnings/StatementScreen";
import { MarketplaceGate } from "../screens/marketplace/MarketplaceGate";
import { RequestFeedContainer } from "../screens/marketplace/RequestFeedContainer";
import { RequestDetailContainer } from "../screens/marketplace/RequestDetailContainer";
import { WalletHoldsContainer } from "../screens/marketplace/WalletHoldsContainer";
import { RateProfileContainer } from "../screens/marketplace/RateProfileContainer";
import { JobsTimelineContainer } from "../screens/marketplace/JobsTimelineContainer";
import { PlaceholderScreen } from "../screens/PlaceholderScreen"; // RN-02 ports: auth, offer, trip execution, documents, profile, fleet arrangement, safety

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const Inc = createNativeStackNavigator<IncentivesStackParamList>();
const Earn = createNativeStackNavigator<EarningsStackParamList>();
const Req = createNativeStackNavigator<RequestsStackParamList>();
// Negotiated-fare marketplace (M08, boards D01–D12). Gated by the local MarketplaceGate
// (marketplace_rides OR marketplace_delivery, deny-by-default) — mirrors FlagGate rendering.
function RequestsNavigator({
  navigation,
}: BottomTabScreenProps<MainTabParamList, "Requests">) {
  return (
    <MarketplaceGate
      featureName="Requests"
      onDismiss={() => navigation.navigate("Home")}
    >
      <Req.Navigator screenOptions={{ headerShown: false }}>
        <Req.Screen name="Feed" component={RequestFeedContainer} />
        <Req.Screen name="Detail" component={RequestDetailContainer} />
      </Req.Navigator>
    </MarketplaceGate>
  );
}
function IncentivesNavigator({
  navigation,
}: BottomTabScreenProps<MainTabParamList, "Incentives">) {
  return (
    <FlagGate
      flag="driver_commission_rebates"
      featureName="Incentives"
      onDismiss={() => navigation.navigate("Home")}
    >
      <Inc.Navigator screenOptions={{ headerShown: false }}>
        <Inc.Screen name="Overview" component={IncentivesScreen} />
        <Inc.Screen
          name="CommissionDetail"
          component={CommissionDetailScreen}
        />
        <Inc.Screen name="Referrals" component={PlaceholderScreen} />
        <Inc.Screen name="Window" component={PlaceholderScreen} />
      </Inc.Navigator>
    </FlagGate>
  );
}
function EarningsNavigator() {
  return (
    <Earn.Navigator screenOptions={{ headerShown: false }}>
      <Earn.Screen name="Overview" component={PlaceholderScreen} />
      <Earn.Screen name="Statement" component={StatementScreen} />
      <Earn.Screen name="TripDetail" component={PlaceholderScreen} />
      <Earn.Screen name="Payouts" component={PlaceholderScreen} />
      <Earn.Screen name="Cashout" component={PlaceholderScreen} />
    </Earn.Navigator>
  );
}
// Root-level marketplace screens (task D: Jobs/Wallet/Rates are Root screens navigated from
// Feed and Home). Each carries its own gate so a deep link into a disabled market lands on
// the honest flag-off screen, never a broken one (launch CLAUDE.md #5, #8).
function GatedWalletHolds({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <MarketplaceGate
      featureName="Wallet holds"
      onDismiss={() => navigation.navigate("Main")}
    >
      <WalletHoldsContainer />
    </MarketplaceGate>
  );
}
function GatedRates({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <MarketplaceGate
      featureName="My rates"
      onDismiss={() => navigation.navigate("Main")}
    >
      <RateProfileContainer />
    </MarketplaceGate>
  );
}
function GatedJobs({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <MarketplaceGate
      featureName="Your jobs"
      onDismiss={() => navigation.navigate("Main")}
    >
      <JobsTimelineContainer />
    </MarketplaceGate>
  );
}
function MainTabs() {
  const t = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.text,
        tabBarInactiveTintColor: t.colors.text3,
        tabBarStyle: {
          backgroundColor: t.colors.bg2,
          borderTopColor: t.colors.border,
          height: 84,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: "Inter-SemiBold", fontSize: 10.5 },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Requests" component={RequestsNavigator} />
      <Tabs.Screen name="Earnings" component={EarningsNavigator} />
      <Tabs.Screen name="Incentives" component={IncentivesNavigator} />
      <Tabs.Screen name="Account" component={PlaceholderScreen} />
    </Tabs.Navigator>
  );
}
export function RootNavigator() {
  const t = useTheme();
  return (
    <NavigationContainer
      theme={{
        ...DarkTheme,
        colors: { ...DarkTheme.colors, background: t.colors.bg },
      }}
    >
      <Root.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName="Main"
      >
        <Root.Screen name="Splash" component={PlaceholderScreen} />
        <Root.Screen name="Onboarding" component={PlaceholderScreen} />
        <Root.Screen name="Auth" component={PlaceholderScreen} />
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Trip" component={PlaceholderScreen} />
        <Root.Screen name="WalletHolds" component={GatedWalletHolds as never} />
        <Root.Screen name="Rates" component={GatedRates as never} />
        <Root.Screen name="Jobs" component={GatedJobs as never} />
        <Root.Screen name="FlagOff" component={PlaceholderScreen} />
        <Root.Group screenOptions={{ presentation: "modal" }}>
          <Root.Screen name="Sos" component={PlaceholderScreen} />
          <Root.Screen name="SecureConfirm" component={PlaceholderScreen} />
        </Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
