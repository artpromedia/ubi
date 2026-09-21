import React from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTheme, FlagGate } from "@ubi/mobile-ui";
import { linking } from "./linking";
import type {
  RootStackParamList,
  MainTabParamList,
  AskStackParamList,
  TravelStackParamList,
  AccountStackParamList,
  AuthStackParamList,
  RideStackParamList,
  WalletStackParamList,
  MarketplaceStackParamList,
} from "./routes";
import { HomeScreen } from "../screens/home/HomeScreen";
import { ActivityScreen } from "../screens/activity/ActivityScreen";
import { AskScreen } from "../screens/ask/AskScreen";
import { ExecutionStatusScreen } from "../screens/ask/ExecutionStatusScreen";
import { MandatesScreen } from "../screens/automation/MandatesScreen";
import { MandateEditorScreen } from "../screens/automation/MandateEditorScreen";
import { MandateReceiptScreen } from "../screens/automation/MandateReceiptScreen";
import { BenefitsScreen } from "../screens/benefits/BenefitsScreen";
import { ReferralsScreen } from "../screens/benefits/ReferralsScreen";
import { FlightSearchScreen } from "../screens/travel/FlightSearchScreen";
import { FlightResultsScreen } from "../screens/travel/FlightResultsScreen";
import { StayRoomsScreen } from "../screens/travel/StayRoomsScreen";
import { PassengerDetailsScreen } from "../screens/travel/PassengerDetailsScreen";
import { TravelCheckoutScreen } from "../screens/travel/TravelCheckoutScreen";
import { OrderStatusScreen } from "../screens/travel/OrderStatusScreen";
import { ItineraryScreen } from "../screens/travel/ItineraryScreen";
import { RefundStatusScreen } from "../screens/travel/RefundStatusScreen";
import { DisruptionScreen } from "../screens/travel/DisruptionScreen";
import { AttachAirportRideScreen } from "../screens/travel/AttachAirportRideScreen";
import { LinkedOrdersScreen } from "../screens/travel/LinkedOrdersScreen";
import { RequestDetailsScreen } from "../screens/marketplace/RequestDetailsScreen";
import { FareEditorContainer } from "../screens/marketplace/FareEditorContainer";
import { OfferInboxContainer } from "../screens/marketplace/OfferInboxContainer";
import { BidDetailContainer } from "../screens/marketplace/BidDetailContainer";
import { QueuedTrackerContainer } from "../screens/marketplace/QueuedTrackerContainer";
import { DeliveryReturnContainer } from "../screens/marketplace/DeliveryReturnContainer";
import { SplashScreen } from "../screens/boot/SplashScreen";
import { OnboardingScreen } from "../screens/boot/OnboardingScreen";
import { useSessionKeeper } from "../api/auth";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { OtpScreen } from "../screens/auth/OtpScreen";
import { RegisterScreen } from "../screens/auth/RegisterScreen";
import {
  RideToMarketplaceRedirect,
  RideStateRouterScreen,
} from "../screens/ride/RideEntryScreens";
import { AssignedScreen } from "../screens/ride/AssignedScreen";
import { PinDisplayScreen } from "../screens/ride/PinDisplayScreen";
import { InTripScreen } from "../screens/ride/InTripScreen";
import { PayScreen } from "../screens/ride/PayScreen";
import { RateScreen } from "../screens/ride/RateScreen";
import { RideDetailsScreen } from "../screens/ride/RideDetailsScreen";
import { SosScreen } from "../screens/safety/SosScreen";
import { SecureConfirmScreen } from "../screens/safety/SecureConfirmScreen";
import { WalletHomeScreen } from "../screens/wallet/WalletHomeScreen";
import { WalletStatementScreen } from "../screens/wallet/WalletStatementScreen";
import { ProfileScreen } from "../screens/account/ProfileScreen";
import { EditProfileScreen } from "../screens/account/EditProfileScreen";
import { FeatureUnavailableScreen } from "../screens/FeatureUnavailableScreen";

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const AskStack = createNativeStackNavigator<AskStackParamList>();
const TravelStack = createNativeStackNavigator<TravelStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RideStack = createNativeStackNavigator<RideStackParamList>();
const WalletStack = createNativeStackNavigator<WalletStackParamList>();
const MarketplaceStack =
  createNativeStackNavigator<MarketplaceStackParamList>();

function AccountNavigator() {
  return (
    <AccountStack.Navigator screenOptions={{ headerShown: false }}>
      <AccountStack.Screen name="Profile" component={ProfileScreen} />
      <AccountStack.Screen name="Benefits" component={BenefitsScreen} />
      <AccountStack.Screen name="Referrals" component={ReferralsScreen} />
      <AccountStack.Screen name="Automation" component={MandatesScreen} />
      <AccountStack.Screen
        name="MandateEditor"
        component={MandateEditorScreen}
      />
      <AccountStack.Screen
        name="MandateReceipt"
        component={MandateReceiptScreen}
      />
      <AccountStack.Screen name="Edit" component={EditProfileScreen} />
      {/* Saved places, payment methods and settings have no audited server
          surface in this slice (C05 scope was Profile view/edit only) — they
          stay honestly gated rather than shipping a screen with nothing real
          behind it. */}
      <AccountStack.Screen
        name="Places"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "AccountPlaces" } as never}
      />
      <AccountStack.Screen
        name="Payments"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "AccountPayments" } as never}
      />
      <AccountStack.Screen
        name="Settings"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "AccountSettings" } as never}
      />
    </AccountStack.Navigator>
  );
}
function WalletNavigator() {
  return (
    <WalletStack.Navigator screenOptions={{ headerShown: false }}>
      <WalletStack.Screen name="Home" component={WalletHomeScreen} />
      <WalletStack.Screen name="Statement" component={WalletStatementScreen} />
      {/* Money-movement flows (send/request/NIP transfer/top-up) exist
          server-side but are out of this read-only wallet slice — gated
          honestly rather than wired to a mutation this app hasn't earned. */}
      <WalletStack.Screen
        name="Send"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "WalletSend" } as never}
      />
      <WalletStack.Screen
        name="Request"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "WalletRequest" } as never}
      />
      <WalletStack.Screen
        name="Nip"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "WalletNip" } as never}
      />
      <WalletStack.Screen
        name="TopUp"
        component={FeatureUnavailableScreen}
        initialParams={{ feature: "WalletTopUp" } as never}
      />
    </WalletStack.Navigator>
  );
}
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Otp" component={OtpScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}
function RideNavigator() {
  return (
    <RideStack.Navigator screenOptions={{ headerShown: false }}>
      {/* Search/Pickup/Quote are thin redirects into the one real pricing
          surface (the marketplace fare editor) — never a parallel quote flow. */}
      <RideStack.Screen name="Search" component={RideToMarketplaceRedirect} />
      <RideStack.Screen name="Pickup" component={RideToMarketplaceRedirect} />
      <RideStack.Screen name="Quote" component={RideToMarketplaceRedirect} />
      <RideStack.Screen name="Matching" component={RideStateRouterScreen} />
      <RideStack.Screen name="Assigned" component={AssignedScreen} />
      <RideStack.Screen name="Pin" component={PinDisplayScreen} />
      <RideStack.Screen name="InTrip" component={InTripScreen} />
      <RideStack.Screen name="Pay" component={PayScreen} />
      <RideStack.Screen name="Rate" component={RateScreen} />
      <RideStack.Screen name="Details" component={RideDetailsScreen} />
    </RideStack.Navigator>
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
          backgroundColor: t.colors.bg,
          borderTopColor: t.colors.border,
          height: 84,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: "Inter-SemiBold", fontSize: 10.5 },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Activity" component={ActivityScreen} />
      <Tabs.Screen name="Wallet" component={WalletNavigator} />
      <Tabs.Screen name="Account" component={AccountNavigator} />
    </Tabs.Navigator>
  );
}
function AskNavigator({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <FlagGate
      flag="ai_assistant"
      featureName="Ask UBI"
      onDismiss={() => navigation.navigate("Main")}
    >
      <AskStack.Navigator screenOptions={{ headerShown: false }}>
        <AskStack.Screen name="Thread" component={AskScreen} />
        <AskStack.Screen name="Execution" component={ExecutionStatusScreen} />
      </AskStack.Navigator>
    </FlagGate>
  );
}
function TravelNavigator({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <FlagGate
      flag="flights_booking"
      featureName="Flights & stays"
      onDismiss={() => navigation.navigate("Main")}
    >
      <TravelStack.Navigator screenOptions={{ headerShown: false }}>
        <TravelStack.Screen
          name="FlightSearch"
          component={FlightSearchScreen}
        />
        <TravelStack.Screen
          name="FlightResults"
          component={FlightResultsScreen}
        />
        <TravelStack.Screen
          name="StaySearch"
          component={FeatureUnavailableScreen}
          initialParams={{ feature: "StaySearch" } as never}
        />
        <TravelStack.Screen name="StayRooms" component={StayRoomsScreen} />
        <TravelStack.Screen
          name="PassengerDetails"
          component={PassengerDetailsScreen}
        />
        <TravelStack.Screen name="Checkout" component={TravelCheckoutScreen} />
        <TravelStack.Screen name="OrderStatus" component={OrderStatusScreen} />
        <TravelStack.Screen name="Itinerary" component={ItineraryScreen} />
        <TravelStack.Screen
          name="Servicing"
          component={FeatureUnavailableScreen}
          initialParams={{ feature: "TravelServicing" } as never}
        />
        <TravelStack.Screen
          name="RefundStatus"
          component={RefundStatusScreen}
        />
        <TravelStack.Screen name="Disruption" component={DisruptionScreen} />
        <TravelStack.Screen
          name="AttachAirportRide"
          component={AttachAirportRideScreen}
        />
        <TravelStack.Screen
          name="LinkedOrders"
          component={LinkedOrdersScreen}
        />
      </TravelStack.Navigator>
    </FlagGate>
  );
}
function MarketplaceNavigator({
  navigation,
}: {
  navigation: { navigate: (s: "Main") => void };
}) {
  return (
    <FlagGate
      flag="marketplace_rides"
      featureName="Fare marketplace"
      onDismiss={() => navigation.navigate("Main")}
    >
      <MarketplaceStack.Navigator screenOptions={{ headerShown: false }}>
        <MarketplaceStack.Screen
          name="Details"
          component={RequestDetailsScreen}
        />
        <MarketplaceStack.Screen name="Fare" component={FareEditorContainer} />
        <MarketplaceStack.Screen
          name="Offers"
          component={OfferInboxContainer}
        />
        <MarketplaceStack.Screen
          name="BidDetail"
          component={BidDetailContainer}
        />
        <MarketplaceStack.Screen
          name="Queued"
          component={QueuedTrackerContainer}
        />
        <MarketplaceStack.Screen
          name="DeliveryReturn"
          component={DeliveryReturnContainer}
        />
      </MarketplaceStack.Navigator>
    </FlagGate>
  );
}
export function RootNavigator() {
  const t = useTheme();
  // Foreground token keeper (C05 / G01): refreshes the session well before
  // the access token expires so no screen ever rides on a stale one. A no-op
  // while signed out (loadSession() resolves undefined).
  useSessionKeeper();
  const navTheme =
    t.mode === "dark"
      ? {
          ...DarkTheme,
          colors: { ...DarkTheme.colors, background: t.colors.bg },
        }
      : {
          ...DefaultTheme,
          colors: { ...DefaultTheme.colors, background: t.colors.bg2 },
        };
  return (
    <NavigationContainer linking={linking} theme={navTheme}>
      <Root.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName="Splash"
      >
        <Root.Screen name="Splash" component={SplashScreen} />
        <Root.Screen name="Onboarding" component={OnboardingScreen} />
        <Root.Screen name="Auth" component={AuthNavigator as never} />
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Ride" component={RideNavigator as never} />
        {/* Food and parcel ordering have no audited journey in this app yet
            (G12) — FeatureUnavailableScreen already carries honest copy for
            these two route names. */}
        <Root.Screen name="Bites" component={FeatureUnavailableScreen} />
        <Root.Screen name="Send" component={FeatureUnavailableScreen} />
        <Root.Screen name="Ask" component={AskNavigator as never} />
        <Root.Screen name="Travel" component={TravelNavigator as never} />
        <Root.Screen
          name="Marketplace"
          component={MarketplaceNavigator as never}
        />
        <Root.Screen name="FlagOff" component={FeatureUnavailableScreen} />
        <Root.Group screenOptions={{ presentation: "modal" }}>
          <Root.Screen name="Sos" component={SosScreen} />
          <Root.Screen name="SecureConfirm" component={SecureConfirmScreen} />
        </Root.Group>
      </Root.Navigator>
    </NavigationContainer>
  );
}
