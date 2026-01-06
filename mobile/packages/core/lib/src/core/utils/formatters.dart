/// Formatters
///
/// Common formatting functions for displaying data.
library;

/// Collection of formatter functions
abstract class Formatters {
  /// Format currency
  static String currency(
    double amount, {
    String symbol = '\$',
    int decimals = 2,
    String locale = 'en_US',
  }) {
    final formatted = amount.toStringAsFixed(decimals);
    return '$symbol$formatted';
  }

  /// Format phone number
  static String phone(String phoneNumber, {String countryCode = '+1'}) {
    final cleaned = phoneNumber.replaceAll(RegExp(r'\D'), '');
    if (cleaned.length == 10) {
      return '$countryCode (${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}';
    }
    return phoneNumber;
  }

  /// Format distance in meters to human readable
  static String distance(double meters) {
    if (meters < 1000) {
      return '${meters.round()} m';
    } else {
      return '${(meters / 1000).toStringAsFixed(1)} km';
    }
  }

  /// Format duration in seconds to human readable
  static String duration(int seconds) {
    if (seconds < 60) {
      return '$seconds sec';
    } else if (seconds < 3600) {
      final minutes = seconds ~/ 60;
      return '$minutes min';
    } else {
      final hours = seconds ~/ 3600;
      final minutes = (seconds % 3600) ~/ 60;
      if (minutes == 0) {
        return '$hours hr';
      }
      return '$hours hr $minutes min';
    }
  }

  /// Format ETA
  static String eta(DateTime estimatedTime) {
    final now = DateTime.now();
    final diff = estimatedTime.difference(now);

    if (diff.isNegative) {
      return 'Arriving now';
    }

    if (diff.inMinutes < 1) {
      return 'Less than a minute';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes} min';
    } else {
      final hours = diff.inHours;
      final minutes = diff.inMinutes % 60;
      if (minutes == 0) {
        return '$hours hr';
      }
      return '$hours hr $minutes min';
    }
  }

  /// Format file size
  static String fileSize(int bytes) {
    if (bytes < 1024) {
      return '$bytes B';
    } else if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else {
      return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
    }
  }

  /// Format rating (e.g., 4.5 -> "4.5")
  static String rating(double value) {
    return value.toStringAsFixed(1);
  }

  /// Format count with suffix (e.g., 1500 -> "1.5K")
  static String compactNumber(int number) {
    if (number < 1000) {
      return number.toString();
    } else if (number < 1000000) {
      return '${(number / 1000).toStringAsFixed(1)}K';
    } else if (number < 1000000000) {
      return '${(number / 1000000).toStringAsFixed(1)}M';
    } else {
      return '${(number / 1000000000).toStringAsFixed(1)}B';
    }
  }

  /// Format card number (mask middle digits)
  static String cardNumber(String number) {
    final cleaned = number.replaceAll(RegExp(r'\D'), '');
    if (cleaned.length < 8) return number;
    return '**** **** **** ${cleaned.substring(cleaned.length - 4)}';
  }

  /// Format date as relative (today, yesterday, date)
  static String relativeDate(DateTime date) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final dateOnly = DateTime(date.year, date.month, date.day);

    if (dateOnly == today) {
      return 'Today';
    } else if (dateOnly == yesterday) {
      return 'Yesterday';
    } else {
      return '${_monthName(date.month)} ${date.day}, ${date.year}';
    }
  }

  /// Format time as 12-hour
  static String time12Hour(DateTime time) {
    final hour = time.hour % 12 == 0 ? 12 : time.hour % 12;
    final minute = time.minute.toString().padLeft(2, '0');
    final period = time.hour < 12 ? 'AM' : 'PM';
    return '$hour:$minute $period';
  }

  static String _monthName(int month) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return months[month - 1];
  }
}
