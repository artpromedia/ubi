/// Cache Manager
///
/// Manages in-memory and persistent caching.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'cache_policy.dart';

/// In-memory cache storage
class _InMemoryCache {
  final _cache = <String, CacheEntry<dynamic>>{};
  final int maxEntries;

  _InMemoryCache({this.maxEntries = 100});

  void put(String key, CacheEntry<dynamic> entry) {
    // Evict oldest if at capacity
    if (_cache.length >= maxEntries) {
      _evictOldest();
    }
    _cache[key] = entry;
  }

  CacheEntry<T>? get<T>(String key) {
    return _cache[key] as CacheEntry<T>?;
  }

  void remove(String key) {
    _cache.remove(key);
  }

  void clear() {
    _cache.clear();
  }

  void _evictOldest() {
    if (_cache.isEmpty) return;

    String? oldestKey;
    DateTime? oldestTime;

    for (final entry in _cache.entries) {
      if (oldestTime == null || entry.value.cachedAt.isBefore(oldestTime)) {
        oldestTime = entry.value.cachedAt;
        oldestKey = entry.key;
      }
    }

    if (oldestKey != null) {
      _cache.remove(oldestKey);
    }
  }

  int get size => _cache.length;
}

/// Cache manager with in-memory and persistent storage
@lazySingleton
class CacheManager {
  CacheManager(this._prefs);

  final SharedPreferences _prefs;
  final _memoryCache = _InMemoryCache(maxEntries: 200);

  static const _cachePrefix = 'cache_';
  static const _metaPrefix = 'cache_meta_';

  /// Get cached data
  Future<T?> get<T>(
    String key, {
    CachePolicy policy = CachePolicy.defaultPolicy,
    T Function(Map<String, dynamic>)? fromJson,
  }) async {
    // Try memory cache first
    final memoryEntry = _memoryCache.get<T>(key);
    if (memoryEntry != null) {
      if (memoryEntry.isFresh(policy)) {
        return memoryEntry.data;
      }
      if (policy.type == CachePolicyType.cacheFirst && memoryEntry.canUseStale(policy)) {
        return memoryEntry.data;
      }
    }

    // Try persistent cache
    final persistentData = await _getPersistent<T>(key, fromJson);
    if (persistentData != null) {
      final meta = _getCacheMeta(key);
      if (meta != null) {
        final entry = CacheEntry<T>(
          data: persistentData,
          cachedAt: meta['cachedAt'] as DateTime,
          etag: meta['etag'] as String?,
        );

        // Update memory cache
        _memoryCache.put(key, entry);

        if (entry.isFresh(policy)) {
          return persistentData;
        }
        if (policy.type == CachePolicyType.cacheFirst && entry.canUseStale(policy)) {
          return persistentData;
        }
      }
    }

    return null;
  }

  /// Put data in cache
  Future<void> put<T>(
    String key,
    T data, {
    String? etag,
    String? lastModified,
    Map<String, dynamic> Function(T)? toJson,
  }) async {
    final now = DateTime.now();

    // Memory cache
    _memoryCache.put(
      key,
      CacheEntry<T>(
        data: data,
        cachedAt: now,
        etag: etag,
        lastModified: lastModified,
      ),
    );

    // Persistent cache
    await _putPersistent(key, data, toJson);
    await _setCacheMeta(key, {
      'cachedAt': now,
      'etag': etag,
      'lastModified': lastModified,
    });
  }

  /// Remove specific cache entry
  Future<void> remove(String key) async {
    _memoryCache.remove(key);
    await _prefs.remove('$_cachePrefix$key');
    await _prefs.remove('$_metaPrefix$key');
  }

  /// Clear all cache
  Future<void> clear() async {
    _memoryCache.clear();

    final keys = _prefs.getKeys();
    for (final key in keys) {
      if (key.startsWith(_cachePrefix) || key.startsWith(_metaPrefix)) {
        await _prefs.remove(key);
      }
    }
  }

  /// Clear expired entries
  Future<void> clearExpired({
    Duration maxAge = const Duration(days: 7),
  }) async {
    final keys = _prefs.getKeys();
    final cutoff = DateTime.now().subtract(maxAge);

    for (final key in keys) {
      if (key.startsWith(_metaPrefix)) {
        final cacheKey = key.substring(_metaPrefix.length);
        final meta = _getCacheMeta(cacheKey);
        if (meta != null) {
          final cachedAt = meta['cachedAt'] as DateTime?;
          if (cachedAt != null && cachedAt.isBefore(cutoff)) {
            await remove(cacheKey);
          }
        }
      }
    }
  }

  /// Get cache stats
  Map<String, dynamic> getStats() {
    final keys = _prefs.getKeys();
    final cacheKeys = keys.where((k) => k.startsWith(_cachePrefix)).toList();

    return {
      'memoryEntries': _memoryCache.size,
      'persistentEntries': cacheKeys.length,
    };
  }

  /// Generate cache key from URL and params
  static String generateKey(String baseKey, [Map<String, dynamic>? params]) {
    if (params == null || params.isEmpty) {
      return baseKey;
    }

    final sortedParams = Map.fromEntries(
      params.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
    );
    final paramsString = json.encode(sortedParams);
    final hash = md5.convert(utf8.encode(paramsString)).toString();

    return '${baseKey}_$hash';
  }

  // === Private Methods ===

  Future<T?> _getPersistent<T>(
    String key,
    T Function(Map<String, dynamic>)? fromJson,
  ) async {
    final value = _prefs.getString('$_cachePrefix$key');
    if (value == null) return null;

    try {
      final data = json.decode(value);
      if (fromJson != null && data is Map<String, dynamic>) {
        return fromJson(data);
      }
      return data as T;
    } catch (e) {
      return null;
    }
  }

  Future<void> _putPersistent<T>(
    String key,
    T data,
    Map<String, dynamic> Function(T)? toJson,
  ) async {
    final value = toJson != null ? json.encode(toJson(data)) : json.encode(data);
    await _prefs.setString('$_cachePrefix$key', value);
  }

  Map<String, dynamic>? _getCacheMeta(String key) {
    final value = _prefs.getString('$_metaPrefix$key');
    if (value == null) return null;

    try {
      final data = json.decode(value) as Map<String, dynamic>;
      // Parse cachedAt
      if (data['cachedAt'] is String) {
        data['cachedAt'] = DateTime.parse(data['cachedAt'] as String);
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  Future<void> _setCacheMeta(String key, Map<String, dynamic> meta) async {
    final metaToStore = Map<String, dynamic>.from(meta);
    if (metaToStore['cachedAt'] is DateTime) {
      metaToStore['cachedAt'] = (metaToStore['cachedAt'] as DateTime).toIso8601String();
    }
    await _prefs.setString('$_metaPrefix$key', json.encode(metaToStore));
  }
}
