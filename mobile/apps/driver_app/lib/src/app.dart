import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_theming.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

import 'core/di/injection.dart';
import 'core/router/app_router.dart';
import 'features/driver/bloc/driver_bloc.dart';

/// Main application widget for the Driver App.
///
/// The theme is the shared token theme, dark by default (CLAUDE.md rule 10).
/// The previous version built its own palette around a jade green that is not
/// in `contracts/semantic-tokens.json`; that is gone.
class UbiDriverApp extends StatelessWidget {
  const UbiDriverApp({
    required this.configCubit,
    required this.themeCubit,
    super.key,
  });

  final ConfigCubit configCubit;
  final UbiThemeModeCubit themeCubit;

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<ConfigCubit>.value(value: configCubit),
        BlocProvider<UbiThemeModeCubit>.value(value: themeCubit),
        BlocProvider<DriverBloc>(create: (_) => getIt<DriverBloc>()),
      ],
      child: const _AppView(),
    );
  }
}

class _AppView extends StatelessWidget {
  const _AppView();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<UbiThemeModeCubit, ThemeMode>(
      builder: (BuildContext context, ThemeMode themeMode) {
        return MaterialApp.router(
          title: 'UBI Driver',
          debugShowCheckedModeBanner: false,

          theme: UbiTokenTheme.light,
          darkTheme: UbiTokenTheme.dark,
          themeMode: themeMode,

          routerConfig: appRouter,

          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: const [
            Locale('en'),
            Locale('sw'),
            Locale('fr'),
          ],

          builder: (BuildContext context, Widget? child) {
            // Foreground ETag poll for config and flags (slice 01).
            return ConfigRefreshOnResume(
              child: child ?? const SizedBox.shrink(),
            );
          },
        );
      },
    );
  }
}
