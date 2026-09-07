/// Which city the app is operating in.
///
/// There is no hard-coded default. When no city is known the config layer
/// reports [ConfigUnavailableReason.noCity] and every flag stays off, which is
/// the honest state — better than guessing a market and showing its fares.
library;

import 'package:shared_preferences/shared_preferences.dart';

abstract class CitySource {
  /// The active city id, or null when none has been established.
  Future<String?> currentCityId();

  /// Records the city the server assigned to this session.
  Future<void> setCityId(String cityId);
}

class StoredCitySource implements CitySource {
  StoredCitySource(this._prefs);

  static Future<StoredCitySource> open() async =>
      StoredCitySource(await SharedPreferences.getInstance());

  /// Preference key holding the city id the server told us to use.
  static const String storageKey = 'ubi.city_id';

  /// Build-time city for development and integration builds
  /// (`--dart-define=UBI_CITY_ID=LOS`). Empty in a normal build.
  static const String buildTimeCityId = String.fromEnvironment('UBI_CITY_ID');

  final SharedPreferences _prefs;

  @override
  Future<String?> currentCityId() async {
    final String? stored = _prefs.getString(storageKey);
    if (stored != null && stored.isNotEmpty) {
      return stored;
    }
    return buildTimeCityId.isEmpty ? null : buildTimeCityId;
  }

  @override
  Future<void> setCityId(String cityId) async {
    await _prefs.setString(storageKey, cityId);
  }
}
