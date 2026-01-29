/// UBI API Client
///
/// Main HTTP client with Dio, configured with all necessary interceptors
/// for authentication, error handling, retries, and caching.
library;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:injectable/injectable.dart';
import 'package:logger/logger.dart';
import 'package:pretty_dio_logger/pretty_dio_logger.dart';

import 'api_config.dart';
import '../interceptors/auth_interceptor.dart';
import '../interceptors/error_interceptor.dart';
import '../interceptors/retry_interceptor.dart';
import '../interceptors/connectivity_interceptor.dart';
import '../services/app_version_service.dart';

/// Token storage interface for managing auth tokens
abstract class TokenStorage {
  /// Get the current access token
  Future<String?> getAccessToken();

  /// Get the current refresh token
  Future<String?> getRefreshToken();

  /// Save tokens after authentication
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  });

  /// Clear all tokens (logout)
  Future<void> clearTokens();
}

/// Connectivity checker interface
abstract class ConnectivityChecker {
  /// Check if device has network connectivity
  Future<bool> hasConnection();

  /// Stream of connectivity changes
  Stream<bool> get connectivityStream;
}

/// UBI API Client
///
/// Central HTTP client for all API communications.
/// Pre-configured with:
/// - Authentication interceptor for auto-attaching tokens
/// - Error interceptor for standardized error handling
/// - Retry interceptor for transient failure recovery
/// - Connectivity interceptor for offline detection
/// - Logging interceptor for debugging (dev only)
@singleton
class ApiClient {
  ApiClient({
    required this.config,
    required this.tokenStorage,
    required this.connectivityChecker,
    this.versionService,
    Logger? logger,
  }) : _logger = logger ?? Logger() {
    _dio = _createDio();
    _setupInterceptors();
  }

  /// API configuration
  final ApiConfig config;

  /// Token storage for auth management
  final TokenStorage tokenStorage;

  /// Connectivity checker for offline detection
  final ConnectivityChecker connectivityChecker;

  /// App version service for client version headers
  final AppVersionService? versionService;

  /// Logger instance
  final Logger _logger;

  /// Dio HTTP client instance
  late final Dio _dio;

  /// Get the underlying Dio instance
  ///
  /// Use this for creating Retrofit API services
  Dio get dio => _dio;

  /// Create and configure Dio instance
  Dio _createDio() {
    final clientVersion = versionService?.apiVersion ?? '1.0.0';
    final userAgent = versionService?.userAgent ?? 'UBI-Mobile/1.0.0';

    final dio = Dio(
      BaseOptions(
        baseUrl: config.apiUrl,
        connectTimeout: config.connectTimeout,
        receiveTimeout: config.receiveTimeout,
        sendTimeout: config.sendTimeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Client-Platform': defaultTargetPlatform.name,
          'X-Client-Version': clientVersion,
          'User-Agent': userAgent,
        },
        validateStatus: (status) => status != null && status < 500,
      ),
    );

    return dio;
  }

  /// Setup all interceptors
  void _setupInterceptors() {
    // Order matters! Interceptors are executed in order for requests
    // and reverse order for responses

    // 1. Connectivity check (first, to fail fast if offline)
    _dio.interceptors.add(
      ConnectivityInterceptor(
        connectivityChecker: connectivityChecker,
      ),
    );

    // 2. Auth interceptor (add tokens to requests)
    _dio.interceptors.add(
      AuthInterceptor(
        tokenStorage: tokenStorage,
        refreshTokenEndpoint: config.endpoints.authRefreshToken,
        dio: _dio,
        logger: _logger,
      ),
    );

    // 3. Retry interceptor (retry on transient failures)
    _dio.interceptors.add(
      RetryInterceptor(
        dio: _dio,
        maxRetries: config.maxRetries,
        retryDelay: config.retryDelay,
        logger: _logger,
      ),
    );

    // 4. Error interceptor (transform errors to domain failures)
    _dio.interceptors.add(
      ErrorInterceptor(logger: _logger),
    );

    // 5. Logging interceptor (dev only)
    if (config.enableLogging && !kReleaseMode) {
      _dio.interceptors.add(
        PrettyDioLogger(
          requestHeader: true,
          requestBody: true,
          responseHeader: false,
          responseBody: true,
          error: true,
          compact: true,
          maxWidth: 120,
        ),
      );
    }
  }

  // === HTTP Methods ===

  /// GET request
  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) {
    return _dio.get<T>(
      path,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
    );
  }

  /// POST request
  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) {
    return _dio.post<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
    );
  }

  /// PUT request
  Future<Response<T>> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) {
    return _dio.put<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
    );
  }

  /// PATCH request
  Future<Response<T>> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) {
    return _dio.patch<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
    );
  }

  /// DELETE request
  Future<Response<T>> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
  }) {
    return _dio.delete<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
    );
  }

  /// Upload file with multipart form data
  Future<Response<T>> upload<T>(
    String path, {
    required FormData formData,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
    void Function(int, int)? onSendProgress,
  }) {
    return _dio.post<T>(
      path,
      data: formData,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
    );
  }

  /// Download file
  Future<Response> download(
    String path,
    String savePath, {
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
    void Function(int, int)? onReceiveProgress,
  }) {
    return _dio.download(
      path,
      savePath,
      queryParameters: queryParameters,
      options: options,
      cancelToken: cancelToken,
      onReceiveProgress: onReceiveProgress,
    );
  }
}

/// Request options builder
class ApiRequestOptions {
  const ApiRequestOptions._();

  /// Options for requests that should skip auth
  static Options noAuth() {
    return Options(
      extra: {'skipAuth': true},
    );
  }

  /// Options for requests that should skip retry
  static Options noRetry() {
    return Options(
      extra: {'skipRetry': true},
    );
  }

  /// Options for cached requests
  static Options cached({Duration? maxAge, Duration? maxStale}) {
    return Options(
      extra: {
        'cache': true,
        'cacheMaxAge': maxAge?.inSeconds,
        'cacheMaxStale': maxStale?.inSeconds,
      },
    );
  }

  /// Combine multiple options
  static Options combine(List<Options> options) {
    final merged = Options(extra: {});
    for (final opt in options) {
      merged.extra?.addAll(opt.extra ?? {});
      if (opt.headers != null) {
        merged.headers = {...?merged.headers, ...opt.headers!};
      }
    }
    return merged;
  }
}
