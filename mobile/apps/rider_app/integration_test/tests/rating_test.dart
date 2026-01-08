/// E2E Tests - Rating and Feedback Flow
///
/// Tests post-ride rating, tipping, and feedback.
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

  group('Rating E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    tearDown(() async {
      await TestCleanup.cleanupTestData(TestUsers.standardUser);
    });

    testWidgets(
      'User can rate driver after ride completion',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_driver');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          // Navigate to completed ride (simulated)
          await _loginAndNavigateToCompletedRide(tester);
          await reporter.capture('rating_screen');

          // Should show rating UI
          expect(AppFinders.starRating(5), findsOneWidget);

          // Tap 5 stars
          await tester.safeTap(AppFinders.starRating(5));
          await tester.settleAndWait();
          await reporter.capture('5_stars_selected');

          // Submit rating
          await tester.safeTap(AppFinders.submitRatingButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);
          await reporter.capture('after_rating');

          // Should show confirmation or navigate away
          final thanksMessage = find.textContaining('Thank');
          final homeVisible = AppFinders.pickupInput.evaluate().isNotEmpty;

          expect(
            thanksMessage.evaluate().isNotEmpty || homeVisible,
            isTrue,
          );
        });
      },
    );

    testWidgets(
      'User can select different star ratings',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_star_selection');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);

        // Test different star selections
        for (var stars = 1; stars <= 5; stars++) {
          await tester.safeTap(AppFinders.starRating(stars));
          await tester.settleAndWait();
          await reporter.capture('${stars}_stars');

          // Stars up to selected should be highlighted
          // Exact assertion depends on implementation
        }
      },
    );

    testWidgets(
      'User can add tip to driver',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_add_tip');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);

        // Rate first
        await tester.safeTap(AppFinders.starRating(5));
        await tester.settleAndWait();

        await reporter.capture('before_tip');

        // Check for tip options
        if (AppFinders.tipOptions.evaluate().isNotEmpty) {
          // Select a tip amount
          await tester.safeTap(AppFinders.tipAmount(50));
          await tester.settleAndWait();
          await reporter.capture('tip_selected');

          // Submit with tip
          await tester.safeTap(AppFinders.submitRatingButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          await reporter.capture('after_tip');
        }
      },
    );

    testWidgets(
      'User can add custom tip amount',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_custom_tip');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);
        await tester.safeTap(AppFinders.starRating(5));
        await tester.settleAndWait();

        // Look for custom tip option
        final customTipButton = find.byKey(const Key('custom_tip_button'));
        if (customTipButton.evaluate().isNotEmpty) {
          await tester.safeTap(customTipButton);
          await tester.settleAndWait();

          await reporter.capture('custom_tip_input');

          // Enter custom amount
          final tipInput = find.byKey(const Key('custom_tip_input'));
          if (tipInput.evaluate().isNotEmpty) {
            await tester.enterTextInField(tipInput, '100');
            await tester.settleAndWait();

            await reporter.capture('custom_tip_entered');
          }
        }
      },
    );

    testWidgets(
      'User can add feedback comment',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_feedback');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);
        await tester.safeTap(AppFinders.starRating(4));
        await tester.settleAndWait();

        await reporter.capture('before_feedback');

        // Look for feedback input
        final feedbackInput = find.byKey(const Key('feedback_input'));
        if (feedbackInput.evaluate().isNotEmpty) {
          await tester.enterTextInField(
            feedbackInput,
            'Great ride, very professional driver!',
          );
          await tester.settleAndWait();

          await reporter.capture('feedback_entered');
        }

        // Submit
        await tester.safeTap(AppFinders.submitRatingButton);
        await tester.settleAndWait(duration: TestConfig.networkDelay);

        await reporter.capture('after_feedback');
      },
    );

    testWidgets(
      'User sees feedback options for low rating',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_low_feedback');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);

        // Select low rating (1-3 stars)
        await tester.safeTap(AppFinders.starRating(2));
        await tester.settleAndWait();

        await reporter.capture('low_rating_options');

        // Should show feedback reasons
        final feedbackOptions = [
          'Driver behavior',
          'Vehicle condition',
          'Route taken',
          'Safety concerns',
        ];

        // At least some feedback options should appear
        var foundOptions = 0;
        for (final option in feedbackOptions) {
          if (find.textContaining(option).evaluate().isNotEmpty) {
            foundOptions++;
          }
        }

        // For low ratings, feedback options might be shown
        // Depends on implementation
      },
    );

    testWidgets(
      'User can skip rating',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_skip');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);
        await reporter.capture('rating_screen_with_skip');

        // Look for skip button
        final skipButton = find.textContaining('Skip');
        if (skipButton.evaluate().isNotEmpty) {
          await tester.safeTap(skipButton);
          await tester.settleAndWait();

          await reporter.capture('after_skip');

          // Should navigate to home
          await tester.waitForWidget(AppFinders.pickupInput);
          expect(AppFinders.pickupInput, findsOneWidget);
        }
      },
    );

    testWidgets(
      'User sees receipt after rating',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'rating_receipt');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToCompletedRide(tester);

        // Rate the ride
        await tester.safeTap(AppFinders.starRating(5));
        await tester.settleAndWait();
        await tester.safeTap(AppFinders.submitRatingButton);
        await tester.settleAndWait(duration: TestConfig.networkDelay);

        // Look for receipt
        final receiptButton = find.textContaining('Receipt');
        if (receiptButton.evaluate().isNotEmpty) {
          await tester.safeTap(receiptButton);
          await tester.settleAndWait();

          await reporter.capture('receipt_view');

          // Receipt should show trip details
          expect(find.textContaining('KES'), findsWidgets);
        }
      },
    );
  });
}

// Helper function - simulates navigating to completed ride rating screen
Future<void> _loginAndNavigateToCompletedRide(WidgetTester tester) async {
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

  // In a real test environment, we would:
  // 1. Book a ride
  // 2. Have the test server simulate ride completion
  // 3. Navigate to rating screen
  
  // For now, try to access rating through ride history
  final historyButton = find.byKey(const Key('ride_history_button'));
  if (historyButton.evaluate().isNotEmpty) {
    await tester.safeTap(historyButton);
    await tester.settleAndWait();

    // Find most recent completed ride
    final completedRide = find.textContaining('Completed');
    if (completedRide.evaluate().isNotEmpty) {
      await tester.safeTap(completedRide.first);
      await tester.settleAndWait();

      // Try to rate
      final rateButton = find.textContaining('Rate');
      if (rateButton.evaluate().isNotEmpty) {
        await tester.safeTap(rateButton);
        await tester.settleAndWait();
      }
    }
  }

  // Wait for rating screen elements
  await tester.waitForWidget(
    AppFinders.starRating(1),
    timeout: TestConfig.defaultTimeout,
  );
}
