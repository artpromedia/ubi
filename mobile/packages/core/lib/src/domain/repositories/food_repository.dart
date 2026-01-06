/// Food Repository Interface
///
/// Contract for food ordering data operations.
library;

import '../../core/result/result.dart';
import '../entities/food_order.dart';

/// Repository for food ordering operations
abstract class FoodRepository {
  /// Get nearby restaurants
  Future<Result<List<Restaurant>>> getNearbyRestaurants({
    required double latitude,
    required double longitude,
    double radiusKm = 5.0,
    String? cuisineType,
    int page = 1,
    int perPage = 20,
  });

  /// Get featured restaurants
  Future<Result<List<Restaurant>>> getFeaturedRestaurants({
    required double latitude,
    required double longitude,
  });

  /// Search restaurants
  Future<Result<List<Restaurant>>> searchRestaurants({
    required String query,
    required double latitude,
    required double longitude,
    double radiusKm = 10.0,
    int page = 1,
    int perPage = 20,
  });

  /// Get restaurant details
  Future<Result<Restaurant>> getRestaurantById(String restaurantId);

  /// Get restaurant menu
  Future<Result<List<MenuItem>>> getRestaurantMenu(String restaurantId);

  /// Get available cuisines
  Future<Result<List<String>>> getCuisines();

  /// Create a food order
  Future<Result<FoodOrder>> createOrder({
    required String restaurantId,
    required List<FoodOrderItem> items,
    required String deliveryAddressId,
    String? paymentMethodId,
    String? instructions,
    String? promoCode,
  });

  /// Get order by ID
  Future<Result<FoodOrder>> getOrderById(String orderId);

  /// Get active orders
  Future<Result<List<FoodOrder>>> getActiveOrders();

  /// Cancel an order
  Future<Result<FoodOrder>> cancelOrder(String orderId, {String? reason});

  /// Rate an order
  Future<Result<void>> rateOrder({
    required String orderId,
    required int foodRating,
    required int deliveryRating,
    String? review,
  });

  /// Reorder a previous order
  Future<Result<FoodOrder>> reorder(String orderId);

  /// Stream order updates in real-time
  Stream<FoodOrder> watchOrder(String orderId);
}

