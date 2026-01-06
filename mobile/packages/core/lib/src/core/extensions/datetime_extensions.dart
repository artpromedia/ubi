import 'package:intl/intl.dart';

/// DateTime extension methods
extension DateTimeExtensions on DateTime {
  /// Format as readable date (e.g., "Jan 15, 2024")
  String get formattedDate => DateFormat.yMMMd().format(this);

  /// Format as readable time (e.g., "2:30 PM")
  String get formattedTime => DateFormat.jm().format(this);

  /// Format as full date and time (e.g., "Jan 15, 2024, 2:30 PM")
  String get formattedDateTime => DateFormat.yMMMd().add_jm().format(this);

  /// Format as ISO 8601 string
  String get iso8601 => toIso8601String();

  /// Check if date is today
  bool get isToday {
    final now = DateTime.now();
    return year == now.year && month == now.month && day == now.day;
  }

  /// Check if date is yesterday
  bool get isYesterday {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    return year == yesterday.year &&
        month == yesterday.month &&
        day == yesterday.day;
  }

  /// Check if date is tomorrow
  bool get isTomorrow {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    return year == tomorrow.year &&
        month == tomorrow.month &&
        day == tomorrow.day;
  }

  /// Get relative time description (e.g., "2 hours ago", "in 3 days")
  String get relativeTime {
    final now = DateTime.now();
    final difference = now.difference(this);

    if (difference.isNegative) {
      // Future
      final absDiff = difference.abs();
      if (absDiff.inDays > 0) return 'in ${absDiff.inDays} day${absDiff.inDays == 1 ? '' : 's'}';
      if (absDiff.inHours > 0) return 'in ${absDiff.inHours} hour${absDiff.inHours == 1 ? '' : 's'}';
      if (absDiff.inMinutes > 0) return 'in ${absDiff.inMinutes} minute${absDiff.inMinutes == 1 ? '' : 's'}';
      return 'just now';
    } else {
      // Past
      if (difference.inDays > 0) return '${difference.inDays} day${difference.inDays == 1 ? '' : 's'} ago';
      if (difference.inHours > 0) return '${difference.inHours} hour${difference.inHours == 1 ? '' : 's'} ago';
      if (difference.inMinutes > 0) return '${difference.inMinutes} minute${difference.inMinutes == 1 ? '' : 's'} ago';
      return 'just now';
    }
  }

  /// Get start of day
  DateTime get startOfDay => DateTime(year, month, day);

  /// Get end of day
  DateTime get endOfDay => DateTime(year, month, day, 23, 59, 59, 999);
}
