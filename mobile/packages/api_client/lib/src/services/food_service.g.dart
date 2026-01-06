// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'food_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RestaurantDto _$RestaurantDtoFromJson(Map<String, dynamic> json) =>
    RestaurantDto(
      id: json['id'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      imageUrl: json['imageUrl'] as String?,
      coverImageUrl: json['coverImageUrl'] as String?,
      cuisines: (json['cuisines'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      rating: (json['rating'] as num?)?.toDouble(),
      reviewCount: (json['reviewCount'] as num?)?.toInt(),
      priceLevel: (json['priceLevel'] as num?)?.toInt(),
      deliveryFee: (json['deliveryFee'] as num?)?.toDouble(),
      deliveryTime: (json['deliveryTime'] as num?)?.toInt(),
      minOrder: (json['minOrder'] as num?)?.toDouble(),
      isOpen: json['isOpen'] as bool?,
      isFeatured: json['isFeatured'] as bool?,
      distance: (json['distance'] as num?)?.toDouble(),
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$RestaurantDtoToJson(RestaurantDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'imageUrl': instance.imageUrl,
      'coverImageUrl': instance.coverImageUrl,
      'cuisines': instance.cuisines,
      'rating': instance.rating,
      'reviewCount': instance.reviewCount,
      'priceLevel': instance.priceLevel,
      'deliveryFee': instance.deliveryFee,
      'deliveryTime': instance.deliveryTime,
      'minOrder': instance.minOrder,
      'isOpen': instance.isOpen,
      'isFeatured': instance.isFeatured,
      'distance': instance.distance,
      'tags': instance.tags,
    };

RestaurantDetailDto _$RestaurantDetailDtoFromJson(Map<String, dynamic> json) =>
    RestaurantDetailDto(
      id: json['id'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      imageUrl: json['imageUrl'] as String?,
      coverImageUrl: json['coverImageUrl'] as String?,
      description: json['description'] as String?,
      cuisines: (json['cuisines'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      rating: (json['rating'] as num?)?.toDouble(),
      reviewCount: (json['reviewCount'] as num?)?.toInt(),
      priceLevel: (json['priceLevel'] as num?)?.toInt(),
      deliveryFee: (json['deliveryFee'] as num?)?.toDouble(),
      deliveryTime: (json['deliveryTime'] as num?)?.toInt(),
      minOrder: (json['minOrder'] as num?)?.toDouble(),
      isOpen: json['isOpen'] as bool?,
      isFeatured: json['isFeatured'] as bool?,
      phoneNumber: json['phoneNumber'] as String?,
      openingHours: (json['openingHours'] as List<dynamic>?)
          ?.map((e) => OpeningHoursDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      paymentMethods: (json['paymentMethods'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      features: (json['features'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$RestaurantDetailDtoToJson(
        RestaurantDetailDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'imageUrl': instance.imageUrl,
      'coverImageUrl': instance.coverImageUrl,
      'description': instance.description,
      'cuisines': instance.cuisines,
      'rating': instance.rating,
      'reviewCount': instance.reviewCount,
      'priceLevel': instance.priceLevel,
      'deliveryFee': instance.deliveryFee,
      'deliveryTime': instance.deliveryTime,
      'minOrder': instance.minOrder,
      'isOpen': instance.isOpen,
      'isFeatured': instance.isFeatured,
      'phoneNumber': instance.phoneNumber,
      'openingHours': instance.openingHours,
      'paymentMethods': instance.paymentMethods,
      'features': instance.features,
      'tags': instance.tags,
    };

OpeningHoursDto _$OpeningHoursDtoFromJson(Map<String, dynamic> json) =>
    OpeningHoursDto(
      dayOfWeek: (json['dayOfWeek'] as num).toInt(),
      openTime: json['openTime'] as String,
      closeTime: json['closeTime'] as String,
      isClosed: json['isClosed'] as bool?,
    );

Map<String, dynamic> _$OpeningHoursDtoToJson(OpeningHoursDto instance) =>
    <String, dynamic>{
      'dayOfWeek': instance.dayOfWeek,
      'openTime': instance.openTime,
      'closeTime': instance.closeTime,
      'isClosed': instance.isClosed,
    };

MenuCategoryDto _$MenuCategoryDtoFromJson(Map<String, dynamic> json) =>
    MenuCategoryDto(
      id: json['id'] as String,
      name: json['name'] as String,
      items: (json['items'] as List<dynamic>)
          .map((e) => MenuItemDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      description: json['description'] as String?,
      imageUrl: json['imageUrl'] as String?,
      sortOrder: (json['sortOrder'] as num?)?.toInt(),
    );

Map<String, dynamic> _$MenuCategoryDtoToJson(MenuCategoryDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'items': instance.items,
      'description': instance.description,
      'imageUrl': instance.imageUrl,
      'sortOrder': instance.sortOrder,
    };

MenuItemDto _$MenuItemDtoFromJson(Map<String, dynamic> json) => MenuItemDto(
      id: json['id'] as String,
      name: json['name'] as String,
      price: (json['price'] as num).toDouble(),
      currency: json['currency'] as String,
      description: json['description'] as String?,
      imageUrl: json['imageUrl'] as String?,
      calories: (json['calories'] as num?)?.toInt(),
      preparationTime: (json['preparationTime'] as num?)?.toInt(),
      isAvailable: json['isAvailable'] as bool?,
      isPopular: json['isPopular'] as bool?,
      isVegetarian: json['isVegetarian'] as bool?,
      isVegan: json['isVegan'] as bool?,
      isGlutenFree: json['isGlutenFree'] as bool?,
      spiceLevel: (json['spiceLevel'] as num?)?.toInt(),
      allergens: (json['allergens'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      customizations: (json['customizations'] as List<dynamic>?)
          ?.map(
              (e) => CustomizationGroupDto.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$MenuItemDtoToJson(MenuItemDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'price': instance.price,
      'currency': instance.currency,
      'description': instance.description,
      'imageUrl': instance.imageUrl,
      'calories': instance.calories,
      'preparationTime': instance.preparationTime,
      'isAvailable': instance.isAvailable,
      'isPopular': instance.isPopular,
      'isVegetarian': instance.isVegetarian,
      'isVegan': instance.isVegan,
      'isGlutenFree': instance.isGlutenFree,
      'spiceLevel': instance.spiceLevel,
      'allergens': instance.allergens,
      'customizations': instance.customizations,
    };

CustomizationGroupDto _$CustomizationGroupDtoFromJson(
        Map<String, dynamic> json) =>
    CustomizationGroupDto(
      id: json['id'] as String,
      name: json['name'] as String,
      options: (json['options'] as List<dynamic>)
          .map(
              (e) => CustomizationOptionDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      isRequired: json['isRequired'] as bool?,
      minSelections: (json['minSelections'] as num?)?.toInt(),
      maxSelections: (json['maxSelections'] as num?)?.toInt(),
    );

Map<String, dynamic> _$CustomizationGroupDtoToJson(
        CustomizationGroupDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'options': instance.options,
      'isRequired': instance.isRequired,
      'minSelections': instance.minSelections,
      'maxSelections': instance.maxSelections,
    };

CustomizationOptionDto _$CustomizationOptionDtoFromJson(
        Map<String, dynamic> json) =>
    CustomizationOptionDto(
      id: json['id'] as String,
      name: json['name'] as String,
      price: (json['price'] as num?)?.toDouble(),
      isDefault: json['isDefault'] as bool?,
    );

Map<String, dynamic> _$CustomizationOptionDtoToJson(
        CustomizationOptionDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'price': instance.price,
      'isDefault': instance.isDefault,
    };

CreateFoodOrderDto _$CreateFoodOrderDtoFromJson(Map<String, dynamic> json) =>
    CreateFoodOrderDto(
      restaurantId: json['restaurantId'] as String,
      items: (json['items'] as List<dynamic>)
          .map((e) => OrderItemDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      deliveryAddress: json['deliveryAddress'] as String,
      deliveryLatitude: (json['deliveryLatitude'] as num).toDouble(),
      deliveryLongitude: (json['deliveryLongitude'] as num).toDouble(),
      paymentMethodId: json['paymentMethodId'] as String,
      notes: json['notes'] as String?,
      promoCode: json['promoCode'] as String?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      isContactless: json['isContactless'] as bool?,
    );

Map<String, dynamic> _$CreateFoodOrderDtoToJson(CreateFoodOrderDto instance) =>
    <String, dynamic>{
      'restaurantId': instance.restaurantId,
      'items': instance.items,
      'deliveryAddress': instance.deliveryAddress,
      'deliveryLatitude': instance.deliveryLatitude,
      'deliveryLongitude': instance.deliveryLongitude,
      'paymentMethodId': instance.paymentMethodId,
      'notes': instance.notes,
      'promoCode': instance.promoCode,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'isContactless': instance.isContactless,
    };

OrderItemDto _$OrderItemDtoFromJson(Map<String, dynamic> json) => OrderItemDto(
      menuItemId: json['menuItemId'] as String,
      quantity: (json['quantity'] as num).toInt(),
      customizations: (json['customizations'] as List<dynamic>?)
          ?.map((e) =>
              SelectedCustomizationDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      specialInstructions: json['specialInstructions'] as String?,
    );

Map<String, dynamic> _$OrderItemDtoToJson(OrderItemDto instance) =>
    <String, dynamic>{
      'menuItemId': instance.menuItemId,
      'quantity': instance.quantity,
      'customizations': instance.customizations,
      'specialInstructions': instance.specialInstructions,
    };

SelectedCustomizationDto _$SelectedCustomizationDtoFromJson(
        Map<String, dynamic> json) =>
    SelectedCustomizationDto(
      groupId: json['groupId'] as String,
      optionIds:
          (json['optionIds'] as List<dynamic>).map((e) => e as String).toList(),
    );

Map<String, dynamic> _$SelectedCustomizationDtoToJson(
        SelectedCustomizationDto instance) =>
    <String, dynamic>{
      'groupId': instance.groupId,
      'optionIds': instance.optionIds,
    };

FoodOrderDto _$FoodOrderDtoFromJson(Map<String, dynamic> json) => FoodOrderDto(
      id: json['id'] as String,
      status: json['status'] as String,
      restaurantId: json['restaurantId'] as String,
      restaurantName: json['restaurantName'] as String,
      items: (json['items'] as List<dynamic>)
          .map((e) => FoodOrderItemDto.fromJson(e as Map<String, dynamic>))
          .toList(),
      deliveryAddress: json['deliveryAddress'] as String,
      deliveryLatitude: (json['deliveryLatitude'] as num).toDouble(),
      deliveryLongitude: (json['deliveryLongitude'] as num).toDouble(),
      subtotal: (json['subtotal'] as num).toDouble(),
      deliveryFee: (json['deliveryFee'] as num).toDouble(),
      serviceFee: (json['serviceFee'] as num).toDouble(),
      total: (json['total'] as num).toDouble(),
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      restaurantImageUrl: json['restaurantImageUrl'] as String?,
      discount: (json['discount'] as num?)?.toDouble(),
      tax: (json['tax'] as num?)?.toDouble(),
      tip: (json['tip'] as num?)?.toDouble(),
      paymentMethodId: json['paymentMethodId'] as String?,
      paymentStatus: json['paymentStatus'] as String?,
      driver: json['driver'] == null
          ? null
          : DeliveryDriverDto.fromJson(json['driver'] as Map<String, dynamic>),
      estimatedDeliveryTime: json['estimatedDeliveryTime'] == null
          ? null
          : DateTime.parse(json['estimatedDeliveryTime'] as String),
      actualDeliveryTime: json['actualDeliveryTime'] == null
          ? null
          : DateTime.parse(json['actualDeliveryTime'] as String),
      notes: json['notes'] as String?,
      isContactless: json['isContactless'] as bool?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      preparedAt: json['preparedAt'] == null
          ? null
          : DateTime.parse(json['preparedAt'] as String),
      pickedUpAt: json['pickedUpAt'] == null
          ? null
          : DateTime.parse(json['pickedUpAt'] as String),
      deliveredAt: json['deliveredAt'] == null
          ? null
          : DateTime.parse(json['deliveredAt'] as String),
      cancelledAt: json['cancelledAt'] == null
          ? null
          : DateTime.parse(json['cancelledAt'] as String),
      cancellationReason: json['cancellationReason'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
    );

Map<String, dynamic> _$FoodOrderDtoToJson(FoodOrderDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'restaurantId': instance.restaurantId,
      'restaurantName': instance.restaurantName,
      'items': instance.items,
      'deliveryAddress': instance.deliveryAddress,
      'deliveryLatitude': instance.deliveryLatitude,
      'deliveryLongitude': instance.deliveryLongitude,
      'subtotal': instance.subtotal,
      'deliveryFee': instance.deliveryFee,
      'serviceFee': instance.serviceFee,
      'total': instance.total,
      'currency': instance.currency,
      'createdAt': instance.createdAt.toIso8601String(),
      'restaurantImageUrl': instance.restaurantImageUrl,
      'discount': instance.discount,
      'tax': instance.tax,
      'tip': instance.tip,
      'paymentMethodId': instance.paymentMethodId,
      'paymentStatus': instance.paymentStatus,
      'driver': instance.driver,
      'estimatedDeliveryTime':
          instance.estimatedDeliveryTime?.toIso8601String(),
      'actualDeliveryTime': instance.actualDeliveryTime?.toIso8601String(),
      'notes': instance.notes,
      'isContactless': instance.isContactless,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'preparedAt': instance.preparedAt?.toIso8601String(),
      'pickedUpAt': instance.pickedUpAt?.toIso8601String(),
      'deliveredAt': instance.deliveredAt?.toIso8601String(),
      'cancelledAt': instance.cancelledAt?.toIso8601String(),
      'cancellationReason': instance.cancellationReason,
      'rating': instance.rating,
    };

FoodOrderItemDto _$FoodOrderItemDtoFromJson(Map<String, dynamic> json) =>
    FoodOrderItemDto(
      id: json['id'] as String,
      menuItemId: json['menuItemId'] as String,
      name: json['name'] as String,
      quantity: (json['quantity'] as num).toInt(),
      unitPrice: (json['unitPrice'] as num).toDouble(),
      totalPrice: (json['totalPrice'] as num).toDouble(),
      imageUrl: json['imageUrl'] as String?,
      customizations: (json['customizations'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      specialInstructions: json['specialInstructions'] as String?,
    );

Map<String, dynamic> _$FoodOrderItemDtoToJson(FoodOrderItemDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'menuItemId': instance.menuItemId,
      'name': instance.name,
      'quantity': instance.quantity,
      'unitPrice': instance.unitPrice,
      'totalPrice': instance.totalPrice,
      'imageUrl': instance.imageUrl,
      'customizations': instance.customizations,
      'specialInstructions': instance.specialInstructions,
    };

DeliveryDriverDto _$DeliveryDriverDtoFromJson(Map<String, dynamic> json) =>
    DeliveryDriverDto(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      profileImageUrl: json['profileImageUrl'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      currentLatitude: (json['currentLatitude'] as num?)?.toDouble(),
      currentLongitude: (json['currentLongitude'] as num?)?.toDouble(),
      heading: (json['heading'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$DeliveryDriverDtoToJson(DeliveryDriverDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'firstName': instance.firstName,
      'lastName': instance.lastName,
      'profileImageUrl': instance.profileImageUrl,
      'phoneNumber': instance.phoneNumber,
      'rating': instance.rating,
      'currentLatitude': instance.currentLatitude,
      'currentLongitude': instance.currentLongitude,
      'heading': instance.heading,
    };

CancelOrderDto _$CancelOrderDtoFromJson(Map<String, dynamic> json) =>
    CancelOrderDto(
      reason: json['reason'] as String,
      otherReason: json['otherReason'] as String?,
    );

Map<String, dynamic> _$CancelOrderDtoToJson(CancelOrderDto instance) =>
    <String, dynamic>{
      'reason': instance.reason,
      'otherReason': instance.otherReason,
    };

RateOrderDto _$RateOrderDtoFromJson(Map<String, dynamic> json) => RateOrderDto(
      foodRating: (json['foodRating'] as num).toInt(),
      deliveryRating: (json['deliveryRating'] as num?)?.toInt(),
      comment: json['comment'] as String?,
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$RateOrderDtoToJson(RateOrderDto instance) =>
    <String, dynamic>{
      'foodRating': instance.foodRating,
      'deliveryRating': instance.deliveryRating,
      'comment': instance.comment,
      'tags': instance.tags,
    };

ReviewDto _$ReviewDtoFromJson(Map<String, dynamic> json) => ReviewDto(
      id: json['id'] as String,
      rating: (json['rating'] as num).toInt(),
      createdAt: DateTime.parse(json['createdAt'] as String),
      userName: json['userName'] as String?,
      userImageUrl: json['userImageUrl'] as String?,
      comment: json['comment'] as String?,
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
      response: json['response'] as String?,
    );

Map<String, dynamic> _$ReviewDtoToJson(ReviewDto instance) => <String, dynamic>{
      'id': instance.id,
      'rating': instance.rating,
      'createdAt': instance.createdAt.toIso8601String(),
      'userName': instance.userName,
      'userImageUrl': instance.userImageUrl,
      'comment': instance.comment,
      'tags': instance.tags,
      'response': instance.response,
    };

CuisineDto _$CuisineDtoFromJson(Map<String, dynamic> json) => CuisineDto(
      id: json['id'] as String,
      name: json['name'] as String,
      imageUrl: json['imageUrl'] as String?,
      restaurantCount: (json['restaurantCount'] as num?)?.toInt(),
    );

Map<String, dynamic> _$CuisineDtoToJson(CuisineDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'imageUrl': instance.imageUrl,
      'restaurantCount': instance.restaurantCount,
    };

PopularItemDto _$PopularItemDtoFromJson(Map<String, dynamic> json) =>
    PopularItemDto(
      id: json['id'] as String,
      name: json['name'] as String,
      price: (json['price'] as num).toDouble(),
      currency: json['currency'] as String,
      restaurantId: json['restaurantId'] as String,
      restaurantName: json['restaurantName'] as String,
      imageUrl: json['imageUrl'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      orderCount: (json['orderCount'] as num?)?.toInt(),
    );

Map<String, dynamic> _$PopularItemDtoToJson(PopularItemDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'price': instance.price,
      'currency': instance.currency,
      'restaurantId': instance.restaurantId,
      'restaurantName': instance.restaurantName,
      'imageUrl': instance.imageUrl,
      'rating': instance.rating,
      'orderCount': instance.orderCount,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _FoodService implements FoodService {
  _FoodService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<List<RestaurantDto>> getNearbyRestaurants(
    double latitude,
    double longitude,
    double? radius,
    String? cuisine,
    String? sortBy,
    int? page,
    int? limit,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'latitude': latitude,
      r'longitude': longitude,
      r'radius': radius,
      r'cuisine': cuisine,
      r'sortBy': sortBy,
      r'page': page,
      r'limit': limit,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<RestaurantDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/nearby',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<RestaurantDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => RestaurantDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<RestaurantDto>> getFeaturedRestaurants(
    double latitude,
    double longitude,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'latitude': latitude,
      r'longitude': longitude,
    };
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<RestaurantDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/featured',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<RestaurantDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => RestaurantDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<RestaurantDto>> searchRestaurants(
    String query,
    double latitude,
    double longitude,
    int? page,
    int? limit,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'query': query,
      r'latitude': latitude,
      r'longitude': longitude,
      r'page': page,
      r'limit': limit,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<RestaurantDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/search',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<RestaurantDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => RestaurantDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<RestaurantDetailDto> getRestaurantById(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<RestaurantDetailDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late RestaurantDetailDto _value;
    try {
      _value = RestaurantDetailDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<MenuCategoryDto>> getRestaurantMenu(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<MenuCategoryDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/${id}/menu',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<MenuCategoryDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              MenuCategoryDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaginatedResponseDto<ReviewDto>> getRestaurantReviews(
    String id,
    int page,
    int limit,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'page': page,
      r'limit': limit,
    };
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<PaginatedResponseDto<ReviewDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/restaurants/${id}/reviews',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<ReviewDto> _value;
    try {
      _value = PaginatedResponseDto<ReviewDto>.fromJson(
        _result.data!,
        (json) => ReviewDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<FoodOrderDto> createOrder(CreateFoodOrderDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<FoodOrderDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late FoodOrderDto _value;
    try {
      _value = FoodOrderDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<FoodOrderDto> getOrderById(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<FoodOrderDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late FoodOrderDto _value;
    try {
      _value = FoodOrderDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<FoodOrderDto> cancelOrder(
    String id,
    CancelOrderDto request,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<FoodOrderDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders/${id}/cancel',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late FoodOrderDto _value;
    try {
      _value = FoodOrderDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> rateOrder(
    String id,
    RateOrderDto request,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<void>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders/${id}/rate',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    await _dio.fetch<void>(_options);
  }

  @override
  Future<List<FoodOrderDto>> getActiveOrders() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<FoodOrderDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders/active',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<FoodOrderDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => FoodOrderDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<FoodOrderDto> reorder(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<FoodOrderDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/food-orders/${id}/reorder',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late FoodOrderDto _value;
    try {
      _value = FoodOrderDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<CuisineDto>> getCuisines() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<CuisineDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/cuisines',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<CuisineDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => CuisineDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<PopularItemDto>> getPopularItems(
    double latitude,
    double longitude,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'latitude': latitude,
      r'longitude': longitude,
    };
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<PopularItemDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/popular-items',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<PopularItemDto> _value;
    try {
      _value = _result.data!
          .map(
              (dynamic i) => PopularItemDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  RequestOptions _setStreamType<T>(RequestOptions requestOptions) {
    if (T != dynamic &&
        !(requestOptions.responseType == ResponseType.bytes ||
            requestOptions.responseType == ResponseType.stream)) {
      if (T == String) {
        requestOptions.responseType = ResponseType.plain;
      } else {
        requestOptions.responseType = ResponseType.json;
      }
    }
    return requestOptions;
  }

  String _combineBaseUrls(
    String dioBaseUrl,
    String? baseUrl,
  ) {
    if (baseUrl == null || baseUrl.trim().isEmpty) {
      return dioBaseUrl;
    }

    final url = Uri.parse(baseUrl);

    if (url.isAbsolute) {
      return url.toString();
    }

    return Uri.parse(dioBaseUrl).resolveUri(url).toString();
  }
}
