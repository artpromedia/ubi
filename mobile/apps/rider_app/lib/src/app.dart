import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ubi_ui_kit/ubi_ui_kit.dart';

import 'core/di/injection.dart';
import 'core/router/app_router.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/connectivity/bloc/connectivity_bloc.dart';

/// Main application widget
class UbiRiderApp extends StatelessWidget {
  const UbiRiderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        // Global blocs
        BlocProvider(
          create: (_) => getIt<AuthBloc>()..add(const AuthCheckRequested()),
        ),
        BlocProvider(
          create: (_) => getIt<ConnectivityBloc>()..add(const ConnectivityStarted()),
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
    final router = AppRouter.router;

    return MaterialApp.router(
      title: 'UBI',
      debugShowCheckedModeBanner: false,

      // Theme
      theme: UbiTheme.light,
      darkTheme: UbiTheme.dark,
      themeMode: ThemeMode.system,

      // Routing
      routerConfig: router,

      // Localization
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'),
        Locale('fr'),
        Locale('sw'), // Swahili
      ],

      // Builder for global overlays
      builder: (context, child) {
        return BlocListener<ConnectivityBloc, ConnectivityState>(
          listener: (context, state) {
            if (state is ConnectivityOffline) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('No internet connection'),
                  backgroundColor: Colors.red,
                  duration: Duration(days: 1),
                ),
              );
            } else if (state is ConnectivityOnline) {
              ScaffoldMessenger.of(context).hideCurrentSnackBar();
            }
          },
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
