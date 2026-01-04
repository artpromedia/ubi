/// Food Service
///
/// API service for food ordering endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

import 'user_service.dart';

part 'food_service.g.dart';

/// Food API Service
///
/// Handles all food ordering API calls including:
/// - Restaurant discovery
/// - Menu browsing
/// - Order placement
/// - Order tracking
@RestApi()
abstract class FoodService {
  factory FoodService(Dio dio, {String baseUrl}) = _FoodService;

  // === Restaurant Discovery ===

  /// Get nearby restaurants
  @GET('/restaurants/nearby')
  Future<List<RestaurantDto>> getNearbyRestaurants(
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
    @Query('radius') double? radius,
    @Query('cuisine') String? cuisine,
    @Query('sortBy') String? sortBy,
    @Query('page') int? page,
    @Query('limit') int? limit,
  );

  /// Get featured restaurants
  @GET('/restaurants/featured')
  Future<List<RestaurantDto>> getFeaturedRestaurants(
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
  );

  /// Search restaurants
  @GET('/restaurants/search')
  Future<List<RestaurantDto>> searchRestaurants(
    @Query('query') String query,
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
    @Query('page') int? page,
    @Query('limit') int? limit,
  );

  /// Get restaurant by ID
  @GET('/restaurants/{id}')
  Future<RestaurantDetailDto> getRestaurantById(@Path('id') String id);

  /// Get restaurant menu
  @GET('/restaurants/{id}/menu')
  Future<List<MenuCategoryDto>> getRestaurantMenu(@Path('id') String id);

  /// Get restaurant reviews
  @GET('/restaurants/{id}/reviews')
  Future<PaginatedResponseDto<ReviewDto>> getRestaurantReviews(
    @Path('id') String id,
    @Query('page') int page,
    @Query('limit') int limit,
  );

  // === Orders ===

  /// Create food order
  @POST('/food-orders')
  Future<FoodOrderDto> createOrder(@Body() CreateFoodOrderDto request);

  /// Get order by ID
  @GET('/food-orders/{id}')
  Future<FoodOrderDto> getOrderById(@Path('id') String id);

  /// Cancel order
  @POST('/food-orders/{id}/cancel')
  Future<FoodOrderDto> cancelOrder(
    @Path('id') String id,
    @Body() CancelOrderDto request,
  );

  /// Rate order
  @POST('/food-orders/{id}/rate')
  Future<void> rateOrder(
    @Path('id') String id,
    @Body() RateOrderDto request,
  );

  /// Get active orders
  @GET('/food-orders/active')
  Future<List<FoodOrderDto>> getActiveOrders();

  /// Reorder (create order from previous order)
  @POST('/food-orders/{id}/reorder')
  Future<FoodOrderDto> reorder(@Path('id') String id);

  // === Cuisines & Categories ===

  /// Get all cuisine types
  @GET('/cuisines')
  Future<List<CuisineDto>> getCuisines();

  /// Get popular items
  @GET('/popular-items')
  Future<List<PopularItemDto>> getPopularItems(
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
  );
}

// === Restaurant DTOs ===

@JsonSerializable()
class RestaurantDto {
  const RestaurantDto({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.imageUrl,
    this.coverImageUrl,
    this.cuisines,
    this.rating,
    this.reviewCount,
    this.priceLevel,
    this.deliveryFee,
    this.deliveryTime,
    this.minOrder,
    this.isOpen,
    this.isFeatured,
    this.distance,
    this.tags,
  });

  factory RestaurantDto.fromJson(Map<String, dynamic> json) =>
      _$RestaurantDtoFromJson(json);

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? imageUrl;
  final String? coverImageUrl;
  final List<String>? cuisines;
  final double? rating;
  final int? reviewCount;
  final int? priceLevel; // 1-4
  final double? deliveryFee;
  final int? deliveryTime; // in minutes
  final double? minOrder;
  final bool? isOpen;
  final bool? isFeatured;
  final double? distance;
  final List<String>? tags;

  Map<String, dynamic> toJson() => _$RestaurantDtoToJson(this);
}

@JsonSerializable()
class RestaurantDetailDto {
  const RestaurantDetailDto({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
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
    this.isOpen,
    this.isFeatured,
    this.phoneNumber,
    this.openingHours,
    this.paymentMethods,
    this.features,
    this.tags,
  });

  factory RestaurantDetailDto.fromJson(Map<String, dynamic> json) =>
      _$RestaurantDetailDtoFromJson(json);

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
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
  final bool? isOpen;
  final bool? isFeatured;
  final String? phoneNumber;
  final List<OpeningHoursDto>? openingHours;
  final List<String>? paymentMethods;
  final List<String>? features;
  final List<String>? tags;

  Map<String, dynamic> toJson() => _$RestaurantDetailDtoToJson(this);
}

@JsonSerializable()
class OpeningHoursDto {
  const OpeningHoursDto({
    required this.dayOfWeek,
    required this.openTime,
    required this.closeTime,
    this.isClosed,
  });

  factory OpeningHoursDto.fromJson(Map<String, dynamic> json) =>
      _$OpeningHoursDtoFromJson(json);

  final int dayOfWeek; // 0-6 (Sunday-Saturday)
  final String openTime; // HH:mm
  final String closeTime; // HH:mm
  final bool? isClosed;

  Map<String, dynamic> toJson() => _$OpeningHoursDtoToJson(this);
}

// === Menu DTOs ===

@JsonSerializable()
class MenuCategoryDto {
  const MenuCategoryDto({
    required this.id,
    required this.name,
    required this.items,
    this.description,
    this.imageUrl,
    this.sortOrder,
  });

  factory MenuCategoryDto.fromJson(Map<String, dynamic> json) =>
      _$MenuCategoryDtoFromJson(json);

  final String id;
  final String name;
  final List<MenuItemDto> items;
  final String? description;
  final String? imageUrl;
  final int? sortOrder;

  Map<String, dynamic> toJson() => _$MenuCategoryDtoToJson(this);
}

@JsonSerializable()
class MenuItemDto {
  const MenuItemDto({
    required this.id,
    required this.name,
    required this.price,
    required this.currency,
    this.description,
    this.imageUrl,
    this.calories,
    this.preparationTime,
    this.isAvailable,
    this.isPopular,
    this.isVegetarian,
    this.isVegan,
    this.isGlutenFree,
    this.spiceLevel,
    this.allergens,
    this.customizations,
  });

  factory MenuItemDto.fromJson(Map<String, dynamic> json) =>
      _$MenuItemDtoFromJson(json);

  final String id;
  final String name;
  final double price;
  final String currency;
  final String? description;
  final String? imageUrl;
  final int? calories;
  final int? preparationTime;
  final bool? isAvailable;
  final bool? isPopular;
  final bool? isVegetarian;
  final bool? isVegan;
  final bool? isGlutenFree;
  final int? spiceLevel;
  final List<String>? allergens;
  final List<CustomizationGroupDto>? customizations;

  Map<String, dynamic> toJson() => _$MenuItemDtoToJson(this);
}

@JsonSerializable()
class CustomizationGroupDto {
  const CustomizationGroupDto({
    required this.id,
    required this.name,
    required this.options,
    this.isRequired,
    this.minSelections,
    this.maxSelections,
  });

  factory CustomizationGroupDto.fromJson(Map<String, dynamic> json) =>
      _$CustomizationGroupDtoFromJson(json);

  final String id;
  final String name;
  final List<CustomizationOptionDto> options;
  final bool? isRequired;
  final int? minSelections;
  final int? maxSelections;

  Map<String, dynamic> toJson() => _$CustomizationGroupDtoToJson(this);
}

@JsonSerializable()
class CustomizationOptionDto {
  const CustomizationOptionDto({
    required this.id,
    required this.name,
    this.price,
    this.isDefault,
  });

  factory CustomizationOptionDto.fromJson(Map<String, dynamic> json) =>
      _$CustomizationOptionDtoFromJson(json);

  final String id;
  final String name;
  final double? price;
  final bool? isDefault;

  Map<String, dynamic> toJson() => _$CustomizationOptionDtoToJson(this);
}

// === Order DTOs ===

@JsonSerializable()
class CreateFoodOrderDto {
  const CreateFoodOrderDto({
    required this.restaurantId,
    required this.items,
    required this.deliveryAddress,
    required this.deliveryLatitude,
    required this.deliveryLongitude,
    required this.paymentMethodId,
    this.notes,
    this.promoCode,
    this.scheduledTime,
    this.isContactless,
  });

  factory CreateFoodOrderDto.fromJson(Map<String, dynamic> json) =>
      _$CreateFoodOrderDtoFromJson(json);

  final String restaurantId;
  final List<OrderItemDto> items;
  final String deliveryAddress;
  final double deliveryLatitude;
  final double deliveryLongitude;
  final String paymentMethodId;
  final String? notes;
  final String? promoCode;
  final DateTime? scheduledTime;
  final bool? isContactless;

  Map<String, dynamic> toJson() => _$CreateFoodOrderDtoToJson(this);
}

@JsonSerializable()
class OrderItemDto {
  const OrderItemDto({
    required this.menuItemId,
    required this.quantity,
    this.customizations,
    this.specialInstructions,
  });

  factory OrderItemDto.fromJson(Map<String, dynamic> json) =>
      _$OrderItemDtoFromJson(json);

  final String menuItemId;
  final int quantity;
  final List<SelectedCustomizationDto>? customizations;
  final String? specialInstructions;

  Map<String, dynamic> toJson() => _$OrderItemDtoToJson(this);
}

@JsonSerializable()
class SelectedCustomizationDto {
  const SelectedCustomizationDto({
    required this.groupId,
    required this.optionIds,
  });

  factory SelectedCustomizationDto.fromJson(Map<String, dynamic> json) =>
      _$SelectedCustomizationDtoFromJson(json);

  final String groupId;
  final List<String> optionIds;

  Map<String, dynamic> toJson() => _$SelectedCustomizationDtoToJson(this);
}

@JsonSerializable()
class FoodOrderDto {
  const FoodOrderDto({
    required this.id,
    required this.status,
    required this.restaurantId,
    required this.restaurantName,
    required this.items,
    required this.deliveryAddress,
    required this.deliveryLatitude,
    required this.deliveryLongitude,
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
    this.isContactless,
    this.scheduledTime,
    this.preparedAt,
    this.pickedUpAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancellationReason,
    this.rating,
  });

  factory FoodOrderDto.fromJson(Map<String, dynamic> json) =>
      _$FoodOrderDtoFromJson(json);

  final String id;
  final String status;
  final String restaurantId;
  final String restaurantName;
  final List<FoodOrderItemDto> items;
  final String deliveryAddress;
  final double deliveryLatitude;
  final double deliveryLongitude;
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
  final DeliveryDriverDto? driver;
  final DateTime? estimatedDeliveryTime;
  final DateTime? actualDeliveryTime;
  final String? notes;
  final bool? isContactless;
  final DateTime? scheduledTime;
  final DateTime? preparedAt;
  final DateTime? pickedUpAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final int? rating;

  Map<String, dynamic> toJson() => _$FoodOrderDtoToJson(this);
}

@JsonSerializable()
class FoodOrderItemDto {
  const FoodOrderItemDto({
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

  factory FoodOrderItemDto.fromJson(Map<String, dynamic> json) =>
      _$FoodOrderItemDtoFromJson(json);

  final String id;
  final String menuItemId;
  final String name;
  final int quantity;
  final double unitPrice;
  final double totalPrice;
  final String? imageUrl;
  final List<String>? customizations;
  final String? specialInstructions;

  Map<String, dynamic> toJson() => _$FoodOrderItemDtoToJson(this);
}

@JsonSerializable()
class DeliveryDriverDto {
  const DeliveryDriverDto({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImageUrl,
    this.phoneNumber,
    this.rating,
    this.currentLatitude,
    this.currentLongitude,
    this.heading,
  });

  factory DeliveryDriverDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryDriverDtoFromJson(json);

  final String id;
  final String firstName;
  final String lastName;
  final String? profileImageUrl;
  final String? phoneNumber;
  final double? rating;
  final double? currentLatitude;
  final double? currentLongitude;
  final double? heading;

  String get fullName => '$firstName $lastName';

  Map<String, dynamic> toJson() => _$DeliveryDriverDtoToJson(this);
}

// === Cancel & Rate DTOs ===

@JsonSerializable()
class CancelOrderDto {
  const CancelOrderDto({
    required this.reason,
    this.otherReason,
  });

  factory CancelOrderDto.fromJson(Map<String, dynamic> json) =>
      _$CancelOrderDtoFromJson(json);

  final String reason;
  final String? otherReason;

  Map<String, dynamic> toJson() => _$CancelOrderDtoToJson(this);
}

@JsonSerializable()
class RateOrderDto {
  const RateOrderDto({
    required this.foodRating,
    this.deliveryRating,
    this.comment,
    this.tags,
  });

  factory RateOrderDto.fromJson(Map<String, dynamic> json) =>
      _$RateOrderDtoFromJson(json);

  final int foodRating;
  final int? deliveryRating;
  final String? comment;
  final List<String>? tags;

  Map<String, dynamic> toJson() => _$RateOrderDtoToJson(this);
}

// === Review DTOs ===

@JsonSerializable()
class ReviewDto {
  const ReviewDto({
    required this.id,
    required this.rating,
    required this.createdAt,
    this.userName,
    this.userImageUrl,
    this.comment,
    this.tags,
    this.response,
  });

  factory ReviewDto.fromJson(Map<String, dynamic> json) =>
      _$ReviewDtoFromJson(json);

  final String id;
  final int rating;
  final DateTime createdAt;
  final String? userName;
  final String? userImageUrl;
  final String? comment;
  final List<String>? tags;
  final String? response;

  Map<String, dynamic> toJson() => _$ReviewDtoToJson(this);
}

// === Cuisine & Category DTOs ===

@JsonSerializable()
class CuisineDto {
  const CuisineDto({
    required this.id,
    required this.name,
    this.imageUrl,
    this.restaurantCount,
  });

  factory CuisineDto.fromJson(Map<String, dynamic> json) =>
      _$CuisineDtoFromJson(json);

  final String id;
  final String name;
  final String? imageUrl;
  final int? restaurantCount;

  Map<String, dynamic> toJson() => _$CuisineDtoToJson(this);
}

@JsonSerializable()
class PopularItemDto {
  const PopularItemDto({
    required this.id,
    required this.name,
    required this.price,
    required this.currency,
    required this.restaurantId,
    required this.restaurantName,
    this.imageUrl,
    this.rating,
    this.orderCount,
  });

  factory PopularItemDto.fromJson(Map<String, dynamic> json) =>
      _$PopularItemDtoFromJson(json);

  final String id;
  final String name;
  final double price;
  final String currency;
  final String restaurantId;
  final String restaurantName;
  final String? imageUrl;
  final double? rating;
  final int? orderCount;

  Map<String, dynamic> toJson() => _$PopularItemDtoToJson(this);
}
