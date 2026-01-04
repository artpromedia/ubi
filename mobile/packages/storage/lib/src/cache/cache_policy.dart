/// Cache Policy
///
/// Defines caching strategies and policies.
library;

/// Cache policy types
enum CachePolicyType {
  /// Always fetch from network first
  networkFirst,

  /// Always fetch from cache first
  cacheFirst,

  /// Use cache only
  cacheOnly,

  /// Use network only
  networkOnly,

  /// Use cache while fetching network (stale-while-revalidate)
  staleWhileRevalidate,
}

/// Cache policy configuration
class CachePolicy {
  const CachePolicy({
    this.type = CachePolicyType.cacheFirst,
    this.maxAge = const Duration(hours: 1),
    this.maxStaleAge = const Duration(hours: 24),
    this.shouldCache = true,
  });

  /// Default policy for most data
  static const defaultPolicy = CachePolicy();

  /// Policy for frequently changing data
  static const shortLived = CachePolicy(
    type: CachePolicyType.staleWhileRevalidate,
    maxAge: Duration(minutes: 5),
    maxStaleAge: Duration(minutes: 30),
  );

  /// Policy for rarely changing data
  static const longLived = CachePolicy(
    type: CachePolicyType.cacheFirst,
    maxAge: Duration(days: 7),
    maxStaleAge: Duration(days: 30),
  );

  /// Policy for user profile data
  static const userProfile = CachePolicy(
    type: CachePolicyType.staleWhileRevalidate,
    maxAge: Duration(minutes: 15),
    maxStaleAge: Duration(hours: 2),
  );

  /// Policy for restaurant/menu data
  static const menuData = CachePolicy(
    type: CachePolicyType.staleWhileRevalidate,
    maxAge: Duration(hours: 1),
    maxStaleAge: Duration(hours: 6),
  );

  /// Policy for active rides/orders (should be fresh)
  static const activeSession = CachePolicy(
    type: CachePolicyType.networkFirst,
    maxAge: Duration(seconds: 30),
    maxStaleAge: Duration(minutes: 5),
  );

  /// No caching
  static const noCache = CachePolicy(
    type: CachePolicyType.networkOnly,
    shouldCache: false,
  );

  final CachePolicyType type;
  final Duration maxAge;
  final Duration maxStaleAge;
  final bool shouldCache;

  /// Check if cached entry is still fresh
  bool isFresh(DateTime cachedAt) {
    return DateTime.now().difference(cachedAt) < maxAge;
  }

  /// Check if cached entry can be used as stale
  bool canUseStale(DateTime cachedAt) {
    return DateTime.now().difference(cachedAt) < maxStaleAge;
  }
}

/// Cache entry metadata
class CacheEntry<T> {
  const CacheEntry({
    required this.data,
    required this.cachedAt,
    this.etag,
    this.lastModified,
  });

  final T data;
  final DateTime cachedAt;
  final String? etag;
  final String? lastModified;

  /// Check if entry is fresh based on policy
  bool isFresh(CachePolicy policy) => policy.isFresh(cachedAt);

  /// Check if entry can be used as stale based on policy
  bool canUseStale(CachePolicy policy) => policy.canUseStale(cachedAt);

  /// Age of the cache entry
  Duration get age => DateTime.now().difference(cachedAt);

  /// Create updated entry with new data
  CacheEntry<T> copyWithData(T newData) {
    return CacheEntry<T>(
      data: newData,
      cachedAt: DateTime.now(),
      etag: etag,
      lastModified: lastModified,
    );
  }
}
