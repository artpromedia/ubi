import 'package:intl/intl.dart';

/// UBI Formatters
///
/// Utility class for formatting data across UBI mobile apps.
/// Supports currency, dates, distances, and other common formats
/// with localization for African markets.
class UbiFormatters {
  UbiFormatters._();

  // === Currency Formatters ===

  /// Formats amount with currency symbol
  static String currency(
    double amount, {
    String currency = 'KES',
    int decimalDigits = 0,
    bool compact = false,
  }) {
    final currencySymbols = {
      'KES': 'KSh',
      'UGX': 'USh',
      'TZS': 'TSh',
      'NGN': '₦',
      'GHS': 'GH₵',
      'ZAR': 'R',
      'USD': '\$',
      'EUR': '€',
      'GBP': '£',
      'RWF': 'FRw',
      'XOF': 'CFA',
      'XAF': 'FCFA',
      'ETB': 'Br',
      'EGP': 'E£',
    };

    final symbol = currencySymbols[currency] ?? currency;

    if (compact && amount >= 1000) {
      return '$symbol${_compactNumber(amount)}';
    }

    final formatter = NumberFormat.currency(
      symbol: symbol,
      decimalDigits: decimalDigits,
    );
    return formatter.format(amount);
  }

  /// Formats amount without currency symbol
  static String amount(
    double value, {
    int decimalDigits = 0,
    bool compact = false,
  }) {
    if (compact && value >= 1000) {
      return _compactNumber(value);
    }
    return NumberFormat.decimalPattern().format(value);
  }

  static String _compactNumber(double value) {
    if (value >= 1000000000) {
      return '${(value / 1000000000).toStringAsFixed(1)}B';
    } else if (value >= 1000000) {
      return '${(value / 1000000).toStringAsFixed(1)}M';
    } else if (value >= 1000) {
      return '${(value / 1000).toStringAsFixed(1)}K';
    }
    return value.toStringAsFixed(0);
  }

  // === Distance & Duration Formatters ===

  /// Formats distance in km/m
  static String distance(double meters) {
    if (meters < 1000) {
      return '${meters.round()} m';
    }
    return '${(meters / 1000).toStringAsFixed(1)} km';
  }

  /// Formats estimated time of arrival
  static String eta(Duration duration) {
    if (duration.inMinutes < 1) {
      return '< 1 min';
    } else if (duration.inMinutes < 60) {
      return '${duration.inMinutes} min';
    } else {
      final hours = duration.inHours;
      final mins = duration.inMinutes.remainder(60);
      if (mins == 0) {
        return '$hours hr';
      }
      return '$hours hr $mins min';
    }
  }

  /// Formats trip duration
  static String tripDuration(Duration duration) {
    if (duration.inMinutes < 60) {
      return '${duration.inMinutes} min';
    }
    final hours = duration.inHours;
    final mins = duration.inMinutes.remainder(60);
    if (hours < 24) {
      return mins > 0 ? '$hours h $mins min' : '$hours h';
    }
    final days = duration.inDays;
    final remainingHours = hours.remainder(24);
    return remainingHours > 0 ? '$days d $remainingHours h' : '$days d';
  }

  // === Date & Time Formatters ===

  /// Formats date to readable string
  static String date(DateTime date, {DateFormat? format}) {
    if (format != null) {
      return format.format(date);
    }
    return DateFormat('MMM d, y').format(date);
  }

  /// Formats time to readable string
  static String time(DateTime time, {bool use24Hour = false}) {
    if (use24Hour) {
      return DateFormat('HH:mm').format(time);
    }
    return DateFormat('h:mm a').format(time);
  }

  /// Formats date and time
  static String dateTime(DateTime dateTime, {bool use24Hour = false}) {
    final dateStr = date(dateTime);
    final timeStr = time(dateTime, use24Hour: use24Hour);
    return '$dateStr at $timeStr';
  }

  /// Formats relative time (e.g., "2 hours ago", "in 5 minutes")
  static String relativeTime(DateTime dateTime) {
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.isNegative) {
      // Future time
      final absDiff = difference.abs();
      if (absDiff.inSeconds < 60) return 'in a moment';
      if (absDiff.inMinutes < 60) return 'in ${absDiff.inMinutes} min';
      if (absDiff.inHours < 24) return 'in ${absDiff.inHours} hr';
      if (absDiff.inDays < 7) return 'in ${absDiff.inDays} days';
      return date(dateTime);
    } else {
      // Past time
      if (difference.inSeconds < 60) return 'just now';
      if (difference.inMinutes < 60) return '${difference.inMinutes} min ago';
      if (difference.inHours < 24) return '${difference.inHours} hr ago';
      if (difference.inDays < 7) return '${difference.inDays} days ago';
      return date(dateTime);
    }
  }

  /// Formats today/yesterday/date
  static String relativeDate(DateTime dateTime) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dateDay = DateTime(dateTime.year, dateTime.month, dateTime.day);
    final difference = today.difference(dateDay).inDays;

    if (difference == 0) return 'Today';
    if (difference == 1) return 'Yesterday';
    if (difference == -1) return 'Tomorrow';
    if (difference > 0 && difference < 7) return DateFormat('EEEE').format(dateTime);
    return date(dateTime);
  }

  // === Phone Number Formatters ===

  /// Formats phone number for display
  static String phoneNumber(String phone, {String? countryCode}) {
    // Remove non-digit characters except +
    final cleaned = phone.replaceAll(RegExp(r'[^\d+]'), '');

    // Format based on length
    if (cleaned.startsWith('+254') && cleaned.length == 13) {
      // Kenya: +254 7XX XXX XXX
      return '+254 ${cleaned.substring(4, 7)} ${cleaned.substring(7, 10)} ${cleaned.substring(10)}';
    } else if (cleaned.startsWith('+234') && cleaned.length >= 13) {
      // Nigeria: +234 XXX XXX XXXX
      return '+234 ${cleaned.substring(4, 7)} ${cleaned.substring(7, 10)} ${cleaned.substring(10)}';
    } else if (cleaned.startsWith('+233') && cleaned.length == 13) {
      // Ghana: +233 XX XXX XXXX
      return '+233 ${cleaned.substring(4, 6)} ${cleaned.substring(6, 9)} ${cleaned.substring(9)}';
    } else if (cleaned.startsWith('+256') && cleaned.length == 13) {
      // Uganda: +256 7XX XXX XXX
      return '+256 ${cleaned.substring(4, 7)} ${cleaned.substring(7, 10)} ${cleaned.substring(10)}';
    }

    // Default: just return with basic formatting
    if (cleaned.length > 6) {
      return cleaned;
    }
    return phone;
  }

  /// Masks phone number for privacy
  static String maskedPhoneNumber(String phone) {
    final cleaned = phone.replaceAll(RegExp(r'[^\d+]'), '');
    if (cleaned.length < 8) return phone;

    final prefix = cleaned.substring(0, cleaned.length - 4);
    final masked = '*' * (prefix.length - 4 > 0 ? prefix.length - 4 : 0);
    final start = prefix.substring(0, prefix.length - masked.length);
    final suffix = cleaned.substring(cleaned.length - 4);

    return '$start$masked$suffix';
  }

  // === Rating Formatters ===

  /// Formats rating value
  static String rating(double value, {int precision = 1}) {
    return value.toStringAsFixed(precision);
  }

  /// Formats rating count
  static String ratingCount(int count) {
    if (count < 1000) return '($count)';
    if (count < 1000000) return '(${(count / 1000).toStringAsFixed(1)}K)';
    return '(${(count / 1000000).toStringAsFixed(1)}M)';
  }

  // === Order/ID Formatters ===

  /// Formats order ID for display
  static String orderId(String id, {int visibleChars = 8}) {
    if (id.length <= visibleChars) return id.toUpperCase();
    return '#${id.substring(0, visibleChars).toUpperCase()}';
  }

  /// Formats vehicle plate number
  static String plateNumber(String plate) {
    // Common African formats
    return plate.toUpperCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  // === Percentage Formatters ===

  /// Formats percentage
  static String percentage(double value, {int decimalDigits = 0}) {
    return '${value.toStringAsFixed(decimalDigits)}%';
  }

  /// Formats change percentage (with + or -)
  static String changePercentage(double value, {int decimalDigits = 1}) {
    final sign = value >= 0 ? '+' : '';
    return '$sign${value.toStringAsFixed(decimalDigits)}%';
  }

  // === File Size Formatters ===

  /// Formats file size in bytes to human readable
  static String fileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }
}

/// UBI Validators
///
/// Common validation functions for UBI forms.
class UbiValidators {
  UbiValidators._();

  /// Validates email address
  static String? email(String? value, {String? message}) {
    if (value == null || value.isEmpty) {
      return message ?? 'Email is required';
    }
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(value)) {
      return message ?? 'Please enter a valid email';
    }
    return null;
  }

  /// Validates phone number (basic)
  static String? phone(String? value, {String? message}) {
    if (value == null || value.isEmpty) {
      return message ?? 'Phone number is required';
    }
    final phoneRegex = RegExp(r'^\+?[\d\s\-\(\)]{10,}$');
    if (!phoneRegex.hasMatch(value)) {
      return message ?? 'Please enter a valid phone number';
    }
    return null;
  }

  /// Validates required field
  static String? required(String? value, {String? message, String? fieldName}) {
    if (value == null || value.trim().isEmpty) {
      return message ?? '${fieldName ?? 'This field'} is required';
    }
    return null;
  }

  /// Validates minimum length
  static String? minLength(String? value, int minLength, {String? message}) {
    if (value == null || value.length < minLength) {
      return message ?? 'Must be at least $minLength characters';
    }
    return null;
  }

  /// Validates maximum length
  static String? maxLength(String? value, int maxLength, {String? message}) {
    if (value != null && value.length > maxLength) {
      return message ?? 'Must be at most $maxLength characters';
    }
    return null;
  }

  /// Validates PIN code
  static String? pin(String? value, {int length = 4, String? message}) {
    if (value == null || value.isEmpty) {
      return message ?? 'PIN is required';
    }
    if (value.length != length || !RegExp(r'^\d+$').hasMatch(value)) {
      return message ?? 'PIN must be $length digits';
    }
    return null;
  }

  /// Validates OTP
  static String? otp(String? value, {int length = 6, String? message}) {
    if (value == null || value.isEmpty) {
      return message ?? 'OTP is required';
    }
    if (value.length != length || !RegExp(r'^\d+$').hasMatch(value)) {
      return message ?? 'OTP must be $length digits';
    }
    return null;
  }

  /// Combines multiple validators
  static String? Function(String?) combine(
    List<String? Function(String?)> validators,
  ) {
    return (value) {
      for (final validator in validators) {
        final result = validator(value);
        if (result != null) return result;
      }
      return null;
    };
  }
}
