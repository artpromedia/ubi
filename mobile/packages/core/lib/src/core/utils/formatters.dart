import 'package:intl/intl.dart';

/// Value formatters for display
class Formatters {
  Formatters._();

  /// Format currency amount from cents
  static String currency(int cents, {String symbol = '\$'}) {
    final dollars = cents / 100;
    return NumberFormat.currency(symbol: symbol).format(dollars);
  }

  /// Format distance in meters
  static String distance(double meters) {
    if (meters < 1000) {
      return '${meters.toInt()} m';
    }
    return '${(meters / 1000).toStringAsFixed(1)} km';
  }

  /// Format duration in seconds
  static String duration(int seconds) {
    if (seconds < 60) {
      return '$seconds sec';
    }
    final minutes = seconds ~/ 60;
    if (minutes < 60) {
      return '$minutes min';
    }
    final hours = minutes ~/ 60;
    final remainingMinutes = minutes % 60;
    if (remainingMinutes == 0) {
      return '${hours}h';
    }
    return '${hours}h ${remainingMinutes}m';
  }

  /// Format phone number for display
  static String phone(String phone) {
    final cleaned = phone.replaceAll(RegExp(r'[^\d]'), '');
    if (cleaned.length == 10) {
      return '(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}';
    } else if (cleaned.length == 11 && cleaned.startsWith('1')) {
      return '+1 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7)}';
    }
    return phone;
  }

  /// Format date for display
  static String date(DateTime date, {String? pattern}) {
    if (pattern != null) {
      return DateFormat(pattern).format(date);
    }
    return DateFormat.yMMMd().format(date);
  }

  /// Format time for display
  static String time(DateTime time, {bool use24Hour = false}) {
    return use24Hour
        ? DateFormat.Hm().format(time)
        : DateFormat.jm().format(time);
  }

  /// Format date and time
  static String dateTime(DateTime dateTime) {
    return DateFormat.yMMMd().add_jm().format(dateTime);
  }

  /// Format rating (e.g., "4.5 ★")
  static String rating(double rating, {int decimals = 1}) {
    return '${rating.toStringAsFixed(decimals)} ★';
  }

  /// Format card number for display (masked)
  static String cardNumber(String number) {
    final cleaned = number.replaceAll(RegExp(r'[^\d]'), '');
    if (cleaned.length < 4) return number;
    return '•••• ${cleaned.substring(cleaned.length - 4)}';
  }

  /// Format address
  static String address({
    String? street,
    String? city,
    String? state,
    String? zip,
    String? country,
  }) {
    final parts = <String>[];
    if (street != null && street.isNotEmpty) parts.add(street);
    if (city != null && city.isNotEmpty) parts.add(city);
    if (state != null && state.isNotEmpty) parts.add(state);
    if (zip != null && zip.isNotEmpty) parts.add(zip);
    if (country != null && country.isNotEmpty) parts.add(country);
    return parts.join(', ');
  }

  /// Format ETA (estimated time of arrival)
  static String eta(DateTime arrivalTime) {
    final now = DateTime.now();
    final difference = arrivalTime.difference(now);
    
    if (difference.isNegative) {
      return 'Arriving now';
    }
    
    if (difference.inMinutes < 1) {
      return 'Less than a minute';
    }
    
    if (difference.inMinutes < 60) {
      return '${difference.inMinutes} min';
    }
    
    return DateFormat.jm().format(arrivalTime);
  }

  /// Format order number
  static String orderNumber(String id, {int displayLength = 8}) {
    if (id.length <= displayLength) return '#$id';
    return '#${id.substring(0, displayLength).toUpperCase()}';
  }
}
