/// API Configuration
///
/// Contains all configuration for connecting to UBI backend services.
library;

import 'package:flutter/foundation.dart';

/// Environment types for API configuration
enum ApiEnvironment {
  development,
  staging,
  production,
}

/// API configuration class
///
/// Holds all the necessary configuration for connecting to backend services.
/// Supports multiple environments (dev, staging, prod) with different base URLs.
class ApiConfig {
  /// Creates a new [ApiConfig] instance
  const ApiConfig({
    required this.baseUrl,
    required this.environment,
    this.apiVersion = 'v1',
    this.connectTimeout = const Duration(seconds: 30),
    this.receiveTimeout = const Duration(seconds: 30),
    this.sendTimeout = const Duration(seconds: 30),
    this.enableLogging = true,
    this.maxRetries = 3,
    this.retryDelay = const Duration(seconds: 1),
    this.cacheMaxAge = const Duration(minutes: 5),
    this.cacheMaxStale = const Duration(days: 7),
  });

  /// Development configuration
  factory ApiConfig.development() {
    return const ApiConfig(
      baseUrl: 'http://localhost:3000/api',
      environment: ApiEnvironment.development,
      enableLogging: true,
    );
  }

  /// Staging configuration
  factory ApiConfig.staging() {
    return const ApiConfig(
      baseUrl: 'https://staging-api.ubi.app/api',
      environment: ApiEnvironment.staging,
      enableLogging: true,
    );
  }

  /// Production configuration
  factory ApiConfig.production() {
    return const ApiConfig(
      baseUrl: 'https://api.ubi.app/api',
      environment: ApiEnvironment.production,
      enableLogging: false,
    );
  }

  /// Creates config based on current build mode
  factory ApiConfig.fromEnvironment() {
    if (kReleaseMode) {
      return ApiConfig.production();
    } else if (kProfileMode) {
      return ApiConfig.staging();
    } else {
      return ApiConfig.development();
    }
  }

  /// Base URL for the API
  final String baseUrl;

  /// Current environment
  final ApiEnvironment environment;

  /// API version string (e.g., 'v1')
  final String apiVersion;

  /// Connection timeout
  final Duration connectTimeout;

  /// Receive timeout for responses
  final Duration receiveTimeout;

  /// Send timeout for requests
  final Duration sendTimeout;

  /// Whether to enable request/response logging
  final bool enableLogging;

  /// Maximum number of retry attempts
  final int maxRetries;

  /// Delay between retry attempts
  final Duration retryDelay;

  /// Maximum age for cached responses
  final Duration cacheMaxAge;

  /// Maximum stale time for offline cache
  final Duration cacheMaxStale;

  /// Full API URL with version
  String get apiUrl => '$baseUrl/$apiVersion';

  /// Whether this is a development environment
  bool get isDevelopment => environment == ApiEnvironment.development;

  /// Whether this is a staging environment
  bool get isStaging => environment == ApiEnvironment.staging;

  /// Whether this is a production environment
  bool get isProduction => environment == ApiEnvironment.production;

  /// Service-specific endpoints
  ApiEndpoints get endpoints => ApiEndpoints(this);

  @override
  String toString() => 'ApiConfig(baseUrl: $baseUrl, environment: $environment)';
}

/// Service-specific API endpoints
class ApiEndpoints {
  const ApiEndpoints(this._config);

  final ApiConfig _config;

  String get _base => _config.apiUrl;

  // === Auth Endpoints ===
  String get auth => '$_base/auth';
  String get authLogin => '$auth/login';
  String get authRegister => '$auth/register';
  String get authVerifyOtp => '$auth/verify-otp';
  String get authResendOtp => '$auth/resend-otp';
  String get authRefreshToken => '$auth/refresh';
  String get authLogout => '$auth/logout';
  String get authGoogle => '$auth/google';
  String get authApple => '$auth/apple';
  String get authForgotPassword => '$auth/forgot-password';
  String get authResetPassword => '$auth/reset-password';

  // === User Endpoints ===
  String get users => '$_base/users';
  String get usersMe => '$users/me';
  String get usersProfile => '$users/profile';
  String get usersPreferences => '$users/preferences';
  String get usersPaymentMethods => '$users/payment-methods';
  String get usersSavedPlaces => '$users/saved-places';
  String get usersRideHistory => '$users/rides';
  String get usersOrderHistory => '$users/orders';
  String userById(String id) => '$users/$id';

  // === Ride Endpoints ===
  String get rides => '$_base/rides';
  String get ridesEstimate => '$rides/estimate';
  String get ridesRequest => '$rides/request';
  String get ridesNearbyDrivers => '$rides/nearby-drivers';
  String rideById(String id) => '$rides/$id';
  String rideCancel(String id) => '$rides/$id/cancel';
  String rideRate(String id) => '$rides/$id/rate';
  String rideStatus(String id) => '$rides/$id/status';
  String rideDriver(String id) => '$rides/$id/driver';
  String rideTip(String id) => '$rides/$id/tip';

  // === Food Endpoints ===
  String get restaurants => '$_base/restaurants';
  String get restaurantsNearby => '$restaurants/nearby';
  String get restaurantsFeatured => '$restaurants/featured';
  String get restaurantsSearch => '$restaurants/search';
  String restaurantById(String id) => '$restaurants/$id';
  String restaurantMenu(String id) => '$restaurants/$id/menu';
  String restaurantReviews(String id) => '$restaurants/$id/reviews';

  String get foodOrders => '$_base/food-orders';
  String foodOrderById(String id) => '$foodOrders/$id';
  String foodOrderCancel(String id) => '$foodOrders/$id/cancel';
  String foodOrderRate(String id) => '$foodOrders/$id/rate';
  String foodOrderStatus(String id) => '$foodOrders/$id/status';

  // === Delivery Endpoints ===
  String get deliveries => '$_base/deliveries';
  String get deliveriesEstimate => '$deliveries/estimate';
  String get deliveriesRequest => '$deliveries/request';
  String deliveryById(String id) => '$deliveries/$id';
  String deliveryCancel(String id) => '$deliveries/$id/cancel';
  String deliveryStatus(String id) => '$deliveries/$id/status';

  // === Payment Endpoints ===
  String get payments => '$_base/payments';
  String get paymentMethods => '$payments/methods';
  String paymentMethodById(String id) => '$paymentMethods/$id';
  String get paymentsMpesa => '$payments/mpesa';
  String get paymentsMpesaCallback => '$paymentsMpesa/callback';
  String get paymentsMtn => '$payments/mtn';
  String get paymentsStripe => '$payments/stripe';
  String get paymentsWallet => '$payments/wallet';
  String get paymentsWalletTopUp => '$paymentsWallet/top-up';
  String get paymentsWalletWithdraw => '$paymentsWallet/withdraw';
  String get paymentsWalletTransactions => '$paymentsWallet/transactions';

  // === Notification Endpoints ===
  String get notifications => '$_base/notifications';
  String get notificationsPreferences => '$notifications/preferences';
  String notificationById(String id) => '$notifications/$id';
  String notificationRead(String id) => '$notifications/$id/read';
  String get notificationsReadAll => '$notifications/read-all';
  String get notificationsRegisterDevice => '$notifications/device';

  // === Location/Geocoding Endpoints ===
  String get places => '$_base/places';
  String get placesSearch => '$places/search';
  String get placesAutocomplete => '$places/autocomplete';
  String get placesReverseGeocode => '$places/reverse-geocode';
  String placeById(String id) => '$places/$id';

  // === Driver Endpoints (for Driver App) ===
  String get drivers => '$_base/drivers';
  String get driversMe => '$drivers/me';
  String get driversOnline => '$drivers/online';
  String get driversOffline => '$drivers/offline';
  String get driversLocation => '$drivers/location';
  String get driversEarnings => '$drivers/earnings';
  String get driversEarningsDaily => '$driversEarnings/daily';
  String get driversEarningsWeekly => '$driversEarnings/weekly';
  String get driversDocuments => '$drivers/documents';
  String get driversVehicle => '$drivers/vehicle';
  String driverAcceptRide(String rideId) => '$drivers/rides/$rideId/accept';
  String driverRejectRide(String rideId) => '$drivers/rides/$rideId/reject';
  String driverArrived(String rideId) => '$drivers/rides/$rideId/arrived';
  String driverStartRide(String rideId) => '$drivers/rides/$rideId/start';
  String driverCompleteRide(String rideId) => '$drivers/rides/$rideId/complete';

  // === WebSocket Endpoints ===
  String get wsBase => _config.baseUrl.replaceFirst('http', 'ws');
  String wsRideUpdates(String rideId) => '$wsBase/rides/$rideId';
  String wsDriverLocation(String driverId) => '$wsBase/drivers/$driverId/location';
  String wsOrderUpdates(String orderId) => '$wsBase/orders/$orderId';
  String get wsDriverRequests => '$wsBase/drivers/requests';
}
