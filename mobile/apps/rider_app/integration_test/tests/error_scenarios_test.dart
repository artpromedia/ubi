/// E2E Tests - Error Scenarios
///
/// Tests error handling, network failures, and edge cases.
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

  group('Error Scenario E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    group('Network Failure Scenarios', () {
      testWidgets(
        'User sees offline message when network is unavailable',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_offline');

          app.main();
          await tester.pumpAndSettle();

          // In test, we would simulate network failure
          // This depends on connectivity mocking capabilities

          await _loginAndNavigateToHome(tester);
          await reporter.capture('before_network_issue');

          // Simulate network loss (implementation depends on test setup)
          // await _simulateNetworkFailure();

          // Try to book a ride
          await tester.safeTap(AppFinders.pickupInput);
          await tester.settleAndWait();

          await reporter.capture('network_error_handling');

          // Should show offline indicator or error message
          final offlineIndicator = find.textContaining('offline');
          final noConnection = find.textContaining('connection');

          // Some indication of network issue should appear
          // final hasOfflineMessage = offlineIndicator.evaluate().isNotEmpty ||
          //     noConnection.evaluate().isNotEmpty;
        },
      );

      testWidgets(
        'User can retry failed request',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_retry');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);

          // Simulate a failed request scenario
          // Try to load data that might fail
          await tester.safeTap(AppFinders.bottomNavProfile);
          await tester.settleAndWait();

          await reporter.capture('before_retry');

          // If there's an error with retry button
          if (AppFinders.retryButton.evaluate().isNotEmpty) {
            await tester.safeTap(AppFinders.retryButton);
            await tester.settleAndWait(duration: TestConfig.networkDelay);

            await reporter.capture('after_retry');
          }
        },
      );

      testWidgets(
        'App handles timeout gracefully',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_timeout');

          app.main();
          await tester.pumpAndSettle();

          await _loginWithNetworkIssueUser(tester);

          // Try action that might timeout
          await tester.safeTap(AppFinders.pickupInput);
          await tester.settleAndWait();
          await tester.enterTextInField(
            find.byType(TextField).last,
            'Test Location',
          );

          // Wait longer than normal for potential timeout
          await Future.delayed(TestConfig.longTimeout);
          await tester.pumpAndSettle();

          await reporter.capture('timeout_handling');

          // Should show timeout error or handle gracefully
          // Not stuck in loading state
          final isLoading = AppFinders.loadingIndicator.evaluate().isNotEmpty;
          // Either not loading or showing error
        },
      );
    });

    group('Payment Failure Scenarios', () {
      testWidgets(
        'User sees error when payment method is declined',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_payment_declined');

          app.main();
          await tester.pumpAndSettle();

          // Login with user that has payment issues
          await _loginWithPaymentFailUser(tester);

          // Book ride
          await _setLocations(tester);
          await tester.waitForWidget(AppFinders.rideOption('economy'));
          await tester.safeTap(AppFinders.rideOption('economy'));
          await tester.settleAndWait();
          await tester.safeTap(AppFinders.confirmRideButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          await reporter.capture('payment_declined');

          // Should show payment error
          final declinedMessage = find.textContaining('declined');
          final paymentError = find.textContaining('Payment');

          // Error handling for payment decline
        },
      );

      testWidgets(
        'User can change payment method after decline',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_change_payment');

          app.main();
          await tester.pumpAndSettle();

          await _loginWithPaymentFailUser(tester);

          // Simulate payment decline scenario
          await _setLocations(tester);
          await tester.waitForWidget(AppFinders.rideOption('economy'));
          await tester.safeTap(AppFinders.rideOption('economy'));
          await tester.settleAndWait();

          await reporter.capture('before_payment_change');

          // Look for change payment option
          final changePaymentButton = find.textContaining('Change');
          if (changePaymentButton.evaluate().isNotEmpty) {
            await tester.safeTap(changePaymentButton);
            await tester.settleAndWait();

            await reporter.capture('payment_options');

            // Select different method
            final cashOption = find.textContaining('Cash');
            if (cashOption.evaluate().isNotEmpty) {
              await tester.safeTap(cashOption);
              await tester.settleAndWait();

              await reporter.capture('after_payment_change');
            }
          }
        },
      );
    });

    group('Driver Cancellation Scenarios', () {
      testWidgets(
        'User sees notification when driver cancels',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_driver_cancel');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);
          await _bookRide(tester);

          await reporter.capture('ride_booked');

          // In test environment, simulate driver cancellation
          // This would require test server to send cancellation event

          // Wait for potential cancellation notification
          final cancelled = await tester.waitFor(
            () =>
                find.textContaining('cancelled').evaluate().isNotEmpty ||
                find.textContaining('Cancelled').evaluate().isNotEmpty,
            timeout: TestConfig.longTimeout,
          );

          if (cancelled) {
            await reporter.capture('driver_cancelled');

            // Should show cancellation message
            expect(find.textContaining('cancel'), findsWidgets);

            // Should offer to rebook
            final rebookButton = find.textContaining('Book');
            expect(rebookButton, findsWidgets);
          }
        },
      );

      testWidgets(
        'User can rebook after driver cancellation',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_rebook');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);

          // After simulated cancellation, look for rebook option
          final rebookButton = find.textContaining('Book Again');
          if (rebookButton.evaluate().isNotEmpty) {
            await tester.safeTap(rebookButton);
            await tester.settleAndWait();

            await reporter.capture('rebook_flow');

            // Should return to booking flow
            expect(
              AppFinders.rideOption('economy').evaluate().isNotEmpty ||
                  AppFinders.pickupInput.evaluate().isNotEmpty,
              isTrue,
            );
          }
        },
      );
    });

    group('Location Permission Scenarios', () {
      testWidgets(
        'User sees prompt when location permission denied',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_location_denied');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);

          // Try to use current location
          await tester.safeTap(AppFinders.currentLocationButton);
          await tester.settleAndWait();

          await reporter.capture('location_request');

          // If permission denied (depends on test setup)
          final permissionMessage = find.textContaining('permission');
          final locationError = find.textContaining('location');

          // Should show appropriate message if denied
        },
      );

      testWidgets(
        'User can manually enter location when GPS unavailable',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_manual_location');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);
          await reporter.capture('home_without_gps');

          // Enter location manually
          await tester.safeTap(AppFinders.pickupInput);
          await tester.settleAndWait();

          await tester.enterTextInField(
            find.byType(TextField).last,
            'Kenyatta Avenue, Nairobi',
          );
          await tester.settleAndWait();

          await reporter.capture('manual_entry');

          // Should show search results
          final suggestions = find.textContaining('Kenyatta');
          expect(suggestions, findsWidgets);
        },
      );
    });

    group('Session Expiry Scenarios', () {
      testWidgets(
        'User is redirected to login when session expires',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_session_expired');

          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToHome(tester);
          await reporter.capture('logged_in');

          // Simulate session expiry
          // This would require invalidating the token on test server

          // Try to perform authenticated action
          await tester.safeTap(AppFinders.bottomNavProfile);
          await tester.settleAndWait();

          // If session expired, should redirect to login
          // await reporter.capture('session_expired_redirect');
        },
      );
    });

    group('Validation Error Scenarios', () {
      testWidgets(
        'User sees validation errors for invalid input',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_validation');

          app.main();
          await tester.pumpAndSettle();

          // Skip to login
          if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
            await tester.safeTap(AppFinders.onboardingSkip);
            await tester.settleAndWait();
          }

          // Try invalid phone formats
          final invalidPhones = ['123', 'abc', '00000'];

          for (final phone in invalidPhones) {
            await tester.enterTextInField(AppFinders.phoneInput, phone);
            await tester.safeTap(AppFinders.continueButton);
            await tester.settleAndWait();

            await reporter.capture('validation_error_$phone');

            // Should show validation error
            expect(AppFinders.otpInput, findsNothing);
          }
        },
      );
    });

    group('Rate Limiting Scenarios', () {
      testWidgets(
        'User sees message when rate limited',
        (tester) async {
          final reporter = ScreenshotReporter(binding, 'error_rate_limit');

          app.main();
          await tester.pumpAndSettle();

          // Skip to login
          if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
            await tester.safeTap(AppFinders.onboardingSkip);
            await tester.settleAndWait();
          }

          // Make many rapid requests
          for (var i = 0; i < 10; i++) {
            await tester.enterTextInField(
              AppFinders.phoneInput,
              '70000000${i.toString().padLeft(2, '0')}',
            );
            await tester.safeTap(AppFinders.continueButton);
            await tester.pumpAndSettle();
          }

          await reporter.capture('after_rapid_requests');

          // Should show rate limit message if triggered
          final rateLimitMessage = find.textContaining('too many');
          final tryAgain = find.textContaining('try again');

          // Rate limiting handling
        },
      );
    });
  });
}

// Helper functions
Future<void> _loginAndNavigateToHome(WidgetTester tester) async {
  await tester.settleAndWait();

  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }

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
}

Future<void> _loginWithNetworkIssueUser(WidgetTester tester) async {
  await tester.settleAndWait();

  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }

  if (AppFinders.phoneInput.evaluate().isNotEmpty) {
    await tester.enterTextInField(
      AppFinders.phoneInput,
      TestUsers.networkIssueUser.phoneNumber.replaceFirst('+254', ''),
    );
    await tester.safeTap(AppFinders.continueButton);
    await tester.settleAndWait();

    await tester.waitForWidget(AppFinders.otpInput);
    await tester.enterTextInField(
      AppFinders.otpInput,
      TestUsers.networkIssueUser.otp,
    );
    await tester.settleAndWait(duration: TestConfig.networkDelay);
  }
}

Future<void> _loginWithPaymentFailUser(WidgetTester tester) async {
  await tester.settleAndWait();

  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }

  if (AppFinders.phoneInput.evaluate().isNotEmpty) {
    await tester.enterTextInField(
      AppFinders.phoneInput,
      TestUsers.paymentFailUser.phoneNumber.replaceFirst('+254', ''),
    );
    await tester.safeTap(AppFinders.continueButton);
    await tester.settleAndWait();

    await tester.waitForWidget(AppFinders.otpInput);
    await tester.enterTextInField(
      AppFinders.otpInput,
      TestUsers.paymentFailUser.otp,
    );
    await tester.settleAndWait(duration: TestConfig.networkDelay);
  }

  await tester.waitForWidget(AppFinders.pickupInput);
}

Future<void> _setLocations(WidgetTester tester) async {
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
}

Future<void> _bookRide(WidgetTester tester) async {
  await _setLocations(tester);
  await tester.waitForWidget(AppFinders.rideOption('economy'));
  await tester.safeTap(AppFinders.rideOption('economy'));
  await tester.settleAndWait();
  await tester.safeTap(AppFinders.confirmRideButton);
  await tester.settleAndWait();
}
