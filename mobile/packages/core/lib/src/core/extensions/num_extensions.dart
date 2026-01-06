/// Number Extensions
///
/// Useful extensions on num, int, and double types.
library;

/// Extensions on num
extension NumExtensions on num {
  /// Check if number is positive
  bool get isPositive => this > 0;

  /// Check if number is negative
  bool get isNegative => this < 0;

  /// Check if number is zero
  bool get isZero => this == 0;

  /// Clamp value between min and max
  num clampRange(num min, num max) => this < min ? min : (this > max ? max : this);

  /// Convert to duration in milliseconds
  Duration get milliseconds => Duration(milliseconds: toInt());

  /// Convert to duration in seconds
  Duration get seconds => Duration(seconds: toInt());

  /// Convert to duration in minutes
  Duration get minutes => Duration(minutes: toInt());

  /// Convert to duration in hours
  Duration get hours => Duration(hours: toInt());

  /// Convert to duration in days
  Duration get days => Duration(days: toInt());
}

/// Extensions on int
extension IntExtensions on int {
  /// Check if number is even
  bool get isEven => this % 2 == 0;

  /// Check if number is odd
  bool get isOdd => this % 2 != 0;

  /// Generate list from 0 to this number (exclusive)
  List<int> get range => List.generate(this, (i) => i);

  /// Repeat action n times
  void times(void Function(int) action) {
    for (var i = 0; i < this; i++) {
      action(i);
    }
  }

  /// Format with leading zeros
  String padLeft(int width) => toString().padLeft(width, '0');
}

/// Extensions on double
extension DoubleExtensions on double {
  /// Round to specified decimal places
  double roundTo(int places) {
    final mod = _pow10(places);
    return (this * mod).round() / mod;
  }

  /// Format as currency
  String toCurrency({String symbol = '\$', int decimals = 2}) {
    return '$symbol${toStringAsFixed(decimals)}';
  }

  /// Format as percentage
  String toPercentage({int decimals = 1}) {
    return '${(this * 100).toStringAsFixed(decimals)}%';
  }
}

/// Helper function to calculate power of 10
num _pow10(int exponent) {
  num result = 1;
  for (var i = 0; i < exponent; i++) {
    result *= 10;
  }
  return result;
}

/// Extensions on nullable num
extension NullableNumExtensions on num? {
  /// Return zero if null
  num get orZero => this ?? 0;

  /// Check if number is null or zero
  bool get isNullOrZero => this == null || this == 0;

  /// Check if number is not null and not zero
  bool get isNotNullOrZero => this != null && this != 0;
}
