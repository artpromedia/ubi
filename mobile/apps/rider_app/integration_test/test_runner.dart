/// Test Runner Script
///
/// Runs all integration tests with configuration options.
/// Usage: flutter test integration_test/ --flavor dev
library;

import 'dart:io';

import 'tests/authentication_test.dart' as authentication;
import 'tests/error_scenarios_test.dart' as error_scenarios;
import 'tests/onboarding_test.dart' as onboarding;
import 'tests/payment_test.dart' as payment;
import 'tests/rating_test.dart' as rating;
import 'tests/ride_booking_test.dart' as ride_booking;
import 'tests/ride_tracking_test.dart' as ride_tracking;

/// Test entry point for CI/CD
void main() {
  print('🧪 UBI Rider App - E2E Test Suite');
  print('================================');

  final testGroups = [
    ('Onboarding', onboarding.main),
    ('Authentication', authentication.main),
    ('Ride Booking', ride_booking.main),
    ('Ride Tracking', ride_tracking.main),
    ('Payment', payment.main),
    ('Rating', rating.main),
    ('Error Scenarios', error_scenarios.main),
  ];

  print('Running ${testGroups.length} test groups...\n');

  for (final (name, test) in testGroups) {
    print('▶ Starting $name tests');
    test();
  }
}
