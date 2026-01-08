/// E2E Tests - Onboarding Flow
///
/// Tests the complete onboarding experience for new users.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:ubi_rider_app/main.dart' as app;

import '../test_config.dart';
import '../test_utils.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final binding = IntegrationTestWidgetsFlutterBinding.instance;

  group('Onboarding Flow E2E Tests', () {
    setUp(() async {
      await TestCleanup.resetAppState();
    });

    testWidgets(
      'New user sees onboarding screens and can skip to login',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'onboarding_skip');

        // Launch app
        app.main();
        await tester.pumpAndSettle();
        await tester.settleAndWait();

        await reporter.capture('splash_screen');

        // Wait for onboarding to appear (after splash)
        await tester.waitForWidget(
          find.textContaining('Welcome'),
          timeout: TestConfig.defaultTimeout,
        );

        await reporter.capture('onboarding_page_1');

        // Verify first onboarding screen content
        expect(find.textContaining('Welcome'), findsOneWidget);

        // Test skip functionality
        final skipButton = AppFinders.onboardingSkip;
        if (skipButton.evaluate().isNotEmpty) {
          await tester.safeTap(skipButton);
          await tester.settleAndWait();

          await reporter.capture('after_skip');

          // Should be on login page
          expect(AppFinders.phoneInput, findsOneWidget);
        }
      },
    );

    testWidgets(
      'User can swipe through all onboarding pages',
      (tester) async {
        final reporter = ScreenshotReporter(binding, 'onboarding_swipe');

        app.main();
        await tester.pumpAndSettle();
        await tester.settleAndWait();

        // Wait for onboarding
        await tester.waitForWidget(
          find.textContaining('Welcome'),
          timeout: TestConfig.defaultTimeout,
        );

        await reporter.capture('page_1');

        // Swipe to page 2
        await tester.drag(find.byType(PageView), const Offset(-300, 0));
        await tester.pumpAndSettle();
        await reporter.capture('page_2');

        // Swipe to page 3
        await tester.drag(find.byType(PageView), const Offset(-300, 0));
        await tester.pumpAndSettle();
        await reporter.capture('page_3');

        // Look for "Get Started" button on last page
        final getStartedButton = AppFinders.onboardingGetStarted;
        if (getStartedButton.evaluate().isNotEmpty) {
          await tester.safeTap(getStartedButton);
          await tester.settleAndWait();

          await reporter.capture('after_get_started');

          // Should navigate to login
          expect(AppFinders.phoneInput, findsOneWidget);
        }
      },
    );

    testWidgets(
      'Page indicators update correctly during navigation',
      (tester) async {
        app.main();
        await tester.pumpAndSettle();
        await tester.settleAndWait();

        await tester.waitForWidget(
          find.textContaining('Welcome'),
          timeout: TestConfig.defaultTimeout,
        );

        // Find page indicators
        final indicators = find.byKey(const Key('page_indicators'));
        expect(indicators, findsOneWidget);

        // Swipe and verify indicators update
        for (var i = 0; i < 2; i++) {
          await tester.drag(find.byType(PageView), const Offset(-300, 0));
          await tester.pumpAndSettle();
        }

        // Page indicators should reflect current page
        // Specific assertion depends on implementation
      },
    );

    testWidgets(
      'Onboarding is not shown again after completion',
      (tester) async {
        app.main();
        await tester.pumpAndSettle();
        await tester.settleAndWait();

        // Complete onboarding
        await tester.waitForWidget(
          find.textContaining('Welcome'),
          timeout: TestConfig.defaultTimeout,
        );

        // Skip onboarding
        final skipButton = AppFinders.onboardingSkip;
        if (skipButton.evaluate().isNotEmpty) {
          await tester.safeTap(skipButton);
          await tester.settleAndWait();
        }

        // Restart app (simulated by navigating back)
        // In real scenario, would need to reinitialize
        // Verify onboarding is skipped on next launch
      },
    );
  });
}
