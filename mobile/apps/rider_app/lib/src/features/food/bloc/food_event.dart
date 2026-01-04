part of 'food_bloc.dart';

/// Base class for food events
sealed class FoodEvent extends Equatable {
  const FoodEvent();

  @override
  List<Object?> get props => [];
}

/// Event to load restaurants with optional filters
class RestaurantsRequested extends FoodEvent {
  const RestaurantsRequested({
    this.latitude,
    this.longitude,
    this.cuisine,
    this.query,
    this.sortBy,
  });

  final double? latitude;
  final double? longitude;
  final String? cuisine;
  final String? query;
  final String? sortBy;

  @override
  List<Object?> get props => [latitude, longitude, cuisine, query, sortBy];
}

/// Event to load more restaurants (pagination)
class MoreRestaurantsRequested extends FoodEvent {
  const MoreRestaurantsRequested();
}

/// Event to load restaurant details
class RestaurantDetailsRequested extends FoodEvent {
  const RestaurantDetailsRequested(this.restaurantId);

  final String restaurantId;

  @override
  List<Object?> get props => [restaurantId];
}

/// Event to load restaurant menu
class RestaurantMenuRequested extends FoodEvent {
  const RestaurantMenuRequested(this.restaurantId);

  final String restaurantId;

  @override
  List<Object?> get props => [restaurantId];
}

/// Event to add item to cart
class CartItemAdded extends FoodEvent {
  const CartItemAdded({
    required this.menuItem,
    this.quantity = 1,
    this.notes,
    this.customizations,
  });

  final MenuItem menuItem;
  final int quantity;
  final String? notes;
  final Map<String, dynamic>? customizations;

  @override
  List<Object?> get props => [menuItem, quantity, notes, customizations];
}

/// Event to update cart item quantity
class CartItemUpdated extends FoodEvent {
  const CartItemUpdated({
    required this.cartItemId,
    required this.quantity,
  });

  final String cartItemId;
  final int quantity;

  @override
  List<Object?> get props => [cartItemId, quantity];
}

/// Event to remove item from cart
class CartItemRemoved extends FoodEvent {
  const CartItemRemoved(this.cartItemId);

  final String cartItemId;

  @override
  List<Object?> get props => [cartItemId];
}

/// Event to clear cart
class CartCleared extends FoodEvent {
  const CartCleared();
}

/// Event to apply promo code
class PromoCodeApplied extends FoodEvent {
  const PromoCodeApplied(this.code);

  final String code;

  @override
  List<Object?> get props => [code];
}

/// Event to remove promo code
class PromoCodeRemoved extends FoodEvent {
  const PromoCodeRemoved();
}

/// Event to place food order
class FoodOrderPlaced extends FoodEvent {
  const FoodOrderPlaced({
    required this.deliveryAddressId,
    required this.paymentMethodId,
    this.deliveryInstructions,
    this.tip,
  });

  final String deliveryAddressId;
  final String paymentMethodId;
  final String? deliveryInstructions;
  final double? tip;

  @override
  List<Object?> get props => [
        deliveryAddressId,
        paymentMethodId,
        deliveryInstructions,
        tip,
      ];
}

/// Event to cancel food order
class FoodOrderCancelled extends FoodEvent {
  const FoodOrderCancelled(this.orderId);

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}

/// Event to load order details
class FoodOrderDetailsRequested extends FoodEvent {
  const FoodOrderDetailsRequested(this.orderId);

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}

/// Event to load order history
class FoodOrderHistoryRequested extends FoodEvent {
  const FoodOrderHistoryRequested();
}

/// Event to start watching order status
class OrderStatusWatchStarted extends FoodEvent {
  const OrderStatusWatchStarted(this.orderId);

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}

/// Event to stop watching order status
class OrderStatusWatchStopped extends FoodEvent {
  const OrderStatusWatchStopped();
}

/// Internal event for order status updates
class _OrderStatusUpdated extends FoodEvent {
  const _OrderStatusUpdated(this.order);

  final FoodOrder order;

  @override
  List<Object?> get props => [order];
}

/// Event to rate food order
class FoodOrderRated extends FoodEvent {
  const FoodOrderRated({
    required this.orderId,
    required this.foodRating,
    required this.deliveryRating,
    this.comment,
  });

  final String orderId;
  final int foodRating;
  final int deliveryRating;
  final String? comment;

  @override
  List<Object?> get props => [orderId, foodRating, deliveryRating, comment];
}

/// Event to add tip to delivery
class FoodOrderTipAdded extends FoodEvent {
  const FoodOrderTipAdded({
    required this.orderId,
    required this.tipAmount,
  });

  final String orderId;
  final double tipAmount;

  @override
  List<Object?> get props => [orderId, tipAmount];
}

/// Event to search menu items
class MenuSearchRequested extends FoodEvent {
  const MenuSearchRequested({
    required this.restaurantId,
    required this.query,
  });

  final String restaurantId;
  final String query;

  @override
  List<Object?> get props => [restaurantId, query];
}

/// Event to load featured restaurants
class FeaturedRestaurantsRequested extends FoodEvent {
  const FeaturedRestaurantsRequested();
}

/// Event to load nearby restaurants
class NearbyRestaurantsRequested extends FoodEvent {
  const NearbyRestaurantsRequested({
    required this.latitude,
    required this.longitude,
    this.radiusKm = 5.0,
  });

  final double latitude;
  final double longitude;
  final double radiusKm;

  @override
  List<Object?> get props => [latitude, longitude, radiusKm];
}

/// Event to reorder a previous order
class ReorderRequested extends FoodEvent {
  const ReorderRequested(this.orderId);

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}
