/// Database Service
///
/// Manages Isar database initialization and access.
library;

import 'package:injectable/injectable.dart';
import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';

import 'collections/order_collection.dart';
import 'collections/ride_collection.dart';
import 'collections/user_collection.dart';

/// Database service for local storage
@lazySingleton
class DatabaseService {
  DatabaseService._();

  static DatabaseService? _instance;
  Isar? _isar;

  /// Get singleton instance
  static DatabaseService get instance {
    _instance ??= DatabaseService._();
    return _instance!;
  }

  /// Get Isar instance (throws if not initialized)
  Isar get isar {
    if (_isar == null) {
      throw StateError('Database not initialized. Call initialize() first.');
    }
    return _isar!;
  }

  /// Check if database is initialized
  bool get isInitialized => _isar != null;

  /// Initialize the database
  Future<void> initialize() async {
    if (_isar != null) return;

    final dir = await getApplicationDocumentsDirectory();

    _isar = await Isar.open(
      [
        CachedUserSchema,
        CachedRideSchema,
        CachedFoodOrderSchema,
        CachedDeliverySchema,
        CachedRestaurantSchema,
        CachedSavedPlaceSchema,
      ],
      directory: dir.path,
      name: 'ubi_db',
    );
  }

  /// Close the database
  Future<void> close() async {
    await _isar?.close();
    _isar = null;
  }

  /// Clear all data
  Future<void> clearAll() async {
    await _isar?.writeTxn(() async {
      await _isar!.clear();
    });
  }

  /// Get collection sizes
  Future<Map<String, int>> getCollectionSizes() async {
    return {
      'users': await isar.cachedUsers.count(),
      'rides': await isar.cachedRides.count(),
      'orders': await isar.cachedFoodOrders.count(),
      'deliveries': await isar.cachedDeliverys.count(),
      'restaurants': await isar.cachedRestaurants.count(),
      'savedPlaces': await isar.cachedSavedPlaces.count(),
    };
  }

  // === User Collection ===

  /// Get user collection
  IsarCollection<CachedUser> get users => isar.cachedUsers;

  /// Save user
  Future<void> saveUser(CachedUser user) async {
    await isar.writeTxn(() async {
      await users.put(user);
    });
  }

  /// Get current user
  Future<CachedUser?> getCurrentUser() async {
    return await users.where().isCurrentUserEqualTo(true).findFirst();
  }

  /// Clear current user
  Future<void> clearCurrentUser() async {
    await isar.writeTxn(() async {
      await users.filter().isCurrentUserEqualTo(true).deleteAll();
    });
  }

  // === Ride Collection ===

  /// Get rides collection
  IsarCollection<CachedRide> get rides => isar.cachedRides;

  /// Save ride
  Future<void> saveRide(CachedRide ride) async {
    await isar.writeTxn(() async {
      await rides.put(ride);
    });
  }

  /// Get recent rides
  Future<List<CachedRide>> getRecentRides({int limit = 20}) async {
    return await rides.where().sortByCreatedAtDesc().limit(limit).findAll();
  }

  /// Get active ride
  Future<CachedRide?> getActiveRide() async {
    return await rides.filter().isActiveEqualTo(true).findFirst();
  }

  // === Food Order Collection ===

  /// Get food orders collection
  IsarCollection<CachedFoodOrder> get foodOrders => isar.cachedFoodOrders;

  /// Save food order
  Future<void> saveFoodOrder(CachedFoodOrder order) async {
    await isar.writeTxn(() async {
      await foodOrders.put(order);
    });
  }

  /// Get recent orders
  Future<List<CachedFoodOrder>> getRecentOrders({int limit = 20}) async {
    return await foodOrders.where().sortByCreatedAtDesc().limit(limit).findAll();
  }

  // === Delivery Collection ===

  /// Get deliveries collection
  IsarCollection<CachedDelivery> get deliveries => isar.cachedDeliverys;

  /// Save delivery
  Future<void> saveDelivery(CachedDelivery delivery) async {
    await isar.writeTxn(() async {
      await deliveries.put(delivery);
    });
  }

  // === Restaurant Collection ===

  /// Get restaurants collection
  IsarCollection<CachedRestaurant> get restaurants => isar.cachedRestaurants;

  /// Save restaurant
  Future<void> saveRestaurant(CachedRestaurant restaurant) async {
    await isar.writeTxn(() async {
      await restaurants.put(restaurant);
    });
  }

  /// Save multiple restaurants
  Future<void> saveRestaurants(List<CachedRestaurant> items) async {
    await isar.writeTxn(() async {
      await restaurants.putAll(items);
    });
  }

  /// Search restaurants
  Future<List<CachedRestaurant>> searchRestaurants(String query) async {
    return await restaurants
        .filter()
        .nameContains(query, caseSensitive: false)
        .or()
        .cuisineContains(query, caseSensitive: false)
        .findAll();
  }

  // === Saved Places Collection ===

  /// Get saved places collection
  IsarCollection<CachedSavedPlace> get savedPlaces => isar.cachedSavedPlaces;

  /// Get all saved places
  Future<List<CachedSavedPlace>> getSavedPlaces() async {
    return await savedPlaces.where().findAll();
  }

  /// Save a place
  Future<void> saveSavedPlace(CachedSavedPlace place) async {
    await isar.writeTxn(() async {
      await savedPlaces.put(place);
    });
  }

  /// Delete a saved place
  Future<void> deleteSavedPlace(String placeId) async {
    await isar.writeTxn(() async {
      await savedPlaces.filter().serverIdEqualTo(placeId).deleteFirst();
    });
  }
}
