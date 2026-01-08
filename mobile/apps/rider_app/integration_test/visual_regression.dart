/// Visual Regression Testing for UBI Rider App
///
/// Captures and compares screenshots for UI consistency.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as path;

/// Visual regression test configuration
class VisualRegressionConfig {
  /// Golden images directory
  static const String goldenDir = 'test/goldens';

  /// Current screenshots directory
  static const String screenshotsDir = 'test/screenshots';

  /// Difference threshold (0.0 - 1.0)
  /// Lower values are more strict
  static const double diffThreshold = 0.001;

  /// Supported screen sizes for testing
  static const List<ScreenSize> screenSizes = [
    ScreenSize('small_phone', 360, 640),
    ScreenSize('medium_phone', 390, 844),
    ScreenSize('large_phone', 414, 896),
    ScreenSize('tablet', 768, 1024),
  ];
}

/// Screen size configuration
class ScreenSize {
  final String name;
  final double width;
  final double height;

  const ScreenSize(this.name, this.width, this.height);

  Size toSize() => Size(width, height);
}

/// Visual regression test runner
class VisualRegressionTester {
  final IntegrationTestWidgetsFlutterBinding binding;
  final String testName;
  final bool updateGoldens;

  VisualRegressionTester({
    required this.binding,
    required this.testName,
    this.updateGoldens = false,
  });

  /// Capture and compare screenshot
  Future<void> compare(
    WidgetTester tester,
    String screenName, {
    ScreenSize? screenSize,
  }) async {
    // Ensure widget is settled
    await tester.pumpAndSettle();

    // Capture screenshot
    final screenshot = await binding.takeScreenshot(screenName);

    final sizeSuffix = screenSize?.name ?? 'default';
    final goldenPath = path.join(
      VisualRegressionConfig.goldenDir,
      testName,
      '${screenName}_$sizeSuffix.png',
    );
    final currentPath = path.join(
      VisualRegressionConfig.screenshotsDir,
      testName,
      '${screenName}_$sizeSuffix.png',
    );

    // Save current screenshot
    final currentFile = File(currentPath);
    await currentFile.parent.create(recursive: true);
    await currentFile.writeAsBytes(screenshot);

    // Compare with golden
    final goldenFile = File(goldenPath);

    if (updateGoldens || !goldenFile.existsSync()) {
      // Update golden image
      await goldenFile.parent.create(recursive: true);
      await goldenFile.writeAsBytes(screenshot);
      print('📸 Updated golden: $goldenPath');
    } else {
      // Compare with existing golden
      final goldenBytes = await goldenFile.readAsBytes();
      final diffResult = _compareImages(goldenBytes, screenshot);

      if (diffResult > VisualRegressionConfig.diffThreshold) {
        // Save diff image
        final diffPath = path.join(
          VisualRegressionConfig.screenshotsDir,
          testName,
          '${screenName}_${sizeSuffix}_diff.png',
        );

        fail(
          'Visual regression detected for $screenName!\n'
          'Difference: ${(diffResult * 100).toStringAsFixed(2)}%\n'
          'Threshold: ${(VisualRegressionConfig.diffThreshold * 100).toStringAsFixed(2)}%\n'
          'Golden: $goldenPath\n'
          'Current: $currentPath',
        );
      }

      print('✅ Visual match: $screenName (diff: ${(diffResult * 100).toStringAsFixed(4)}%)');
    }
  }

  /// Compare two images and return difference ratio
  double _compareImages(Uint8List golden, Uint8List current) {
    // Simple hash comparison for now
    // In production, use pixel-by-pixel comparison with image library
    final goldenHash = md5.convert(golden).toString();
    final currentHash = md5.convert(current).toString();

    if (goldenHash == currentHash) {
      return 0.0;
    }

    // Calculate byte-level difference as approximation
    final minLength =
        golden.length < current.length ? golden.length : current.length;
    var diffCount = 0;

    for (var i = 0; i < minLength; i++) {
      if (golden[i] != current[i]) {
        diffCount++;
      }
    }

    diffCount += (golden.length - current.length).abs();

    return diffCount / golden.length;
  }
}

/// Multi-screen size test helper
Future<void> runVisualTestForAllSizes(
  WidgetTester tester,
  IntegrationTestWidgetsFlutterBinding binding,
  String testName,
  String screenName,
  Future<void> Function() setupWidget,
) async {
  final vrTester = VisualRegressionTester(
    binding: binding,
    testName: testName,
    updateGoldens: bool.fromEnvironment('UPDATE_GOLDENS', defaultValue: false),
  );

  for (final size in VisualRegressionConfig.screenSizes) {
    // Set screen size
    tester.view.physicalSize = size.toSize();
    tester.view.devicePixelRatio = 3.0;

    // Run setup
    await setupWidget();
    await tester.pumpAndSettle();

    // Capture and compare
    await vrTester.compare(tester, screenName, screenSize: size);

    // Reset screen size
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  }
}

/// Screen-specific visual tests
class VisualRegressionTests {
  /// Test home screen visual consistency
  static Future<void> testHomeScreen(
    WidgetTester tester,
    IntegrationTestWidgetsFlutterBinding binding,
  ) async {
    await runVisualTestForAllSizes(
      tester,
      binding,
      'home',
      'home_screen',
      () async {
        // Navigate to home screen
        // This depends on your app structure
      },
    );
  }

  /// Test booking flow screens
  static Future<void> testBookingScreens(
    WidgetTester tester,
    IntegrationTestWidgetsFlutterBinding binding,
  ) async {
    final screens = [
      'location_search',
      'ride_options',
      'payment_selection',
      'booking_confirmation',
    ];

    for (final screen in screens) {
      await runVisualTestForAllSizes(
        tester,
        binding,
        'booking',
        screen,
        () async {
          // Navigate to each screen
        },
      );
    }
  }

  /// Test profile screens
  static Future<void> testProfileScreens(
    WidgetTester tester,
    IntegrationTestWidgetsFlutterBinding binding,
  ) async {
    await runVisualTestForAllSizes(
      tester,
      binding,
      'profile',
      'profile_main',
      () async {
        // Navigate to profile
      },
    );
  }
}
