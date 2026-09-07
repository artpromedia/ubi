/// Money and date formatting driven entirely by city config.
///
/// The currency code, the minor-unit exponent and the locale all come from
/// [CityConfig]. Nothing in this file names a currency, a symbol or a market
/// (CLAUDE.md rule 6), and nothing here does arithmetic on an amount: the
/// server computes, the client renders (rule 1).
library;

import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'city_config.dart';
import 'money.dart';

class UbiMoneyFormatter {
  const UbiMoneyFormatter({
    required this.currency,
    required this.fractionDigits,
    required this.locale,
  });

  /// The only supported way to build one.
  factory UbiMoneyFormatter.fromConfig(CityConfig config) => UbiMoneyFormatter(
        currency: config.currency,
        fractionDigits: config.currencyFractionDigits,
        locale: config.locale,
      );

  /// ISO-4217 code from config.
  final String currency;

  /// Minor-unit exponent from config — 2 for kobo, 0 for a zero-decimal
  /// currency. Never assumed.
  final int fractionDigits;

  /// BCP-47 locale from config; decides grouping and decimal separators.
  final String locale;

  /// Formats an amount in the city's own currency, e.g. `1234567` kobo.
  String formatMinor(int amountMinor) =>
      _format(amountMinor, currency, fractionDigits);

  /// Formats a server-supplied [Money].
  ///
  /// The amount is rendered in the currency the server stamped on it. When
  /// that is not the city currency (a cross-border booking) the exponent for
  /// the city is not applicable, so the locale's own default is used rather
  /// than a guess.
  String format(Money money) {
    if (money.currency == currency) {
      return _format(money.amountMinor, currency, fractionDigits);
    }
    return _format(money.amountMinor, money.currency, null);
  }

  /// Formats an amount that is already expressed in MAJOR units.
  ///
  /// No conversion and no rounding decision happens here — the number is
  /// passed straight to the locale's currency pattern with the city's currency
  /// and fraction digits. It exists for call sites that still receive a bare
  /// number from a pre-slice-03 bloc; anything that has a server-signed amount
  /// uses [format] with a [Money] instead.
  String formatMajor(num amountMajor) {
    return NumberFormat.currency(
      locale: locale,
      name: currency,
      decimalDigits: fractionDigits,
    ).format(amountMajor);
  }

  /// Same as [format] with an explicit sign, for statement and ledger rows
  /// where a credit and a debit must be told apart without colour.
  String formatSigned(Money money) {
    final String rendered = format(money);
    if (money.amountMinor > 0 && !rendered.startsWith('+')) {
      return '+$rendered';
    }
    return rendered;
  }

  /// Screen-reader label: money is always announced with its currency
  /// (slice 12 accessibility).
  String semanticsLabel(Money money) {
    final int digits =
        money.currency == currency ? fractionDigits : _defaultDigitsFor(money.currency);
    final double major = _toMajor(money.amountMinor, digits);
    final NumberFormat plain = NumberFormat.decimalPatternDigits(
      locale: locale,
      decimalDigits: digits,
    );
    return '${plain.format(major)} ${money.currency}';
  }

  String _format(int amountMinor, String currencyCode, int? digits) {
    final int effectiveDigits = digits ?? _defaultDigitsFor(currencyCode);
    final NumberFormat format = NumberFormat.currency(
      locale: locale,
      name: currencyCode,
      decimalDigits: effectiveDigits,
    );
    return format.format(_toMajor(amountMinor, effectiveDigits));
  }

  /// Minor units to major units. Display only — no rounding decision is made
  /// here that could change an amount the server computed.
  static double _toMajor(int amountMinor, int digits) {
    int scale = 1;
    for (int i = 0; i < digits; i++) {
      scale *= 10;
    }
    return amountMinor / scale;
  }

  /// The exponent `intl` knows for a currency, used only for an amount that is
  /// not in the city currency.
  static int _defaultDigitsFor(String currencyCode) =>
      NumberFormat.simpleCurrency(name: currencyCode).decimalDigits ?? 2;
}

class UbiDateTimeFormatter {
  const UbiDateTimeFormatter({required this.locale, required this.timezone});

  factory UbiDateTimeFormatter.fromConfig(CityConfig config) =>
      UbiDateTimeFormatter(locale: config.locale, timezone: config.timezone);

  /// BCP-47 locale from config.
  final String locale;

  /// IANA timezone id from config.
  ///
  /// KNOWN GAP: converting an instant into this zone needs a tz database, and
  /// no timezone package is declared in this workspace. Everything below
  /// renders in the device's own zone. Do not present these strings as
  /// city-local times until that dependency exists.
  final String timezone;

  /// Loads the locale data `DateFormat` needs. Call once at startup, after the
  /// city config is known.
  static Future<void> ensureLocaleData(String locale) =>
      initializeDateFormatting(locale);

  String date(DateTime value) => DateFormat.yMMMd(locale).format(value.toLocal());

  String time(DateTime value) => DateFormat.jm(locale).format(value.toLocal());

  String dateTime(DateTime value) =>
      '${date(value)} ${time(value)}';

  /// Short "last updated" stamp for the offline banner.
  String timestamp(DateTime value) =>
      DateFormat.MMMd(locale).add_jm().format(value.toLocal());
}
