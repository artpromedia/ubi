/// API Module
///
/// Dependency injection module for API services.
library;

import 'package:dio/dio.dart';
import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import '../client/api_client.dart';
import '../client/api_config.dart';
import '../services/auth_service.dart';
import '../services/user_service.dart';
import '../services/ride_service.dart';
import '../services/food_service.dart';
import '../services/delivery_service.dart';
import '../services/payment_service.dart';
import '../services/notification_service.dart';

/// Register API module dependencies
///
/// Call this during app initialization to register all API services.
/// Requires [TokenStorage] and [ConnectivityChecker] to be registered first.
@module
abstract class ApiModule {
  /// Provide API configuration
  @lazySingleton
  ApiConfig provideApiConfig() => ApiConfig.fromEnvironment();

  /// Provide API client
  @lazySingleton
  ApiClient provideApiClient(
    ApiConfig config,
    TokenStorage tokenStorage,
    ConnectivityChecker connectivityChecker,
  ) {
    return ApiClient(
      config: config,
      tokenStorage: tokenStorage,
      connectivityChecker: connectivityChecker,
    );
  }

  /// Provide Dio instance from API client
  @lazySingleton
  Dio provideDio(ApiClient apiClient) => apiClient.dio;

  /// Provide Auth service
  @lazySingleton
  AuthService provideAuthService(Dio dio, ApiConfig config) {
    return AuthService(dio, baseUrl: config.apiUrl);
  }

  /// Provide User service
  @lazySingleton
  UserService provideUserService(Dio dio, ApiConfig config) {
    return UserService(dio, baseUrl: config.apiUrl);
  }

  /// Provide Ride service
  @lazySingleton
  RideService provideRideService(Dio dio, ApiConfig config) {
    return RideService(dio, baseUrl: config.apiUrl);
  }

  /// Provide Food service
  @lazySingleton
  FoodService provideFoodService(Dio dio, ApiConfig config) {
    return FoodService(dio, baseUrl: config.apiUrl);
  }

  /// Provide Delivery service
  @lazySingleton
  DeliveryService provideDeliveryService(Dio dio, ApiConfig config) {
    return DeliveryService(dio, baseUrl: config.apiUrl);
  }

  /// Provide Payment service
  @lazySingleton
  PaymentService providePaymentService(Dio dio, ApiConfig config) {
    return PaymentService(dio, baseUrl: config.apiUrl);
  }

  /// Provide Notification service
  @lazySingleton
  NotificationService provideNotificationService(Dio dio, ApiConfig config) {
    return NotificationService(dio, baseUrl: config.apiUrl);
  }
}

/// Manual registration for apps not using injectable
///
/// Use this to manually register API dependencies in GetIt.
void registerApiModule(
  GetIt getIt, {
  required TokenStorage tokenStorage,
  required ConnectivityChecker connectivityChecker,
  ApiConfig? config,
}) {
  final apiConfig = config ?? ApiConfig.fromEnvironment();

  // Register config
  if (!getIt.isRegistered<ApiConfig>()) {
    getIt.registerLazySingleton<ApiConfig>(() => apiConfig);
  }

  // Register token storage and connectivity checker if not already registered
  if (!getIt.isRegistered<TokenStorage>()) {
    getIt.registerLazySingleton<TokenStorage>(() => tokenStorage);
  }
  if (!getIt.isRegistered<ConnectivityChecker>()) {
    getIt.registerLazySingleton<ConnectivityChecker>(() => connectivityChecker);
  }

  // Register API client
  if (!getIt.isRegistered<ApiClient>()) {
    getIt.registerLazySingleton<ApiClient>(
      () => ApiClient(
        config: getIt<ApiConfig>(),
        tokenStorage: getIt<TokenStorage>(),
        connectivityChecker: getIt<ConnectivityChecker>(),
      ),
    );
  }

  // Register Dio
  if (!getIt.isRegistered<Dio>()) {
    getIt.registerLazySingleton<Dio>(() => getIt<ApiClient>().dio);
  }

  // Register services
  final dio = getIt<Dio>();
  final baseUrl = apiConfig.apiUrl;

  if (!getIt.isRegistered<AuthService>()) {
    getIt.registerLazySingleton<AuthService>(
      () => AuthService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<UserService>()) {
    getIt.registerLazySingleton<UserService>(
      () => UserService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<RideService>()) {
    getIt.registerLazySingleton<RideService>(
      () => RideService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<FoodService>()) {
    getIt.registerLazySingleton<FoodService>(
      () => FoodService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<DeliveryService>()) {
    getIt.registerLazySingleton<DeliveryService>(
      () => DeliveryService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<PaymentService>()) {
    getIt.registerLazySingleton<PaymentService>(
      () => PaymentService(dio, baseUrl: baseUrl),
    );
  }
  if (!getIt.isRegistered<NotificationService>()) {
    getIt.registerLazySingleton<NotificationService>(
      () => NotificationService(dio, baseUrl: baseUrl),
    );
  }
}
