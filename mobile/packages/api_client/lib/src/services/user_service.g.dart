// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'user_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UserDto _$UserDtoFromJson(Map<String, dynamic> json) => UserDto(
      id: json['id'] as String,
      phoneNumber: json['phoneNumber'] as String,
      email: json['email'] as String?,
      firstName: json['firstName'] as String?,
      lastName: json['lastName'] as String?,
      profileImageUrl: json['profileImageUrl'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      totalRides: (json['totalRides'] as num?)?.toInt(),
      totalOrders: (json['totalOrders'] as num?)?.toInt(),
      isVerified: json['isVerified'] as bool?,
      role: json['role'] as String?,
      createdAt: json['createdAt'] == null
          ? null
          : DateTime.parse(json['createdAt'] as String),
      updatedAt: json['updatedAt'] == null
          ? null
          : DateTime.parse(json['updatedAt'] as String),
    );

Map<String, dynamic> _$UserDtoToJson(UserDto instance) => <String, dynamic>{
      'id': instance.id,
      'phoneNumber': instance.phoneNumber,
      'email': instance.email,
      'firstName': instance.firstName,
      'lastName': instance.lastName,
      'profileImageUrl': instance.profileImageUrl,
      'rating': instance.rating,
      'totalRides': instance.totalRides,
      'totalOrders': instance.totalOrders,
      'isVerified': instance.isVerified,
      'role': instance.role,
      'createdAt': instance.createdAt?.toIso8601String(),
      'updatedAt': instance.updatedAt?.toIso8601String(),
    };

UpdateProfileDto _$UpdateProfileDtoFromJson(Map<String, dynamic> json) =>
    UpdateProfileDto(
      firstName: json['firstName'] as String?,
      lastName: json['lastName'] as String?,
      email: json['email'] as String?,
    );

Map<String, dynamic> _$UpdateProfileDtoToJson(UpdateProfileDto instance) =>
    <String, dynamic>{
      'firstName': instance.firstName,
      'lastName': instance.lastName,
      'email': instance.email,
    };

ProfileImageResponseDto _$ProfileImageResponseDtoFromJson(
        Map<String, dynamic> json) =>
    ProfileImageResponseDto(
      imageUrl: json['imageUrl'] as String,
    );

Map<String, dynamic> _$ProfileImageResponseDtoToJson(
        ProfileImageResponseDto instance) =>
    <String, dynamic>{
      'imageUrl': instance.imageUrl,
    };

UserPreferencesDto _$UserPreferencesDtoFromJson(Map<String, dynamic> json) =>
    UserPreferencesDto(
      language: json['language'] as String?,
      currency: json['currency'] as String?,
      notificationsEnabled: json['notificationsEnabled'] as bool?,
      emailNotifications: json['emailNotifications'] as bool?,
      smsNotifications: json['smsNotifications'] as bool?,
      pushNotifications: json['pushNotifications'] as bool?,
      darkMode: json['darkMode'] as bool?,
      defaultPaymentMethodId: json['defaultPaymentMethodId'] as String?,
      defaultVehicleType: json['defaultVehicleType'] as String?,
    );

Map<String, dynamic> _$UserPreferencesDtoToJson(UserPreferencesDto instance) =>
    <String, dynamic>{
      'language': instance.language,
      'currency': instance.currency,
      'notificationsEnabled': instance.notificationsEnabled,
      'emailNotifications': instance.emailNotifications,
      'smsNotifications': instance.smsNotifications,
      'pushNotifications': instance.pushNotifications,
      'darkMode': instance.darkMode,
      'defaultPaymentMethodId': instance.defaultPaymentMethodId,
      'defaultVehicleType': instance.defaultVehicleType,
    };

UpdatePreferencesDto _$UpdatePreferencesDtoFromJson(
        Map<String, dynamic> json) =>
    UpdatePreferencesDto(
      language: json['language'] as String?,
      currency: json['currency'] as String?,
      notificationsEnabled: json['notificationsEnabled'] as bool?,
      emailNotifications: json['emailNotifications'] as bool?,
      smsNotifications: json['smsNotifications'] as bool?,
      pushNotifications: json['pushNotifications'] as bool?,
      darkMode: json['darkMode'] as bool?,
      defaultPaymentMethodId: json['defaultPaymentMethodId'] as String?,
      defaultVehicleType: json['defaultVehicleType'] as String?,
    );

Map<String, dynamic> _$UpdatePreferencesDtoToJson(
        UpdatePreferencesDto instance) =>
    <String, dynamic>{
      'language': instance.language,
      'currency': instance.currency,
      'notificationsEnabled': instance.notificationsEnabled,
      'emailNotifications': instance.emailNotifications,
      'smsNotifications': instance.smsNotifications,
      'pushNotifications': instance.pushNotifications,
      'darkMode': instance.darkMode,
      'defaultPaymentMethodId': instance.defaultPaymentMethodId,
      'defaultVehicleType': instance.defaultVehicleType,
    };

SavedPlaceDto _$SavedPlaceDtoFromJson(Map<String, dynamic> json) =>
    SavedPlaceDto(
      id: json['id'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      icon: json['icon'] as String?,
      placeType: json['placeType'] as String?,
      createdAt: json['createdAt'] == null
          ? null
          : DateTime.parse(json['createdAt'] as String),
    );

Map<String, dynamic> _$SavedPlaceDtoToJson(SavedPlaceDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'icon': instance.icon,
      'placeType': instance.placeType,
      'createdAt': instance.createdAt?.toIso8601String(),
    };

CreateSavedPlaceDto _$CreateSavedPlaceDtoFromJson(Map<String, dynamic> json) =>
    CreateSavedPlaceDto(
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      icon: json['icon'] as String?,
      placeType: json['placeType'] as String?,
    );

Map<String, dynamic> _$CreateSavedPlaceDtoToJson(
        CreateSavedPlaceDto instance) =>
    <String, dynamic>{
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'icon': instance.icon,
      'placeType': instance.placeType,
    };

UpdateSavedPlaceDto _$UpdateSavedPlaceDtoFromJson(Map<String, dynamic> json) =>
    UpdateSavedPlaceDto(
      name: json['name'] as String?,
      address: json['address'] as String?,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      icon: json['icon'] as String?,
      placeType: json['placeType'] as String?,
    );

Map<String, dynamic> _$UpdateSavedPlaceDtoToJson(
        UpdateSavedPlaceDto instance) =>
    <String, dynamic>{
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'icon': instance.icon,
      'placeType': instance.placeType,
    };

PaymentMethodDto _$PaymentMethodDtoFromJson(Map<String, dynamic> json) =>
    PaymentMethodDto(
      id: json['id'] as String,
      type: json['type'] as String,
      displayName: json['displayName'] as String,
      last4: json['last4'] as String?,
      brand: json['brand'] as String?,
      expiryMonth: (json['expiryMonth'] as num?)?.toInt(),
      expiryYear: (json['expiryYear'] as num?)?.toInt(),
      isDefault: json['isDefault'] as bool?,
      phoneNumber: json['phoneNumber'] as String?,
      provider: json['provider'] as String?,
      createdAt: json['createdAt'] == null
          ? null
          : DateTime.parse(json['createdAt'] as String),
    );

Map<String, dynamic> _$PaymentMethodDtoToJson(PaymentMethodDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'displayName': instance.displayName,
      'last4': instance.last4,
      'brand': instance.brand,
      'expiryMonth': instance.expiryMonth,
      'expiryYear': instance.expiryYear,
      'isDefault': instance.isDefault,
      'phoneNumber': instance.phoneNumber,
      'provider': instance.provider,
      'createdAt': instance.createdAt?.toIso8601String(),
    };

CreatePaymentMethodDto _$CreatePaymentMethodDtoFromJson(
        Map<String, dynamic> json) =>
    CreatePaymentMethodDto(
      type: json['type'] as String,
      stripePaymentMethodId: json['stripePaymentMethodId'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      provider: json['provider'] as String?,
    );

Map<String, dynamic> _$CreatePaymentMethodDtoToJson(
        CreatePaymentMethodDto instance) =>
    <String, dynamic>{
      'type': instance.type,
      'stripePaymentMethodId': instance.stripePaymentMethodId,
      'phoneNumber': instance.phoneNumber,
      'provider': instance.provider,
    };

RideHistoryItemDto _$RideHistoryItemDtoFromJson(Map<String, dynamic> json) =>
    RideHistoryItemDto(
      id: json['id'] as String,
      status: json['status'] as String,
      pickupAddress: json['pickupAddress'] as String,
      dropoffAddress: json['dropoffAddress'] as String,
      fare: (json['fare'] as num).toDouble(),
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      driverName: json['driverName'] as String?,
      driverRating: (json['driverRating'] as num?)?.toDouble(),
      vehicleType: json['vehicleType'] as String?,
      distance: (json['distance'] as num?)?.toDouble(),
      duration: (json['duration'] as num?)?.toInt(),
      rating: (json['rating'] as num?)?.toInt(),
    );

Map<String, dynamic> _$RideHistoryItemDtoToJson(RideHistoryItemDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'pickupAddress': instance.pickupAddress,
      'dropoffAddress': instance.dropoffAddress,
      'fare': instance.fare,
      'currency': instance.currency,
      'createdAt': instance.createdAt.toIso8601String(),
      'driverName': instance.driverName,
      'driverRating': instance.driverRating,
      'vehicleType': instance.vehicleType,
      'distance': instance.distance,
      'duration': instance.duration,
      'rating': instance.rating,
    };

OrderHistoryItemDto _$OrderHistoryItemDtoFromJson(Map<String, dynamic> json) =>
    OrderHistoryItemDto(
      id: json['id'] as String,
      type: json['type'] as String,
      status: json['status'] as String,
      total: (json['total'] as num).toDouble(),
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      restaurantName: json['restaurantName'] as String?,
      itemCount: (json['itemCount'] as num?)?.toInt(),
      deliveryAddress: json['deliveryAddress'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
    );

Map<String, dynamic> _$OrderHistoryItemDtoToJson(
        OrderHistoryItemDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'status': instance.status,
      'total': instance.total,
      'currency': instance.currency,
      'createdAt': instance.createdAt.toIso8601String(),
      'restaurantName': instance.restaurantName,
      'itemCount': instance.itemCount,
      'deliveryAddress': instance.deliveryAddress,
      'rating': instance.rating,
    };

WalletDto _$WalletDtoFromJson(Map<String, dynamic> json) => WalletDto(
      balance: (json['balance'] as num).toDouble(),
      currency: json['currency'] as String,
      pendingBalance: (json['pendingBalance'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$WalletDtoToJson(WalletDto instance) => <String, dynamic>{
      'balance': instance.balance,
      'currency': instance.currency,
      'pendingBalance': instance.pendingBalance,
    };

WalletTransactionDto _$WalletTransactionDtoFromJson(
        Map<String, dynamic> json) =>
    WalletTransactionDto(
      id: json['id'] as String,
      type: json['type'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      description: json['description'] as String?,
      referenceId: json['referenceId'] as String?,
    );

Map<String, dynamic> _$WalletTransactionDtoToJson(
        WalletTransactionDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'amount': instance.amount,
      'currency': instance.currency,
      'status': instance.status,
      'createdAt': instance.createdAt.toIso8601String(),
      'description': instance.description,
      'referenceId': instance.referenceId,
    };

PaginatedResponseDto<T> _$PaginatedResponseDtoFromJson<T>(
  Map<String, dynamic> json,
  T Function(Object? json) fromJsonT,
) =>
    PaginatedResponseDto<T>(
      data: (json['data'] as List<dynamic>).map(fromJsonT).toList(),
      page: (json['page'] as num).toInt(),
      limit: (json['limit'] as num).toInt(),
      total: (json['total'] as num).toInt(),
      totalPages: (json['totalPages'] as num).toInt(),
    );

Map<String, dynamic> _$PaginatedResponseDtoToJson<T>(
  PaginatedResponseDto<T> instance,
  Object? Function(T value) toJsonT,
) =>
    <String, dynamic>{
      'data': instance.data.map(toJsonT).toList(),
      'page': instance.page,
      'limit': instance.limit,
      'total': instance.total,
      'totalPages': instance.totalPages,
    };

DeleteAccountDto _$DeleteAccountDtoFromJson(Map<String, dynamic> json) =>
    DeleteAccountDto(
      confirmation: json['confirmation'] as String,
      reason: json['reason'] as String?,
    );

Map<String, dynamic> _$DeleteAccountDtoToJson(DeleteAccountDto instance) =>
    <String, dynamic>{
      'confirmation': instance.confirmation,
      'reason': instance.reason,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _UserService implements UserService {
  _UserService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<UserDto> getCurrentUser() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<UserDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/me',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late UserDto _value;
    try {
      _value = UserDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<UserDto> updateProfile(UpdateProfileDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<UserDto>(Options(
      method: 'PATCH',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/me',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late UserDto _value;
    try {
      _value = UserDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<ProfileImageResponseDto> updateProfileImage(
    List<int> imageBytes,
    String filename,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = FormData();
    _data.files.add(MapEntry(
        'image',
        MultipartFile.fromBytes(
          imageBytes,
          filename: null,
        )));
    _data.fields.add(MapEntry(
      'filename',
      filename,
    ));
    final _options = _setStreamType<ProfileImageResponseDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
      contentType: 'multipart/form-data',
    )
        .compose(
          _dio.options,
          '/users/me/profile-image',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late ProfileImageResponseDto _value;
    try {
      _value = ProfileImageResponseDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> deleteProfileImage() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<void>(Options(
      method: 'DELETE',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/me/profile-image',
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
  Future<UserPreferencesDto> getPreferences() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<UserPreferencesDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/preferences',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late UserPreferencesDto _value;
    try {
      _value = UserPreferencesDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<UserPreferencesDto> updatePreferences(
      UpdatePreferencesDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<UserPreferencesDto>(Options(
      method: 'PATCH',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/preferences',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late UserPreferencesDto _value;
    try {
      _value = UserPreferencesDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<SavedPlaceDto>> getSavedPlaces() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<SavedPlaceDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/saved-places',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<SavedPlaceDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => SavedPlaceDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<SavedPlaceDto> addSavedPlace(CreateSavedPlaceDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<SavedPlaceDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/saved-places',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late SavedPlaceDto _value;
    try {
      _value = SavedPlaceDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<SavedPlaceDto> updateSavedPlace(
    String id,
    UpdateSavedPlaceDto request,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<SavedPlaceDto>(Options(
      method: 'PATCH',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/saved-places/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late SavedPlaceDto _value;
    try {
      _value = SavedPlaceDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> deleteSavedPlace(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<void>(Options(
      method: 'DELETE',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/saved-places/${id}',
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
  Future<List<PaymentMethodDto>> getPaymentMethods() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<PaymentMethodDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/payment-methods',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<PaymentMethodDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              PaymentMethodDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaymentMethodDto> addPaymentMethod(
      CreatePaymentMethodDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<PaymentMethodDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/payment-methods',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaymentMethodDto _value;
    try {
      _value = PaymentMethodDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaymentMethodDto> setDefaultPaymentMethod(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<PaymentMethodDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/payment-methods/${id}/default',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaymentMethodDto _value;
    try {
      _value = PaymentMethodDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> deletePaymentMethod(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<void>(Options(
      method: 'DELETE',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/payment-methods/${id}',
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
  Future<PaginatedResponseDto<RideHistoryItemDto>> getRideHistory(
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
    final _options =
        _setStreamType<PaginatedResponseDto<RideHistoryItemDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
            .compose(
              _dio.options,
              '/users/rides',
              queryParameters: queryParameters,
              data: _data,
            )
            .copyWith(
                baseUrl: _combineBaseUrls(
              _dio.options.baseUrl,
              baseUrl,
            )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<RideHistoryItemDto> _value;
    try {
      _value = PaginatedResponseDto<RideHistoryItemDto>.fromJson(
        _result.data!,
        (json) => RideHistoryItemDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaginatedResponseDto<OrderHistoryItemDto>> getOrderHistory(
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
    final _options =
        _setStreamType<PaginatedResponseDto<OrderHistoryItemDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
            .compose(
              _dio.options,
              '/users/orders',
              queryParameters: queryParameters,
              data: _data,
            )
            .copyWith(
                baseUrl: _combineBaseUrls(
              _dio.options.baseUrl,
              baseUrl,
            )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<OrderHistoryItemDto> _value;
    try {
      _value = PaginatedResponseDto<OrderHistoryItemDto>.fromJson(
        _result.data!,
        (json) => OrderHistoryItemDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<WalletDto> getWallet() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<WalletDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/wallet',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late WalletDto _value;
    try {
      _value = WalletDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaginatedResponseDto<WalletTransactionDto>> getWalletTransactions(
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
    final _options =
        _setStreamType<PaginatedResponseDto<WalletTransactionDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
            .compose(
              _dio.options,
              '/users/wallet/transactions',
              queryParameters: queryParameters,
              data: _data,
            )
            .copyWith(
                baseUrl: _combineBaseUrls(
              _dio.options.baseUrl,
              baseUrl,
            )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<WalletTransactionDto> _value;
    try {
      _value = PaginatedResponseDto<WalletTransactionDto>.fromJson(
        _result.data!,
        (json) => WalletTransactionDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> deleteAccount(DeleteAccountDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<void>(Options(
      method: 'DELETE',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/users/me',
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
