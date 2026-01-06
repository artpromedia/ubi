/// App Constants
///
/// Contains application-wide constants.
library;

/// Application-wide constants
abstract class AppConstants {
  /// App name
  static const String appName = 'UBI';

  /// Minimum supported app version
  static const String minSupportedVersion = '1.0.0';

  /// Animation duration in milliseconds
  static const int animationDurationMs = 300;

  /// Debounce duration in milliseconds
  static const int debounceDurationMs = 500;

  /// Maximum file upload size in bytes (10 MB)
  static const int maxFileUploadSize = 10 * 1024 * 1024;

  /// Supported image extensions
  static const List<String> supportedImageExtensions = ['jpg', 'jpeg', 'png', 'gif'];

  /// Date format for display
  static const String displayDateFormat = 'MMM dd, yyyy';

  /// Time format for display
  static const String displayTimeFormat = 'hh:mm a';

  /// DateTime format for display
  static const String displayDateTimeFormat = 'MMM dd, yyyy hh:mm a';
}
