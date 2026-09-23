// Typed routes = the deep-link surface. Paths mirror the Flutter go_router paths so existing links keep working.
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { MpStopInput } from "@ubi/contracts";

export type AuthStackParamList = {
  Login: undefined;
  // The wire contract is phone + 6-digit code (services/user-service/src/routes/auth.ts
  // POST /v1/auth/login/otp and /v1/auth/verify-otp) — there is no separate
  // verification-id concept to carry between the two steps.
  Otp: { phone: string };
  Register: undefined;
};
export type RideStackParamList = {
  Search: { prefill?: { destinationPlaceId?: string } } | undefined;
  Pickup: { placeId: string };
  Quote: { quoteId: string };
  Matching: { rideId: string };
  // `requestId` names the marketplace request a ride executes (A02 trip, stops and
  // route changes are keyed by it); the ride view itself does not carry it.
  Assigned: { rideId: string; pickupPin?: string; requestId?: string };
  Pin: { rideId: string };
  InTrip: { rideId: string; requestId?: string };
  Pay: { rideId: string };
  Rate: { rideId: string };
  Details: { rideId: string };
};
export type BitesStackParamList = {
  Restaurants: undefined;
  Restaurant: { restaurantId: string };
  Cart: undefined;
  OrderTracking: { orderId: string };
  OrderDetails: { orderId: string };
};
export type SendStackParamList = {
  New: undefined;
  Tracking: { deliveryId: string };
  Details: { deliveryId: string };
};
export type WalletStackParamList = {
  Home: undefined;
  Send: undefined;
  Request: undefined;
  Nip: undefined;
  Statement: { month?: string } | undefined;
  TopUp: undefined;
};
export type AskStackParamList = {
  Thread: { threadId?: string; seed?: string } | undefined;
  Review: { reviewId: string };
  Execution: { executionId: string };
};
export type TravelStackParamList = {
  FlightSearch:
    | {
        from?: string;
        to?: string;
        departDate?: string;
        returnDate?: string;
        passengers?: number;
        withStay?: boolean;
      }
    | undefined;
  FlightResults: { searchId: string };
  StaySearch: {
    city: string;
    checkIn: string;
    checkOut: string;
    guests: number;
  };
  StayRooms: { propertyId: string; searchId: string };
  PassengerDetails: { cartId: string; index: number };
  Checkout: { cartId: string };
  OrderStatus: { orderId: string };
  Itinerary: { tripId: string };
  Servicing: { orderId: string };
  RefundStatus: { refundId: string };
  Disruption: { orderId: string };
  AttachAirportRide: {
    orderId: string;
    direction: "to_airport" | "from_airport";
  };
  LinkedOrders: { tripId: string };
};
/** Inputs the fare editor needs to price a marketplace request (GET /v1/mp/quote). Areas are coarse label+centroid, never a house number. */
export type MarketplaceQuoteParams = {
  service: "ride" | "delivery";
  vehicleClass: string;
  pickup: { label: string; lat: number; lng: number };
  dropoff: { label: string; lat: number; lng: number };
  weightKg?: number;
  handling?: string[];
  /** A02 ordered intermediate stops (rides only); the server prices the complete route. */
  stops?: MpStopInput[];
};
export type MarketplaceStackParamList = {
  Details: undefined;
  Fare: { quoteParams: MarketplaceQuoteParams };
  Offers: { requestId: string; unavailableNotice?: string };
  BidDetail: { requestId: string; bidId: string };
  Queued: { requestId: string };
  DeliveryReturn: { deliveryId: string };
  // A02 route builder: `quoteParams` builds a new route; `requestId` edits the stops of
  // an OPEN request before award (the pre-award route revision).
  Route: { quoteParams?: MarketplaceQuoteParams; requestId?: string };
  // A02 executing trip (stops, waiting, route changes, early end) and the proposal composer.
  Trip: { requestId: string };
  ProposeChange: { requestId: string };
  // A03 Book for Later.
  Schedule: { quoteParams: MarketplaceQuoteParams };
  Later: undefined;
  Scheduled: { scheduledRequestId: string };
  AdvanceOffers: { requestId: string };
  Booking: { bookingId: string };
  Series: { templateId: string };
};
export type AccountStackParamList = {
  Profile: undefined;
  Edit: undefined;
  Places: undefined;
  Payments: undefined;
  Settings: undefined;
  Benefits: undefined;
  Referrals: undefined;
  Automation: undefined;
  MandateEditor: { mandateId?: string } | undefined;
  MandateReceipt: { executionId: string };
};
export type MainTabParamList = {
  Home: undefined;
  Activity: undefined;
  Wallet: NavigatorScreenParams<WalletStackParamList>;
  Account: NavigatorScreenParams<AccountStackParamList>;
};
export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  Ride: NavigatorScreenParams<RideStackParamList>;
  Bites: NavigatorScreenParams<BitesStackParamList>;
  Send: NavigatorScreenParams<SendStackParamList>;
  Ask: NavigatorScreenParams<AskStackParamList>;
  Travel: NavigatorScreenParams<TravelStackParamList>;
  Marketplace: NavigatorScreenParams<MarketplaceStackParamList>;
  FlagOff: { feature: string };
  Sos: { rideId?: string } | undefined;
  SecureConfirm: { purpose: string; onProof: (proof: string) => void };
};
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- react-navigation's documented global-typing pattern
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the extends clause is the whole point
    interface RootParamList extends RootStackParamList {}
  }
}
