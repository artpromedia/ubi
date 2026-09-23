import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./routes";
// Universal Links / App Links (domain ubi.africa) + custom scheme. Disabled verticals resolve to FlagOff via the FlagGate on each stack root.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ubi://", "https://ubi.africa", "https://links.ubi.africa"],
  config: {
    screens: {
      Main: {
        screens: {
          Home: "home",
          Activity: "activity",
          Wallet: {
            screens: { Home: "wallet", Statement: "wallet/statement" },
          },
          Account: {
            screens: {
              Profile: "profile",
              Benefits: "benefits",
              Referrals: "benefits/referrals",
              Automation: "profile/automation",
              MandateReceipt: "profile/automation/receipts/:executionId",
            },
          },
        },
      },
      Ride: {
        screens: {
          Search: "home/ride/search",
          Matching: "home/ride/:rideId/tracking",
          Details: "home/ride/:rideId/details",
        },
      },
      // Bites and Send are FeatureUnavailableScreen leaves, not navigators
      // (G01/G12: nothing is built behind either yet) — a single honest path
      // each, rather than a nested `screens` map whose sub-screens don't
      // exist in the actual tree (that mismatch was the bug: a deep link to
      // e.g. "home/food/order/:orderId/tracking" would try to resolve a
      // screen this app has never had).
      Bites: "home/food",
      Send: "home/delivery",
      Ask: {
        screens: { Thread: "ask", Execution: "ask/executions/:executionId" },
      },
      Travel: {
        screens: {
          FlightSearch: "travel",
          FlightResults: "travel/flights/:searchId",
          Itinerary: "trips/:tripId",
          OrderStatus: "travel/orders/:orderId",
          Disruption: "travel/orders/:orderId/disruption",
          RefundStatus: "travel/refunds/:refundId",
          Transfer: "travel/transfers/:transferId",
        },
      },
      Marketplace: {
        screens: {
          Details: "home/marketplace/new",
          Offers: "home/marketplace/:requestId/offers",
          BidDetail: "home/marketplace/:requestId/offers/:bidId",
          Queued: "home/marketplace/:requestId/queued",
          DeliveryReturn: "home/marketplace/delivery/:deliveryId/return",
          // A02: the pre-award route edit of an open request, and the executing trip.
          Route: "home/marketplace/:requestId/route",
          Trip: "home/marketplace/:requestId/trip",
          ProposeChange: "home/marketplace/:requestId/trip/change",
          // A03 Book for Later.
          Later: "home/marketplace/later",
          Scheduled: "home/marketplace/later/scheduled/:scheduledRequestId",
          AdvanceOffers: "home/marketplace/:requestId/advance",
          Booking: "home/marketplace/later/bookings/:bookingId",
          Series: "home/marketplace/later/series/:templateId",
          // A04.3 / A06 rider confidence.
          Favourites: "home/marketplace/favourites",
          Receipt: "home/marketplace/:requestId/receipt",
        },
      }, // Fare and Schedule carry an object param (quoteParams) and are reached in-app only.
      FlagOff: "unavailable/:feature",
    },
  },
};
