import 'package:intl/intl.dart';

/// Numeric extension methods
extension NumExtensions on num {
  /// Format as currency (e.g., "$12.99")
  String toCurrency({String symbol = '\$', int decimalDigits = 2}) {
    final formatter = NumberFormat.currency(
      symbol: symbol,
      decimalDigits: decimalDigits,
    );
    return formatter.format(this);
  }

  /// Format as compact number (e.g., "1.2K", "3.4M")
  String toCompact() {
    final formatter = NumberFormat.compact();
    return formatter.format(this);
  }

  /// Format as percentage (e.g., "85%")
  String toPercentage({int decimalDigits = 0}) {
    final formatter = NumberFormat.percentPattern()
      ..maximumFractionDigits = decimalDigits;
    return formatter.format(this / 100);
  }

  /// Format with thousand separators (e.g., "1,234,567")
  String withSeparators() {
    final formatter = NumberFormat('#,##0');
    return formatter.format(this);
  }

  /// Convert cents to dollars
  double get centsToDollars => this / 100;

  /// Convert meters to kilometers
  double get metersToKilometers => this / 1000;

  /// Convert meters to miles
  double get metersToMiles => this / 1609.344;

  /// Format distance intelligently (m or km)
  String toDistanceString() {
    if (this < 1000) {
      return '${toInt()} m';
    } else {
      return '${(this / 1000).toStringAsFixed(1)} km';
    }
  }

  /// Format duration intelligently (seconds to readable)
  String toDurationString() {
    final seconds = toInt();
    if (seconds < 60) {
      return '$seconds sec';
    } else if (seconds < 3600) {
      return '${seconds ~/ 60} min';
    } else {
      final hours = seconds ~/ 3600;
      final mins = (seconds % 3600) ~/ 60;
      return mins > 0 ? '${hours}h ${mins}m' : '${hours}h';
    }
  }

  /// Clamp value between min and max
  num clampValue(num min, num max) {
    if (this < min) return min;
    if (this > max) return max;
    return this;
  }
}
