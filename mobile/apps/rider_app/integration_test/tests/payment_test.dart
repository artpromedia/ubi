/// E2E Tests - Payment Flow
///
/// Tests payment method management and transaction flows.
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

  group('Payment E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    tearDown(() async {
      await TestCleanup.cleanupTestData(TestUsers.standardUser);
    });

    testWidgets(
      'User can view payment methods list',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_view_methods');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          await _loginAndNavigateToPayments(tester);
          await reporter.capture('payment_methods_page');

          // Should show payment methods list
          expect(AppFinders.paymentMethodsList, findsOneWidget);

          // Should show add payment button
          expect(AppFinders.addPaymentButton, findsOneWidget);

          // If user has payment methods, they should be listed
          if (TestUsers.standardUser.hasPaymentMethods) {
            expect(find.textContaining('M-Pesa'), findsWidgets);
          }
        });
      },
    );

    testWidgets(
      'User can add M-Pesa payment method',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_add_mpesa');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToPayments(tester);
        await reporter.capture('before_add');

        // Tap add payment
        await tester.safeTap(AppFinders.addPaymentButton);
        await tester.settleAndWait();

        await reporter.capture('add_options');

        // Select M-Pesa
        await tester.safeTap(AppFinders.mpesaOption);
        await tester.settleAndWait();

        await reporter.capture('mpesa_setup');

        // Enter phone number
        final phoneInput = find.byKey(const Key('mpesa_phone_input'));
        if (phoneInput.evaluate().isNotEmpty) {
          await tester.enterTextInField(phoneInput, '700000001');
          await tester.settleAndWait();

          // Confirm
          final confirmButton = find.byKey(const Key('confirm_payment_method'));
          await tester.safeTap(confirmButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          await reporter.capture('after_add_mpesa');

          // M-Pesa should appear in list
          expect(find.textContaining('M-Pesa'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User can add card payment method',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_add_card');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToPayments(tester);

        // Tap add payment
        await tester.safeTap(AppFinders.addPaymentButton);
        await tester.settleAndWait();

        // Select card option
        await tester.safeTap(AppFinders.cardOption);
        await tester.settleAndWait();

        await reporter.capture('card_setup');

        // Fill card details
        final cardNumberInput = find.byKey(const Key('card_number_input'));
        if (cardNumberInput.evaluate().isNotEmpty) {
          await tester.enterTextInField(cardNumberInput, '4242424242424242');

          final expiryInput = find.byKey(const Key('card_expiry_input'));
          await tester.enterTextInField(expiryInput, '12/25');

          final cvvInput = find.byKey(const Key('card_cvv_input'));
          await tester.enterTextInField(cvvInput, '123');

          await reporter.capture('card_details_entered');

          // Confirm
          final confirmButton = find.byKey(const Key('confirm_payment_method'));
          await tester.safeTap(confirmButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          await reporter.capture('after_add_card');

          // Card should appear in list
          expect(find.textContaining('4242'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User can set default payment method',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_set_default');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToPayments(tester);

        // Find a payment method that's not default
        final mpesaMethod = find.textContaining('M-Pesa');
        if (mpesaMethod.evaluate().isNotEmpty) {
          // Long press or find menu
          await tester.longPress(mpesaMethod.first);
          await tester.settleAndWait();

          await reporter.capture('payment_options_menu');

          // Tap set as default
          final setDefaultOption = find.textContaining('Set as default');
          if (setDefaultOption.evaluate().isNotEmpty) {
            await tester.safeTap(setDefaultOption);
            await tester.settleAndWait();

            await reporter.capture('after_set_default');

            // Should show as default
            expect(find.textContaining('Default'), findsWidgets);
          }
        }
      },
    );

    testWidgets(
      'User can delete payment method',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_delete');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToPayments(tester);
        await reporter.capture('before_delete');

        // Find a payment method
        final paymentMethod = find.textContaining('M-Pesa');
        if (paymentMethod.evaluate().isNotEmpty) {
          // Long press or swipe to delete
          await tester.longPress(paymentMethod.first);
          await tester.settleAndWait();

          await reporter.capture('delete_options');

          // Tap delete
          final deleteOption = find.textContaining('Delete');
          if (deleteOption.evaluate().isNotEmpty) {
            await tester.safeTap(deleteOption);
            await tester.settleAndWait();

            // Confirm deletion
            final confirmDelete = AppFinders.dialogConfirmButton;
            if (confirmDelete.evaluate().isNotEmpty) {
              await tester.safeTap(confirmDelete);
              await tester.settleAndWait();
            }

            await reporter.capture('after_delete');
          }
        }
      },
    );

    testWidgets(
      'User can select payment method during booking',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_during_booking');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Set up ride
        await _setLocations(tester);
        await tester.waitForWidget(AppFinders.rideOption('economy'));
        await tester.safeTap(AppFinders.rideOption('economy'));
        await tester.settleAndWait();

        await reporter.capture('ride_selected');

        // Find payment selector
        final paymentSelector = find.byKey(const Key('payment_method_selector'));
        if (paymentSelector.evaluate().isNotEmpty) {
          await tester.safeTap(paymentSelector);
          await tester.settleAndWait();

          await reporter.capture('payment_options_in_booking');

          // Should show available payment methods
          expect(find.textContaining('M-Pesa'), findsWidgets);
          expect(find.textContaining('Cash'), findsWidgets);
        }
      },
    );

    testWidgets(
      'User sees payment processing after ride',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'payment_processing');

        app.main();
        await tester.pumpAndSettle();

        await _loginAndNavigateToHome(tester);

        // Book and complete ride (simulated)
        await _bookRide(tester);

        // Wait for ride completion and payment
        final paymentScreen = await tester.waitFor(
          () => find.textContaining('Payment').evaluate().isNotEmpty ||
              find.textContaining('KES').evaluate().isNotEmpty,
          timeout: TestConfig.longTimeout,
        );

        if (paymentScreen) {
          await reporter.capture('payment_screen');

          // Should show amount
          expect(find.textContaining('KES'), findsWidgets);
        }
      },
    );
  });
}

// Helper functions
Future<void> _loginAndNavigateToPayments(WidgetTester tester) async {
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

  // Navigate to profile
  await tester.safeTap(AppFinders.bottomNavProfile);
  await tester.settleAndWait();

  // Navigate to payment methods
  await tester.scrollUntilVisible(AppFinders.savedPlacesButton);
  final paymentButton = find.textContaining('Payment');
  await tester.safeTap(paymentButton.first);
  await tester.settleAndWait();
}

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
