/// Theme mode, persisted per device.
///
/// The rider app ships light-default and the driver app dark-default; both are
/// switchable and the choice survives a restart (CLAUDE.md rule 10). The
/// default is passed in rather than baked in, so neither app's preference is
/// hard-coded in the shared package.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/constants/storage_keys.dart';

class UbiThemeModeCubit extends Cubit<ThemeMode> {
  UbiThemeModeCubit({required ThemeMode appDefault, SharedPreferences? prefs})
      : _appDefault = appDefault,
        _prefs = prefs,
        super(_read(prefs) ?? appDefault);

  /// Builds the cubit with preferences already open, so the first frame is
  /// painted in the stored theme instead of flashing the default.
  static Future<UbiThemeModeCubit> open({required ThemeMode appDefault}) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return UbiThemeModeCubit(appDefault: appDefault, prefs: prefs);
  }

  final ThemeMode _appDefault;
  final SharedPreferences? _prefs;

  /// The app's shipped default, for a "reset to default" affordance.
  ThemeMode get appDefault => _appDefault;

  Future<void> set(ThemeMode mode) async {
    if (mode == state) {
      return;
    }
    emit(mode);
    await _prefs?.setString(StorageKeys.themeMode, mode.name);
  }

  /// Convenience for a single switch tile: on means dark, off means light.
  Future<void> setDark({required bool dark}) =>
      set(dark ? ThemeMode.dark : ThemeMode.light);

  /// Follow the device setting again.
  Future<void> followSystem() => set(ThemeMode.system);

  static ThemeMode? _read(SharedPreferences? prefs) {
    final String? stored = prefs?.getString(StorageKeys.themeMode);
    if (stored == null) {
      return null;
    }
    for (final ThemeMode mode in ThemeMode.values) {
      if (mode.name == stored) {
        return mode;
      }
    }
    return null;
  }
}
