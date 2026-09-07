import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_theming.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

import 'core/di/injection.dart';
import 'core/router/app_router.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/connectivity/bloc/connectivity_bloc.dart';

/// Main application widget.
///
/// The config cubit and the theme cubit are built in `main()` (both need
/// storage) and injected here, so the first frame already knows the stored
/// theme and starts from deny-all flags rather than flashing tiles that may
/// not exist in this city.
class UbiRiderApp extends StatelessWidget {
  const UbiRiderApp({
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
        // City config and evaluated flags — above the router so a deep link is
        // gated before its screen builds.
        BlocProvider<ConfigCubit>.value(value: configCubit),
        BlocProvider<UbiThemeModeCubit>.value(value: themeCubit),
        BlocProvider<AuthBloc>(
          create: (_) => getIt<AuthBloc>()..add(const AuthCheckRequested()),
        ),
        BlocProvider<ConnectivityBloc>(
          create: (_) =>
              getIt<ConnectivityBloc>()..add(const ConnectivityStarted()),
        ),
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
          title: 'UBI',
          debugShowCheckedModeBanner: false,

          // Both themes come from contracts/semantic-tokens.json. Rider ships
          // light-default; the stored choice wins (CLAUDE.md rule 10).
          theme: UbiTokenTheme.light,
          darkTheme: UbiTokenTheme.dark,
          themeMode: themeMode,

          routerConfig: AppRouter.router,

          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: const <Locale>[
            Locale('en'),
            Locale('fr'),
            Locale('sw'),
          ],

          builder: (BuildContext context, Widget? child) {
            // Foreground ETag poll for config and flags (slice 01).
            return ConfigRefreshOnResume(
              child: BlocListener<ConnectivityBloc, ConnectivityState>(
                listener: _onConnectivityChanged,
                child: child ?? const SizedBox.shrink(),
              ),
            );
          },
        );
      },
    );
  }

  static void _onConnectivityChanged(
    BuildContext context,
    ConnectivityState state,
  ) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    if (state is ConnectivityOffline) {
      final UbiSemanticColors colors = UbiSemanticColors.of(context);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'You are offline. Showing saved information.',
            style: UbiTokenTypography.bodyMedium.copyWith(color: colors.warnInk),
          ),
          backgroundColor: colors.warnTint,
          duration: const Duration(days: 1),
        ),
      );
    } else if (state is ConnectivityOnline) {
      messenger.hideCurrentSnackBar();
      // Reconnected: revalidate config and flags immediately rather than
      // waiting for the next foreground.
      unawaited(context.read<ConfigCubit>().refresh());
    }
  }
}
