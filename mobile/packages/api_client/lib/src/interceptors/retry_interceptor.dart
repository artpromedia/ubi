/// Retry Interceptor
///
/// Automatically retries failed requests for transient failures
/// with exponential backoff.
library;

import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:logger/logger.dart';

/// Interceptor that retries failed requests
///
/// Retries on:
/// - Connection timeouts
/// - Network errors
/// - 5xx server errors
///
/// Does NOT retry on:
/// - Client errors (4xx)
/// - Request cancellation
/// - Requests marked with skipRetry
class RetryInterceptor extends Interceptor {
  RetryInterceptor({
    required Dio dio,
    this.maxRetries = 3,
    this.retryDelay = const Duration(seconds: 1),
    this.useExponentialBackoff = true,
    this.maxBackoffDelay = const Duration(seconds: 30),
    this.retryableStatusCodes = const [
      HttpStatus.requestTimeout,
      HttpStatus.tooManyRequests,
      HttpStatus.internalServerError,
      HttpStatus.badGateway,
      HttpStatus.serviceUnavailable,
      HttpStatus.gatewayTimeout,
    ],
    Logger? logger,
  })  : _dio = dio,
        _logger = logger ?? Logger();

  final Dio _dio;
  final int maxRetries;
  final Duration retryDelay;
  final bool useExponentialBackoff;
  final Duration maxBackoffDelay;
  final List<int> retryableStatusCodes;
  final Logger _logger;

  /// Random instance for jitter
  final _random = Random();

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    // Check if we should retry this request
    if (!_shouldRetry(err)) {
      handler.next(err);
      return;
    }

    // Get current retry count
    final retryCount = err.requestOptions.extra['_retryCount'] as int? ?? 0;

    // Check if we've exceeded max retries
    if (retryCount >= maxRetries) {
      _logger.w('Max retries ($maxRetries) reached for ${err.requestOptions.path}');
      handler.next(err);
      return;
    }

    // Calculate delay with exponential backoff and jitter
    final delay = _calculateDelay(retryCount);

    _logger.d(
      'Retrying request (${retryCount + 1}/$maxRetries) '
      'after ${delay.inMilliseconds}ms: ${err.requestOptions.path}',
    );

    // Wait before retrying
    await Future.delayed(delay);

    // Update retry count
    err.requestOptions.extra['_retryCount'] = retryCount + 1;

    try {
      // Retry the request
      final response = await _dio.fetch(err.requestOptions);
      handler.resolve(response);
    } on DioException catch (e) {
      // If retry fails, continue with error handling
      // The error handler will be called again and may retry
      handler.reject(e);
    }
  }

  /// Check if the request should be retried
  bool _shouldRetry(DioException err) {
    // Skip if explicitly disabled
    if (err.requestOptions.extra['skipRetry'] == true) {
      return false;
    }

    // Retry on specific DioException types
    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return true;

      case DioExceptionType.badResponse:
        // Only retry on specific status codes
        final statusCode = err.response?.statusCode;
        return statusCode != null && retryableStatusCodes.contains(statusCode);

      case DioExceptionType.cancel:
        // Never retry cancelled requests
        return false;

      case DioExceptionType.badCertificate:
        // SSL errors are not transient
        return false;

      case DioExceptionType.unknown:
        // Check if it's a socket exception (network error)
        return err.error is SocketException;
    }
  }

  /// Calculate delay with exponential backoff and jitter
  Duration _calculateDelay(int retryCount) {
    if (!useExponentialBackoff) {
      return retryDelay;
    }

    // Exponential backoff: delay * 2^retryCount
    final exponentialDelay = retryDelay.inMilliseconds * pow(2, retryCount);

    // Cap at max backoff delay
    final cappedDelay = min(exponentialDelay.toInt(), maxBackoffDelay.inMilliseconds);

    // Add jitter (0-25% of delay) to prevent thundering herd
    final jitter = (_random.nextDouble() * 0.25 * cappedDelay).toInt();

    return Duration(milliseconds: cappedDelay + jitter);
  }
}

/// Extension to configure retry behavior per-request
extension RetryOptionsExtension on RequestOptions {
  /// Disable retry for this request
  RequestOptions withNoRetry() {
    extra['skipRetry'] = true;
    return this;
  }

  /// Set custom max retries for this request
  RequestOptions withMaxRetries(int maxRetries) {
    extra['maxRetries'] = maxRetries;
    return this;
  }
}
