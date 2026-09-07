/// Reads city config and flags, with an ETag revalidation loop and a hard
/// fail-closed rule for flags.
library;

import '../core/utils/logger.dart';
import 'city_config.dart';
import 'config_api.dart';
import 'config_cache.dart';
import 'config_failure.dart';
import 'feature_flags.dart';
import 'json_read.dart';

/// Outcome of loading the city config.
class CityConfigOutcome {
  const CityConfigOutcome({
    required this.config,
    required this.isStale,
    required this.reason,
    required this.storedAt,
  });

  /// The active config, or null when we have never successfully read one.
  final CityConfig? config;

  /// True when [config] came from disk and could not be revalidated. Screens
  /// must show the offline banner and [storedAt] in this state rather than
  /// pretending the numbers are current.
  final bool isStale;

  /// Why the last read failed, or null when it succeeded.
  final ConfigUnavailableReason? reason;

  /// When the returned document was last confirmed by the service.
  final DateTime? storedAt;

  bool get isUsable => config != null;
}

/// Outcome of evaluating flags.
///
/// [flags] is [FlagSet.denyAll] whenever [reason] is set. There is no path
/// through this class that returns an enabled flag the service did not just
/// confirm (CLAUDE.md rule 5).
class FlagOutcome {
  const FlagOutcome({required this.flags, required this.reason});

  const FlagOutcome.denied(ConfigUnavailableReason this.reason)
      : flags = FlagSet.denyAll;

  final FlagSet flags;
  final ConfigUnavailableReason? reason;
}

class ConfigRepository {
  ConfigRepository({required ConfigSource api, ConfigCache? cache})
      : _api = api,
        _cache = cache;

  final ConfigSource _api;
  final ConfigCache? _cache;

  /// Flag revalidation state. In memory only, and only for this session — see
  /// the note at the top of config_cache.dart.
  String? _flagEtag;
  FlagSet? _flagSet;

  /// Drops per-session flag state. Call on sign-out and on a city change so one
  /// session can never revalidate another's evaluation.
  void forgetSession() {
    _flagEtag = null;
    _flagSet = null;
  }

  Future<CityConfigOutcome> loadCityConfig(String cityId) async {
    CachedConfigDocument? cached = _cache?.readCityConfig(cityId);
    CityConfig? cachedConfig;
    if (cached != null) {
      try {
        cachedConfig = CityConfig.fromJson(cached.body);
      } on ConfigFormatException {
        // Written by an older build against an older contract. Drop it rather
        // than trust it.
        cachedConfig = null;
        cached = null;
        await _cache?.clearCityConfig(cityId);
      }
    }

    final ConfigResponse<CityConfig> response = await _api.fetchCityConfig(
      cityId: cityId,
      etag: cachedConfig == null ? null : cached?.etag,
    );

    if (response is ConfigPayload<CityConfig>) {
      final DateTime now = DateTime.now().toUtc();
      await _cache?.writeCityConfig(
        cityId,
        body: response.raw,
        etag: response.etag,
        storedAt: now,
      );
      return CityConfigOutcome(
        config: response.value,
        isStale: false,
        reason: null,
        storedAt: now,
      );
    }

    if (response is ConfigNotModified<CityConfig>) {
      if (cachedConfig == null) {
        AppLogger.w('config: 304 with no cached document');
        return const CityConfigOutcome(
          config: null,
          isStale: false,
          reason: ConfigUnavailableReason.malformed,
          storedAt: null,
        );
      }
      // Revalidated against a reachable service, so it is current, not stale.
      return CityConfigOutcome(
        config: cachedConfig,
        isStale: false,
        reason: null,
        storedAt: DateTime.now().toUtc(),
      );
    }

    final ConfigUnavailableReason reason = response is ConfigFailure<CityConfig>
        ? response.reason
        : ConfigUnavailableReason.serverError;
    AppLogger.w('config: city config unavailable (${reason.code})');
    return CityConfigOutcome(
      config: cachedConfig,
      isStale: cachedConfig != null,
      reason: reason,
      storedAt: cached?.storedAt,
    );
  }

  /// Evaluates flags. Any failure returns [FlagSet.denyAll].
  Future<FlagOutcome> loadFlags(String cityId) async {
    final ConfigResponse<FlagSet> response = await _api.fetchFlags(
      cityId: cityId,
      etag: _flagSet == null ? null : _flagEtag,
    );

    if (response is ConfigPayload<FlagSet>) {
      _flagSet = response.value;
      _flagEtag = response.etag;
      return FlagOutcome(flags: response.value, reason: null);
    }

    if (response is ConfigNotModified<FlagSet>) {
      final FlagSet? known = _flagSet;
      if (known == null) {
        AppLogger.w('flags: 304 with no evaluated set; denying all');
        return const FlagOutcome.denied(ConfigUnavailableReason.malformed);
      }
      return FlagOutcome(flags: known, reason: null);
    }

    final ConfigUnavailableReason reason = response is ConfigFailure<FlagSet>
        ? response.reason
        : ConfigUnavailableReason.serverError;
    AppLogger.w('flags: unavailable (${reason.code}); denying all');
    return FlagOutcome.denied(reason);
  }
}
