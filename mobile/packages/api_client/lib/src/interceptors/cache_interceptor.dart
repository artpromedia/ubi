/// Cache Interceptor
///
/// Provides HTTP caching for GET requests with configurable
/// TTL and stale-while-revalidate support.
library;

import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:logger/logger.dart';

/// Interface for cache storage
abstract class CacheStorage {
  /// Get cached response for key
  Future<CachedResponse?> get(String key);

  /// Store response with key
  Future<void> set(String key, CachedResponse response);

  /// Remove cached response
  Future<void> remove(String key);

  /// Clear all cached responses
  Future<void> clear();
}

/// Cached response data
class CachedResponse {
  const CachedResponse({
    required this.data,
    required this.headers,
    required this.statusCode,
    required this.cachedAt,
    required this.maxAge,
    this.maxStale,
    this.etag,
    this.lastModified,
  });

  /// Parse from JSON
  factory CachedResponse.fromJson(Map<String, dynamic> json) {
    return CachedResponse(
      data: json['data'],
      headers: Map<String, String>.from(json['headers'] as Map),
      statusCode: json['statusCode'] as int,
      cachedAt: DateTime.parse(json['cachedAt'] as String),
      maxAge: Duration(seconds: json['maxAge'] as int),
      maxStale: json['maxStale'] != null
          ? Duration(seconds: json['maxStale'] as int)
          : null,
      etag: json['etag'] as String?,
      lastModified: json['lastModified'] as String?,
    );
  }

  final dynamic data;
  final Map<String, String> headers;
  final int statusCode;
  final DateTime cachedAt;
  final Duration maxAge;
  final Duration? maxStale;
  final String? etag;
  final String? lastModified;

  /// Check if response is fresh (within maxAge)
  bool get isFresh {
    final age = DateTime.now().difference(cachedAt);
    return age < maxAge;
  }

  /// Check if response is stale but usable (within maxStale)
  bool get isStaleButUsable {
    if (maxStale == null) return false;
    final age = DateTime.now().difference(cachedAt);
    return age >= maxAge && age < (maxAge + maxStale!);
  }

  /// Check if response is completely expired
  bool get isExpired {
    final age = DateTime.now().difference(cachedAt);
    final totalTtl = maxAge + (maxStale ?? Duration.zero);
    return age >= totalTtl;
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() => {
        'data': data,
        'headers': headers,
        'statusCode': statusCode,
        'cachedAt': cachedAt.toIso8601String(),
        'maxAge': maxAge.inSeconds,
        'maxStale': maxStale?.inSeconds,
        'etag': etag,
        'lastModified': lastModified,
      };
}

/// Interceptor that caches GET requests
///
/// Supports:
/// - Cache-Control header parsing
/// - ETag/If-None-Match validation
/// - Last-Modified/If-Modified-Since validation
/// - Stale-while-revalidate pattern
/// - Per-request cache configuration
class CacheInterceptor extends Interceptor {
  CacheInterceptor({
    required this.storage,
    this.defaultMaxAge = const Duration(minutes: 5),
    this.defaultMaxStale = const Duration(days: 7),
    Logger? logger,
  }) : _logger = logger ?? Logger();

  final CacheStorage storage;
  final Duration defaultMaxAge;
  final Duration defaultMaxStale;
  final Logger _logger;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Only cache GET requests
    if (options.method.toUpperCase() != 'GET') {
      handler.next(options);
      return;
    }

    // Skip if caching is explicitly disabled
    if (options.extra['noCache'] == true) {
      handler.next(options);
      return;
    }

    final cacheKey = _generateCacheKey(options);
    final cached = await storage.get(cacheKey);

    if (cached != null) {
      if (cached.isFresh) {
        // Return cached response immediately
        _logger.d('Cache HIT (fresh): ${options.path}');
        handler.resolve(_createResponse(options, cached));
        return;
      }

      if (cached.isStaleButUsable) {
        // Return stale data but revalidate in background
        _logger.d('Cache HIT (stale, revalidating): ${options.path}');

        // Add validation headers
        if (cached.etag != null) {
          options.headers['If-None-Match'] = cached.etag;
        }
        if (cached.lastModified != null) {
          options.headers['If-Modified-Since'] = cached.lastModified;
        }

        // Mark that we have stale data available
        options.extra['_cachedResponse'] = cached;
      }
    }

    handler.next(options);
  }

  @override
  void onResponse(
    Response response,
    ResponseInterceptorHandler handler,
  ) async {
    // Only cache successful GET requests
    if (response.requestOptions.method.toUpperCase() != 'GET') {
      handler.next(response);
      return;
    }

    // Handle 304 Not Modified
    if (response.statusCode == 304) {
      final cached =
          response.requestOptions.extra['_cachedResponse'] as CachedResponse?;
      if (cached != null) {
        _logger.d('Cache validated (304): ${response.requestOptions.path}');
        handler.resolve(_createResponse(response.requestOptions, cached));
        return;
      }
    }

    // Cache successful responses
    if (response.statusCode == 200) {
      await _cacheResponse(response);
    }

    handler.next(response);
  }

  @override
  void onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    // On network error, try to return stale cached data
    if (_isNetworkError(err)) {
      final cacheKey = _generateCacheKey(err.requestOptions);
      final cached = await storage.get(cacheKey);

      if (cached != null && !cached.isExpired) {
        _logger.d('Returning stale cache due to network error: ${err.requestOptions.path}');
        handler.resolve(_createResponse(err.requestOptions, cached));
        return;
      }
    }

    handler.next(err);
  }

  /// Generate cache key from request
  String _generateCacheKey(RequestOptions options) {
    final buffer = StringBuffer();
    buffer.write(options.method);
    buffer.write(':');
    buffer.write(options.path);

    // Include query parameters in key
    if (options.queryParameters.isNotEmpty) {
      final sortedParams = Map.fromEntries(
        options.queryParameters.entries.toList()
          ..sort((a, b) => a.key.compareTo(b.key)),
      );
      buffer.write('?');
      buffer.write(Uri(queryParameters: sortedParams.map(
        (key, value) => MapEntry(key, value.toString()),
      )).query);
    }

    return buffer.toString();
  }

  /// Create Response from cached data
  Response _createResponse(RequestOptions options, CachedResponse cached) {
    return Response(
      requestOptions: options,
      data: cached.data,
      statusCode: cached.statusCode,
      headers: Headers.fromMap({
        for (final entry in cached.headers.entries) entry.key: [entry.value],
        'x-cache': ['HIT'],
        'x-cache-age': [
          DateTime.now().difference(cached.cachedAt).inSeconds.toString()
        ],
      }),
    );
  }

  /// Cache a response
  Future<void> _cacheResponse(Response response) async {
    final options = response.requestOptions;

    // Get cache configuration
    Duration maxAge = defaultMaxAge;
    Duration? maxStale = defaultMaxStale;

    // Check for per-request configuration
    if (options.extra['cacheMaxAge'] != null) {
      maxAge = Duration(seconds: options.extra['cacheMaxAge'] as int);
    }
    if (options.extra['cacheMaxStale'] != null) {
      maxStale = Duration(seconds: options.extra['cacheMaxStale'] as int);
    }

    // Parse Cache-Control header
    final cacheControl = response.headers.value('cache-control');
    if (cacheControl != null) {
      final parsed = _parseCacheControl(cacheControl);
      if (parsed['no-store'] == true) {
        return; // Don't cache
      }
      if (parsed['max-age'] != null) {
        maxAge = Duration(seconds: parsed['max-age'] as int);
      }
      if (parsed['stale-while-revalidate'] != null) {
        maxStale = Duration(seconds: parsed['stale-while-revalidate'] as int);
      }
    }

    final cached = CachedResponse(
      data: response.data,
      headers: {
        for (final entry in response.headers.map.entries)
          entry.key: entry.value.first,
      },
      statusCode: response.statusCode ?? 200,
      cachedAt: DateTime.now(),
      maxAge: maxAge,
      maxStale: maxStale,
      etag: response.headers.value('etag'),
      lastModified: response.headers.value('last-modified'),
    );

    final cacheKey = _generateCacheKey(options);
    await storage.set(cacheKey, cached);

    _logger.d('Cached response: ${options.path} (max-age: ${maxAge.inSeconds}s)');
  }

  /// Parse Cache-Control header
  Map<String, dynamic> _parseCacheControl(String header) {
    final result = <String, dynamic>{};

    for (final directive in header.split(',')) {
      final trimmed = directive.trim().toLowerCase();

      if (trimmed == 'no-store' || trimmed == 'no-cache') {
        result[trimmed] = true;
        continue;
      }

      final parts = trimmed.split('=');
      if (parts.length == 2) {
        final key = parts[0].trim();
        final value = int.tryParse(parts[1].trim());
        if (value != null) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /// Check if error is a network error
  bool _isNetworkError(DioException err) {
    return err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.unknown;
  }
}

/// In-memory cache storage implementation
class InMemoryCacheStorage implements CacheStorage {
  final _cache = <String, CachedResponse>{};

  @override
  Future<CachedResponse?> get(String key) async {
    final cached = _cache[key];
    if (cached != null && cached.isExpired) {
      _cache.remove(key);
      return null;
    }
    return cached;
  }

  @override
  Future<void> set(String key, CachedResponse response) async {
    _cache[key] = response;
  }

  @override
  Future<void> remove(String key) async {
    _cache.remove(key);
  }

  @override
  Future<void> clear() async {
    _cache.clear();
  }
}
