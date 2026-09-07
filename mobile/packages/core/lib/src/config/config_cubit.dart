/// App-side state for city config and feature flags.
///
/// One cubit per app, provided above the router so a deep link can be gated
/// before its screen builds. The initial state has [FlagSet.denyAll]: nothing
/// renders as available until the service says so.
library;

import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'city_config.dart';
import 'city_source.dart';
import 'config_failure.dart';
import 'config_repository.dart';
import 'feature_flags.dart';
import 'money_formatter.dart';

enum ConfigStatus {
  /// Nothing has been attempted yet.
  initial,

  /// A load is in flight.
  loading,

  /// A city config is available (possibly stale — check [ConfigState.isStale]).
  ready,

  /// No city config at all. The app can only show honest unavailability.
  unavailable,
}

class ConfigState extends Equatable {
  const ConfigState({
    this.status = ConfigStatus.initial,
    this.cityId,
    this.config,
    this.flags = FlagSet.denyAll,
    this.isStale = false,
    this.configReason,
    this.flagsReason,
    this.configStoredAt,
  });

  final ConfigStatus status;

  /// The city the rest of the state describes, or null when none is known.
  final String? cityId;

  final CityConfig? config;

  /// Never null. Deny-all until the service confirms otherwise.
  final FlagSet flags;

  /// [config] came from disk and could not be revalidated.
  final bool isStale;

  final ConfigUnavailableReason? configReason;

  /// Set whenever flags are denied because the service could not be reached.
  /// Screens use it to say "we could not check" instead of "not available".
  final ConfigUnavailableReason? flagsReason;

  /// When [config] was last confirmed by the service.
  final DateTime? configStoredAt;

  /// The only correct way for UI to read a flag.
  bool isEnabled(UbiFlag flag) => flags.isEnabled(flag);

  /// True when flags are off because we could not reach the service, rather
  /// than because the city genuinely does not run the feature.
  bool get flagsUnverified => flagsReason != null;

  /// Money formatter for the active city, or null when there is no config —
  /// in which case there is no honest way to render an amount.
  UbiMoneyFormatter? get money {
    final CityConfig? active = config;
    return active == null ? null : UbiMoneyFormatter.fromConfig(active);
  }

  /// Date formatter for the active city.
  UbiDateTimeFormatter? get dates {
    final CityConfig? active = config;
    return active == null ? null : UbiDateTimeFormatter.fromConfig(active);
  }

  /// The city's emergency number. Null when config is unavailable — a screen
  /// must then say the number could not be loaded, never substitute one.
  String? get emergencyNumber => config?.emergencyNumber;

  ConfigState copyWith({
    ConfigStatus? status,
    String? cityId,
    CityConfig? config,
    FlagSet? flags,
    bool? isStale,
    ConfigUnavailableReason? configReason,
    ConfigUnavailableReason? flagsReason,
    DateTime? configStoredAt,
    bool clearConfigReason = false,
    bool clearFlagsReason = false,
  }) {
    return ConfigState(
      status: status ?? this.status,
      cityId: cityId ?? this.cityId,
      config: config ?? this.config,
      flags: flags ?? this.flags,
      isStale: isStale ?? this.isStale,
      configReason:
          clearConfigReason ? null : (configReason ?? this.configReason),
      flagsReason: clearFlagsReason ? null : (flagsReason ?? this.flagsReason),
      configStoredAt: configStoredAt ?? this.configStoredAt,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        cityId,
        config,
        flags,
        isStale,
        configReason,
        flagsReason,
        configStoredAt,
      ];
}

class ConfigCubit extends Cubit<ConfigState> {
  ConfigCubit({
    required ConfigRepository repository,
    required CitySource citySource,
  })  : _repository = repository,
        _citySource = citySource,
        super(const ConfigState());

  final ConfigRepository _repository;
  final CitySource _citySource;

  bool _inFlight = false;

  /// Cold start and every foreground poll. Config and flags are fetched
  /// together so a screen never renders a tile from one and a fare from the
  /// other.
  Future<void> load() async {
    if (_inFlight) {
      return;
    }
    _inFlight = true;
    try {
      final String? cityId = await _citySource.currentCityId();
      if (cityId == null) {
        emit(
          const ConfigState(
            status: ConfigStatus.unavailable,
            configReason: ConfigUnavailableReason.noCity,
            flagsReason: ConfigUnavailableReason.noCity,
          ),
        );
        return;
      }

      if (state.status == ConfigStatus.initial) {
        emit(state.copyWith(status: ConfigStatus.loading, cityId: cityId));
      }

      final CityConfigOutcome configOutcome =
          await _repository.loadCityConfig(cityId);
      final FlagOutcome flagOutcome = await _repository.loadFlags(cityId);

      emit(
        ConfigState(
          status: configOutcome.isUsable
              ? ConfigStatus.ready
              : ConfigStatus.unavailable,
          cityId: cityId,
          config: configOutcome.config,
          flags: flagOutcome.flags,
          isStale: configOutcome.isStale,
          configReason: configOutcome.reason,
          flagsReason: flagOutcome.reason,
          configStoredAt: configOutcome.storedAt,
        ),
      );
    } finally {
      _inFlight = false;
    }
  }

  /// The foreground ETag poll (slice 01).
  Future<void> refresh() => load();

  /// Records the city the server assigned and reloads. Flag state from the
  /// previous city is dropped first.
  Future<void> selectCity(String cityId) async {
    if (cityId.isEmpty) {
      return;
    }
    _repository.forgetSession();
    await _citySource.setCityId(cityId);
    await load();
  }

  /// Call on sign-out: the next session must be evaluated from scratch.
  Future<void> signedOut() async {
    _repository.forgetSession();
    emit(const ConfigState());
  }
}

/// Re-runs the ETag poll whenever the app comes back to the foreground.
///
/// Wrap the app once, above the router.
class ConfigRefreshOnResume extends StatefulWidget {
  const ConfigRefreshOnResume({required this.child, super.key});

  final Widget child;

  @override
  State<ConfigRefreshOnResume> createState() => _ConfigRefreshOnResumeState();
}

class _ConfigRefreshOnResumeState extends State<ConfigRefreshOnResume>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      unawaited(context.read<ConfigCubit>().refresh());
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
