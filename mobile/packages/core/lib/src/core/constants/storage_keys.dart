/// Storage Keys
///
/// Contains keys for local storage and secure storage.
library;

/// Storage keys for persistent data
abstract class StorageKeys {
  // === Auth Keys ===
  static const String accessToken = 'access_token';
  static const String refreshToken = 'refresh_token';
  static const String userId = 'user_id';
  static const String userEmail = 'user_email';

  // === Preferences Keys ===
  static const String themeMode = 'theme_mode';
  static const String locale = 'locale';
  static const String onboardingCompleted = 'onboarding_completed';
  static const String notificationsEnabled = 'notifications_enabled';
  static const String biometricEnabled = 'biometric_enabled';

  // === Cache Keys ===
  static const String cachedUser = 'cached_user';
  static const String cachedRides = 'cached_rides';
  static const String cachedOrders = 'cached_orders';
  static const String lastSyncTime = 'last_sync_time';

  // === Location Keys ===
  static const String savedAddresses = 'saved_addresses';
  static const String recentSearches = 'recent_searches';
  static const String homeAddress = 'home_address';
  static const String workAddress = 'work_address';
}
