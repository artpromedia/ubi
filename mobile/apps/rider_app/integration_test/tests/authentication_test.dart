/// E2E Tests - Authentication Flow
///
/// Tests phone authentication, OTP verification, and registration.
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

  group('Authentication E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    tearDown(() async {
      await TestCleanup.cleanupTestData(TestUsers.standardUser);
    });

    testWidgets(
      'User can login with phone number and OTP - Happy Path',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_login_success');

        await runWithRetry(() async {
          app.main();
          await tester.pumpAndSettle();

          // Skip onboarding if shown
          await _skipOnboardingIfPresent(tester);

          await reporter.capture('login_page');

          // Verify login page elements
          expect(AppFinders.phoneInput, findsOneWidget);
          expect(AppFinders.continueButton, findsOneWidget);

          // Enter phone number
          await tester.enterTextInField(
            AppFinders.phoneInput,
            TestUsers.standardUser.phoneNumber.replaceFirst('+254', ''),
          );
          await reporter.capture('phone_entered');

          // Tap continue
          await tester.safeTap(AppFinders.continueButton);
          await tester.settleAndWait();

          await reporter.capture('otp_page');

          // Should navigate to OTP page
          await tester.waitForWidget(
            AppFinders.otpInput,
            timeout: TestConfig.defaultTimeout,
          );
          expect(AppFinders.otpInput, findsOneWidget);

          // Enter OTP
          await tester.enterTextInField(
            AppFinders.otpInput,
            TestUsers.standardUser.otp,
          );
          await reporter.capture('otp_entered');

          // Wait for verification and navigation to home
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          // Should be on home page
          await tester.waitForWidget(
            AppFinders.pickupInput,
            timeout: TestConfig.longTimeout,
          );

          await reporter.capture('home_page');

          expect(AppFinders.pickupInput, findsOneWidget);
        });
      },
    );

    testWidgets(
      'User sees error for invalid phone number',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_invalid_phone');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Enter invalid phone number (too short)
        await tester.enterTextInField(
          AppFinders.phoneInput,
          '123',
        );
        await reporter.capture('invalid_phone_entered');

        // Tap continue
        await tester.safeTap(AppFinders.continueButton);
        await tester.settleAndWait();

        await reporter.capture('validation_error');

        // Should show error (not navigate to OTP)
        expect(AppFinders.otpInput, findsNothing);
        // Error message should be visible
        expect(find.textContaining('valid'), findsWidgets);
      },
    );

    testWidgets(
      'User sees error for invalid OTP',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_invalid_otp');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Enter valid phone
        await tester.enterTextInField(
          AppFinders.phoneInput,
          TestUsers.standardUser.phoneNumber.replaceFirst('+254', ''),
        );

        await tester.safeTap(AppFinders.continueButton);
        await tester.settleAndWait();

        // Wait for OTP page
        await tester.waitForWidget(AppFinders.otpInput);

        // Enter wrong OTP
        await tester.enterTextInField(
          AppFinders.otpInput,
          '000000',
        );

        await tester.settleAndWait(duration: TestConfig.networkDelay);
        await reporter.capture('wrong_otp_error');

        // Should show error, not navigate to home
        expect(AppFinders.pickupInput, findsNothing);
        // Error should be displayed
        expect(find.textContaining('incorrect'), findsWidgets);
      },
    );

    testWidgets(
      'User can request OTP resend',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_resend_otp');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Navigate to OTP page
        await tester.enterTextInField(
          AppFinders.phoneInput,
          TestUsers.standardUser.phoneNumber.replaceFirst('+254', ''),
        );
        await tester.safeTap(AppFinders.continueButton);
        await tester.settleAndWait();

        await tester.waitForWidget(AppFinders.otpInput);
        await reporter.capture('otp_page_before_resend');

        // Wait for resend button to be enabled (usually after countdown)
        final resendButton = find.textContaining('Resend');
        await tester.waitForWidget(
          resendButton,
          timeout: const Duration(seconds: 60),
        );

        // Tap resend
        await tester.safeTap(resendButton);
        await tester.settleAndWait();

        await reporter.capture('after_resend');

        // Should show confirmation
        expect(find.textContaining('sent'), findsWidgets);
      },
    );

    testWidgets(
      'New user is directed to registration after OTP',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_new_user_registration');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Use new user phone
        await tester.enterTextInField(
          AppFinders.phoneInput,
          TestUsers.newUser.phoneNumber.replaceFirst('+254', ''),
        );

        await tester.safeTap(AppFinders.continueButton);
        await tester.settleAndWait();

        await tester.waitForWidget(AppFinders.otpInput);

        // Enter OTP
        await tester.enterTextInField(
          AppFinders.otpInput,
          TestUsers.newUser.otp,
        );

        await tester.settleAndWait(duration: TestConfig.networkDelay);
        await reporter.capture('registration_page');

        // Should be on registration page (or home if auto-registered)
        final nameInput = find.byKey(const Key('name_input'));
        final emailInput = find.byKey(const Key('email_input'));

        // Either registration fields or home page
        if (nameInput.evaluate().isNotEmpty) {
          expect(nameInput, findsOneWidget);
          expect(emailInput, findsOneWidget);
        } else {
          expect(AppFinders.pickupInput, findsOneWidget);
        }
      },
    );

    testWidgets(
      'User can complete registration with name and email',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_complete_registration');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Navigate to registration
        await tester.enterTextInField(
          AppFinders.phoneInput,
          TestUsers.newUser.phoneNumber.replaceFirst('+254', ''),
        );
        await tester.safeTap(AppFinders.continueButton);
        await tester.settleAndWait();

        await tester.waitForWidget(AppFinders.otpInput);
        await tester.enterTextInField(AppFinders.otpInput, TestUsers.newUser.otp);
        await tester.settleAndWait(duration: TestConfig.networkDelay);

        // If on registration page
        final nameInput = find.byKey(const Key('name_input'));
        if (nameInput.evaluate().isNotEmpty) {
          final testName = 'Test User ${MockDataGenerator.generateId()}';
          final testEmail = MockDataGenerator.generateEmail(name: testName);

          await tester.enterTextInField(nameInput, testName);
          await reporter.capture('name_entered');

          final emailInput = find.byKey(const Key('email_input'));
          await tester.enterTextInField(emailInput, testEmail);
          await reporter.capture('email_entered');

          // Submit registration
          final submitButton = find.byKey(const Key('submit_registration'));
          await tester.safeTap(submitButton);
          await tester.settleAndWait(duration: TestConfig.networkDelay);

          await reporter.capture('after_registration');

          // Should navigate to home
          await tester.waitForWidget(
            AppFinders.pickupInput,
            timeout: TestConfig.defaultTimeout,
          );
        }

        expect(AppFinders.pickupInput, findsOneWidget);
      },
    );

    testWidgets(
      'User can logout and login again',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'auth_logout_login');

        app.main();
        await tester.pumpAndSettle();

        await _skipOnboardingIfPresent(tester);

        // Login
        await _performLogin(tester, TestUsers.standardUser);

        await tester.waitForWidget(AppFinders.pickupInput);
        await reporter.capture('logged_in');

        // Navigate to profile
        await tester.safeTap(AppFinders.bottomNavProfile);
        await tester.settleAndWait();

        await reporter.capture('profile_page');

        // Scroll to logout button if needed
        await tester.scrollUntilVisible(AppFinders.logoutButton);
        await tester.safeTap(AppFinders.logoutButton);
        await tester.settleAndWait();

        // Confirm logout if dialog appears
        final confirmButton = AppFinders.dialogConfirmButton;
        if (confirmButton.evaluate().isNotEmpty) {
          await tester.safeTap(confirmButton);
          await tester.settleAndWait();
        }

        await reporter.capture('after_logout');

        // Should be back on login page
        expect(AppFinders.phoneInput, findsOneWidget);

        // Login again
        await _performLogin(tester, TestUsers.standardUser);

        await tester.waitForWidget(AppFinders.pickupInput);
        await reporter.capture('logged_in_again');

        expect(AppFinders.pickupInput, findsOneWidget);
      },
    );
  });
}

// Helper functions
Future<void> _skipOnboardingIfPresent(WidgetTester tester) async {
  await tester.settleAndWait();

  // Wait for either onboarding or login page
  final hasOnboarding = await tester.waitFor(
    () =>
        AppFinders.onboardingSkip.evaluate().isNotEmpty ||
        AppFinders.phoneInput.evaluate().isNotEmpty,
    timeout: TestConfig.defaultTimeout,
  );

  if (!hasOnboarding) return;

  // If onboarding is shown, skip it
  if (AppFinders.onboardingSkip.evaluate().isNotEmpty) {
    await tester.safeTap(AppFinders.onboardingSkip);
    await tester.settleAndWait();
  }
}

Future<void> _performLogin(WidgetTester tester, TestUser user) async {
  // Enter phone
  await tester.enterTextInField(
    AppFinders.phoneInput,
    user.phoneNumber.replaceFirst('+254', ''),
  );

  // Continue to OTP
  await tester.safeTap(AppFinders.continueButton);
  await tester.settleAndWait();

  // Wait for OTP input
  await tester.waitForWidget(AppFinders.otpInput);

  // Enter OTP
  await tester.enterTextInField(AppFinders.otpInput, user.otp);
  await tester.settleAndWait(duration: TestConfig.networkDelay);
}
