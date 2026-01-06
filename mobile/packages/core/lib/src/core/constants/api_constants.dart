/// API Constants
///
/// Contains API-related constants used across the application.
library;

/// API endpoints and configuration constants
abstract class ApiConstants {
  /// Default API timeout in seconds
  static const int defaultTimeoutSeconds = 30;

  /// Maximum retry attempts for failed requests
  static const int maxRetryAttempts = 3;

  /// Retry delay in milliseconds
  static const int retryDelayMs = 1000;

  /// API version
  static const String apiVersion = 'v1';

  /// Default page size for pagination
  static const int defaultPageSize = 20;

  /// Maximum page size for pagination
  static const int maxPageSize = 100;
}
