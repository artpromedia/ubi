/// Food Order Entity
///
/// Domain entities for food ordering.
library;

import 'package:equatable/equatable.dart';

import 'location.dart';

/// Status of a food order
enum FoodOrderStatus {
  pending('pending', 'Order Pending'),
  confirmed('confirmed', 'Order Confirmed'),
  preparing('preparing', 'Preparing'),
  ready('ready', 'Ready for Pickup'),
  pickedUp('picked_up', 'Picked Up'),
  delivering('delivering', 'On the Way'),
  delivered('delivered', 'Delivered'),
  cancelled('cancelled', 'Cancelled');

  const FoodOrderStatus(this.value, this.displayName);

  final String value;
  final String displayName;

  bool get isActive => ![delivered, cancelled].contains(this);
  bool get canCancel => [pending, confirmed, preparing].contains(this);
}

/// Food order entity
class FoodOrder extends Equatable {
  const FoodOrder({
    required this.id,
    required this.status,
    required this.restaurantId,
    required this.restaurantName,
    required this.items,
    required this.deliveryAddress,
    required this.deliveryLocation,
    required this.subtotal,
    required this.deliveryFee,
    required this.serviceFee,
    required this.total,
    required this.currency,
    required this.createdAt,
    this.restaurantImageUrl,
    this.discount,
    this.tax,
    this.tip,
    this.paymentMethodId,
    this.paymentStatus,
    this.driver,
    this.estimatedDeliveryTime,
    this.actualDeliveryTime,
    this.notes,
    this.isContactless = false,
    this.scheduledTime,
    this.preparedAt,
    this.pickedUpAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancellationReason,
    this.rating,
  });

  final String id;
  final FoodOrderStatus status;
  final String restaurantId;
  final String restaurantName;
  final List<FoodOrderItem> items;
  final String deliveryAddress;
  final GeoLocation deliveryLocation;
  final double subtotal;
  final double deliveryFee;
  final double serviceFee;
  final double total;
  final String currency;
  final DateTime createdAt;
  final String? restaurantImageUrl;
  final double? discount;
  final double? tax;
  final double? tip;
  final String? paymentMethodId;
  final String? paymentStatus;
  final DeliveryPerson? driver;
  final DateTime? estimatedDeliveryTime;
  final DateTime? actualDeliveryTime;
  final String? notes;
  final bool isContactless;
  final DateTime? scheduledTime;
  final DateTime? preparedAt;
  final DateTime? pickedUpAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final int? rating;

  /// Number of items in the order
  int get itemCount => items.fold(0, (sum, item) => sum + item.quantity);

  /// Whether the order can be cancelled
  bool get canCancel => status.canCancel;

  /// Whether the order is active
  bool get isActive => status.isActive;

  /// Estimated time remaining for delivery
  Duration? get estimatedTimeRemaining {
    if (estimatedDeliveryTime == null) return null;
    final remaining = estimatedDeliveryTime!.difference(DateTime.now());
    return remaining.isNegative ? Duration.zero : remaining;
  }

  @override
  List<Object?> get props => [
        id,
        status,
        restaurantId,
        restaurantName,
        items,
        deliveryAddress,
        deliveryLocation,
        subtotal,
        deliveryFee,
        serviceFee,
        total,
        currency,
        createdAt,
      ];

  FoodOrder copyWith({
    String? id,
    FoodOrderStatus? status,
    String? restaurantId,
    String? restaurantName,
    List<FoodOrderItem>? items,
    String? deliveryAddress,
    GeoLocation? deliveryLocation,
    double? subtotal,
    double? deliveryFee,
    double? serviceFee,
    double? total,
    String? currency,
    DateTime? createdAt,
    String? restaurantImageUrl,
    double? discount,
    double? tax,
    double? tip,
    String? paymentMethodId,
    String? paymentStatus,
    DeliveryPerson? driver,
    DateTime? estimatedDeliveryTime,
    DateTime? actualDeliveryTime,
    String? notes,
    bool? isContactless,
    DateTime? scheduledTime,
    DateTime? preparedAt,
    DateTime? pickedUpAt,
    DateTime? deliveredAt,
    DateTime? cancelledAt,
    String? cancellationReason,
    int? rating,
  }) {
    return FoodOrder(
      id: id ?? this.id,
      status: status ?? this.status,
      restaurantId: restaurantId ?? this.restaurantId,
      restaurantName: restaurantName ?? this.restaurantName,
      items: items ?? this.items,
      deliveryAddress: deliveryAddress ?? this.deliveryAddress,
      deliveryLocation: deliveryLocation ?? this.deliveryLocation,
      subtotal: subtotal ?? this.subtotal,
      deliveryFee: deliveryFee ?? this.deliveryFee,
      serviceFee: serviceFee ?? this.serviceFee,
      total: total ?? this.total,
      currency: currency ?? this.currency,
      createdAt: createdAt ?? this.createdAt,
      restaurantImageUrl: restaurantImageUrl ?? this.restaurantImageUrl,
      discount: discount ?? this.discount,
      tax: tax ?? this.tax,
      tip: tip ?? this.tip,
      paymentMethodId: paymentMethodId ?? this.paymentMethodId,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      driver: driver ?? this.driver,
      estimatedDeliveryTime: estimatedDeliveryTime ?? this.estimatedDeliveryTime,
      actualDeliveryTime: actualDeliveryTime ?? this.actualDeliveryTime,
      notes: notes ?? this.notes,
      isContactless: isContactless ?? this.isContactless,
      scheduledTime: scheduledTime ?? this.scheduledTime,
      preparedAt: preparedAt ?? this.preparedAt,
      pickedUpAt: pickedUpAt ?? this.pickedUpAt,
      deliveredAt: deliveredAt ?? this.deliveredAt,
      cancelledAt: cancelledAt ?? this.cancelledAt,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      rating: rating ?? this.rating,
    );
  }
}

/// Item in a food order
class FoodOrderItem extends Equatable {
  const FoodOrderItem({
    required this.id,
    required this.menuItemId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.totalPrice,
    this.imageUrl,
    this.customizations,
    this.specialInstructions,
  });

  final String id;
  final String menuItemId;
  final String name;
  final int quantity;
  final double unitPrice;
  final double totalPrice;
  final String? imageUrl;
  final List<String>? customizations;
  final String? specialInstructions;

  @override
  List<Object?> get props => [id, menuItemId, name, quantity, unitPrice, totalPrice];
}

/// Delivery person for food orders
class DeliveryPerson extends Equatable {
  const DeliveryPerson({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImageUrl,
    this.phoneNumber,
    this.rating,
    this.currentLocation,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String? profileImageUrl;
  final String? phoneNumber;
  final double? rating;
  final GeoLocation? currentLocation;

  String get fullName => '$firstName $lastName';

  @override
  List<Object?> get props => [id, firstName, lastName];
}

/// Restaurant entity
class Restaurant extends Equatable {
  const Restaurant({
    required this.id,
    required this.name,
    required this.address,
    required this.location,
    this.imageUrl,
    this.coverImageUrl,
    this.description,
    this.cuisines,
    this.rating,
    this.reviewCount,
    this.priceLevel,
    this.deliveryFee,
    this.deliveryTime,
    this.minOrder,
    this.isOpen = true,
    this.isFeatured = false,
    this.distance,
    this.phoneNumber,
    this.openingHours,
    this.features,
    this.tags,
  });

  final String id;
  final String name;
  final String address;
  final GeoLocation location;
  final String? imageUrl;
  final String? coverImageUrl;
  final String? description;
  final List<String>? cuisines;
  final double? rating;
  final int? reviewCount;
  final int? priceLevel;
  final double? deliveryFee;
  final int? deliveryTime;
  final double? minOrder;
  final bool isOpen;
  final bool isFeatured;
  final double? distance;
  final String? phoneNumber;
  final List<OpeningHours>? openingHours;
  final List<String>? features;
  final List<String>? tags;

  /// Price level display (e.g., "$$")
  String get priceLevelDisplay => '\$' * (priceLevel ?? 1);

  /// Delivery time display (e.g., "20-30 min")
  String? get deliveryTimeDisplay {
    if (deliveryTime == null) return null;
    final min = deliveryTime!;
    final max = min + 10;
    return '$min-$max min';
  }

  @override
  List<Object?> get props => [id, name, address, location];
}

/// Opening hours for a restaurant
class OpeningHours extends Equatable {
  const OpeningHours({
    required this.dayOfWeek,
    required this.openTime,
    required this.closeTime,
    this.isClosed = false,
  });

  final int dayOfWeek; // 0-6 (Sunday-Saturday)
  final String openTime; // HH:mm
  final String closeTime; // HH:mm
  final bool isClosed;

  /// Day name
  String get dayName {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek % 7];
  }

  /// Display string
  String get display => isClosed ? 'Closed' : '$openTime - $closeTime';

  @override
  List<Object?> get props => [dayOfWeek, openTime, closeTime, isClosed];
}

/// Menu item entity
class MenuItem extends Equatable {
  const MenuItem({
    required this.id,
    required this.name,
    required this.price,
    required this.currency,
    this.description,
    this.imageUrl,
    this.calories,
    this.preparationTime,
    this.isAvailable = true,
    this.isPopular = false,
    this.isVegetarian = false,
    this.isVegan = false,
    this.isGlutenFree = false,
    this.spiceLevel,
    this.allergens,
    this.customizations,
  });

  final String id;
  final String name;
  final double price;
  final String currency;
  final String? description;
  final String? imageUrl;
  final int? calories;
  final int? preparationTime;
  final bool isAvailable;
  final bool isPopular;
  final bool isVegetarian;
  final bool isVegan;
  final bool isGlutenFree;
  final int? spiceLevel;
  final List<String>? allergens;
  final List<CustomizationGroup>? customizations;

  @override
  List<Object?> get props => [id, name, price, currency];
}

/// Customization group for menu items
class CustomizationGroup extends Equatable {
  const CustomizationGroup({
    required this.id,
    required this.name,
    required this.options,
    this.isRequired = false,
    this.minSelections,
    this.maxSelections,
  });

  final String id;
  final String name;
  final List<CustomizationOption> options;
  final bool isRequired;
  final int? minSelections;
  final int? maxSelections;

  @override
  List<Object?> get props => [id, name, options];
}

/// Option within a customization group
class CustomizationOption extends Equatable {
  const CustomizationOption({
    required this.id,
    required this.name,
    this.price,
    this.isDefault = false,
  });

  final String id;
  final String name;
  final double? price;
  final bool isDefault;

  @override
  List<Object?> get props => [id, name, price];
}
