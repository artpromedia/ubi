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
  AuthStackParamList,
  TripStackParamList,
  AccountStackParamList,
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
import { DriverPreferencesContainer } from "../screens/marketplace/DriverPreferencesContainer";
import { JobsTimelineContainer } from "../screens/marketplace/JobsTimelineContainer";
import { useSessionKeeper } from "../api/auth";
import { SplashScreen } from "../screens/boot/SplashScreen";
import { OnboardingScreen } from "../screens/boot/OnboardingScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { OtpScreen } from "../screens/auth/OtpScreen";
import { RegisterScreen } from "../screens/auth/RegisterScreen";
import { OfferScreen } from "../screens/trip/OfferScreen";
import { NavigateScreen } from "../screens/trip/NavigateScreen";
import { WaitingScreen } from "../screens/trip/WaitingScreen";
import { PinScreen } from "../screens/trip/PinScreen";
import { InTripScreen } from "../screens/trip/InTripScreen";
import { CashScreen } from "../screens/trip/CashScreen";
import { CompleteScreen } from "../screens/trip/CompleteScreen";
import { SosScreen } from "../screens/safety/SosScreen";
import { SecureConfirmScreen } from "../screens/safety/SecureConfirmScreen";
import { ProfileScreen } from "../screens/account/ProfileScreen";
import { FeatureUnavailableScreen } from "../screens/FeatureUnavailableScreen";

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const Inc = createNativeStackNavigator<IncentivesStackParamList>();
const Earn = createNativeStackNavigator<EarningsStackParamList>();
const Req = createNativeStackNavigator<RequestsStackParamList>();
const Auth = createNativeStackNavigator<AuthStackParamList>();
const Trip = createNativeStackNavigator<TripStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();

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
        <Inc.Screen
          name="Referrals"
          component={FeatureUnavailableScreen}
          initialParams={{ feature: "Referrals" } as never}
        />
        <Inc.Screen
          name="Window"
          component={FeatureUnavailableScreen}
          initialParams={{ feature: "Window" } as never}
        />
      </Inc.Navigator>
    </FlagGate>
  );
}
function EarningsNavigator() {
  return (
    <Earn.Navigator screenOptions={{ headerShown: false }}>
      <Earn.Screen
        name="Overview"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "EarningsOverview" } as never}
      />
      <Earn.Screen name="Statement" component={StatementScreen} />
      <Earn.Screen
        name="TripDetail"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "TripDetail" } as never}
      />
      <Earn.Screen
        name="Payouts"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Payouts" } as never}
      />
      <Earn.Screen
        name="Cashout"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Cashout" } as never}
      />
    </Earn.Navigator>
  );
}
function AccountNavigator() {
  return (
    <AccountStack.Navigator screenOptions={{ headerShown: false }}>
      <AccountStack.Screen name="Profile" component={ProfileScreen} />
      {/* Vehicle/documents/ratings/fleet/liveness/Ask have no audited server
          surface in this slice (api/unsupported.ts driverDocuments) — gated
          honestly rather than shipping a screen with nothing real behind it. */}
      <AccountStack.Screen
        name="Edit"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "AccountPlaces" } as never}
      />
      <AccountStack.Screen
        name="Vehicle"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Vehicle" } as never}
      />
      <AccountStack.Screen
        name="Documents"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Documents" } as never}
      />
      <AccountStack.Screen
        name="UploadDocument"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "UploadDocument" } as never}
      />
      <AccountStack.Screen
        name="Ratings"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Ratings" } as never}
      />
      <AccountStack.Screen
        name="Settings"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Settings" } as never}
      />
      <AccountStack.Screen
        name="FleetArrangement"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "FleetArrangement" } as never}
      />
      <AccountStack.Screen
        name="LivenessCheck"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "LivenessCheck" } as never}
      />
      <AccountStack.Screen
        name="Ask"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "Ask" } as never}
      />
    </AccountStack.Navigator>
  );
}
function AuthNavigator() {
  return (
    <Auth.Navigator screenOptions={{ headerShown: false }}>
      <Auth.Screen name="Login" component={LoginScreen} />
      <Auth.Screen name="Otp" component={OtpScreen} />
      <Auth.Screen name="Register" component={RegisterScreen} />
    </Auth.Navigator>
  );
}
function TripNavigator() {
  return (
    <Trip.Navigator screenOptions={{ headerShown: false }}>
      <Trip.Screen name="Offer" component={OfferScreen} />
      <Trip.Screen name="Navigate" component={NavigateScreen} />
      <Trip.Screen name="Waiting" component={WaitingScreen} />
      <Trip.Screen name="Pin" component={PinScreen} />
      <Trip.Screen name="InTrip" component={InTripScreen} />
      <Trip.Screen name="Cash" component={CashScreen} />
      <Trip.Screen name="Complete" component={CompleteScreen} />
    </Trip.Navigator>
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
function GatedPreferences({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <MarketplaceGate
      featureName="Preferences"
      onDismiss={() => navigation.navigate("Main")}
    >
      <DriverPreferencesContainer />
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
      <Tabs.Screen name="Account" component={AccountNavigator} />
    </Tabs.Navigator>
  );
}
export function RootNavigator() {
  const t = useTheme();
  // Foreground token keeper (C05 / G01): refreshes the session well before
  // the access token expires so no screen ever rides on a stale one. A no-op
  // while signed out (loadSession() resolves undefined).
  useSessionKeeper();
  return (
    <NavigationContainer
      theme={{
        ...DarkTheme,
        colors: { ...DarkTheme.colors, background: t.colors.bg },
      }}
    >
      <Root.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName="Splash"
      >
        <Root.Screen name="Splash" component={SplashScreen} />
        <Root.Screen name="Onboarding" component={OnboardingScreen} />
        <Root.Screen name="Auth" component={AuthNavigator as never} />
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Trip" component={TripNavigator as never} />
        <Root.Screen name="WalletHolds" component={GatedWalletHolds as never} />
        <Root.Screen name="Rates" component={GatedRates as never} />
        <Root.Screen name="Preferences" component={GatedPreferences as never} />
        <Root.Screen name="Jobs" component={GatedJobs as never} />
        <Root.Screen name="FlagOff" component={FeatureUnavailableScreen} />
        <Root.Group screenOptions={{ presentation: "modal" }}>
          <Root.Screen name="Sos" component={SosScreen} />
          <Root.Screen name="SecureConfirm" component={SecureConfirmScreen} />
        </Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
