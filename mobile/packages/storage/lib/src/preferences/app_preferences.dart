/// App Preferences
///
/// Manages non-sensitive app settings and preferences.
library;

import 'dart:convert';

import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Keys for app preferences
abstract class PreferenceKeys {
  // Onboarding
  static const hasCompletedOnboarding = 'has_completed_onboarding';
  static const hasSeenPermissionIntro = 'has_seen_permission_intro';

  // User Preferences
  static const preferredLanguage = 'preferred_language';
  static const preferredCurrency = 'preferred_currency';
  static const preferredPaymentMethod = 'preferred_payment_method';

  // Ride Preferences
  static const defaultVehicleType = 'default_vehicle_type';
  static const savedPickupLocations = 'saved_pickup_locations';
  static const savedDropoffLocations = 'saved_dropoff_locations';

  // Notifications
  static const pushNotificationsEnabled = 'push_notifications_enabled';
  static const rideNotificationsEnabled = 'ride_notifications_enabled';
  static const orderNotificationsEnabled = 'order_notifications_enabled';
  static const promoNotificationsEnabled = 'promo_notifications_enabled';

  // App Settings
  static const themeMode = 'theme_mode'; // light, dark, system
  static const mapStyle = 'map_style';
  static const hapticFeedbackEnabled = 'haptic_feedback_enabled';
  static const soundEffectsEnabled = 'sound_effects_enabled';

  // Cache Control
  static const lastCacheCleared = 'last_cache_cleared';
  static const lastSync = 'last_sync';
}

/// App preferences storage
@lazySingleton
class AppPreferences {
  AppPreferences(this._prefs);

  final SharedPreferences _prefs;

  /// Factory to create with async initialization
  static Future<AppPreferences> create() async {
    final prefs = await SharedPreferences.getInstance();
    return AppPreferences(prefs);
  }

  // === Onboarding ===

  bool get hasCompletedOnboarding =>
      _prefs.getBool(PreferenceKeys.hasCompletedOnboarding) ?? false;

  Future<void> setOnboardingCompleted(bool value) =>
      _prefs.setBool(PreferenceKeys.hasCompletedOnboarding, value);

  bool get hasSeenPermissionIntro =>
      _prefs.getBool(PreferenceKeys.hasSeenPermissionIntro) ?? false;

  Future<void> setPermissionIntroSeen(bool value) =>
      _prefs.setBool(PreferenceKeys.hasSeenPermissionIntro, value);

  // === User Preferences ===

  String get preferredLanguage =>
      _prefs.getString(PreferenceKeys.preferredLanguage) ?? 'en';

  Future<void> setPreferredLanguage(String value) =>
      _prefs.setString(PreferenceKeys.preferredLanguage, value);

  String get preferredCurrency =>
      _prefs.getString(PreferenceKeys.preferredCurrency) ?? 'USD';

  Future<void> setPreferredCurrency(String value) =>
      _prefs.setString(PreferenceKeys.preferredCurrency, value);

  String? get preferredPaymentMethod =>
      _prefs.getString(PreferenceKeys.preferredPaymentMethod);

  Future<void> setPreferredPaymentMethod(String? value) => value != null
      ? _prefs.setString(PreferenceKeys.preferredPaymentMethod, value)
      : _prefs.remove(PreferenceKeys.preferredPaymentMethod);

  // === Ride Preferences ===

  String get defaultVehicleType =>
      _prefs.getString(PreferenceKeys.defaultVehicleType) ?? 'standard';

  Future<void> setDefaultVehicleType(String value) =>
      _prefs.setString(PreferenceKeys.defaultVehicleType, value);

  // === Notifications ===

  bool get pushNotificationsEnabled =>
      _prefs.getBool(PreferenceKeys.pushNotificationsEnabled) ?? true;

  Future<void> setPushNotificationsEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.pushNotificationsEnabled, value);

  bool get rideNotificationsEnabled =>
      _prefs.getBool(PreferenceKeys.rideNotificationsEnabled) ?? true;

  Future<void> setRideNotificationsEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.rideNotificationsEnabled, value);

  bool get orderNotificationsEnabled =>
      _prefs.getBool(PreferenceKeys.orderNotificationsEnabled) ?? true;

  Future<void> setOrderNotificationsEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.orderNotificationsEnabled, value);

  bool get promoNotificationsEnabled =>
      _prefs.getBool(PreferenceKeys.promoNotificationsEnabled) ?? true;

  Future<void> setPromoNotificationsEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.promoNotificationsEnabled, value);

  // === App Settings ===

  String get themeMode => _prefs.getString(PreferenceKeys.themeMode) ?? 'system';

  Future<void> setThemeMode(String value) =>
      _prefs.setString(PreferenceKeys.themeMode, value);

  String get mapStyle => _prefs.getString(PreferenceKeys.mapStyle) ?? 'default';

  Future<void> setMapStyle(String value) =>
      _prefs.setString(PreferenceKeys.mapStyle, value);

  bool get hapticFeedbackEnabled =>
      _prefs.getBool(PreferenceKeys.hapticFeedbackEnabled) ?? true;

  Future<void> setHapticFeedbackEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.hapticFeedbackEnabled, value);

  bool get soundEffectsEnabled =>
      _prefs.getBool(PreferenceKeys.soundEffectsEnabled) ?? true;

  Future<void> setSoundEffectsEnabled(bool value) =>
      _prefs.setBool(PreferenceKeys.soundEffectsEnabled, value);

  // === Cache Control ===

  DateTime? get lastCacheCleared {
    final value = _prefs.getString(PreferenceKeys.lastCacheCleared);
    return value != null ? DateTime.tryParse(value) : null;
  }

  Future<void> setLastCacheCleared(DateTime value) =>
      _prefs.setString(PreferenceKeys.lastCacheCleared, value.toIso8601String());

  DateTime? get lastSync {
    final value = _prefs.getString(PreferenceKeys.lastSync);
    return value != null ? DateTime.tryParse(value) : null;
  }

  Future<void> setLastSync(DateTime value) =>
      _prefs.setString(PreferenceKeys.lastSync, value.toIso8601String());

  // === Generic Methods ===

  /// Get a string list
  List<String>? getStringList(String key) => _prefs.getStringList(key);

  /// Set a string list
  Future<void> setStringList(String key, List<String> value) =>
      _prefs.setStringList(key, value);

  /// Get a JSON object
  Map<String, dynamic>? getJson(String key) {
    final value = _prefs.getString(key);
    if (value == null) return null;
    try {
      return json.decode(value) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Set a JSON object
  Future<void> setJson(String key, Map<String, dynamic> value) =>
      _prefs.setString(key, json.encode(value));

  /// Remove a key
  Future<void> remove(String key) => _prefs.remove(key);

  /// Clear all preferences
  Future<void> clear() => _prefs.clear();

  /// Check if a key exists
  bool containsKey(String key) => _prefs.containsKey(key);
}
