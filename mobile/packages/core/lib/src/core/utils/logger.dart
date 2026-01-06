/// Logger Utility
///
/// Simple logging utility for the application.
library;

/// Log levels
enum LogLevel {
  debug,
  info,
  warning,
  error,
}

/// Simple logger for the application
class AppLogger {
  AppLogger._();

  static LogLevel _minLevel = LogLevel.debug;

  /// Set minimum log level
  static void setMinLevel(LogLevel level) {
    _minLevel = level;
  }

  /// Log debug message
  static void d(String message, [Object? error, StackTrace? stackTrace]) {
    _log(LogLevel.debug, message, error, stackTrace);
  }

  /// Log info message
  static void i(String message, [Object? error, StackTrace? stackTrace]) {
    _log(LogLevel.info, message, error, stackTrace);
  }

  /// Log warning message
  static void w(String message, [Object? error, StackTrace? stackTrace]) {
    _log(LogLevel.warning, message, error, stackTrace);
  }

  /// Log error message
  static void e(String message, [Object? error, StackTrace? stackTrace]) {
    _log(LogLevel.error, message, error, stackTrace);
  }

  static void _log(LogLevel level, String message, Object? error, StackTrace? stackTrace) {
    if (level.index < _minLevel.index) return;

    final timestamp = DateTime.now().toIso8601String();
    final levelStr = level.name.toUpperCase().padRight(7);
    final logMessage = '[$timestamp] $levelStr: $message';

    // Using print for now - in production, use proper logging package
    // ignore: avoid_print
    print(logMessage);

    if (error != null) {
      // ignore: avoid_print
      print('Error: $error');
    }

    if (stackTrace != null) {
      // ignore: avoid_print
      print('StackTrace: $stackTrace');
    }
  }
}
