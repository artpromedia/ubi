import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_config.dart';

import 'config_fixtures.dart';

void main() {
  group('UbiMoneyFormatter', () {
    test('takes currency, fraction digits and locale from config', () {
      final CityConfig config = CityConfig.fromJson(
        cityConfigJson(currency: 'NGN', currencyFractionDigits: 2),
      );
      final UbiMoneyFormatter formatter = UbiMoneyFormatter.fromConfig(config);

      expect(formatter.currency, 'NGN');
      expect(formatter.fractionDigits, 2);
      expect(formatter.locale, 'en_GB');
    });

    test('renders minor units at the configured precision', () {
      final CityConfig config = CityConfig.fromJson(
        cityConfigJson(currency: 'NGN', currencyFractionDigits: 2),
      );
      final UbiMoneyFormatter formatter = UbiMoneyFormatter.fromConfig(config);

      // 123456 kobo is 1,234.56 — grouped, two decimals, whatever symbol the
      // locale data has for NGN.
      final String rendered = formatter.formatMinor(123456);
      expect(rendered, contains('1,234.56'));
    });

    test('a zero-decimal currency renders no decimals', () {
      final CityConfig config = CityConfig.fromJson(
        cityConfigJson(currency: 'JPY', currencyFractionDigits: 0),
      );
      final UbiMoneyFormatter formatter = UbiMoneyFormatter.fromConfig(config);

      final String rendered = formatter.formatMinor(1234);
      expect(rendered, contains('1,234'));
      expect(rendered, isNot(contains('.')));
    });

    test('announces money with its currency for screen readers', () {
      final CityConfig config = CityConfig.fromJson(
        cityConfigJson(currency: 'NGN', currencyFractionDigits: 2),
      );
      final UbiMoneyFormatter formatter = UbiMoneyFormatter.fromConfig(config);

      expect(
        formatter.semanticsLabel(
          const Money(amountMinor: 123456, currency: 'NGN'),
        ),
        '1,234.56 NGN',
      );
    });

    test('renders an amount in the currency the server stamped on it', () {
      final CityConfig config = CityConfig.fromJson(
        cityConfigJson(currency: 'NGN', currencyFractionDigits: 2),
      );
      final UbiMoneyFormatter formatter = UbiMoneyFormatter.fromConfig(config);

      final String rendered = formatter.format(
        const Money(amountMinor: 50000, currency: 'USD'),
      );
      // 50000 cents is 500.00 in USD, not 500.00 in the city currency.
      expect(rendered, contains('500.00'));
      expect(
        formatter.semanticsLabel(
          const Money(amountMinor: 50000, currency: 'USD'),
        ),
        '500.00 USD',
      );
    });
  });

  group('Money', () {
    test('round-trips the contract shape', () {
      final Money money = Money.fromJson(<String, dynamic>{
        'amountMinor': 30000,
        'currency': 'NGN',
      });

      expect(money.amountMinor, 30000);
      expect(money.currency, 'NGN');
      expect(money.toJson(), <String, dynamic>{
        'amountMinor': 30000,
        'currency': 'NGN',
      });
    });

    test('rejects a payload without a currency', () {
      expect(
        () => Money.fromJson(<String, dynamic>{'amountMinor': 1}),
        throwsA(isA<ConfigFormatException>()),
      );
    });
  });
}
