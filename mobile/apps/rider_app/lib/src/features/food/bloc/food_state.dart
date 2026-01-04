part of 'food_bloc.dart';

/// Base class for food states
sealed class FoodState extends Equatable {
  const FoodState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class FoodInitial extends FoodState {
  const FoodInitial();
}

/// Loading restaurants
class RestaurantsLoading extends FoodState {
  const RestaurantsLoading();
}

/// Restaurants loaded successfully
class RestaurantsLoaded extends FoodState {
  const RestaurantsLoaded({
    required this.restaurants,
    required this.hasMore,
    this.currentPage = 1,
  });

  final List<Restaurant> restaurants;
  final bool hasMore;
  final int currentPage;

  @override
  List<Object?> get props => [restaurants, hasMore, currentPage];

  RestaurantsLoaded copyWith({
    List<Restaurant>? restaurants,
    bool? hasMore,
    int? currentPage,
  }) {
    return RestaurantsLoaded(
      restaurants: restaurants ?? this.restaurants,
      hasMore: hasMore ?? this.hasMore,
      currentPage: currentPage ?? this.currentPage,
    );
  }
}

/// Loading more restaurants (pagination)
class RestaurantsLoadingMore extends FoodState {
  const RestaurantsLoadingMore({
    required this.currentRestaurants,
  });

  final List<Restaurant> currentRestaurants;

  @override
  List<Object?> get props => [currentRestaurants];
}

/// Restaurant details loading
class RestaurantDetailsLoading extends FoodState {
  const RestaurantDetailsLoading();
}

/// Restaurant details loaded
class RestaurantDetailsLoaded extends FoodState {
  const RestaurantDetailsLoaded({
    required this.restaurant,
    required this.menuCategories,
  });

  final Restaurant restaurant;
  final List<MenuCategory> menuCategories;

  @override
  List<Object?> get props => [restaurant, menuCategories];
}

/// Cart state
class CartState extends FoodState {
  const CartState({
    required this.items,
    this.restaurant,
    this.promoCode,
    this.discount = 0,
  });

  final List<CartItem> items;
  final Restaurant? restaurant;
  final String? promoCode;
  final double discount;

  double get subtotal => items.fold(
        0,
        (sum, item) => sum + (item.menuItem.price * item.quantity),
      );

  double get deliveryFee => restaurant?.deliveryFee ?? 0;

  double get serviceFee => subtotal * 0.05; // 5% service fee

  double get total => subtotal + deliveryFee + serviceFee - discount;

  int get itemCount => items.fold(0, (sum, item) => sum + item.quantity);

  bool get isEmpty => items.isEmpty;

  @override
  List<Object?> get props => [items, restaurant, promoCode, discount];

  CartState copyWith({
    List<CartItem>? items,
    Restaurant? restaurant,
    String? promoCode,
    double? discount,
  }) {
    return CartState(
      items: items ?? this.items,
      restaurant: restaurant ?? this.restaurant,
      promoCode: promoCode ?? this.promoCode,
      discount: discount ?? this.discount,
    );
  }
}

/// Placing order
class FoodOrderPlacing extends FoodState {
  const FoodOrderPlacing();
}

/// Order placed successfully
class FoodOrderPlaced extends FoodState {
  const FoodOrderPlaced({
    required this.order,
  });

  final FoodOrder order;

  @override
  List<Object?> get props => [order];
}

/// Order tracking state
class FoodOrderTracking extends FoodState {
  const FoodOrderTracking({
    required this.order,
    this.driverLocation,
  });

  final FoodOrder order;
  final LatLng? driverLocation;

  @override
  List<Object?> get props => [order, driverLocation];

  FoodOrderTracking copyWith({
    FoodOrder? order,
    LatLng? driverLocation,
  }) {
    return FoodOrderTracking(
      order: order ?? this.order,
      driverLocation: driverLocation ?? this.driverLocation,
    );
  }
}

/// Order details loaded
class FoodOrderDetailsLoaded extends FoodState {
  const FoodOrderDetailsLoaded({
    required this.order,
  });

  final FoodOrder order;

  @override
  List<Object?> get props => [order];
}

/// Order history loaded
class FoodOrderHistoryLoaded extends FoodState {
  const FoodOrderHistoryLoaded({
    required this.orders,
  });

  final List<FoodOrder> orders;

  @override
  List<Object?> get props => [orders];
}

/// Order cancelled
class FoodOrderCancelledState extends FoodState {
  const FoodOrderCancelledState({
    required this.orderId,
  });

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}

/// Order rated
class FoodOrderRatedState extends FoodState {
  const FoodOrderRatedState({
    required this.orderId,
  });

  final String orderId;

  @override
  List<Object?> get props => [orderId];
}

/// Menu search results
class MenuSearchResults extends FoodState {
  const MenuSearchResults({
    required this.items,
    required this.query,
  });

  final List<MenuItem> items;
  final String query;

  @override
  List<Object?> get props => [items, query];
}

/// Featured restaurants loaded
class FeaturedRestaurantsLoaded extends FoodState {
  const FeaturedRestaurantsLoaded({
    required this.restaurants,
  });

  final List<Restaurant> restaurants;

  @override
  List<Object?> get props => [restaurants];
}

/// Promo code applied
class PromoCodeAppliedState extends FoodState {
  const PromoCodeAppliedState({
    required this.code,
    required this.discount,
  });

  final String code;
  final double discount;

  @override
  List<Object?> get props => [code, discount];
}

/// Promo code invalid
class PromoCodeInvalid extends FoodState {
  const PromoCodeInvalid({
    required this.message,
  });

  final String message;

  @override
  List<Object?> get props => [message];
}

/// Error state
class FoodError extends FoodState {
  const FoodError({
    required this.message,
    this.previousState,
  });

  final String message;
  final FoodState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}

// Supporting models

/// Cart item model
class CartItem {
  const CartItem({
    required this.id,
    required this.menuItem,
    required this.quantity,
    this.notes,
    this.customizations,
  });

  final String id;
  final MenuItem menuItem;
  final int quantity;
  final String? notes;
  final Map<String, dynamic>? customizations;

  CartItem copyWith({
    String? id,
    MenuItem? menuItem,
    int? quantity,
    String? notes,
    Map<String, dynamic>? customizations,
  }) {
    return CartItem(
      id: id ?? this.id,
      menuItem: menuItem ?? this.menuItem,
      quantity: quantity ?? this.quantity,
      notes: notes ?? this.notes,
      customizations: customizations ?? this.customizations,
    );
  }
}

/// Menu category model
class MenuCategory {
  const MenuCategory({
    required this.id,
    required this.name,
    required this.items,
    this.description,
  });

  final String id;
  final String name;
  final List<MenuItem> items;
  final String? description;
}

/// MenuItem model (simplified for BLoC)
class MenuItem {
  const MenuItem({
    required this.id,
    required this.name,
    required this.price,
    this.description,
    this.imageUrl,
    this.isAvailable = true,
    this.isPopular = false,
    this.category,
  });

  final String id;
  final String name;
  final double price;
  final String? description;
  final String? imageUrl;
  final bool isAvailable;
  final bool isPopular;
  final String? category;
}

/// Restaurant model (simplified for BLoC)
class Restaurant {
  const Restaurant({
    required this.id,
    required this.name,
    required this.rating,
    required this.deliveryFee,
    required this.deliveryTimeMinutes,
    this.imageUrl,
    this.cuisine,
    this.address,
    this.isOpen = true,
    this.isFeatured = false,
    this.minimumOrder,
    this.distance,
  });

  final String id;
  final String name;
  final double rating;
  final double deliveryFee;
  final int deliveryTimeMinutes;
  final String? imageUrl;
  final String? cuisine;
  final String? address;
  final bool isOpen;
  final bool isFeatured;
  final double? minimumOrder;
  final double? distance;
}

/// FoodOrder model (simplified for BLoC)
class FoodOrder {
  const FoodOrder({
    required this.id,
    required this.status,
    required this.restaurant,
    required this.items,
    required this.subtotal,
    required this.deliveryFee,
    required this.serviceFee,
    required this.total,
    required this.createdAt,
    this.driverName,
    this.driverPhone,
    this.driverPhoto,
    this.estimatedDeliveryTime,
    this.deliveryAddress,
    this.discount,
    this.tip,
    this.paymentMethod,
    this.rating,
    this.deliveryRating,
  });

  final String id;
  final FoodOrderStatus status;
  final Restaurant restaurant;
  final List<CartItem> items;
  final double subtotal;
  final double deliveryFee;
  final double serviceFee;
  final double total;
  final DateTime createdAt;
  final String? driverName;
  final String? driverPhone;
  final String? driverPhoto;
  final DateTime? estimatedDeliveryTime;
  final String? deliveryAddress;
  final double? discount;
  final double? tip;
  final String? paymentMethod;
  final int? rating;
  final int? deliveryRating;
}

/// Food order status
enum FoodOrderStatus {
  pending,
  confirmed,
  preparing,
  readyForPickup,
  pickedUp,
  onTheWay,
  delivered,
  cancelled,
}

/// LatLng for driver location
class LatLng {
  const LatLng(this.latitude, this.longitude);

  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is LatLng &&
        other.latitude == latitude &&
        other.longitude == longitude;
  }

  @override
  int get hashCode => latitude.hashCode ^ longitude.hashCode;
}
