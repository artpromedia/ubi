import 'package:flutter/material.dart';

import '../theme/ubi_colors.dart';

/// String Extensions for UBI UI
extension UbiStringExtensions on String {
  /// Capitalizes the first letter of the string
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }

  /// Capitalizes the first letter of each word
  String capitalizeWords() {
    if (isEmpty) return this;
    return split(' ').map((word) => word.capitalize()).join(' ');
  }

  /// Truncates string to max length with ellipsis
  String truncate(int maxLength, {String suffix = '...'}) {
    if (length <= maxLength) return this;
    return '${substring(0, maxLength - suffix.length)}$suffix';
  }

  /// Checks if string is a valid email
  bool get isValidEmail {
    return RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(this);
  }

  /// Checks if string is a valid phone number (basic)
  bool get isValidPhone {
    return RegExp(r'^\+?[\d\s\-\(\)]{10,}$').hasMatch(this);
  }

  /// Returns null if string is empty
  String? get nullIfEmpty => isEmpty ? null : this;

  /// Masks string for privacy (e.g., email, phone)
  String mask({int visibleStart = 3, int visibleEnd = 3, String maskChar = '*'}) {
    if (length <= visibleStart + visibleEnd) return this;
    final start = substring(0, visibleStart);
    final end = substring(length - visibleEnd);
    final masked = maskChar * (length - visibleStart - visibleEnd);
    return '$start$masked$end';
  }
}

/// BuildContext Extensions for UBI UI
extension UbiBuildContextExtensions on BuildContext {
  /// Gets the current theme
  ThemeData get theme => Theme.of(this);

  /// Gets the current text theme
  TextTheme get textTheme => Theme.of(this).textTheme;

  /// Gets the current color scheme
  ColorScheme get colorScheme => Theme.of(this).colorScheme;

  /// Checks if dark mode is active
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  /// Gets screen width
  double get screenWidth => MediaQuery.of(this).size.width;

  /// Gets screen height
  double get screenHeight => MediaQuery.of(this).size.height;

  /// Gets safe area padding
  EdgeInsets get padding => MediaQuery.of(this).padding;

  /// Gets safe area top padding
  double get paddingTop => MediaQuery.of(this).padding.top;

  /// Gets safe area bottom padding
  double get paddingBottom => MediaQuery.of(this).padding.bottom;

  /// Gets keyboard height
  double get keyboardHeight => MediaQuery.of(this).viewInsets.bottom;

  /// Checks if keyboard is visible
  bool get isKeyboardVisible => MediaQuery.of(this).viewInsets.bottom > 0;

  /// Gets device pixel ratio
  double get devicePixelRatio => MediaQuery.of(this).devicePixelRatio;

  /// Shows a snackbar
  void showSnackBar(String message, {bool isError = false}) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? const Color(0xFFEF4444) : UbiColors.gray900,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  /// Hides current snackbar
  void hideSnackBar() {
    ScaffoldMessenger.of(this).hideCurrentSnackBar();
  }

  /// Unfocus current focus (dismiss keyboard)
  void unfocus() {
    FocusScope.of(this).unfocus();
  }
}

/// Color Extensions for UBI UI
extension UbiColorExtensions on Color {
  /// Lightens the color by the given percentage
  Color lighten([double amount = 0.1]) {
    assert(amount >= 0 && amount <= 1);
    final hsl = HSLColor.fromColor(this);
    return hsl
        .withLightness((hsl.lightness + amount).clamp(0.0, 1.0))
        .toColor();
  }

  /// Darkens the color by the given percentage
  Color darken([double amount = 0.1]) {
    assert(amount >= 0 && amount <= 1);
    final hsl = HSLColor.fromColor(this);
    return hsl
        .withLightness((hsl.lightness - amount).clamp(0.0, 1.0))
        .toColor();
  }

  /// Returns the color with modified opacity
  Color withOpacity(double opacity) {
    return withValues(alpha: opacity);
  }

  /// Converts color to hex string
  String toHex({bool includeHash = true, bool includeAlpha = false}) {
    final buffer = StringBuffer();
    if (includeHash) buffer.write('#');
    if (includeAlpha) buffer.write(_toHex(a.toInt()));
    buffer.write(_toHex(r.toInt()));
    buffer.write(_toHex(g.toInt()));
    buffer.write(_toHex(b.toInt()));
    return buffer.toString();
  }

  String _toHex(int value) => value.toRadixString(16).padLeft(2, '0');
}

/// DateTime Extensions for UBI UI
extension UbiDateTimeExtensions on DateTime {
  /// Checks if date is today
  bool get isToday {
    final now = DateTime.now();
    return year == now.year && month == now.month && day == now.day;
  }

  /// Checks if date is yesterday
  bool get isYesterday {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    return year == yesterday.year &&
        month == yesterday.month &&
        day == yesterday.day;
  }

  /// Checks if date is tomorrow
  bool get isTomorrow {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    return year == tomorrow.year &&
        month == tomorrow.month &&
        day == tomorrow.day;
  }

  /// Checks if date is in the past
  bool get isPast => isBefore(DateTime.now());

  /// Checks if date is in the future
  bool get isFuture => isAfter(DateTime.now());

  /// Gets start of day
  DateTime get startOfDay => DateTime(year, month, day);

  /// Gets end of day
  DateTime get endOfDay => DateTime(year, month, day, 23, 59, 59, 999);

  /// Formats to relative time string
  String toRelativeString() {
    final now = DateTime.now();
    final difference = now.difference(this);

    if (difference.isNegative) {
      // Future
      final absDiff = difference.abs();
      if (absDiff.inMinutes < 1) return 'in a moment';
      if (absDiff.inMinutes < 60) return 'in ${absDiff.inMinutes}m';
      if (absDiff.inHours < 24) return 'in ${absDiff.inHours}h';
      if (absDiff.inDays < 7) return 'in ${absDiff.inDays}d';
      return 'in ${(absDiff.inDays / 7).floor()}w';
    } else {
      // Past
      if (difference.inMinutes < 1) return 'just now';
      if (difference.inMinutes < 60) return '${difference.inMinutes}m ago';
      if (difference.inHours < 24) return '${difference.inHours}h ago';
      if (difference.inDays < 7) return '${difference.inDays}d ago';
      return '${(difference.inDays / 7).floor()}w ago';
    }
  }
}

/// Duration Extensions for UBI UI
extension UbiDurationExtensions on Duration {
  /// Formats duration to MM:SS string
  String toMinutesSeconds() {
    final minutes = inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  /// Formats duration to HH:MM:SS string
  String toHoursMinutesSeconds() {
    final hours = inHours.toString().padLeft(2, '0');
    final minutes = inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$hours:$minutes:$seconds';
  }

  /// Formats to human readable string
  String toReadableString() {
    if (inDays > 0) return '$inDays day${inDays > 1 ? 's' : ''}';
    if (inHours > 0) return '$inHours hour${inHours > 1 ? 's' : ''}';
    if (inMinutes > 0) return '$inMinutes min${inMinutes > 1 ? 's' : ''}';
    return '$inSeconds sec${inSeconds > 1 ? 's' : ''}';
  }
}

/// List Extensions for UBI UI
extension UbiListExtensions<T> on List<T> {
  /// Returns first element or null if empty
  T? get firstOrNull => isEmpty ? null : first;

  /// Returns last element or null if empty
  T? get lastOrNull => isEmpty ? null : last;

  /// Returns element at index or null if out of bounds
  T? elementAtOrNull(int index) {
    if (index < 0 || index >= length) return null;
    return this[index];
  }

  /// Separates list items with a separator
  List<T> separatedBy(T separator) {
    if (isEmpty) return [];
    return expand((item) => [item, separator]).toList()..removeLast();
  }
}

/// Nullable Extensions
extension UbiNullableExtensions<T> on T? {
  /// Returns the value or a default if null
  T orDefault(T defaultValue) => this ?? defaultValue;

  /// Transforms the value if not null
  R? map<R>(R Function(T) transform) {
    if (this == null) return null;
    return transform(this as T);
  }
}
