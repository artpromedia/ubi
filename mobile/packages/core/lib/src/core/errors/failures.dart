import 'package:freezed_annotation/freezed_annotation.dart';

part 'failures.freezed.dart';

/// Base failure class
@freezed
sealed class Failure with _$Failure {
  const Failure._();

  /// Server error failure
  const factory Failure.server({
    String? message,
    int? statusCode,
    String? errorCode,
  }) = ServerFailure;

  /// Network error failure
  const factory Failure.network({
    String? message,
  }) = NetworkFailure;

  /// Authentication failure
  const factory Failure.authentication({
    String? message,
    String? errorCode,
  }) = AuthenticationFailure;

  /// Authorization/Permission failure
  const factory Failure.authorization({
    String? message,
  }) = AuthorizationFailure;

  /// Validation failure
  const factory Failure.validation({
    String? message,
    Map<String, List<String>>? fieldErrors,
  }) = ValidationFailure;

  /// Not found failure
  const factory Failure.notFound({
    String? message,
    String? resourceType,
    String? resourceId,
  }) = NotFoundFailure;

  /// Cache/Storage failure
  const factory Failure.cache({
    String? message,
  }) = CacheFailure;

  /// Location/GPS failure
  const factory Failure.location({
    String? message,
    LocationFailureReason? reason,
  }) = LocationFailure;

  /// Payment failure
  const factory Failure.payment({
    String? message,
    String? paymentErrorCode,
    String? providerMessage,
  }) = PaymentFailure;

  /// Rate limit failure
  const factory Failure.rateLimit({
    String? message,
    int? retryAfterSeconds,
  }) = RateLimitFailure;

  /// Timeout failure
  const factory Failure.timeout({
    String? message,
  }) = TimeoutFailure;

  /// Unknown failure
  const factory Failure.unknown({
    String? message,
    Object? error,
    StackTrace? stackTrace,
  }) = UnknownFailure;

  /// Get user-friendly message
  String get userMessage {
    return when(
      server: (message, statusCode, errorCode) =>
          message ?? 'Something went wrong. Please try again.',
      network: (message) =>
          message ?? 'Please check your internet connection and try again.',
      authentication: (message, errorCode) =>
          message ?? 'Please sign in to continue.',
      authorization: (message) =>
          message ?? 'You don\'t have permission to perform this action.',
      validation: (message, fieldErrors) =>
          message ?? 'Please check your input and try again.',
      notFound: (message, resourceType, resourceId) =>
          message ?? 'The requested item could not be found.',
      cache: (message) =>
          message ?? 'Unable to access local data.',
      location: (message, reason) =>
          message ?? 'Unable to access your location.',
      payment: (message, paymentErrorCode, providerMessage) =>
          message ?? 'Payment failed. Please try again.',
      rateLimit: (message, retryAfterSeconds) =>
          message ?? 'Too many requests. Please wait a moment.',
      timeout: (message) =>
          message ?? 'The request timed out. Please try again.',
      unknown: (message, error, stackTrace) =>
          message ?? 'An unexpected error occurred.',
    );
  }

  /// Check if failure is retryable
  bool get isRetryable {
    return when(
      server: (_, statusCode, __) => statusCode == null || statusCode >= 500,
      network: (_) => true,
      authentication: (_, __) => false,
      authorization: (_) => false,
      validation: (_, __) => false,
      notFound: (_, __, ___) => false,
      cache: (_) => true,
      location: (_, reason) => reason != LocationFailureReason.permissionDenied,
      payment: (_, __, ___) => true,
      rateLimit: (_, __) => true,
      timeout: (_) => true,
      unknown: (_, __, ___) => true,
    );
  }
}

/// Location failure reasons
enum LocationFailureReason {
  permissionDenied,
  permissionDeniedForever,
  serviceDisabled,
  timeout,
  unknown,
}
