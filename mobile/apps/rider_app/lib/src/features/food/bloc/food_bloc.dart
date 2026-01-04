import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

part 'food_event.dart';
part 'food_state.dart';

/// BLoC for managing food ordering
class FoodBloc extends Bloc<FoodEvent, FoodState> {
  FoodBloc() : super(const FoodInitial()) {
    on<RestaurantsRequested>(_onRestaurantsRequested);
    on<MoreRestaurantsRequested>(_onMoreRestaurantsRequested);
    on<RestaurantDetailsRequested>(_onRestaurantDetailsRequested);
    on<RestaurantMenuRequested>(_onRestaurantMenuRequested);
    on<CartItemAdded>(_onCartItemAdded);
    on<CartItemUpdated>(_onCartItemUpdated);
    on<CartItemRemoved>(_onCartItemRemoved);
    on<CartCleared>(_onCartCleared);
    on<PromoCodeApplied>(_onPromoCodeApplied);
    on<PromoCodeRemoved>(_onPromoCodeRemoved);
    on<FoodOrderPlaced>(_onFoodOrderPlaced);
    on<FoodOrderCancelled>(_onFoodOrderCancelled);
    on<FoodOrderDetailsRequested>(_onFoodOrderDetailsRequested);
    on<FoodOrderHistoryRequested>(_onFoodOrderHistoryRequested);
    on<OrderStatusWatchStarted>(_onOrderStatusWatchStarted);
    on<OrderStatusWatchStopped>(_onOrderStatusWatchStopped);
    on<_OrderStatusUpdated>(_onOrderStatusUpdated);
    on<FoodOrderRated>(_onFoodOrderRated);
    on<FoodOrderTipAdded>(_onFoodOrderTipAdded);
    on<MenuSearchRequested>(_onMenuSearchRequested);
    on<FeaturedRestaurantsRequested>(_onFeaturedRestaurantsRequested);
    on<NearbyRestaurantsRequested>(_onNearbyRestaurantsRequested);
    on<ReorderRequested>(_onReorderRequested);
  }

  // In-memory cart storage
  final List<CartItem> _cartItems = [];
  Restaurant? _cartRestaurant;
  String? _promoCode;
  double _discount = 0;

  StreamSubscription<FoodOrder>? _orderStatusSubscription;

  // Sample data
  static const _uuid = Uuid();

  static final List<Restaurant> _sampleRestaurants = [
    Restaurant(
      id: '1',
      name: 'Java House',
      rating: 4.5,
      deliveryFee: 100,
      deliveryTimeMinutes: 25,
      imageUrl: 'https://example.com/java.jpg',
      cuisine: 'African',
      address: 'Westlands, Nairobi',
      isFeatured: true,
      minimumOrder: 500,
      distance: 2.5,
    ),
    Restaurant(
      id: '2',
      name: 'Chicken Inn',
      rating: 4.2,
      deliveryFee: 80,
      deliveryTimeMinutes: 20,
      imageUrl: 'https://example.com/chicken.jpg',
      cuisine: 'Fast Food',
      address: 'CBD, Nairobi',
      isFeatured: true,
      minimumOrder: 300,
      distance: 1.8,
    ),
    Restaurant(
      id: '3',
      name: 'Artcaffe',
      rating: 4.6,
      deliveryFee: 150,
      deliveryTimeMinutes: 30,
      imageUrl: 'https://example.com/artcaffe.jpg',
      cuisine: 'Italian',
      address: 'Karen, Nairobi',
      isFeatured: false,
      minimumOrder: 800,
      distance: 5.2,
    ),
    Restaurant(
      id: '4',
      name: 'Mama Oliech',
      rating: 4.8,
      deliveryFee: 120,
      deliveryTimeMinutes: 35,
      imageUrl: 'https://example.com/mama.jpg',
      cuisine: 'African',
      address: 'Kilimani, Nairobi',
      isFeatured: true,
      minimumOrder: 400,
      distance: 3.1,
    ),
    Restaurant(
      id: '5',
      name: 'KFC',
      rating: 4.3,
      deliveryFee: 90,
      deliveryTimeMinutes: 22,
      imageUrl: 'https://example.com/kfc.jpg',
      cuisine: 'Fast Food',
      address: 'Thika Road, Nairobi',
      isFeatured: false,
      minimumOrder: 350,
      distance: 4.0,
    ),
  ];

  static final List<MenuCategory> _sampleMenu = [
    MenuCategory(
      id: '1',
      name: 'Popular',
      description: 'Customer favorites',
      items: [
        MenuItem(
          id: '101',
          name: 'Grilled Chicken Burger',
          price: 650,
          description: 'Juicy grilled chicken with fresh vegetables',
          isPopular: true,
          category: 'Burgers',
        ),
        MenuItem(
          id: '102',
          name: 'Classic Fries',
          price: 250,
          description: 'Crispy golden fries',
          isPopular: true,
          category: 'Sides',
        ),
      ],
    ),
    MenuCategory(
      id: '2',
      name: 'Burgers',
      items: [
        MenuItem(
          id: '201',
          name: 'Beef Burger',
          price: 750,
          description: '100% beef patty with cheese',
          category: 'Burgers',
        ),
        MenuItem(
          id: '202',
          name: 'Veggie Burger',
          price: 550,
          description: 'Plant-based patty with avocado',
          category: 'Burgers',
        ),
      ],
    ),
    MenuCategory(
      id: '3',
      name: 'Beverages',
      items: [
        MenuItem(
          id: '301',
          name: 'Fresh Orange Juice',
          price: 180,
          description: 'Freshly squeezed orange juice',
          category: 'Beverages',
        ),
        MenuItem(
          id: '302',
          name: 'Mango Smoothie',
          price: 220,
          description: 'Creamy mango smoothie',
          category: 'Beverages',
        ),
      ],
    ),
  ];

  @override
  Future<void> close() {
    _orderStatusSubscription?.cancel();
    return super.close();
  }

  Future<void> _onRestaurantsRequested(
    RestaurantsRequested event,
    Emitter<FoodState> emit,
  ) async {
    emit(const RestaurantsLoading());

    try {
      // Simulate API call
      await Future.delayed(const Duration(milliseconds: 800));

      var restaurants = List<Restaurant>.from(_sampleRestaurants);

      // Apply filters
      if (event.cuisine != null && event.cuisine!.isNotEmpty) {
        restaurants = restaurants
            .where((r) =>
                r.cuisine?.toLowerCase() == event.cuisine!.toLowerCase())
            .toList();
      }

      if (event.query != null && event.query!.isNotEmpty) {
        restaurants = restaurants
            .where((r) =>
                r.name.toLowerCase().contains(event.query!.toLowerCase()))
            .toList();
      }

      // Apply sorting
      if (event.sortBy == 'rating') {
        restaurants.sort((a, b) => b.rating.compareTo(a.rating));
      } else if (event.sortBy == 'distance') {
        restaurants.sort(
            (a, b) => (a.distance ?? 0).compareTo(b.distance ?? 0));
      } else if (event.sortBy == 'delivery_time') {
        restaurants.sort(
            (a, b) => a.deliveryTimeMinutes.compareTo(b.deliveryTimeMinutes));
      }

      emit(RestaurantsLoaded(
        restaurants: restaurants,
        hasMore: false,
        currentPage: 1,
      ));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onMoreRestaurantsRequested(
    MoreRestaurantsRequested event,
    Emitter<FoodState> emit,
  ) async {
    final currentState = state;
    if (currentState is! RestaurantsLoaded || !currentState.hasMore) {
      return;
    }

    emit(RestaurantsLoadingMore(
      currentRestaurants: currentState.restaurants,
    ));

    try {
      // Simulate API call for more data
      await Future.delayed(const Duration(milliseconds: 500));

      // In real app, fetch next page
      emit(currentState.copyWith(
        hasMore: false,
        currentPage: currentState.currentPage + 1,
      ));
    } catch (e) {
      emit(FoodError(
        message: e.toString(),
        previousState: currentState,
      ));
    }
  }

  Future<void> _onRestaurantDetailsRequested(
    RestaurantDetailsRequested event,
    Emitter<FoodState> emit,
  ) async {
    emit(const RestaurantDetailsLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final restaurant = _sampleRestaurants.firstWhere(
        (r) => r.id == event.restaurantId,
        orElse: () => _sampleRestaurants.first,
      );

      emit(RestaurantDetailsLoaded(
        restaurant: restaurant,
        menuCategories: _sampleMenu,
      ));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onRestaurantMenuRequested(
    RestaurantMenuRequested event,
    Emitter<FoodState> emit,
  ) async {
    // Similar to details - can be combined
    add(RestaurantDetailsRequested(event.restaurantId));
  }

  Future<void> _onCartItemAdded(
    CartItemAdded event,
    Emitter<FoodState> emit,
  ) async {
    // Check if adding from different restaurant
    if (_cartRestaurant != null &&
        _cartItems.isNotEmpty &&
        _cartRestaurant!.id != event.menuItem.category) {
      // In real app, show confirmation dialog
    }

    // Find existing item
    final existingIndex = _cartItems.indexWhere(
      (item) => item.menuItem.id == event.menuItem.id,
    );

    if (existingIndex != -1) {
      // Update quantity
      _cartItems[existingIndex] = _cartItems[existingIndex].copyWith(
        quantity: _cartItems[existingIndex].quantity + event.quantity,
      );
    } else {
      // Add new item
      _cartItems.add(CartItem(
        id: _uuid.v4(),
        menuItem: event.menuItem,
        quantity: event.quantity,
        notes: event.notes,
        customizations: event.customizations,
      ));
    }

    emit(CartState(
      items: List.from(_cartItems),
      restaurant: _cartRestaurant,
      promoCode: _promoCode,
      discount: _discount,
    ));
  }

  Future<void> _onCartItemUpdated(
    CartItemUpdated event,
    Emitter<FoodState> emit,
  ) async {
    final index = _cartItems.indexWhere((item) => item.id == event.cartItemId);
    if (index != -1) {
      if (event.quantity <= 0) {
        _cartItems.removeAt(index);
      } else {
        _cartItems[index] = _cartItems[index].copyWith(
          quantity: event.quantity,
        );
      }
    }

    emit(CartState(
      items: List.from(_cartItems),
      restaurant: _cartRestaurant,
      promoCode: _promoCode,
      discount: _discount,
    ));
  }

  Future<void> _onCartItemRemoved(
    CartItemRemoved event,
    Emitter<FoodState> emit,
  ) async {
    _cartItems.removeWhere((item) => item.id == event.cartItemId);

    if (_cartItems.isEmpty) {
      _cartRestaurant = null;
      _promoCode = null;
      _discount = 0;
    }

    emit(CartState(
      items: List.from(_cartItems),
      restaurant: _cartRestaurant,
      promoCode: _promoCode,
      discount: _discount,
    ));
  }

  Future<void> _onCartCleared(
    CartCleared event,
    Emitter<FoodState> emit,
  ) async {
    _cartItems.clear();
    _cartRestaurant = null;
    _promoCode = null;
    _discount = 0;

    emit(const CartState(items: []));
  }

  Future<void> _onPromoCodeApplied(
    PromoCodeApplied event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Validate promo code
      if (event.code.toUpperCase() == 'SAVE20') {
        _promoCode = event.code;
        _discount = 100; // KES 100 off

        emit(PromoCodeAppliedState(
          code: event.code,
          discount: _discount,
        ));

        emit(CartState(
          items: List.from(_cartItems),
          restaurant: _cartRestaurant,
          promoCode: _promoCode,
          discount: _discount,
        ));
      } else {
        emit(const PromoCodeInvalid(message: 'Invalid promo code'));
      }
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onPromoCodeRemoved(
    PromoCodeRemoved event,
    Emitter<FoodState> emit,
  ) async {
    _promoCode = null;
    _discount = 0;

    emit(CartState(
      items: List.from(_cartItems),
      restaurant: _cartRestaurant,
      promoCode: null,
      discount: 0,
    ));
  }

  Future<void> _onFoodOrderPlaced(
    FoodOrderPlaced event,
    Emitter<FoodState> emit,
  ) async {
    emit(const FoodOrderPlacing());

    try {
      await Future.delayed(const Duration(seconds: 2));

      final order = FoodOrder(
        id: _uuid.v4(),
        status: FoodOrderStatus.confirmed,
        restaurant: _cartRestaurant ?? _sampleRestaurants.first,
        items: List.from(_cartItems),
        subtotal: _cartItems.fold(
          0,
          (sum, item) => sum + (item.menuItem.price * item.quantity),
        ),
        deliveryFee: _cartRestaurant?.deliveryFee ?? 100,
        serviceFee: 50,
        total: _cartItems.fold(
              0,
              (sum, item) => sum + (item.menuItem.price * item.quantity),
            ) +
            (_cartRestaurant?.deliveryFee ?? 100) +
            50 -
            _discount,
        createdAt: DateTime.now(),
        estimatedDeliveryTime: DateTime.now().add(const Duration(minutes: 35)),
        deliveryAddress: '123 Kilimani Road, Nairobi',
        discount: _discount > 0 ? _discount : null,
        tip: event.tip,
        paymentMethod: 'M-Pesa',
      );

      // Clear cart after successful order
      _cartItems.clear();
      _cartRestaurant = null;
      _promoCode = null;
      _discount = 0;

      emit(FoodOrderPlaced(order: order));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onFoodOrderCancelled(
    FoodOrderCancelled event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(FoodOrderCancelledState(orderId: event.orderId));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onFoodOrderDetailsRequested(
    FoodOrderDetailsRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final order = FoodOrder(
        id: event.orderId,
        status: FoodOrderStatus.delivered,
        restaurant: _sampleRestaurants.first,
        items: [
          CartItem(
            id: '1',
            menuItem: _sampleMenu.first.items.first,
            quantity: 2,
          ),
        ],
        subtotal: 1300,
        deliveryFee: 100,
        serviceFee: 50,
        total: 1450,
        createdAt: DateTime.now().subtract(const Duration(hours: 2)),
        driverName: 'Joseph Kamau',
        driverPhone: '+254 712 345 678',
        deliveryAddress: '123 Kilimani Road, Nairobi',
        paymentMethod: 'M-Pesa',
        rating: 4,
        deliveryRating: 5,
      );

      emit(FoodOrderDetailsLoaded(order: order));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onFoodOrderHistoryRequested(
    FoodOrderHistoryRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final orders = List.generate(
        5,
        (i) => FoodOrder(
          id: _uuid.v4(),
          status: FoodOrderStatus.delivered,
          restaurant: _sampleRestaurants[i % _sampleRestaurants.length],
          items: [
            CartItem(
              id: '1',
              menuItem: _sampleMenu.first.items.first,
              quantity: 1,
            ),
          ],
          subtotal: 650 + (i * 100),
          deliveryFee: 100,
          serviceFee: 50,
          total: 800 + (i * 100),
          createdAt: DateTime.now().subtract(Duration(days: i + 1)),
          paymentMethod: 'M-Pesa',
        ),
      );

      emit(FoodOrderHistoryLoaded(orders: orders));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onOrderStatusWatchStarted(
    OrderStatusWatchStarted event,
    Emitter<FoodState> emit,
  ) async {
    await _orderStatusSubscription?.cancel();

    // Simulate order status updates
    _orderStatusSubscription = Stream.periodic(
      const Duration(seconds: 10),
      (i) => FoodOrder(
        id: event.orderId,
        status: FoodOrderStatus.values[
            (FoodOrderStatus.confirmed.index + i) %
                FoodOrderStatus.values.length],
        restaurant: _sampleRestaurants.first,
        items: [],
        subtotal: 1300,
        deliveryFee: 100,
        serviceFee: 50,
        total: 1450,
        createdAt: DateTime.now(),
        driverName: 'Joseph Kamau',
        driverPhone: '+254 712 345 678',
        estimatedDeliveryTime: DateTime.now().add(const Duration(minutes: 25)),
      ),
    ).listen((order) {
      add(_OrderStatusUpdated(order));
    });
  }

  Future<void> _onOrderStatusWatchStopped(
    OrderStatusWatchStopped event,
    Emitter<FoodState> emit,
  ) async {
    await _orderStatusSubscription?.cancel();
    _orderStatusSubscription = null;
  }

  void _onOrderStatusUpdated(
    _OrderStatusUpdated event,
    Emitter<FoodState> emit,
  ) {
    final currentState = state;
    if (currentState is FoodOrderTracking) {
      emit(currentState.copyWith(order: event.order));
    } else {
      emit(FoodOrderTracking(order: event.order));
    }
  }

  Future<void> _onFoodOrderRated(
    FoodOrderRated event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(FoodOrderRatedState(orderId: event.orderId));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onFoodOrderTipAdded(
    FoodOrderTipAdded event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      // Update order with tip
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onMenuSearchRequested(
    MenuSearchRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final allItems =
          _sampleMenu.expand((category) => category.items).toList();
      final results = allItems
          .where((item) =>
              item.name.toLowerCase().contains(event.query.toLowerCase()))
          .toList();

      emit(MenuSearchResults(items: results, query: event.query));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onFeaturedRestaurantsRequested(
    FeaturedRestaurantsRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final featured =
          _sampleRestaurants.where((r) => r.isFeatured).toList();

      emit(FeaturedRestaurantsLoaded(restaurants: featured));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onNearbyRestaurantsRequested(
    NearbyRestaurantsRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Filter by radius
      final nearby = _sampleRestaurants
          .where((r) => (r.distance ?? 0) <= event.radiusKm)
          .toList();

      emit(RestaurantsLoaded(
        restaurants: nearby,
        hasMore: false,
      ));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  Future<void> _onReorderRequested(
    ReorderRequested event,
    Emitter<FoodState> emit,
  ) async {
    try {
      // Load previous order and add items to cart
      await Future.delayed(const Duration(milliseconds: 500));

      // In real app, fetch order details and add items to cart
      emit(CartState(
        items: [
          CartItem(
            id: _uuid.v4(),
            menuItem: _sampleMenu.first.items.first,
            quantity: 2,
          ),
        ],
        restaurant: _sampleRestaurants.first,
      ));
    } catch (e) {
      emit(FoodError(message: e.toString()));
    }
  }

  /// Get current cart state
  CartState get cartState => CartState(
        items: List.from(_cartItems),
        restaurant: _cartRestaurant,
        promoCode: _promoCode,
        discount: _discount,
      );
}
