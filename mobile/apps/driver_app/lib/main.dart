import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_theming.dart';
import 'package:ubi_storage/ubi_storage.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

import 'src/app.dart';
import 'src/core/di/injection.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.black,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  // Initialize dependencies
  await configureDependencies();

  // City config and feature flags, before the first frame so nothing renders
  // from a flag we have not been told about (CLAUDE.md rule 5).
  final configCubit = await ConfigBootstrap.createCubit(
    dio: ConfigBootstrap.dio(
      baseUrl: ConfigBootstrap.baseUrlFromEnvironment,
      accessToken: _accessToken,
    ),
  );

  // Driver ships dark-default; a stored choice wins (CLAUDE.md rule 10).
  final themeCubit = await UbiThemeModeCubit.open(
    appDefault: UbiApp.driver.defaultThemeMode,
  );

  unawaited(configCubit.load());

  runApp(UbiDriverApp(configCubit: configCubit, themeCubit: themeCubit));
}

/// Bearer for the config service. Flags are evaluated server-side from this
/// token; the app never sends a user id (server is authoritative).
Future<String?> _accessToken() async {
  if (!getIt.isRegistered<TokenStorage>()) {
    return null;
  }
  return getIt<TokenStorage>().getAccessToken();
}
