// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ride_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RideEstimateRequestDto _$RideEstimateRequestDtoFromJson(
        Map<String, dynamic> json) =>
    RideEstimateRequestDto(
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      vehicleTypes: (json['vehicleTypes'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
    );

Map<String, dynamic> _$RideEstimateRequestDtoToJson(
        RideEstimateRequestDto instance) =>
    <String, dynamic>{
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'vehicleTypes': instance.vehicleTypes,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
    };

RideEstimateDto _$RideEstimateDtoFromJson(Map<String, dynamic> json) =>
    RideEstimateDto(
      vehicleType: json['vehicleType'] as String,
      vehicleName: json['vehicleName'] as String,
      minFare: (json['minFare'] as num).toDouble(),
      maxFare: (json['maxFare'] as num).toDouble(),
      currency: json['currency'] as String,
      estimatedDuration: (json['estimatedDuration'] as num).toInt(),
      estimatedDistance: (json['estimatedDistance'] as num).toDouble(),
      eta: (json['eta'] as num).toInt(),
      surgeMultiplier: (json['surgeMultiplier'] as num?)?.toDouble(),
      vehicleImageUrl: json['vehicleImageUrl'] as String?,
      capacity: (json['capacity'] as num?)?.toInt(),
      features: (json['features'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$RideEstimateDtoToJson(RideEstimateDto instance) =>
    <String, dynamic>{
      'vehicleType': instance.vehicleType,
      'vehicleName': instance.vehicleName,
      'minFare': instance.minFare,
      'maxFare': instance.maxFare,
      'currency': instance.currency,
      'estimatedDuration': instance.estimatedDuration,
      'estimatedDistance': instance.estimatedDistance,
      'eta': instance.eta,
      'surgeMultiplier': instance.surgeMultiplier,
      'vehicleImageUrl': instance.vehicleImageUrl,
      'capacity': instance.capacity,
      'features': instance.features,
    };

RideRequestDto _$RideRequestDtoFromJson(Map<String, dynamic> json) =>
    RideRequestDto(
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      pickupAddress: json['pickupAddress'] as String,
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      dropoffAddress: json['dropoffAddress'] as String,
      vehicleType: json['vehicleType'] as String,
      paymentMethodId: json['paymentMethodId'] as String,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      notes: json['notes'] as String?,
      promoCode: json['promoCode'] as String?,
    );

Map<String, dynamic> _$RideRequestDtoToJson(RideRequestDto instance) =>
    <String, dynamic>{
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'pickupAddress': instance.pickupAddress,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'dropoffAddress': instance.dropoffAddress,
      'vehicleType': instance.vehicleType,
      'paymentMethodId': instance.paymentMethodId,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'notes': instance.notes,
      'promoCode': instance.promoCode,
    };

RideDto _$RideDtoFromJson(Map<String, dynamic> json) => RideDto(
      id: json['id'] as String,
      status: json['status'] as String,
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      pickupAddress: json['pickupAddress'] as String,
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      dropoffAddress: json['dropoffAddress'] as String,
      vehicleType: json['vehicleType'] as String,
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      driver: json['driver'] == null
          ? null
          : DriverDto.fromJson(json['driver'] as Map<String, dynamic>),
      vehicle: json['vehicle'] == null
          ? null
          : VehicleDto.fromJson(json['vehicle'] as Map<String, dynamic>),
      estimatedFare: (json['estimatedFare'] as num?)?.toDouble(),
      finalFare: (json['finalFare'] as num?)?.toDouble(),
      distance: (json['distance'] as num?)?.toDouble(),
      duration: (json['duration'] as num?)?.toInt(),
      eta: (json['eta'] as num?)?.toInt(),
      surgeMultiplier: (json['surgeMultiplier'] as num?)?.toDouble(),
      paymentMethodId: json['paymentMethodId'] as String?,
      paymentStatus: json['paymentStatus'] as String?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      startedAt: json['startedAt'] == null
          ? null
          : DateTime.parse(json['startedAt'] as String),
      completedAt: json['completedAt'] == null
          ? null
          : DateTime.parse(json['completedAt'] as String),
      cancelledAt: json['cancelledAt'] == null
          ? null
          : DateTime.parse(json['cancelledAt'] as String),
      cancellationReason: json['cancellationReason'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
      driverRating: (json['driverRating'] as num?)?.toInt(),
      notes: json['notes'] as String?,
      route: json['route'] == null
          ? null
          : RouteDto.fromJson(json['route'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$RideDtoToJson(RideDto instance) => <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'pickupAddress': instance.pickupAddress,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'dropoffAddress': instance.dropoffAddress,
      'vehicleType': instance.vehicleType,
      'currency': instance.currency,
      'createdAt': instance.createdAt.toIso8601String(),
      'driver': instance.driver,
      'vehicle': instance.vehicle,
      'estimatedFare': instance.estimatedFare,
      'finalFare': instance.finalFare,
      'distance': instance.distance,
      'duration': instance.duration,
      'eta': instance.eta,
      'surgeMultiplier': instance.surgeMultiplier,
      'paymentMethodId': instance.paymentMethodId,
      'paymentStatus': instance.paymentStatus,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'startedAt': instance.startedAt?.toIso8601String(),
      'completedAt': instance.completedAt?.toIso8601String(),
      'cancelledAt': instance.cancelledAt?.toIso8601String(),
      'cancellationReason': instance.cancellationReason,
      'rating': instance.rating,
      'driverRating': instance.driverRating,
      'notes': instance.notes,
      'route': instance.route,
    };

DriverDto _$DriverDtoFromJson(Map<String, dynamic> json) => DriverDto(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      profileImageUrl: json['profileImageUrl'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      totalRides: (json['totalRides'] as num?)?.toInt(),
      currentLatitude: (json['currentLatitude'] as num?)?.toDouble(),
      currentLongitude: (json['currentLongitude'] as num?)?.toDouble(),
      heading: (json['heading'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$DriverDtoToJson(DriverDto instance) => <String, dynamic>{
      'id': instance.id,
      'firstName': instance.firstName,
      'lastName': instance.lastName,
      'profileImageUrl': instance.profileImageUrl,
      'phoneNumber': instance.phoneNumber,
      'rating': instance.rating,
      'totalRides': instance.totalRides,
      'currentLatitude': instance.currentLatitude,
      'currentLongitude': instance.currentLongitude,
      'heading': instance.heading,
    };

VehicleDto _$VehicleDtoFromJson(Map<String, dynamic> json) => VehicleDto(
      id: json['id'] as String,
      make: json['make'] as String,
      model: json['model'] as String,
      year: (json['year'] as num).toInt(),
      color: json['color'] as String,
      licensePlate: json['licensePlate'] as String,
      imageUrl: json['imageUrl'] as String?,
    );

Map<String, dynamic> _$VehicleDtoToJson(VehicleDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'make': instance.make,
      'model': instance.model,
      'year': instance.year,
      'color': instance.color,
      'licensePlate': instance.licensePlate,
      'imageUrl': instance.imageUrl,
    };

RouteDto _$RouteDtoFromJson(Map<String, dynamic> json) => RouteDto(
      polyline: json['polyline'] as String,
      distance: (json['distance'] as num).toDouble(),
      duration: (json['duration'] as num).toInt(),
      steps: (json['steps'] as List<dynamic>?)
          ?.map((e) => RouteStepDto.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$RouteDtoToJson(RouteDto instance) => <String, dynamic>{
      'polyline': instance.polyline,
      'distance': instance.distance,
      'duration': instance.duration,
      'steps': instance.steps,
    };

RouteStepDto _$RouteStepDtoFromJson(Map<String, dynamic> json) => RouteStepDto(
      instruction: json['instruction'] as String,
      distance: (json['distance'] as num).toDouble(),
      duration: (json['duration'] as num).toInt(),
      maneuver: json['maneuver'] as String?,
    );

Map<String, dynamic> _$RouteStepDtoToJson(RouteStepDto instance) =>
    <String, dynamic>{
      'instruction': instance.instruction,
      'distance': instance.distance,
      'duration': instance.duration,
      'maneuver': instance.maneuver,
    };

NearbyDriverDto _$NearbyDriverDtoFromJson(Map<String, dynamic> json) =>
    NearbyDriverDto(
      id: json['id'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      vehicleType: json['vehicleType'] as String,
      heading: (json['heading'] as num?)?.toDouble(),
      eta: (json['eta'] as num?)?.toInt(),
    );

Map<String, dynamic> _$NearbyDriverDtoToJson(NearbyDriverDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'vehicleType': instance.vehicleType,
      'heading': instance.heading,
      'eta': instance.eta,
    };

CancelRideDto _$CancelRideDtoFromJson(Map<String, dynamic> json) =>
    CancelRideDto(
      reason: json['reason'] as String,
      otherReason: json['otherReason'] as String?,
    );

Map<String, dynamic> _$CancelRideDtoToJson(CancelRideDto instance) =>
    <String, dynamic>{
      'reason': instance.reason,
      'otherReason': instance.otherReason,
    };

RateRideDto _$RateRideDtoFromJson(Map<String, dynamic> json) => RateRideDto(
      rating: (json['rating'] as num).toInt(),
      comment: json['comment'] as String?,
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$RateRideDtoToJson(RateRideDto instance) =>
    <String, dynamic>{
      'rating': instance.rating,
      'comment': instance.comment,
      'tags': instance.tags,
    };

AddTipDto _$AddTipDtoFromJson(Map<String, dynamic> json) => AddTipDto(
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
    );

Map<String, dynamic> _$AddTipDtoToJson(AddTipDto instance) => <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
    };

PlaceSearchResultDto _$PlaceSearchResultDtoFromJson(
        Map<String, dynamic> json) =>
    PlaceSearchResultDto(
      placeId: json['placeId'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      types:
          (json['types'] as List<dynamic>?)?.map((e) => e as String).toList(),
      distance: (json['distance'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$PlaceSearchResultDtoToJson(
        PlaceSearchResultDto instance) =>
    <String, dynamic>{
      'placeId': instance.placeId,
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'types': instance.types,
      'distance': instance.distance,
    };

PlaceAutocompleteDto _$PlaceAutocompleteDtoFromJson(
        Map<String, dynamic> json) =>
    PlaceAutocompleteDto(
      placeId: json['placeId'] as String,
      mainText: json['mainText'] as String,
      secondaryText: json['secondaryText'] as String,
      types:
          (json['types'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$PlaceAutocompleteDtoToJson(
        PlaceAutocompleteDto instance) =>
    <String, dynamic>{
      'placeId': instance.placeId,
      'mainText': instance.mainText,
      'secondaryText': instance.secondaryText,
      'types': instance.types,
    };

PlaceDetailsDto _$PlaceDetailsDtoFromJson(Map<String, dynamic> json) =>
    PlaceDetailsDto(
      placeId: json['placeId'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      formattedAddress: json['formattedAddress'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      website: json['website'] as String?,
      types:
          (json['types'] as List<dynamic>?)?.map((e) => e as String).toList(),
      openingHours: (json['openingHours'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$PlaceDetailsDtoToJson(PlaceDetailsDto instance) =>
    <String, dynamic>{
      'placeId': instance.placeId,
      'name': instance.name,
      'address': instance.address,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'formattedAddress': instance.formattedAddress,
      'phoneNumber': instance.phoneNumber,
      'website': instance.website,
      'types': instance.types,
      'openingHours': instance.openingHours,
    };

ReverseGeocodeDto _$ReverseGeocodeDtoFromJson(Map<String, dynamic> json) =>
    ReverseGeocodeDto(
      address: json['address'] as String,
      name: json['name'] as String?,
      street: json['street'] as String?,
      city: json['city'] as String?,
      state: json['state'] as String?,
      country: json['country'] as String?,
      postalCode: json['postalCode'] as String?,
    );

Map<String, dynamic> _$ReverseGeocodeDtoToJson(ReverseGeocodeDto instance) =>
    <String, dynamic>{
      'address': instance.address,
      'name': instance.name,
      'street': instance.street,
      'city': instance.city,
      'state': instance.state,
      'country': instance.country,
      'postalCode': instance.postalCode,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _RideService implements RideService {
  _RideService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<List<RideEstimateDto>> getEstimates(
      RideEstimateRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<List<RideEstimateDto>>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/estimate',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<RideEstimateDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              RideEstimateDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<RideDto> requestRide(RideRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<RideDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/request',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late RideDto _value;
    try {
      _value = RideDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<RideDto> getRideById(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<RideDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late RideDto _value;
    try {
      _value = RideDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<RideDto> cancelRide(
    String id,
    CancelRideDto request,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<RideDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/${id}/cancel',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late RideDto _value;
    try {
      _value = RideDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> rateRide(
    String id,
    RateRideDto request,
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
          '/rides/${id}/rate',
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
  Future<void> addTip(
    String id,
    AddTipDto request,
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
          '/rides/${id}/tip',
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
  Future<List<NearbyDriverDto>> getNearbyDrivers(
    double latitude,
    double longitude,
    String? vehicleType,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'latitude': latitude,
      r'longitude': longitude,
      r'vehicleType': vehicleType,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<NearbyDriverDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/nearby-drivers',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<NearbyDriverDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              NearbyDriverDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<RideDto?> getActiveRide() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<RideDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/rides/active',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>?>(_options);
    late RideDto? _value;
    try {
      _value = _result.data == null ? null : RideDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<PlaceSearchResultDto>> searchPlaces(
    String query,
    double? latitude,
    double? longitude,
    int? limit,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'query': query,
      r'latitude': latitude,
      r'longitude': longitude,
      r'limit': limit,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<PlaceSearchResultDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/places/search',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<PlaceSearchResultDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              PlaceSearchResultDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<PlaceAutocompleteDto>> autocompletePlaces(
    String query,
    double? latitude,
    double? longitude,
    String? sessionToken,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'query': query,
      r'latitude': latitude,
      r'longitude': longitude,
      r'sessionToken': sessionToken,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<PlaceAutocompleteDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/places/autocomplete',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<PlaceAutocompleteDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) =>
              PlaceAutocompleteDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PlaceDetailsDto> getPlaceDetails(
    String id,
    String? sessionToken,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{r'sessionToken': sessionToken};
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<PlaceDetailsDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/places/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PlaceDetailsDto _value;
    try {
      _value = PlaceDetailsDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<ReverseGeocodeDto> reverseGeocode(
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
    final _options = _setStreamType<ReverseGeocodeDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/places/reverse-geocode',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late ReverseGeocodeDto _value;
    try {
      _value = ReverseGeocodeDto.fromJson(_result.data!);
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
