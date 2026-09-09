import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './routes';
// Universal Links / App Links (domain ubi.africa) + custom scheme. Disabled verticals resolve to FlagOff via the FlagGate on each stack root.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ubi://', 'https://ubi.africa', 'https://links.ubi.africa'],
  config: {
    screens: {
      Main: { screens: { Home: 'home', Activity: 'activity', Wallet: { screens: { Home: 'wallet', Statement: 'wallet/statement' } }, Account: { screens: { Profile: 'profile', Benefits: 'benefits', Referrals: 'benefits/referrals', Automation: 'profile/automation', MandateReceipt: 'profile/automation/receipts/:executionId' } } } },
      Ride: { screens: { Search: 'home/ride/search', Matching: 'home/ride/:rideId/tracking', Details: 'home/ride/:rideId/details' } },
      Bites: { screens: { Restaurants: 'home/food/restaurants', Restaurant: 'home/food/restaurant/:restaurantId', Cart: 'home/food/cart', OrderTracking: 'home/food/order/:orderId/tracking', OrderDetails: 'home/food/order/:orderId/details' } },
      Send: { screens: { New: 'home/delivery/new', Tracking: 'home/delivery/:deliveryId/tracking', Details: 'home/delivery/:deliveryId/details' } },
      Ask: { screens: { Thread: 'ask', Execution: 'ask/executions/:executionId' } },
      Travel: { screens: { FlightSearch: 'travel', FlightResults: 'travel/flights/:searchId', Itinerary: 'trips/:tripId', OrderStatus: 'travel/orders/:orderId', Disruption: 'travel/orders/:orderId/disruption', RefundStatus: 'travel/refunds/:refundId' } },
      FlagOff: 'unavailable/:feature',
    },
  },
};
