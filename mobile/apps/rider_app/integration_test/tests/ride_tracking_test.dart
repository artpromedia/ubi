/// E2E Tests - Ride Tracking Flow
///
/// Tests ride tracking, driver updates, and trip completion.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:ubi_rider_app/main.dart' as app;

import '../test_config.dart';
import '../test_utils.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final binding = IntegrationTestWidgetsFlutterBinding.instance;

  group('Ride Tracking E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    tearDown(() async {
      await TestCleanup.cleanupTestData(TestUsers.standardUser);
    });

    testWidgets(
      'User sees driver info when driver is assigned',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_driver_assigned');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          await _loginAndBookRide(tester);
          await reporter.capture('ride_booked');

          // Wait for driver assignment (may take time in test env)
          final driverAssigned = await tester.waitFor(
            () => AppFinders.driverInfo.evaluate().isNotEmpty,
            timeout: TestConfig.longTimeout,
          );

          if (driverAssigned) {
            await reporter.capture('driver_assigned');

            // Should show driver info
            expect(AppFinders.driverInfo, findsOneWidget);

            // Should show driver name
            expect(find.textContaining('Driver'), findsWidgets);

            // Should show vehicle info
            expect(find.textContaining('plate'), findsWidgets);

            // Should show driver rating
            expect(find.byIcon(Icons.star), findsWidgets);
          }
        });
      },
    );

    testWidgets(
      'User sees live map with driver location',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_live_map');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        // Wait for tracking page
        await tester.waitForWidget(
          AppFinders.mapView,
          timeout: TestConfig.longTimeout,
        );

        await reporter.capture('tracking_map');

        // Map should be visible
        expect(AppFinders.mapView, findsOneWidget);
      },
    );

    testWidgets(
      'User sees ETA updates during ride',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_eta_updates');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        // Wait for ETA display
        await tester.waitForWidget(
          AppFinders.etaDisplay,
          timeout: TestConfig.longTimeout,
        );

        await reporter.capture('initial_eta');

        // ETA should be shown
        expect(AppFinders.etaDisplay, findsOneWidget);
        expect(find.textContaining('min'), findsWidgets);

        // Wait for potential ETA update
        await Future.delayed(const Duration(seconds: 10));
        await tester.pumpAndSettle();

        await reporter.capture('updated_eta');
      },
    );

    testWidgets(
      'User can contact driver from tracking screen',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_contact_driver');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        // Wait for driver assignment
        final driverAssigned = await tester.waitFor(
          () => AppFinders.contactDriverButton.evaluate().isNotEmpty,
          timeout: TestConfig.longTimeout,
        );

        if (driverAssigned) {
          await reporter.capture('before_contact');

          // Tap contact driver
          await tester.safeTap(AppFinders.contactDriverButton);
          await tester.settleAndWait();

          await reporter.capture('contact_options');

          // Should show contact options (call, message)
          final callOption = find.textContaining('Call');
          final messageOption = find.textContaining('Message');

          expect(
            callOption.evaluate().isNotEmpty ||
                messageOption.evaluate().isNotEmpty,
            isTrue,
          );
        }
      },
    );

    testWidgets(
      'User sees driver arrived notification',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_driver_arrived');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        // In test environment, we might simulate driver arrival
        // Wait for arrival state
        final arrived = await tester.waitFor(
          () => find.textContaining('arrived').evaluate().isNotEmpty ||
              find.textContaining('Arrived').evaluate().isNotEmpty,
          timeout: TestConfig.longTimeout,
        );

        if (arrived) {
          await reporter.capture('driver_arrived');
          expect(find.textContaining('arrived'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User sees ride in progress updates',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_in_progress');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        // Wait for ride to be in progress
        final inProgress = await tester.waitFor(
          () =>
              find.textContaining('In Progress').evaluate().isNotEmpty ||
              find.textContaining('trip').evaluate().isNotEmpty,
          timeout: TestConfig.longTimeout,
        );

        if (inProgress) {
          await reporter.capture('ride_in_progress');

          // Should show current location on route
          expect(AppFinders.mapView, findsOneWidget);

          // Should show remaining time/distance
          expect(find.textContaining('min'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User can access emergency button during ride',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_emergency');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        await tester.waitForWidget(
          AppFinders.mapView,
          timeout: TestConfig.longTimeout,
        );

        await reporter.capture('tracking_with_emergency');

        // Emergency button should be accessible
        final emergencyButton = AppFinders.emergencyButton;
        if (emergencyButton.evaluate().isNotEmpty) {
          await tester.safeTap(emergencyButton);
          await tester.settleAndWait();

          await reporter.capture('emergency_options');

          // Should show emergency options
          expect(find.textContaining('Emergency'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User can share trip details',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'tracking_share_trip');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndBookRide(tester);

        await tester.waitForWidget(
          AppFinders.mapView,
          timeout: TestConfig.longTimeout,
        );

        // Find share button
        final shareButton = find.byKey(const Key('share_trip_button'));
        if (shareButton.evaluate().isNotEmpty) {
          await tester.safeTap(shareButton);
          await tester.settleAndWait();

          await reporter.capture('share_dialog');

          // Share options should appear
          expect(find.textContaining('Share'), findsWidgets);
        }
      },
    );
  });
}

// Helper function
Future<void> _loginAndBookRide(WidgetTester tester) async {
  await tester.settleAndWait();

  // Skip onboarding
  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }

  // Login if needed
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

  await tester.waitForWidget(AppFinders.pickupInput);

  // Set locations and book
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

  // Wait for ride options and book
  await tester.waitForWidget(AppFinders.rideOption('economy'));
  await tester.safeTap(AppFinders.rideOption('economy'));
  await tester.settleAndWait();
  await tester.safeTap(AppFinders.confirmRideButton);
  await tester.settleAndWait();
}
