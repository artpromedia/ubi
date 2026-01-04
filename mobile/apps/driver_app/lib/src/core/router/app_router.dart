import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/otp_verification_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/documents/presentation/pages/documents_page.dart';
import '../../features/documents/presentation/pages/upload_document_page.dart';
import '../../features/earnings/presentation/pages/earnings_page.dart';
import '../../features/earnings/presentation/pages/payout_history_page.dart';
import '../../features/earnings/presentation/pages/trip_history_page.dart';
import '../../features/earnings/presentation/pages/trip_details_page.dart';
import '../../features/home/presentation/pages/home_page.dart';
import '../../features/navigation/presentation/pages/navigation_page.dart';
import '../../features/onboarding/presentation/pages/onboarding_page.dart';
import '../../features/profile/presentation/pages/profile_page.dart';
import '../../features/profile/presentation/pages/edit_profile_page.dart';
import '../../features/profile/presentation/pages/vehicle_page.dart';
import '../../features/profile/presentation/pages/settings_page.dart';
import '../../features/ratings/presentation/pages/ratings_page.dart';
import '../../features/splash/presentation/pages/splash_page.dart';
import '../../features/trips/presentation/pages/trip_request_page.dart';
import '../../features/trips/presentation/pages/active_trip_page.dart';

/// Route names for navigation
abstract class AppRoutes {
  // Initial routes
  static const splash = '/';
  static const onboarding = '/onboarding';

  // Auth routes
  static const login = '/login';
  static const register = '/register';
  static const otpVerification = '/otp-verification';

  // Main routes
  static const home = '/home';
  static const tripRequest = '/trip-request';
  static const activeTrip = '/active-trip';
  static const navigation = '/navigation';

  // Earnings routes
  static const earnings = '/earnings';
  static const tripHistory = '/earnings/history';
  static const tripDetails = '/earnings/trip/:tripId';
  static const payoutHistory = '/earnings/payouts';

  // Profile routes
  static const profile = '/profile';
  static const editProfile = '/profile/edit';
  static const vehicle = '/profile/vehicle';
  static const documents = '/profile/documents';
  static const uploadDocument = '/profile/documents/upload';
  static const ratings = '/profile/ratings';
  static const settings = '/settings';
}

/// App router configuration
final appRouter = GoRouter(
  initialLocation: AppRoutes.splash,
  debugLogDiagnostics: true,
  routes: [
    // Splash
    GoRoute(
      path: AppRoutes.splash,
      name: 'splash',
      builder: (context, state) => const SplashPage(),
    ),

    // Onboarding
    GoRoute(
      path: AppRoutes.onboarding,
      name: 'onboarding',
      builder: (context, state) => const OnboardingPage(),
    ),

    // Auth routes
    GoRoute(
      path: AppRoutes.login,
      name: 'login',
      builder: (context, state) => const LoginPage(),
    ),
    GoRoute(
      path: AppRoutes.register,
      name: 'register',
      builder: (context, state) => const RegisterPage(),
    ),
    GoRoute(
      path: AppRoutes.otpVerification,
      name: 'otp-verification',
      builder: (context, state) {
        final phone = state.extra as String? ?? '';
        return OtpVerificationPage(phoneNumber: phone);
      },
    ),

    // Main home (driver mode)
    GoRoute(
      path: AppRoutes.home,
      name: 'home',
      builder: (context, state) => const HomePage(),
    ),

    // Trip routes
    GoRoute(
      path: AppRoutes.tripRequest,
      name: 'trip-request',
      builder: (context, state) {
        final data = state.extra as Map<String, dynamic>?;
        return TripRequestPage(requestData: data ?? {});
      },
    ),
    GoRoute(
      path: AppRoutes.activeTrip,
      name: 'active-trip',
      builder: (context, state) {
        final tripId = state.extra as String? ?? '';
        return ActiveTripPage(tripId: tripId);
      },
    ),
    GoRoute(
      path: AppRoutes.navigation,
      name: 'navigation',
      builder: (context, state) {
        final data = state.extra as Map<String, dynamic>?;
        return NavigationPage(navigationData: data ?? {});
      },
    ),

    // Earnings routes
    GoRoute(
      path: AppRoutes.earnings,
      name: 'earnings',
      builder: (context, state) => const EarningsPage(),
    ),
    GoRoute(
      path: AppRoutes.tripHistory,
      name: 'trip-history',
      builder: (context, state) => const TripHistoryPage(),
    ),
    GoRoute(
      path: '/earnings/trip/:tripId',
      name: 'trip-details',
      builder: (context, state) {
        final tripId = state.pathParameters['tripId'] ?? '';
        return TripDetailsPage(tripId: tripId);
      },
    ),
    GoRoute(
      path: AppRoutes.payoutHistory,
      name: 'payout-history',
      builder: (context, state) => const PayoutHistoryPage(),
    ),

    // Profile routes
    GoRoute(
      path: AppRoutes.profile,
      name: 'profile',
      builder: (context, state) => const ProfilePage(),
    ),
    GoRoute(
      path: AppRoutes.editProfile,
      name: 'edit-profile',
      builder: (context, state) => const EditProfilePage(),
    ),
    GoRoute(
      path: AppRoutes.vehicle,
      name: 'vehicle',
      builder: (context, state) => const VehiclePage(),
    ),
    GoRoute(
      path: AppRoutes.documents,
      name: 'documents',
      builder: (context, state) => const DocumentsPage(),
    ),
    GoRoute(
      path: AppRoutes.uploadDocument,
      name: 'upload-document',
      builder: (context, state) {
        final documentType = state.extra as String? ?? '';
        return UploadDocumentPage(documentType: documentType);
      },
    ),
    GoRoute(
      path: AppRoutes.ratings,
      name: 'ratings',
      builder: (context, state) => const RatingsPage(),
    ),
    GoRoute(
      path: AppRoutes.settings,
      name: 'settings',
      builder: (context, state) => const SettingsPage(),
    ),
  ],

  // Error handling
  errorBuilder: (context, state) => Scaffold(
    body: Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.error_outline,
            size: 64,
            color: Colors.red,
          ),
          const SizedBox(height: 16),
          Text(
            'Page not found',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            state.uri.toString(),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => context.go(AppRoutes.home),
            child: const Text('Go Home'),
          ),
        ],
      ),
    ),
  ),

  // Redirect logic
  redirect: (context, state) {
    // Add authentication redirect logic here
    // final isAuthenticated = getIt<AuthBloc>().state.isAuthenticated;
    // final isOnAuthRoute = state.matchedLocation.startsWith('/login') ||
    //     state.matchedLocation.startsWith('/register') ||
    //     state.matchedLocation == '/onboarding';
    // 
    // if (!isAuthenticated && !isOnAuthRoute && state.matchedLocation != '/') {
    //   return AppRoutes.login;
    // }
    // if (isAuthenticated && isOnAuthRoute) {
    //   return AppRoutes.home;
    // }
    return null;
  },
);
