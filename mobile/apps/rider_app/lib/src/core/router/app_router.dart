import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ubi_core/ubi_config.dart';

import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/auth/pages/login_page.dart';
import '../../features/auth/pages/otp_page.dart';
import '../../features/auth/pages/register_page.dart';
import '../../features/delivery/pages/delivery_details_page.dart';
import '../../features/delivery/pages/delivery_new_page.dart';
import '../../features/delivery/pages/delivery_tracking_page.dart';
import '../../features/food/pages/cart_page.dart';
import '../../features/food/pages/order_details_page.dart';
import '../../features/food/pages/order_tracking_page.dart';
import '../../features/food/pages/restaurant_detail_page.dart';
import '../../features/food/pages/restaurants_page.dart';
import '../../features/home/pages/home_tiles_page.dart';
import '../../features/onboarding/pages/onboarding_page.dart';
import '../../features/profile/pages/edit_profile_page.dart';
import '../../features/profile/pages/payment_methods_page.dart';
import '../../features/profile/pages/profile_page.dart';
import '../../features/profile/pages/saved_places_page.dart';
import '../../features/profile/pages/settings_page.dart';
import '../../features/ride/pages/ride_details_page.dart';
import '../../features/ride/pages/ride_search_page.dart';
import '../../features/ride/pages/ride_tracking_page.dart';
import '../../features/splash/pages/splash_page.dart';
import '../di/injection.dart';

/// Route names.
///
/// These strings are the deep-link surface, so they must match the `GoRoute`
/// paths below exactly.
abstract class Routes {
  // Splash & Onboarding
  static const splash = '/';
  static const onboarding = '/onboarding';

  // Auth
  static const login = '/login';
  static const otp = '/otp';
  static const register = '/register';

  // Home
  static const home = '/home';

  // Move
  static const rideSearch = '/home/ride/search';

  static String rideTracking(String rideId) => '/home/ride/$rideId/tracking';

  static String rideDetails(String rideId) => '/home/ride/$rideId/details';

  // Bites
  static const foodRestaurants = '/home/food/restaurants';
  static const foodCart = '/home/food/cart';

  static String foodRestaurant(String restaurantId) =>
      '/home/food/restaurant/$restaurantId';

  static String foodOrderTracking(String orderId) =>
      '/home/food/order/$orderId/tracking';

  static String foodOrderDetails(String orderId) =>
      '/home/food/order/$orderId/details';

  // Send
  static const deliveryNew = '/home/delivery/new';

  static String deliveryTracking(String deliveryId) =>
      '/home/delivery/$deliveryId/tracking';

  static String deliveryDetails(String deliveryId) =>
      '/home/delivery/$deliveryId/details';

  // Profile
  static const profile = '/profile';
  static const editProfile = '/profile/edit';
  static const savedPlaces = '/profile/places';
  static const paymentMethods = '/profile/payments';
  static const settings = '/profile/settings';
}

/// App router configuration.
class AppRouter {
  static final _rootNavigatorKey = GlobalKey<NavigatorState>();

  static final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: Routes.splash,
    debugLogDiagnostics: true,
    redirect: _guardRoute,
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (context, state) => const SplashPage(),
      ),
      GoRoute(
        path: Routes.onboarding,
        builder: (context, state) => const OnboardingPage(),
      ),

      // Auth routes
      GoRoute(
        path: Routes.login,
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: Routes.otp,
        builder: (context, state) {
          final extras = state.extra as Map<String, dynamic>?;
          final verificationId = extras?['verificationId'];
          return OtpPage(
            verificationId: verificationId is String ? verificationId : '',
          );
        },
      ),
      GoRoute(
        path: Routes.register,
        builder: (context, state) => const RegisterPage(),
      ),

      // Home
      GoRoute(
        path: Routes.home,
        builder: (context, state) => HomeTilesPage(
          onOpenSearch: () => context.go(Routes.rideSearch),
          onOpenSavedPlaces: () => context.go(Routes.savedPlaces),
          onOpenVertical: (vertical) => context.go(_homeFor(vertical)),
        ),
        routes: [
          // Move
          GoRoute(
            path: 'ride/search',
            builder: (context, state) => _gate(
              context,
              UbiFlag.move,
              'UBI Move',
              const RideSearchPage(),
            ),
          ),
          GoRoute(
            path: 'ride/:rideId/tracking',
            builder: (context, state) => _gate(
              context,
              UbiFlag.move,
              'UBI Move',
              RideTrackingPage(rideId: state.pathParameters['rideId']!),
            ),
          ),
          GoRoute(
            path: 'ride/:rideId/details',
            builder: (context, state) => _gate(
              context,
              UbiFlag.move,
              'UBI Move',
              RideDetailsPage(rideId: state.pathParameters['rideId']!),
            ),
          ),

          // Bites
          GoRoute(
            path: 'food/restaurants',
            builder: (context, state) => _gate(
              context,
              UbiFlag.bites,
              'UBI Bites',
              const RestaurantsPage(),
            ),
          ),
          GoRoute(
            path: 'food/restaurant/:restaurantId',
            builder: (context, state) => _gate(
              context,
              UbiFlag.bites,
              'UBI Bites',
              RestaurantDetailPage(
                restaurantId: state.pathParameters['restaurantId']!,
              ),
            ),
          ),
          GoRoute(
            path: 'food/cart',
            builder: (context, state) => _gate(
              context,
              UbiFlag.bites,
              'UBI Bites',
              const CartPage(),
            ),
          ),
          GoRoute(
            path: 'food/order/:orderId/tracking',
            builder: (context, state) => _gate(
              context,
              UbiFlag.bites,
              'UBI Bites',
              OrderTrackingPage(orderId: state.pathParameters['orderId']!),
            ),
          ),
          GoRoute(
            path: 'food/order/:orderId/details',
            builder: (context, state) => _gate(
              context,
              UbiFlag.bites,
              'UBI Bites',
              OrderDetailsPage(orderId: state.pathParameters['orderId']!),
            ),
          ),

          // Send
          GoRoute(
            path: 'delivery/new',
            builder: (context, state) => _gate(
              context,
              UbiFlag.send,
              'UBI Send',
              const DeliveryNewPage(),
            ),
          ),
          GoRoute(
            path: 'delivery/:deliveryId/tracking',
            builder: (context, state) => _gate(
              context,
              UbiFlag.send,
              'UBI Send',
              DeliveryTrackingPage(
                deliveryId: state.pathParameters['deliveryId']!,
              ),
            ),
          ),
          GoRoute(
            path: 'delivery/:deliveryId/details',
            builder: (context, state) => _gate(
              context,
              UbiFlag.send,
              'UBI Send',
              DeliveryDetailsPage(
                deliveryId: state.pathParameters['deliveryId']!,
              ),
            ),
          ),
        ],
      ),

      // Profile routes
      GoRoute(
        path: Routes.profile,
        builder: (context, state) => const ProfilePage(),
        routes: [
          GoRoute(
            path: 'edit',
            builder: (context, state) => const EditProfilePage(),
          ),
          GoRoute(
            path: 'places',
            builder: (context, state) => const SavedPlacesPage(),
          ),
          GoRoute(
            path: 'payments',
            builder: (context, state) => const PaymentMethodsPage(),
          ),
          GoRoute(
            path: 'settings',
            builder: (context, state) => const SettingsPage(),
          ),
        ],
      ),
    ],
  );

  /// Wraps a vertical's screen so a deep link into a disabled vertical lands on
  /// the honest "not available here" screen (`common.flagOff.screen`) instead
  /// of a broken page or a silent no-op (CLAUDE.md rules 5 and 8).
  static Widget _gate(
    BuildContext context,
    UbiFlag flag,
    String featureName,
    Widget child,
  ) {
    return FlagGatedRoute(
      flag: flag,
      featureName: featureName,
      onDismiss: () => context.go(Routes.home),
      child: child,
    );
  }

  static String _homeFor(UbiFlag vertical) {
    switch (vertical) {
      case UbiFlag.bites:
        return Routes.foodRestaurants;
      case UbiFlag.send:
        return Routes.deliveryNew;
      case UbiFlag.move:
      case UbiFlag.travel:
      case UbiFlag.stays:
      case UbiFlag.journeys:
      case UbiFlag.reservations:
      case UbiFlag.fleet:
      case UbiFlag.walletP2p:
      case UbiFlag.walletNip:
      case UbiFlag.tips:
      case UbiFlag.scheduledRides:
      case UbiFlag.recording:
      case UbiFlag.driverOnline:
      case UbiFlag.rideRequest:
      case UbiFlag.providerPayments:
        return Routes.rideSearch;
    }
  }

  /// Route guard for authentication.
  static String? _guardRoute(BuildContext context, GoRouterState state) {
    final authState = getIt<AuthBloc>().state;
    final isAuthenticated = authState is AuthAuthenticated;
    final isAuthRoute = state.matchedLocation == Routes.login ||
        state.matchedLocation == Routes.otp ||
        state.matchedLocation == Routes.register;
    final isSplashRoute = state.matchedLocation == Routes.splash;
    final isOnboardingRoute = state.matchedLocation == Routes.onboarding;

    if (isSplashRoute || isOnboardingRoute) {
      return null;
    }

    if (!isAuthenticated && !isAuthRoute) {
      return Routes.login;
    }

    if (isAuthenticated && isAuthRoute) {
      return Routes.home;
    }

    return null;
  }
}
