/// Integration Test Configuration
///
/// Central configuration for E2E tests including timeouts, test users,
/// and environment settings.
library;

import 'dart:io';

/// Test environment configuration
class TestConfig {
  TestConfig._();

  /// Test environment (staging, dev, local)
  static String get environment =>
      Platform.environment['TEST_ENV'] ?? 'staging';

  /// API base URL for test environment
  static String get apiBaseUrl {
    switch (environment) {
      case 'local':
        return 'http://localhost:3000';
      case 'dev':
        return 'https://api-dev.ubi.co.ke';
      case 'staging':
      default:
        return 'https://api-staging.ubi.co.ke';
    }
  }

  /// WebSocket URL for real-time updates
  static String get wsUrl {
    switch (environment) {
      case 'local':
        return 'ws://localhost:3001';
      case 'dev':
        return 'wss://ws-dev.ubi.co.ke';
      case 'staging':
      default:
        return 'wss://ws-staging.ubi.co.ke';
    }
  }

  /// Whether to use mock services
  static bool get useMocks =>
      Platform.environment['USE_MOCKS']?.toLowerCase() == 'true';

  /// Test timeouts
  static const Duration defaultTimeout = Duration(seconds: 30);
  static const Duration longTimeout = Duration(minutes: 2);
  static const Duration shortTimeout = Duration(seconds: 10);
  static const Duration animationDuration = Duration(milliseconds: 500);
  static const Duration networkDelay = Duration(seconds: 2);

  /// Retry configuration for flaky test mitigation
  static const int maxRetries = 3;
  static const Duration retryDelay = Duration(seconds: 2);

  /// Screenshot configuration
  static const bool captureScreenshotsOnFailure = true;
  static String get screenshotDir =>
      Platform.environment['SCREENSHOT_DIR'] ?? 'test_screenshots';

  /// Test parallelization
  static int get parallelTestCount =>
      int.tryParse(Platform.environment['PARALLEL_TESTS'] ?? '1') ?? 1;
}

/// Test user credentials for different scenarios
class TestUsers {
  TestUsers._();

  /// Standard test user with complete profile
  static const standardUser = TestUser(
    phoneNumber: '+254700000001',
    otp: '123456',
    name: 'Test User',
    email: 'testuser@ubi.co.ke',
    hasPaymentMethods: true,
    hasSavedPlaces: true,
  );

  /// New user for onboarding tests
  static const newUser = TestUser(
    phoneNumber: '+254700000002',
    otp: '123456',
    name: '',
    email: '',
    hasPaymentMethods: false,
    hasSavedPlaces: false,
  );

  /// User with payment method issues
  static const paymentFailUser = TestUser(
    phoneNumber: '+254700000003',
    otp: '123456',
    name: 'Payment Fail User',
    email: 'paymentfail@ubi.co.ke',
    hasPaymentMethods: true,
    hasSavedPlaces: true,
    forcePaymentFailure: true,
  );

  /// User with network issues
  static const networkIssueUser = TestUser(
    phoneNumber: '+254700000004',
    otp: '123456',
    name: 'Network Issue User',
    email: 'networkissue@ubi.co.ke',
    hasPaymentMethods: true,
    hasSavedPlaces: true,
    simulateNetworkIssues: true,
  );
}

/// Test user model
class TestUser {
  final String phoneNumber;
  final String otp;
  final String name;
  final String email;
  final bool hasPaymentMethods;
  final bool hasSavedPlaces;
  final bool forcePaymentFailure;
  final bool simulateNetworkIssues;

  const TestUser({
    required this.phoneNumber,
    required this.otp,
    required this.name,
    required this.email,
    this.hasPaymentMethods = false,
    this.hasSavedPlaces = false,
    this.forcePaymentFailure = false,
    this.simulateNetworkIssues = false,
  });
}

/// Test locations for geo-based tests
class TestLocations {
  TestLocations._();

  /// Nairobi CBD - common pickup location
  static const nairobiCbd = TestLocation(
    name: 'Nairobi CBD',
    latitude: -1.2864,
    longitude: 36.8172,
    address: 'Kenyatta Avenue, Nairobi CBD',
  );

  /// Westlands - common destination
  static const westlands = TestLocation(
    name: 'Westlands',
    latitude: -1.2673,
    longitude: 36.8110,
    address: 'Westlands Road, Westlands',
  );

  /// JKIA Airport
  static const jkiaAirport = TestLocation(
    name: 'JKIA Airport',
    latitude: -1.3192,
    longitude: 36.9275,
    address: 'Jomo Kenyatta International Airport',
  );

  /// Karen - residential area
  static const karen = TestLocation(
    name: 'Karen',
    latitude: -1.3226,
    longitude: 36.7140,
    address: 'Karen Road, Karen',
  );

  /// Test restaurant location
  static const testRestaurant = TestLocation(
    name: 'Test Restaurant',
    latitude: -1.2900,
    longitude: 36.8200,
    address: '123 Food Street, Nairobi',
  );
}

/// Test location model
class TestLocation {
  final String name;
  final double latitude;
  final double longitude;
  final String address;

  const TestLocation({
    required this.name,
    required this.latitude,
    required this.longitude,
    required this.address,
  });
}

/// Test payment methods
class TestPaymentMethods {
  TestPaymentMethods._();

  static const mpesaValid = TestPaymentMethod(
    type: 'mpesa',
    identifier: '+254700000001',
    name: 'M-Pesa',
    isDefault: true,
  );

  static const cardValid = TestPaymentMethod(
    type: 'card',
    identifier: '**** **** **** 4242',
    name: 'Visa ending in 4242',
    isDefault: false,
  );

  static const cardDeclined = TestPaymentMethod(
    type: 'card',
    identifier: '**** **** **** 0002',
    name: 'Visa ending in 0002',
    isDefault: false,
    willDecline: true,
  );
}

/// Test payment method model
class TestPaymentMethod {
  final String type;
  final String identifier;
  final String name;
  final bool isDefault;
  final bool willDecline;

  const TestPaymentMethod({
    required this.type,
    required this.identifier,
    required this.name,
    this.isDefault = false,
    this.willDecline = false,
  });
}
