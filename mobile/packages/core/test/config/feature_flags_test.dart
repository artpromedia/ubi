import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_config.dart';

void main() {
  group('FlagSet', () {
    test('denyAll has every flag off', () {
      for (final UbiFlag flag in UbiFlag.values) {
        expect(FlagSet.denyAll.isEnabled(flag), isFalse, reason: flag.key);
      }
      expect(FlagSet.denyAll.isDenyAll, isTrue);
    });

    test('reads the flags the service sent', () {
      final FlagSet flags = FlagSet.fromJson(<String, dynamic>{
        'move': true,
        'bites': false,
      });

      expect(flags.isEnabled(UbiFlag.move), isTrue);
      expect(flags.isEnabled(UbiFlag.bites), isFalse);
      // Never mentioned means off.
      expect(flags.isEnabled(UbiFlag.stays), isFalse);
      expect(flags.enabled, <UbiFlag>[UbiFlag.move]);
    });

    test('drops keys that are not in the closed set', () {
      final FlagSet flags = FlagSet.fromJson(<String, dynamic>{
        'not_a_real_flag': true,
        'move': true,
      });

      expect(flags.enabled, <UbiFlag>[UbiFlag.move]);
    });

    test('drops non-boolean values rather than coercing them', () {
      final FlagSet flags = FlagSet.fromJson(<String, dynamic>{
        'move': 'true',
        'bites': 1,
        'send': null,
      });

      expect(flags.isDenyAll, isTrue);
    });

    test('flag keys match the shared contract exactly', () {
      // Mirrors packages/contracts/src/flags.ts FLAG_KEYS.
      expect(
        UbiFlag.values.map((UbiFlag f) => f.key).toList(),
        <String>[
          'move',
          'bites',
          'send',
          'travel',
          'stays',
          'journeys',
          'reservations',
          'fleet',
          'wallet_p2p',
          'wallet_nip',
          'tips',
          'scheduled_rides',
          'recording',
          'driver_online',
          'ride_request',
          'provider_payments',
        ],
      );
    });
  });
}
