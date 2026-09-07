import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_config.dart';

import 'config_fixtures.dart';

void main() {
  group('CityConfig.fromJson', () {
    test('reads every field the contract declares', () {
      final CityConfig config = CityConfig.fromJson(cityConfigJson());

      expect(config.cityId, 'TESTCITY');
      expect(config.version, 7);
      expect(config.currency, 'XTS');
      expect(config.currencyFractionDigits, 2);
      expect(config.emergencyNumber, '112');
      expect(config.pinRequired, isTrue);
      expect(config.offerTtlSec, 12);
      expect(config.waitPolicy.freeSec, 300);
      expect(config.cancelPolicy.riderFeeAfterAssignMinor, 30000);
      expect(config.airport.doors['T1'], 'Door 3');
      expect(config.taxes['vat'], 7.5);
    });

    test('a missing field is a hard failure, never a default', () {
      for (final String field in <String>[
        'currency',
        'currencyFractionDigits',
        'locale',
        'emergencyNumber',
        'quoteTtlSec',
        'offerTtlSec',
      ]) {
        final Map<String, dynamic> json = cityConfigJson()..remove(field);
        expect(
          () => CityConfig.fromJson(json),
          throwsA(isA<ConfigFormatException>()),
          reason: 'missing $field must not fall back to a default',
        );
      }
    });

    test('an unknown vehicle class has no fare table rather than a free ride',
        () {
      final CityConfig config = CityConfig.fromJson(cityConfigJson());

      expect(config.fareTableFor('go')?.baseMinor, 50000);
      expect(config.fareTableFor('moto'), isNull);
    });

    test('payment methods are unavailable unless the city says otherwise', () {
      final CityConfig config = CityConfig.fromJson(cityConfigJson());

      expect(config.paymentMethodAvailable('cash'), isTrue);
      expect(config.paymentMethodAvailable('card'), isFalse);
      expect(
        config.paymentMethod('card')?.reason,
        'Cards are not enabled in this city yet',
      );
      // A method the city never listed is not available.
      expect(config.paymentMethodAvailable('bank_transfer'), isFalse);
      expect(config.paymentMethod('bank_transfer'), isNull);
    });
  });
}
