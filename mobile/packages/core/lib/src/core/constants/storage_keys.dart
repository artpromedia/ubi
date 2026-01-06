/// Storage key constants for local storage
class StorageKeys {
  StorageKeys._();

  // Authentication
  static const String accessToken = 'access_token';
  static const String refreshToken = 'refresh_token';
  static const String userId = 'user_id';
  
  // User preferences
  static const String themeMode = 'theme_mode';
  static const String locale = 'locale';
  static const String notificationsEnabled = 'notifications_enabled';
  
  // Location
  static const String lastKnownLatitude = 'last_known_latitude';
  static const String lastKnownLongitude = 'last_known_longitude';
  static const String savedAddresses = 'saved_addresses';
  
  // App state
  static const String onboardingComplete = 'onboarding_complete';
  static const String lastAppVersion = 'last_app_version';
  
  // Cache
  static const String userProfileCache = 'user_profile_cache';
  static const String recentSearches = 'recent_searches';
}
