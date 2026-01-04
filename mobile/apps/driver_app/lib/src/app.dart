import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ubi_ui_kit/ubi_ui_kit.dart';

import 'core/di/injection.dart';
import 'core/router/app_router.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/connectivity/bloc/connectivity_bloc.dart';
import 'features/driver/bloc/driver_bloc.dart';

/// Main application widget for Driver App
class UbiDriverApp extends StatelessWidget {
  const UbiDriverApp({super.key});

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
        BlocProvider(
          create: (_) => getIt<DriverBloc>(),
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
      title: 'UBI Driver',
      debugShowCheckedModeBanner: false,

      // Theme - Driver app uses a darker primary color
      theme: _buildDriverTheme(Brightness.light),
      darkTheme: _buildDriverTheme(Brightness.dark),
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
        Locale('sw'), // Swahili
        Locale('fr'), // French
      ],
    );
  }

  ThemeData _buildDriverTheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    
    // Driver app uses a green primary color to differentiate from rider app
    const primaryColor = Color(0xFF00A86B); // Jade green
    const secondaryColor = Color(0xFF1A1A2E);
    
    final colorScheme = ColorScheme.fromSeed(
      seedColor: primaryColor,
      brightness: brightness,
      primary: primaryColor,
      secondary: secondaryColor,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      brightness: brightness,
      fontFamily: 'Inter',
      
      appBarTheme: AppBarTheme(
        centerTitle: true,
        elevation: 0,
        backgroundColor: isDark ? colorScheme.surface : Colors.white,
        foregroundColor: isDark ? Colors.white : Colors.black,
      ),
      
      cardTheme: CardTheme(
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? Colors.grey[900] : Colors.grey[100],
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: primaryColor, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
    );
  }
}
