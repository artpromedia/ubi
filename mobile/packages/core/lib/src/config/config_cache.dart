/// On-device cache for the city config document.
///
/// Only the city config is written to disk. It is public policy data — fares,
/// currency, the emergency number — and it is the same for every user in the
/// city, so caching it is safe and lets a cold start render something honest
/// while the ETag revalidates.
///
/// Evaluated flags are deliberately NOT cached to disk. They are per-user, so
/// a stored ETag would let one account's evaluation be revalidated (and then
/// applied) under another account's session; and reusing a stored `true` while
/// the service is unreachable would fail open, which CLAUDE.md rule 5 forbids.
/// Flag revalidation state lives in memory for the life of the process only.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// A cached document plus the ETag to revalidate it with.
class CachedConfigDocument {
  const CachedConfigDocument({
    required this.body,
    required this.etag,
    required this.storedAt,
  });

  final Map<String, dynamic> body;
  final String? etag;
  final DateTime storedAt;
}

class ConfigCache {
  ConfigCache(this._prefs);

  /// Opens the cache backed by shared preferences.
  static Future<ConfigCache> open() async =>
      ConfigCache(await SharedPreferences.getInstance());

  static const String _prefix = 'ubi.config.city.';

  final SharedPreferences _prefs;

  static String _keyFor(String cityId) => '$_prefix$cityId';

  CachedConfigDocument? readCityConfig(String cityId) {
    final String? raw = _prefs.getString(_keyFor(cityId));
    if (raw == null || raw.isEmpty) {
      return null;
    }
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        return null;
      }
      final Object? body = decoded['body'];
      if (body is! Map<String, dynamic>) {
        return null;
      }
      final Object? etag = decoded['etag'];
      final Object? storedAt = decoded['storedAt'];
      return CachedConfigDocument(
        body: body,
        etag: etag is String && etag.isNotEmpty ? etag : null,
        storedAt: storedAt is String
            ? (DateTime.tryParse(storedAt) ?? DateTime.fromMillisecondsSinceEpoch(0))
            : DateTime.fromMillisecondsSinceEpoch(0),
      );
    } on FormatException {
      return null;
    }
  }

  Future<void> writeCityConfig(
    String cityId, {
    required Map<String, dynamic> body,
    required String? etag,
    required DateTime storedAt,
  }) async {
    final String raw = jsonEncode(<String, dynamic>{
      'body': body,
      'etag': etag,
      'storedAt': storedAt.toUtc().toIso8601String(),
    });
    await _prefs.setString(_keyFor(cityId), raw);
  }

  Future<void> clearCityConfig(String cityId) async {
    await _prefs.remove(_keyFor(cityId));
  }
}
