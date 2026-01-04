/// Order Collection
///
/// Isar collections for caching food orders, deliveries, and restaurants.
library;

import 'package:isar/isar.dart';

part 'order_collection.g.dart';

/// Cached food order entity
@collection
class CachedFoodOrder {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  // Status
  late String status;
  
  @Index()
  late bool isActive;

  // Restaurant
  late String restaurantId;
  late String restaurantName;
  String? restaurantImageUrl;

  // Delivery
  late double deliveryLatitude;
  late double deliveryLongitude;
  late String deliveryAddress;

  // Items (stored as JSON string)
  late String itemsJson;

  // Pricing
  late double subtotal;
  late double deliveryFee;
  late double serviceFee;
  double? discount;
  late double total;
  late String currency;
  double? tip;

  // Delivery person
  String? deliveryPersonId;
  String? deliveryPersonName;
  String? deliveryPersonPhotoUrl;
  String? deliveryPersonPhone;

  // Times
  DateTime? orderedAt;
  DateTime? confirmedAt;
  DateTime? preparingAt;
  DateTime? readyAt;
  DateTime? pickedUpAt;
  DateTime? deliveredAt;
  DateTime? cancelledAt;
  int? estimatedDeliveryMinutes;

  // Rating
  int? foodRating;
  int? deliveryRating;
  String? review;

  // Metadata
  @Index()
  DateTime? createdAt;
  DateTime cachedAt = DateTime.now();
}

/// Cached delivery (package delivery) entity
@collection
class CachedDelivery {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  // Status
  late String status;
  
  @Index()
  late bool isActive;

  // Pickup
  late double pickupLatitude;
  late double pickupLongitude;
  late String pickupAddress;
  late String pickupContactName;
  late String pickupContactPhone;

  // Dropoff
  late double dropoffLatitude;
  late double dropoffLongitude;
  late String dropoffAddress;
  late String dropoffContactName;
  late String dropoffContactPhone;

  // Package
  late String packageSize;
  String? packageDescription;

  // Pricing
  late double fare;
  late String currency;
  double? tip;

  // Courier
  String? courierId;
  String? courierName;
  String? courierPhotoUrl;
  String? courierPhone;

  // Times
  DateTime? requestedAt;
  DateTime? pickedUpAt;
  DateTime? deliveredAt;
  DateTime? cancelledAt;
  int? estimatedDurationMinutes;

  // Rating
  int? rating;
  String? review;

  // Metadata
  @Index()
  DateTime? createdAt;
  DateTime cachedAt = DateTime.now();
}

/// Cached restaurant entity
@collection
class CachedRestaurant {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  @Index()
  late String name;
  
  late String address;
  late double latitude;
  late double longitude;
  String? imageUrl;
  String? coverImageUrl;

  @Index()
  late String cuisine;
  String? description;

  // Status
  late bool isOpen;
  bool isFeatured = false;

  // Ratings
  late double rating;
  late int reviewCount;

  // Delivery info
  late double deliveryFee;
  late int minDeliveryTimeMinutes;
  late int maxDeliveryTimeMinutes;
  double? minimumOrder;

  // Price level (1-4)
  int priceLevel = 2;

  // Opening hours (stored as JSON)
  String? openingHoursJson;

  // Metadata
  DateTime cachedAt = DateTime.now();

  /// Delivery time display
  String get deliveryTimeDisplay => '$minDeliveryTimeMinutes-$maxDeliveryTimeMinutes min';

  /// Price level display
  String get priceLevelDisplay => '\$' * priceLevel;
}
