import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../di/injection.dart';
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
import '../../features/home/pages/home_page.dart';
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

/// Route names
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

  // Ride
  static const rideSearch = '/home/ride';
  static const rideTracking = '/home/ride/tracking';
  static const rideDetails = '/home/ride/details';

  // Food
  static const foodRestaurants = '/home/food';
  static const foodCart = '/home/food/cart';
  static const foodOrderTracking = '/home/food/order';
  static const foodOrderDetails = '/home/food/order/details';

  // Delivery
  static const deliveryNew = '/home/delivery';
  static const deliveryTracking = '/home/delivery/tracking';
  static const deliveryDetails = '/home/delivery/details';

  // Profile
  static const profile = '/profile';
  static const editProfile = '/profile/edit';
  static const savedPlaces = '/profile/places';
  static const paymentMethods = '/profile/payments';
  static const settings = '/profile/settings';
}

/// App router configuration
class AppRouter {
  static final _rootNavigatorKey = GlobalKey<NavigatorState>();

  static final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: Routes.splash,
    debugLogDiagnostics: true,
    redirect: _guardRoute,
    routes: [
      // Splash
      GoRoute(
        path: Routes.splash,
        builder: (context, state) => const SplashPage(),
      ),

      // Onboarding
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
          return OtpPage(
            phoneNumber: extras?['phoneNumber'] ?? '',
            countryCode: extras?['countryCode'] ?? '',
          );
        },
      ),
      GoRoute(
        path: Routes.register,
        builder: (context, state) {
          final extras = state.extra as Map<String, dynamic>?;
          return RegisterPage(
            phoneNumber: extras?['phoneNumber'] ?? '',
            countryCode: extras?['countryCode'] ?? '',
          );
        },
      ),

      // Home shell for bottom navigation
      ShellRoute(
        builder: (context, state, child) => HomePage(child: child),
        routes: [
          // Ride routes
          GoRoute(
            path: Routes.rideSearch,
            builder: (context, state) => const RideSearchPage(),
          ),
          GoRoute(
            path: '${Routes.home}/ride/:rideId/tracking',
            builder: (context, state) => RideTrackingPage(
              rideId: state.pathParameters['rideId']!,
            ),
          ),
          GoRoute(
            path: '${Routes.home}/ride/:rideId/details',
            builder: (context, state) => RideDetailsPage(
              rideId: state.pathParameters['rideId']!,
            ),
          ),

          // Food routes
          GoRoute(
            path: Routes.foodRestaurants,
            builder: (context, state) => const RestaurantsPage(),
          ),
          GoRoute(
            path: '${Routes.home}/food/restaurant/:restaurantId',
            builder: (context, state) => RestaurantDetailPage(
              restaurantId: state.pathParameters['restaurantId']!,
            ),
          ),
          GoRoute(
            path: Routes.foodCart,
            builder: (context, state) => const CartPage(),
          ),
          GoRoute(
            path: '${Routes.home}/food/order/:orderId/tracking',
            builder: (context, state) => OrderTrackingPage(
              orderId: state.pathParameters['orderId']!,
            ),
          ),
          GoRoute(
            path: '${Routes.home}/food/order/:orderId/details',
            builder: (context, state) => OrderDetailsPage(
              orderId: state.pathParameters['orderId']!,
            ),
          ),

          // Delivery routes
          GoRoute(
            path: Routes.deliveryNew,
            builder: (context, state) => const DeliveryNewPage(),
          ),
          GoRoute(
            path: '${Routes.home}/delivery/:deliveryId/tracking',
            builder: (context, state) => DeliveryTrackingPage(
              deliveryId: state.pathParameters['deliveryId']!,
            ),
          ),
          GoRoute(
            path: '${Routes.home}/delivery/:deliveryId/details',
            builder: (context, state) => DeliveryDetailsPage(
              deliveryId: state.pathParameters['deliveryId']!,
            ),
          ),

          // Profile routes (inside shell)
          GoRoute(
            path: Routes.profile,
            builder: (context, state) => const ProfilePage(),
          ),
        ],
      ),

      // Profile sub-routes (outside shell for full-screen)
      GoRoute(
        path: '${Routes.profile}/edit',
        builder: (context, state) => const EditProfilePage(),
      ),
      GoRoute(
        path: '${Routes.profile}/places',
        builder: (context, state) => const SavedPlacesPage(),
      ),
      GoRoute(
        path: '${Routes.profile}/payments',
        builder: (context, state) => const PaymentMethodsPage(),
      ),
      GoRoute(
        path: '${Routes.profile}/settings',
        builder: (context, state) => const SettingsPage(),
      ),
    ],
  );

  /// Route guard for authentication
  static String? _guardRoute(BuildContext context, GoRouterState state) {
    final authState = getIt<AuthBloc>().state;
    final isAuthenticated = authState is AuthAuthenticated;
    final isAuthRoute = state.matchedLocation == Routes.login ||
        state.matchedLocation == Routes.otp ||
        state.matchedLocation == Routes.register;
    final isSplashRoute = state.matchedLocation == Routes.splash;
    final isOnboardingRoute = state.matchedLocation == Routes.onboarding;

    // Allow splash and onboarding always
    if (isSplashRoute || isOnboardingRoute) {
      return null;
    }

    // If not authenticated and not on auth route, redirect to login
    if (!isAuthenticated && !isAuthRoute) {
      return Routes.login;
    }

    // If authenticated and on auth route, redirect to home
    if (isAuthenticated && isAuthRoute) {
      return Routes.home;
    }

    return null;
  }
}
