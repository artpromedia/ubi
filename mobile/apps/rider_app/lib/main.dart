import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_theming.dart';
import 'package:ubi_storage/ubi_storage.dart';

import 'src/app.dart';
import 'src/core/di/injection.dart';
import 'src/core/observers/bloc_observer.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // System UI
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );

  // Preferred orientations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Initialize Firebase
  await Firebase.initializeApp();

  // Crashlytics
  FlutterError.onError = (errorDetails) {
    FirebaseCrashlytics.instance.recordFlutterFatalError(errorDetails);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };

  // Initialize dependencies
  await configureDependencies();

  // Setup BLoC observer
  Bloc.observer = AppBlocObserver();

  // City config and feature flags. Built before runApp so the first frame
  // starts from deny-all rather than flashing a vertical that may not run
  // here (CLAUDE.md rule 5). No fetch is awaited: the load below runs in the
  // background and the UI renders its loading state meanwhile.
  final configCubit = await ConfigBootstrap.createCubit(
    dio: ConfigBootstrap.dio(
      baseUrl: ConfigBootstrap.baseUrlFromEnvironment,
      accessToken: _accessToken,
    ),
  );

  // Rider ships light-default; a stored choice wins (CLAUDE.md rule 10).
  final themeCubit = await UbiThemeModeCubit.open(appDefault: ThemeMode.light);

  unawaited(configCubit.load());

  runApp(UbiRiderApp(configCubit: configCubit, themeCubit: themeCubit));
}

/// Bearer for the config service. Flags are evaluated server-side from this
/// token; the app never sends a user id (server is authoritative).
Future<String?> _accessToken() async {
  if (!getIt.isRegistered<TokenStorage>()) {
    return null;
  }
  return getIt<TokenStorage>().getAccessToken();
}
