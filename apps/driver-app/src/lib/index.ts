/**
 * Service Index
 *
 * Re-exports all service modules for easy importing.
 */

export { apiClient } from "./api-client";
export type { ApiError, ApiResponse } from "./api-client";

export { authService } from "./auth-service";
export type {
  AuthTokens,
  DriverProfile,
  LoginOTPRequest,
  RegisterRequest,
  UserProfile,
  VerifyOTPRequest,
} from "./auth-service";

export { driverService } from "./driver-service";
export type {
  DriverApplication,
  DriverDocument,
  DriverEarnings,
  DriverStats,
  DriverStatus,
  LocationUpdate,
} from "./driver-service";

export { tripService } from "./trip-service";
export type {
  Trip,
  TripHistory,
  TripRequest,
  TripStatus,
  TripType,
} from "./trip-service";

export { notificationService } from "./notification-service";
export type {
  Notification,
  NotificationPreferences,
  NotificationType,
} from "./notification-service";

// Custom Hooks
export {
  useActiveTrip,
  useAuth,
  useDriverDocuments,
  useDriverEarnings,
  useDriverStats,
  useDriverStatus,
  useLocationTracking,
  useNotifications,
  useTripActions,
  useTripHistory,
} from "./hooks";
