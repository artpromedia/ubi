/// City config, feature flags and the formatters that read them.
///
/// A standalone entry point (`package:ubi_core/ubi_config.dart`) so an app can
/// take the config layer on its own.
///
/// Contracts: `packages/contracts/src/city-config.ts`,
/// `packages/contracts/src/flags.ts`,
/// `contracts/openapi/support-config.yaml`.
library;

export 'src/config/city_config.dart';
export 'src/config/city_source.dart';
export 'src/config/config_api.dart';
export 'src/config/config_bootstrap.dart';
export 'src/config/config_cache.dart';
export 'src/config/config_cubit.dart';
export 'src/config/config_failure.dart';
export 'src/config/config_repository.dart';
export 'src/config/feature_flags.dart';
export 'src/config/flag_gate.dart';
export 'src/config/json_read.dart';
export 'src/config/money.dart';
export 'src/config/money_formatter.dart';
