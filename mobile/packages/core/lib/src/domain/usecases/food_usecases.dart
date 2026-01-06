/// Food Ordering Use Cases
///
/// Business logic for food ordering operations.
library;

import '../../core/result/result.dart';
import '../entities/food_order.dart';
import '../entities/location.dart';
import '../repositories/food_repository.dart';
import 'use_case.dart';

/// Get nearby restaurants
class GetNearbyRestaurantsUseCase implements UseCase<List<Restaurant>, GetNearbyRestaurantsParams> {
  const GetNearbyRestaurantsUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<Restaurant>>> call(GetNearbyRestaurantsParams params) {
    return repository.getNearbyRestaurants(
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm: params.radiusKm,
      cuisineType: params.cuisineType,
      page: params.page,
      perPage: params.perPage,
    );
  }
}

class GetNearbyRestaurantsParams {
  const GetNearbyRestaurantsParams({
    required this.latitude,
    required this.longitude,
    this.radiusKm = 5.0,
    this.cuisineType,
    this.page = 1,
    this.perPage = 20,
  });

  final double latitude;
  final double longitude;
  final double radiusKm;
  final String? cuisineType;
  final int page;
  final int perPage;
}

/// Get featured restaurants
class GetFeaturedRestaurantsUseCase implements UseCase<List<Restaurant>, GeoLocation> {
  const GetFeaturedRestaurantsUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<Restaurant>>> call(GeoLocation location) {
    return repository.getFeaturedRestaurants(
      latitude: location.latitude,
      longitude: location.longitude,
    );
  }
}

/// Search restaurants
class SearchRestaurantsUseCase implements UseCase<List<Restaurant>, SearchRestaurantsParams> {
  const SearchRestaurantsUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<Restaurant>>> call(SearchRestaurantsParams params) {
    return repository.searchRestaurants(
      query: params.query,
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm: params.radiusKm,
      page: params.page,
      perPage: params.perPage,
    );
  }
}

class SearchRestaurantsParams {
  const SearchRestaurantsParams({
    required this.query,
    required this.latitude,
    required this.longitude,
    this.radiusKm = 10.0,
    this.page = 1,
    this.perPage = 20,
  });

  final String query;
  final double latitude;
  final double longitude;
  final double radiusKm;
  final int page;
  final int perPage;
}

/// Get restaurant details
class GetRestaurantDetailsUseCase implements UseCase<Restaurant, String> {
  const GetRestaurantDetailsUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<Restaurant>> call(String restaurantId) {
    return repository.getRestaurantById(restaurantId);
  }
}

/// Get restaurant menu
class GetRestaurantMenuUseCase implements UseCase<List<MenuItem>, String> {
  const GetRestaurantMenuUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<MenuItem>>> call(String restaurantId) {
    return repository.getRestaurantMenu(restaurantId);
  }
}

/// Get available cuisines
class GetCuisinesUseCase implements UseCase<List<String>, NoParams> {
  const GetCuisinesUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<String>>> call(NoParams params) {
    return repository.getCuisines();
  }
}

/// Create a food order
class CreateFoodOrderUseCase implements UseCase<FoodOrder, CreateFoodOrderParams> {
  const CreateFoodOrderUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<FoodOrder>> call(CreateFoodOrderParams params) {
    return repository.createOrder(
      restaurantId: params.restaurantId,
      items: params.items,
      deliveryAddressId: params.deliveryAddressId,
      paymentMethodId: params.paymentMethodId,
      instructions: params.instructions,
      promoCode: params.promoCode,
    );
  }
}

class CreateFoodOrderParams {
  const CreateFoodOrderParams({
    required this.restaurantId,
    required this.items,
    required this.deliveryAddressId,
    this.paymentMethodId,
    this.instructions,
    this.promoCode,
  });

  final String restaurantId;
  final List<FoodOrderItem> items;
  final String deliveryAddressId;
  final String? paymentMethodId;
  final String? instructions;
  final String? promoCode;
}

/// Get food order details
class GetFoodOrderDetailsUseCase implements UseCase<FoodOrder, String> {
  const GetFoodOrderDetailsUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<FoodOrder>> call(String orderId) {
    return repository.getOrderById(orderId);
  }
}

/// Get active food orders
class GetActiveFoodOrdersUseCase implements UseCase<List<FoodOrder>, NoParams> {
  const GetActiveFoodOrdersUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<List<FoodOrder>>> call(NoParams params) {
    return repository.getActiveOrders();
  }
}

/// Cancel a food order
class CancelFoodOrderUseCase implements UseCase<FoodOrder, CancelFoodOrderParams> {
  const CancelFoodOrderUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<FoodOrder>> call(CancelFoodOrderParams params) {
    return repository.cancelOrder(
      params.orderId,
      reason: params.reason,
    );
  }
}

class CancelFoodOrderParams {
  const CancelFoodOrderParams({
    required this.orderId,
    this.reason,
  });

  final String orderId;
  final String? reason;
}

/// Rate a food order
class RateFoodOrderUseCase implements UseCase<void, RateFoodOrderParams> {
  const RateFoodOrderUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<void>> call(RateFoodOrderParams params) {
    return repository.rateOrder(
      orderId: params.orderId,
      foodRating: params.foodRating,
      deliveryRating: params.deliveryRating,
      review: params.review,
    );
  }
}

class RateFoodOrderParams {
  const RateFoodOrderParams({
    required this.orderId,
    required this.foodRating,
    required this.deliveryRating,
    this.review,
  });

  final String orderId;
  final int foodRating;
  final int deliveryRating;
  final String? review;
}

/// Reorder a previous order
class ReorderUseCase implements UseCase<FoodOrder, String> {
  const ReorderUseCase(this.repository);

  final FoodRepository repository;

  @override
  Future<Result<FoodOrder>> call(String orderId) {
    return repository.reorder(orderId);
  }
}

/// Watch food order updates in real-time
class WatchFoodOrderUseCase implements StreamUseCase<FoodOrder, String> {
  const WatchFoodOrderUseCase(this.repository);

  final FoodRepository repository;

  @override
  Stream<FoodOrder> call(String orderId) {
    return repository.watchOrder(orderId);
  }
}

