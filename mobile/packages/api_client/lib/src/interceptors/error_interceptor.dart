/// Error Interceptor
///
/// Transforms API errors into domain-specific failures
/// for consistent error handling across the app.
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:logger/logger.dart';
import 'package:ubi_core/ubi_core.dart';

/// Interceptor that transforms errors into domain failures
///
/// Converts various error types (network, timeout, server, validation)
/// into standardized [Failure] objects for consistent error handling.
class ErrorInterceptor extends Interceptor {
  ErrorInterceptor({Logger? logger}) : _logger = logger ?? Logger();

  final Logger _logger;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final failure = _mapToFailure(err);

    _logger.w(
      'API Error: ${err.requestOptions.path}',
      error: err.error,
      stackTrace: err.stackTrace,
    );

    // Wrap the failure in a DioException so it can be caught
    handler.reject(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: failure,
        stackTrace: err.stackTrace,
      ),
    );
  }

  /// Map DioException to domain Failure
  Failure _mapToFailure(DioException err) {
    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const Failure.timeout('Request timed out. Please try again.');

      case DioExceptionType.connectionError:
        return const Failure.network('Unable to connect. Please check your internet connection.');

      case DioExceptionType.badCertificate:
        return const Failure.server('Security error. Please update the app.');

      case DioExceptionType.badResponse:
        return _mapResponseError(err.response);

      case DioExceptionType.cancel:
        return const Failure.unknown('Request was cancelled');

      case DioExceptionType.unknown:
        return _mapUnknownError(err);
    }
  }

  /// Map HTTP response errors to failures
  Failure _mapResponseError(Response? response) {
    if (response == null) {
      return const Failure.server('Server error. Please try again.');
    }

    final statusCode = response.statusCode ?? 500;
    final data = response.data;

    // Try to extract error message from response
    String? serverMessage;
    Map<String, List<String>>? fieldErrors;

    if (data is Map<String, dynamic>) {
      serverMessage = data['message'] as String? ??
          data['error'] as String? ??
          data['detail'] as String?;

      // Extract field-level validation errors
      final errors = data['errors'];
      if (errors is Map<String, dynamic>) {
        fieldErrors = errors.map(
          (key, value) => MapEntry(
            key,
            (value is List)
                ? value.map((e) => e.toString()).toList()
                : [value.toString()],
          ),
        );
      }
    }

    switch (statusCode) {
      case HttpStatus.badRequest: // 400
        return Failure.validation(
          serverMessage ?? 'Invalid request',
          fieldErrors ?? {},
        );

      case HttpStatus.unauthorized: // 401
        return Failure.authentication(
          serverMessage ?? 'Please log in to continue',
        );

      case HttpStatus.forbidden: // 403
        return Failure.authorization(
          serverMessage ?? 'You do not have permission to perform this action',
        );

      case HttpStatus.notFound: // 404
        return Failure.notFound(
          serverMessage ?? 'Resource not found',
        );

      case HttpStatus.conflict: // 409
        return Failure.server(
          serverMessage ?? 'Conflict with existing data',
        );

      case HttpStatus.unprocessableEntity: // 422
        return Failure.validation(
          serverMessage ?? 'Validation failed',
          fieldErrors ?? {},
        );

      case HttpStatus.tooManyRequests: // 429
        final retryAfter = response.headers.value('retry-after');
        final seconds = retryAfter != null ? int.tryParse(retryAfter) ?? 60 : 60;
        return Failure.rateLimit(
          serverMessage ?? 'Too many requests. Please wait and try again.',
          Duration(seconds: seconds),
        );

      case HttpStatus.internalServerError: // 500
      case HttpStatus.badGateway: // 502
      case HttpStatus.serviceUnavailable: // 503
      case HttpStatus.gatewayTimeout: // 504
        return Failure.server(
          serverMessage ?? 'Server error. Please try again later.',
        );

      default:
        if (statusCode >= 400 && statusCode < 500) {
          return Failure.server(
            serverMessage ?? 'Request error ($statusCode)',
          );
        }
        return Failure.server(
          serverMessage ?? 'Server error ($statusCode)',
        );
    }
  }

  /// Map unknown errors to failures
  Failure _mapUnknownError(DioException err) {
    final error = err.error;

    // Socket exceptions indicate network issues
    if (error is SocketException) {
      return const Failure.network(
        'Unable to connect. Please check your internet connection.',
      );
    }

    // SSL/TLS errors
    if (error is HandshakeException) {
      return const Failure.server(
        'Security error. Please update the app or try again.',
      );
    }

    // Generic error with message
    if (error != null) {
      return Failure.unknown(error.toString());
    }

    return const Failure.unknown('An unexpected error occurred');
  }
}

/// Extension to extract Failure from DioException
extension DioExceptionExtension on DioException {
  /// Get the domain Failure from this exception
  ///
  /// Returns the error as Failure if it was set by ErrorInterceptor,
  /// otherwise returns a generic server failure.
  Failure get failure {
    final err = error;
    if (err is Failure) {
      return err;
    }
    return Failure.server(message ?? 'An error occurred');
  }
}

/// Extension to convert DioException to Result
extension DioExceptionResultExtension on DioException {
  /// Convert this exception to a failed Result
  Result<T> toResult<T>() {
    return Result.failure(failure);
  }
}
