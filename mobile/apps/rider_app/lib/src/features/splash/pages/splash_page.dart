import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ubi_storage/ubi_storage.dart';

import '../../auth/bloc/auth_bloc.dart';
import '../../../core/di/injection.dart';
import '../../../core/router/app_router.dart';

/// Splash screen shown while app initializes
class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage> {
  @override
  void initState() {
    super.initState();
    _checkInitialRoute();
  }

  Future<void> _checkInitialRoute() async {
    // Wait for auth check to complete
    await Future.delayed(const Duration(seconds: 2));

    if (!mounted) return;

    final authState = context.read<AuthBloc>().state;
    final prefs = getIt<AppPreferences>();

    // Check if onboarding completed
    if (!prefs.hasCompletedOnboarding) {
      context.go(Routes.onboarding);
      return;
    }

    // Check auth state
    if (authState is AuthAuthenticated) {
      context.go(Routes.home);
    } else {
      context.go(Routes.login);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor,
                borderRadius: BorderRadius.circular(30),
              ),
              child: const Icon(
                Icons.directions_car,
                size: 60,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'UBI',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your ride, your food, delivered',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Colors.grey,
                  ),
            ),
            const SizedBox(height: 48),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
