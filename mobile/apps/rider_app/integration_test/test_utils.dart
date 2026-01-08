/// Test Utilities and Helpers
///
/// Common utilities for E2E tests including finders, actions, and assertions.
library;

import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'test_config.dart';

/// Extension on WidgetTester for common E2E operations
extension E2ETestActions on WidgetTester {
  /// Wait for the app to settle after navigation
  Future<void> settleAndWait({
    Duration duration = const Duration(milliseconds: 500),
  }) async {
    await pumpAndSettle();
    await Future.delayed(duration);
    await pumpAndSettle();
  }

  /// Wait for a specific condition with timeout
  Future<bool> waitFor(
    bool Function() condition, {
    Duration timeout = const Duration(seconds: 10),
    Duration pollInterval = const Duration(milliseconds: 100),
  }) async {
    final stopwatch = Stopwatch()..start();
    while (stopwatch.elapsed < timeout) {
      await pump(pollInterval);
      if (condition()) {
        return true;
      }
    }
    return false;
  }

  /// Wait for widget to appear
  Future<void> waitForWidget(
    Finder finder, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final found = await waitFor(
      () => finder.evaluate().isNotEmpty,
      timeout: timeout,
    );
    if (!found) {
      throw TestFailure('Widget not found within timeout: $finder');
    }
  }

  /// Wait for widget to disappear
  Future<void> waitForWidgetToDisappear(
    Finder finder, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final disappeared = await waitFor(
      () => finder.evaluate().isEmpty,
      timeout: timeout,
    );
    if (!disappeared) {
      throw TestFailure('Widget did not disappear within timeout: $finder');
    }
  }

  /// Safely tap a widget with retry logic
  Future<void> safeTap(
    Finder finder, {
    int maxRetries = 3,
    Duration retryDelay = const Duration(milliseconds: 500),
  }) async {
    for (var i = 0; i < maxRetries; i++) {
      try {
        await waitForWidget(finder);
        await tap(finder);
        await pumpAndSettle();
        return;
      } catch (e) {
        if (i == maxRetries - 1) rethrow;
        await Future.delayed(retryDelay);
        await pumpAndSettle();
      }
    }
  }

  /// Enter text in a field with clear
  Future<void> enterTextInField(
    Finder finder,
    String text, {
    bool clearFirst = true,
  }) async {
    await waitForWidget(finder);
    await tap(finder);
    await pumpAndSettle();

    if (clearFirst) {
      await enterText(finder, '');
      await pumpAndSettle();
    }

    await enterText(finder, text);
    await pumpAndSettle();
  }

  /// Scroll until widget is visible
  Future<void> scrollUntilVisible(
    Finder finder, {
    Finder? scrollable,
    double delta = 100,
    int maxScrolls = 50,
  }) async {
    final scrollFinder = scrollable ?? find.byType(Scrollable).first;

    for (var i = 0; i < maxScrolls; i++) {
      if (finder.evaluate().isNotEmpty) {
        await ensureVisible(finder);
        return;
      }
      await drag(scrollFinder, Offset(0, -delta));
      await pumpAndSettle();
    }
    throw TestFailure('Could not scroll to widget: $finder');
  }

  /// Take screenshot with custom name
  Future<void> takeScreenshot(
    IntegrationTestWidgetsFlutterBinding binding,
    String name,
  ) async {
    await pumpAndSettle();

    if (TestConfig.captureScreenshotsOnFailure) {
      try {
        await binding.takeScreenshot(name);
      } catch (e) {
        debugPrint('Failed to take screenshot: $e');
      }
    }
  }
}

/// Common widget finders
class AppFinders {
  AppFinders._();

  // Navigation
  static Finder get bottomNavRide => find.byKey(const Key('nav_ride'));
  static Finder get bottomNavFood => find.byKey(const Key('nav_food'));
  static Finder get bottomNavDelivery => find.byKey(const Key('nav_delivery'));
  static Finder get bottomNavProfile => find.byKey(const Key('nav_profile'));
  static Finder get backButton => find.byType(BackButton);

  // Auth
  static Finder get phoneInput => find.byKey(const Key('phone_input'));
  static Finder get otpInput => find.byKey(const Key('otp_input'));
  static Finder get continueButton => find.byKey(const Key('continue_button'));
  static Finder get loginButton => find.byKey(const Key('login_button'));
  static Finder get googleSignInButton =>
      find.byKey(const Key('google_signin_button'));
  static Finder get appleSignInButton =>
      find.byKey(const Key('apple_signin_button'));

  // Onboarding
  static Finder get onboardingSkip => find.byKey(const Key('onboarding_skip'));
  static Finder get onboardingNext => find.byKey(const Key('onboarding_next'));
  static Finder get onboardingGetStarted =>
      find.byKey(const Key('onboarding_get_started'));

  // Home & Ride
  static Finder get pickupInput => find.byKey(const Key('pickup_input'));
  static Finder get dropoffInput => find.byKey(const Key('dropoff_input'));
  static Finder get searchButton => find.byKey(const Key('search_button'));
  static Finder get currentLocationButton =>
      find.byKey(const Key('current_location'));
  static Finder get voiceSearchButton =>
      find.byKey(const Key('voice_search_button'));

  // Ride Options
  static Finder rideOption(String type) =>
      find.byKey(Key('ride_option_$type'));
  static Finder get confirmRideButton =>
      find.byKey(const Key('confirm_ride_button'));
  static Finder get cancelRideButton =>
      find.byKey(const Key('cancel_ride_button'));

  // Tracking
  static Finder get driverInfo => find.byKey(const Key('driver_info'));
  static Finder get etaDisplay => find.byKey(const Key('eta_display'));
  static Finder get mapView => find.byKey(const Key('map_view'));
  static Finder get contactDriverButton =>
      find.byKey(const Key('contact_driver'));
  static Finder get emergencyButton => find.byKey(const Key('emergency_button'));

  // Rating
  static Finder starRating(int stars) =>
      find.byKey(Key('star_rating_$stars'));
  static Finder get submitRatingButton =>
      find.byKey(const Key('submit_rating'));
  static Finder get tipOptions => find.byKey(const Key('tip_options'));
  static Finder tipAmount(int amount) => find.byKey(Key('tip_$amount'));

  // Payment
  static Finder get paymentMethodsList =>
      find.byKey(const Key('payment_methods_list'));
  static Finder get addPaymentButton =>
      find.byKey(const Key('add_payment_button'));
  static Finder paymentMethod(String id) =>
      find.byKey(Key('payment_method_$id'));
  static Finder get mpesaOption => find.byKey(const Key('payment_mpesa'));
  static Finder get cardOption => find.byKey(const Key('payment_card'));

  // Food
  static Finder get restaurantsList =>
      find.byKey(const Key('restaurants_list'));
  static Finder restaurant(String id) =>
      find.byKey(Key('restaurant_$id'));
  static Finder menuItem(String id) => find.byKey(Key('menu_item_$id'));
  static Finder get cartButton => find.byKey(const Key('cart_button'));
  static Finder get checkoutButton => find.byKey(const Key('checkout_button'));

  // Profile
  static Finder get profileAvatar => find.byKey(const Key('profile_avatar'));
  static Finder get editProfileButton =>
      find.byKey(const Key('edit_profile_button'));
  static Finder get savedPlacesButton =>
      find.byKey(const Key('saved_places_button'));
  static Finder get settingsButton => find.byKey(const Key('settings_button'));
  static Finder get logoutButton => find.byKey(const Key('logout_button'));

  // Error & Loading
  static Finder get loadingIndicator =>
      find.byType(CircularProgressIndicator);
  static Finder get errorMessage => find.byKey(const Key('error_message'));
  static Finder get retryButton => find.byKey(const Key('retry_button'));
  static Finder get snackBar => find.byType(SnackBar);

  // Dialogs
  static Finder get confirmDialog => find.byKey(const Key('confirm_dialog'));
  static Finder get dialogConfirmButton =>
      find.byKey(const Key('dialog_confirm'));
  static Finder get dialogCancelButton =>
      find.byKey(const Key('dialog_cancel'));
}

/// Common assertions for E2E tests
class AppAssertions {
  AppAssertions._();

  /// Assert current route
  static void assertRoute(String expectedRoute) {
    // This would need access to the router state
    // Implementation depends on navigation setup
  }

  /// Assert snackbar shows with message
  static void assertSnackbar(WidgetTester tester, String message) {
    final snackbar = find.byType(SnackBar);
    expect(snackbar, findsOneWidget);
    expect(find.descendant(of: snackbar, matching: find.text(message)),
        findsOneWidget);
  }

  /// Assert loading indicator is shown
  static void assertLoading(WidgetTester tester) {
    expect(AppFinders.loadingIndicator, findsOneWidget);
  }

  /// Assert no loading indicator
  static void assertNotLoading(WidgetTester tester) {
    expect(AppFinders.loadingIndicator, findsNothing);
  }

  /// Assert error state
  static void assertError(WidgetTester tester, {String? message}) {
    expect(AppFinders.errorMessage, findsOneWidget);
    if (message != null) {
      expect(find.text(message), findsOneWidget);
    }
  }
}

/// Test data cleanup utility
class TestCleanup {
  /// Clear all test data after test run
  static Future<void> cleanupTestData(TestUser user) async {
    // In a real implementation, this would call API to clean up test data
    debugPrint('Cleaning up test data for user: ${user.phoneNumber}');
  }

  /// Reset app state
  static Future<void> resetAppState() async {
    // Clear local storage, caches, etc.
    debugPrint('Resetting app state');
  }
}

/// Screenshot reporter for test failures
class ScreenshotReporter {
  final IntegrationTestWidgetsFlutterBinding binding;
  final String testName;
  int _screenshotCount = 0;

  ScreenshotReporter(this.binding, this.testName);

  Future<void> capture(String step) async {
    if (!TestConfig.captureScreenshotsOnFailure) return;

    _screenshotCount++;
    final filename = '${testName}_${_screenshotCount.toString().padLeft(2, '0')}_$step';

    try {
      await binding.takeScreenshot(filename);
      debugPrint('Screenshot captured: $filename');
    } catch (e) {
      debugPrint('Failed to capture screenshot: $e');
    }
  }
}

/// Flaky test handler with retry logic
Future<void> runWithRetry(
  Future<void> Function() testFn, {
  int maxRetries = TestConfig.maxRetries,
  Duration retryDelay = TestConfig.retryDelay,
}) async {
  Exception? lastException;

  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await testFn();
      return; // Success
    } catch (e) {
      lastException = e is Exception ? e : Exception(e.toString());
      debugPrint('Test attempt $attempt failed: $e');

      if (attempt < maxRetries) {
        debugPrint('Retrying in ${retryDelay.inSeconds} seconds...');
        await Future.delayed(retryDelay);
      }
    }
  }

  throw TestFailure(
    'Test failed after $maxRetries attempts. Last error: $lastException',
  );
}
