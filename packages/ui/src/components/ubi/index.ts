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
