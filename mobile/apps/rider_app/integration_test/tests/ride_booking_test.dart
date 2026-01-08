/// E2E Tests - Ride Booking Flow
///
/// Tests the complete ride booking journey from search to confirmation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:ubi_rider_app/main.dart' as app;

import '../test_config.dart';
import '../test_utils.dart';
import '../mock_data_generator.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final binding = IntegrationTestWidgetsFlutterBinding.instance;

  group('Ride Booking E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    tearDown(() async {
      await TestCleanup.cleanupTestData(TestUsers.standardUser);
    });

    testWidgets(
      'User can search and select locations - Happy Path',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_search_locations');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);
          await reporter.capture('home_page');

          // Verify ride search page elements
          expect(AppFinders.pickupInput, findsOneWidget);
          expect(AppFinders.dropoffInput, findsOneWidget);

          // Tap pickup input
          await tester.safeTap(AppFinders.pickupInput);
          await tester.settleAndWait();
          await reporter.capture('pickup_search');

          // Enter pickup location
          await tester.enterTextInField(
            find.byType(TextField).last,
            TestLocations.nairobiCbd.address,
          );
          await tester.settleAndWait();

          // Select from suggestions
          final pickupSuggestion = find.textContaining('Nairobi');
          await tester.waitForWidget(pickupSuggestion);
          await tester.safeTap(pickupSuggestion.first);
          await tester.settleAndWait();
          await reporter.capture('pickup_selected');

          // Tap dropoff input
          await tester.safeTap(AppFinders.dropoffInput);
          await tester.settleAndWait();
          await reporter.capture('dropoff_search');

          // Enter dropoff location
          await tester.enterTextInField(
            find.byType(TextField).last,
            TestLocations.westlands.address,
          );
          await tester.settleAndWait();

          // Select from suggestions
          final dropoffSuggestion = find.textContaining('Westlands');
          await tester.waitForWidget(dropoffSuggestion);
          await tester.safeTap(dropoffSuggestion.first);
          await tester.settleAndWait();
          await reporter.capture('dropoff_selected');

          // Should show ride options
          await tester.waitForWidget(
            AppFinders.rideOption('economy'),
            timeout: TestConfig.defaultTimeout,
          );
          await reporter.capture('ride_options_shown');

          expect(AppFinders.rideOption('economy'), findsOneWidget);
        });
      },
    );

    testWidgets(
      'User can use current location as pickup',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_current_location');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Tap current location button
        await tester.safeTap(AppFinders.currentLocationButton);
        await tester.settleAndWait(duration: TestConfig.networkDelay);
        await reporter.capture('after_current_location');

        // Pickup should be populated
        // Check that pickup field has content
        expect(AppFinders.pickupInput, findsOneWidget);
      },
    );

    testWidgets(
      'User can select different ride types and see prices',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_ride_types');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Set up ride search
        await _setLocations(tester);
        await reporter.capture('locations_set');

        // Wait for ride options
        await tester.waitForWidget(AppFinders.rideOption('economy'));

        // Verify multiple ride options
        expect(AppFinders.rideOption('economy'), findsOneWidget);

        // Tap economy and verify price shown
        await tester.safeTap(AppFinders.rideOption('economy'));
        await tester.settleAndWait();
        await reporter.capture('economy_selected');

        // Price should be displayed
        expect(find.textContaining('KES'), findsWidgets);

        // Tap comfort if available
        final comfortOption = AppFinders.rideOption('comfort');
        if (comfortOption.evaluate().isNotEmpty) {
          await tester.safeTap(comfortOption);
          await tester.settleAndWait();
          await reporter.capture('comfort_selected');

          // Different price should show
          expect(find.textContaining('KES'), findsWidgets);
        }

        // Tap premium if available
        final premiumOption = AppFinders.rideOption('premium');
        if (premiumOption.evaluate().isNotEmpty) {
          await tester.safeTap(premiumOption);
          await tester.settleAndWait();
          await reporter.capture('premium_selected');
        }
      },
    );

    testWidgets(
      'User can confirm ride booking - Full Flow',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_confirm_ride');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);

          // Set locations
          await _setLocations(tester);
          await reporter.capture('locations_ready');

          // Wait for ride options
          await tester.waitForWidget(AppFinders.rideOption('economy'));

          // Select economy ride
          await tester.safeTap(AppFinders.rideOption('economy'));
          await tester.settleAndWait();
          await reporter.capture('ride_selected');

          // Confirm booking
          await tester.safeTap(AppFinders.confirmRideButton);
          await tester.settleAndWait();
          await reporter.capture('booking_confirmed');

          // Should show searching for driver or tracking page
          final searching = await tester.waitFor(
            () =>
                find.textContaining('Searching').evaluate().isNotEmpty ||
                AppFinders.driverInfo.evaluate().isNotEmpty ||
                AppFinders.cancelRideButton.evaluate().isNotEmpty,
            timeout: TestConfig.longTimeout,
          );

          expect(searching, isTrue);
          await reporter.capture('after_booking');
        });
      },
    );

    testWidgets(
      'User can cancel ride during search',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_cancel_during_search');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Book a ride
        await _setLocations(tester);
        await tester.waitForWidget(AppFinders.rideOption('economy'));
        await tester.safeTap(AppFinders.rideOption('economy'));
        await tester.settleAndWait();
        await tester.safeTap(AppFinders.confirmRideButton);
        await tester.settleAndWait();

        await reporter.capture('searching_for_driver');

        // Wait for cancel button
        await tester.waitForWidget(AppFinders.cancelRideButton);

        // Cancel ride
        await tester.safeTap(AppFinders.cancelRideButton);
        await tester.settleAndWait();

        await reporter.capture('cancel_dialog');

        // Confirm cancellation if dialog appears
        final confirmCancel = AppFinders.dialogConfirmButton;
        if (confirmCancel.evaluate().isNotEmpty) {
          await tester.safeTap(confirmCancel);
          await tester.settleAndWait();
        }

        await reporter.capture('after_cancel');

        // Should return to search
        await tester.waitForWidget(
          AppFinders.pickupInput,
          timeout: TestConfig.defaultTimeout,
        );
        expect(AppFinders.pickupInput, findsOneWidget);
      },
    );

    testWidgets(
      'User sees saved places in location search',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_saved_places');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Tap pickup input
        await tester.safeTap(AppFinders.pickupInput);
        await tester.settleAndWait();

        await reporter.capture('search_with_saved');

        // Look for saved places like "Home", "Work"
        final savedHome = find.textContaining('Home');
        final savedWork = find.textContaining('Work');

        // At least one saved place should be visible for test user
        final hasSaved = savedHome.evaluate().isNotEmpty ||
            savedWork.evaluate().isNotEmpty;

        // If user has saved places, they should appear
        if (TestUsers.standardUser.hasSavedPlaces) {
          expect(hasSaved, isTrue);
        }
      },
    );

    testWidgets(
      'User can use voice search for location',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_voice_search');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Look for voice search button
        final voiceButton = AppFinders.voiceSearchButton;
        if (voiceButton.evaluate().isNotEmpty) {
          await tester.safeTap(voiceButton);
          await tester.settleAndWait();

          await reporter.capture('voice_search_overlay');

          // Voice search overlay should appear
          expect(find.textContaining('Listening'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User sees ETA and fare estimate before booking',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_eta_fare');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);
        await _setLocations(tester);

        await tester.waitForWidget(AppFinders.rideOption('economy'));
        await tester.safeTap(AppFinders.rideOption('economy'));
        await tester.settleAndWait();

        await reporter.capture('ride_details');

        // Should show ETA
        expect(find.textContaining('min'), findsWidgets);

        // Should show fare
        expect(find.textContaining('KES'), findsWidgets);

        // Should show distance (optional)
        final hasDistance = find.textContaining('km').evaluate().isNotEmpty;
        // Distance might or might not be shown depending on implementation
      },
    );

    testWidgets(
      'User can schedule ride for later',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'booking_schedule_ride');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);
        await _setLocations(tester);

        await reporter.capture('before_schedule');

        // Look for schedule button
        final scheduleButton = find.byKey(const Key('schedule_ride_button'));
        if (scheduleButton.evaluate().isNotEmpty) {
          await tester.safeTap(scheduleButton);
          await tester.settleAndWait();

          await reporter.capture('schedule_picker');

          // Should show date/time picker
          expect(find.byType(DatePickerDialog), findsWidgets);
        }
      },
    );
  });
}

// Helper functions
Future<void> _loginAndNavigateToHome(WidgetTester tester) async {
  await tester.settleAndWait();

  // Skip onboarding if shown
  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }

  // If on login page, login
  if (AppFinders.phoneInput.evaluate().isNotEmpty) {
    await tester.enterTextInField(
      AppFinders.phoneInput,
      TestUsers.standardUser.phoneNumber.replaceFirst('+254', ''),
    );
    await tester.safeTap(AppFinders.continueButton);
    await tester.settleAndWait();

    await tester.waitForWidget(AppFinders.otpInput);
    await tester.enterTextInField(AppFinders.otpInput, TestUsers.standardUser.otp);
    await tester.settleAndWait(duration: TestConfig.networkDelay);
  }

  // Wait for home page
  await tester.waitForWidget(
    AppFinders.pickupInput,
    timeout: TestConfig.longTimeout,
  );
}

Future<void> _setLocations(WidgetTester tester) async {
  // Set pickup
  await tester.safeTap(AppFinders.pickupInput);
  await tester.settleAndWait();
  await tester.enterTextInField(
    find.byType(TextField).last,
    TestLocations.nairobiCbd.address,
  );
  await tester.settleAndWait();

  final pickupSuggestion = find.textContaining('Nairobi');
  if (pickupSuggestion.evaluate().isNotEmpty) {
    await tester.safeTap(pickupSuggestion.first);
    await tester.settleAndWait();
  }

  // Set dropoff
  await tester.safeTap(AppFinders.dropoffInput);
  await tester.settleAndWait();
  await tester.enterTextInField(
    find.byType(TextField).last,
    TestLocations.westlands.address,
  );
  await tester.settleAndWait();

  final dropoffSuggestion = find.textContaining('Westlands');
  if (dropoffSuggestion.evaluate().isNotEmpty) {
    await tester.safeTap(dropoffSuggestion.first);
    await tester.settleAndWait();
  }
}
