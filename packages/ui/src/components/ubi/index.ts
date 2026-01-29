/**
 * UBI-specific components
 *
 * Domain-specific components for the UBI platform.
 */

// Ride/Transport
export {
  DriverMarker,
  LocationMarker,
  type DriverMarkerProps,
  type LocationMarkerProps,
} from "./map-markers";
export { RideCard, rideCardVariants, type RideCardProps } from "./ride-card";
export {
  TripStatusCard,
  tripStatusCardVariants,
  type TripStatusCardProps,
} from "./trip-status-card";
export {
  TripTimeline,
  type TimelineStep,
  type TripTimelineProps,
} from "./trip-timeline";

// Food/Restaurant
export { MenuItem, type MenuItemProps } from "./menu-item";
export {
  RestaurantCard,
  restaurantCardVariants,
  type RestaurantCardProps,
} from "./restaurant-card";

// Order Tracking
export {
  OrderTrackingCard,
  orderTrackingCardVariants,
  type OrderStatus,
  type OrderTrackingCardProps,
} from "./order-tracking-card";

// Service Selection
export {
  ServiceBadge,
  ServiceSelector,
  serviceConfigs,
  type ServiceBadgeProps,
  type ServiceSelectorProps,
  type ServiceType,
} from "./service-selector";

// Payment
export {
  AddPaymentMethod,
  PaymentMethodCard,
  type AddPaymentMethodProps,
  type PaymentMethodCardProps,
} from "./payment-method";

// Driver
export {
  DriverEarningsCard,
  earningsCardVariants,
  type DriverEarningsCardProps,
} from "./driver-earnings-card";

// Quick Actions
export {
  QuickAction,
  QuickActionGrid,
  iconVariants as quickActionIconVariants,
  quickActionVariants,
  type QuickActionGridProps,
  type QuickActionProps,
} from "./quick-action";

// Address
export {
  AddressCard,
  addressCardVariants,
  type AddressCardProps,
  type AddressType,
} from "./address-card";

// Safety
export {
  SOSButton,
  SafetyAlert,
  safetyAlertVariants,
  type SOSButtonProps,
  type SafetyAlertProps,
} from "./safety-alert";

// Mobile UI
export { BottomSheet, type BottomSheetProps } from "./bottom-sheet";
export {
  PromoBanner,
  promoBannerVariants,
  type PromoBannerProps,
} from "./promo-banner";
