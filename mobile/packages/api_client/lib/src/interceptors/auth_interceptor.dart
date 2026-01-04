/// Auth Interceptor
///
/// Automatically attaches authentication tokens to requests
/// and handles token refresh when tokens expire.
library;

import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:logger/logger.dart';

import '../client/api_client.dart';

/// Interceptor that handles authentication
///
/// - Attaches access token to all requests (unless skipAuth is set)
/// - Intercepts 401 responses and attempts token refresh
/// - Queues requests during token refresh to prevent multiple refresh calls
/// - Clears tokens and throws on refresh failure
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this.tokenStorage,
    required this.refreshTokenEndpoint,
    required Dio dio,
    Logger? logger,
  })  : _dio = dio,
        _logger = logger ?? Logger();

  final TokenStorage tokenStorage;
  final String refreshTokenEndpoint;
  final Dio _dio;
  final Logger _logger;

  /// Lock to prevent multiple simultaneous refresh attempts
  bool _isRefreshing = false;

  /// Completer for requests waiting on token refresh
  Completer<String?>? _refreshCompleter;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Check if this request should skip auth
    if (options.extra['skipAuth'] == true) {
      handler.next(options);
      return;
    }

    try {
      // Wait for any ongoing refresh to complete
      if (_isRefreshing && _refreshCompleter != null) {
        final token = await _refreshCompleter!.future;
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
        return;
      }

      // Get current access token
      final accessToken = await tokenStorage.getAccessToken();
      if (accessToken != null) {
        options.headers['Authorization'] = 'Bearer $accessToken';
      }

      handler.next(options);
    } catch (e) {
      _logger.e('Error adding auth header', error: e);
      handler.next(options);
    }
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    // Only handle 401 Unauthorized errors
    if (err.response?.statusCode != HttpStatus.unauthorized) {
      handler.next(err);
      return;
    }

    // Skip auth-related endpoints to prevent refresh loops
    final path = err.requestOptions.path;
    if (_isAuthEndpoint(path)) {
      handler.next(err);
      return;
    }

    // Skip if request explicitly disabled auth
    if (err.requestOptions.extra['skipAuth'] == true) {
      handler.next(err);
      return;
    }

    _logger.d('Received 401, attempting token refresh');

    try {
      // Attempt token refresh
      final newToken = await _refreshToken();

      if (newToken != null) {
        // Retry the original request with new token
        final retryOptions = err.requestOptions;
        retryOptions.headers['Authorization'] = 'Bearer $newToken';

        final response = await _dio.fetch(retryOptions);
        handler.resolve(response);
        return;
      }

      // Token refresh returned null (refresh token invalid)
      await tokenStorage.clearTokens();
      handler.reject(
        DioException(
          requestOptions: err.requestOptions,
          error: const AuthenticationException('Session expired. Please log in again.'),
          type: DioExceptionType.badResponse,
          response: err.response,
        ),
      );
    } catch (e) {
      _logger.e('Token refresh failed', error: e);
      await tokenStorage.clearTokens();
      handler.reject(
        DioException(
          requestOptions: err.requestOptions,
          error: AuthenticationException(e.toString()),
          type: DioExceptionType.badResponse,
          response: err.response,
        ),
      );
    }
  }

  /// Refresh the access token
  ///
  /// Uses a lock to ensure only one refresh happens at a time.
  /// Other requests wait for the refresh to complete.
  Future<String?> _refreshToken() async {
    // If already refreshing, wait for it to complete
    if (_isRefreshing && _refreshCompleter != null) {
      return _refreshCompleter!.future;
    }

    _isRefreshing = true;
    _refreshCompleter = Completer<String?>();

    try {
      final refreshToken = await tokenStorage.getRefreshToken();
      if (refreshToken == null) {
        _refreshCompleter!.complete(null);
        return null;
      }

      // Make refresh request (skip auth to prevent loops)
      final response = await _dio.post(
        refreshTokenEndpoint,
        data: {'refreshToken': refreshToken},
        options: Options(extra: {'skipAuth': true, 'skipRetry': true}),
      );

      if (response.statusCode == HttpStatus.ok) {
        final data = response.data as Map<String, dynamic>;
        final newAccessToken = data['accessToken'] as String?;
        final newRefreshToken = data['refreshToken'] as String?;

        if (newAccessToken != null && newRefreshToken != null) {
          await tokenStorage.saveTokens(
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
          );
          _refreshCompleter!.complete(newAccessToken);
          return newAccessToken;
        }
      }

      _refreshCompleter!.complete(null);
      return null;
    } catch (e) {
      _logger.e('Refresh token request failed', error: e);
      _refreshCompleter!.completeError(e);
      rethrow;
    } finally {
      _isRefreshing = false;
      _refreshCompleter = null;
    }
  }

  /// Check if the path is an auth-related endpoint
  bool _isAuthEndpoint(String path) {
    return path.contains('/auth/') ||
        path.endsWith('/auth') ||
        path.contains('login') ||
        path.contains('register') ||
        path.contains('refresh') ||
        path.contains('verify-otp');
  }
}

/// Exception thrown when authentication fails
class AuthenticationException implements Exception {
  const AuthenticationException([this.message = 'Authentication failed']);

  final String message;

  @override
  String toString() => 'AuthenticationException: $message';
}
