// Typed routes = the deep-link surface. Paths mirror the Flutter go_router paths so existing links keep working.
import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = { Login: undefined; Otp: { verificationId: string }; Register: undefined };
export type RideStackParamList = { Search: { prefill?: { destinationPlaceId?: string } } | undefined; Pickup: { placeId: string }; Quote: { quoteId: string }; Matching: { rideId: string }; Assigned: { rideId: string }; Pin: { rideId: string }; InTrip: { rideId: string }; Pay: { rideId: string }; Rate: { rideId: string }; Details: { rideId: string } };
export type BitesStackParamList = { Restaurants: undefined; Restaurant: { restaurantId: string }; Cart: undefined; OrderTracking: { orderId: string }; OrderDetails: { orderId: string } };
export type SendStackParamList = { New: undefined; Tracking: { deliveryId: string }; Details: { deliveryId: string } };
export type WalletStackParamList = { Home: undefined; Send: undefined; Request: undefined; Nip: undefined; Statement: { month?: string } | undefined; TopUp: undefined };
export type AskStackParamList = { Thread: { threadId?: string; seed?: string } | undefined; Review: { reviewId: string }; Execution: { executionId: string } };
export type TravelStackParamList = {
  FlightSearch: { from?: string; to?: string; departDate?: string; returnDate?: string; passengers?: number; withStay?: boolean } | undefined;
  FlightResults: { searchId: string }; StaySearch: { city: string; checkIn: string; checkOut: string; guests: number }; StayRooms: { propertyId: string; searchId: string };
  PassengerDetails: { cartId: string; index: number }; Checkout: { cartId: string }; OrderStatus: { orderId: string }; Itinerary: { tripId: string }; Servicing: { orderId: string };
  RefundStatus: { refundId: string }; Disruption: { orderId: string }; AttachAirportRide: { orderId: string; direction: 'to_airport' | 'from_airport' }; LinkedOrders: { tripId: string };
};
export type AccountStackParamList = { Profile: undefined; Edit: undefined; Places: undefined; Payments: undefined; Settings: undefined; Benefits: undefined; Referrals: undefined; Automation: undefined; MandateEditor: { mandateId?: string } | undefined; MandateReceipt: { executionId: string } };
export type MainTabParamList = { Home: undefined; Activity: undefined; Wallet: NavigatorScreenParams<WalletStackParamList>; Account: NavigatorScreenParams<AccountStackParamList> };
export type RootStackParamList = {
  Splash: undefined; Onboarding: undefined; Auth: NavigatorScreenParams<AuthStackParamList>; Main: NavigatorScreenParams<MainTabParamList>;
  Ride: NavigatorScreenParams<RideStackParamList>; Bites: NavigatorScreenParams<BitesStackParamList>; Send: NavigatorScreenParams<SendStackParamList>;
  Ask: NavigatorScreenParams<AskStackParamList>; Travel: NavigatorScreenParams<TravelStackParamList>;
  FlagOff: { feature: string }; Sos: { rideId?: string } | undefined; SecureConfirm: { purpose: string; onProof: (proof: string) => void };
};
declare global { namespace ReactNavigation { interface RootParamList extends RootStackParamList {} } }
