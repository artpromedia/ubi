// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'delivery_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeliveryEstimateRequestDto _$DeliveryEstimateRequestDtoFromJson(
        Map<String, dynamic> json) =>
    DeliveryEstimateRequestDto(
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      packageSize: json['packageSize'] as String,
      packageWeight: (json['packageWeight'] as num?)?.toDouble(),
      isFragile: json['isFragile'] as bool?,
      requiresSignature: json['requiresSignature'] as bool?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
    );

Map<String, dynamic> _$DeliveryEstimateRequestDtoToJson(
        DeliveryEstimateRequestDto instance) =>
    <String, dynamic>{
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'packageSize': instance.packageSize,
      'packageWeight': instance.packageWeight,
      'isFragile': instance.isFragile,
      'requiresSignature': instance.requiresSignature,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
    };

DeliveryEstimateDto _$DeliveryEstimateDtoFromJson(Map<String, dynamic> json) =>
    DeliveryEstimateDto(
      estimatedFare: (json['estimatedFare'] as num).toDouble(),
      currency: json['currency'] as String,
      estimatedDuration: (json['estimatedDuration'] as num).toInt(),
      estimatedDistance: (json['estimatedDistance'] as num).toDouble(),
      eta: (json['eta'] as num).toInt(),
      breakdown: json['breakdown'] == null
          ? null
          : DeliveryFareBreakdownDto.fromJson(
              json['breakdown'] as Map<String, dynamic>),
      surgeMultiplier: (json['surgeMultiplier'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$DeliveryEstimateDtoToJson(
        DeliveryEstimateDto instance) =>
    <String, dynamic>{
      'estimatedFare': instance.estimatedFare,
      'currency': instance.currency,
      'estimatedDuration': instance.estimatedDuration,
      'estimatedDistance': instance.estimatedDistance,
      'eta': instance.eta,
      'breakdown': instance.breakdown,
      'surgeMultiplier': instance.surgeMultiplier,
    };

DeliveryFareBreakdownDto _$DeliveryFareBreakdownDtoFromJson(
        Map<String, dynamic> json) =>
    DeliveryFareBreakdownDto(
      baseFare: (json['baseFare'] as num).toDouble(),
      distanceFare: (json['distanceFare'] as num).toDouble(),
      sizeFare: (json['sizeFare'] as num).toDouble(),
      weightFare: (json['weightFare'] as num?)?.toDouble(),
      fragileFee: (json['fragileFee'] as num?)?.toDouble(),
      signatureFee: (json['signatureFee'] as num?)?.toDouble(),
      surgeFee: (json['surgeFee'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$DeliveryFareBreakdownDtoToJson(
        DeliveryFareBreakdownDto instance) =>
    <String, dynamic>{
      'baseFare': instance.baseFare,
      'distanceFare': instance.distanceFare,
      'sizeFare': instance.sizeFare,
      'weightFare': instance.weightFare,
      'fragileFee': instance.fragileFee,
      'signatureFee': instance.signatureFee,
      'surgeFee': instance.surgeFee,
    };

DeliveryRequestDto _$DeliveryRequestDtoFromJson(Map<String, dynamic> json) =>
    DeliveryRequestDto(
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      pickupAddress: json['pickupAddress'] as String,
      pickupContactName: json['pickupContactName'] as String,
      pickupContactPhone: json['pickupContactPhone'] as String,
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      dropoffAddress: json['dropoffAddress'] as String,
      dropoffContactName: json['dropoffContactName'] as String,
      dropoffContactPhone: json['dropoffContactPhone'] as String,
      packageSize: json['packageSize'] as String,
      packageDescription: json['packageDescription'] as String,
      paymentMethodId: json['paymentMethodId'] as String,
      packageWeight: (json['packageWeight'] as num?)?.toDouble(),
      isFragile: json['isFragile'] as bool?,
      requiresSignature: json['requiresSignature'] as bool?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      pickupNotes: json['pickupNotes'] as String?,
      dropoffNotes: json['dropoffNotes'] as String?,
      promoCode: json['promoCode'] as String?,
    );

Map<String, dynamic> _$DeliveryRequestDtoToJson(DeliveryRequestDto instance) =>
    <String, dynamic>{
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'pickupAddress': instance.pickupAddress,
      'pickupContactName': instance.pickupContactName,
      'pickupContactPhone': instance.pickupContactPhone,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'dropoffAddress': instance.dropoffAddress,
      'dropoffContactName': instance.dropoffContactName,
      'dropoffContactPhone': instance.dropoffContactPhone,
      'packageSize': instance.packageSize,
      'packageDescription': instance.packageDescription,
      'paymentMethodId': instance.paymentMethodId,
      'packageWeight': instance.packageWeight,
      'isFragile': instance.isFragile,
      'requiresSignature': instance.requiresSignature,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'pickupNotes': instance.pickupNotes,
      'dropoffNotes': instance.dropoffNotes,
      'promoCode': instance.promoCode,
    };

DeliveryDto _$DeliveryDtoFromJson(Map<String, dynamic> json) => DeliveryDto(
      id: json['id'] as String,
      status: json['status'] as String,
      pickupLatitude: (json['pickupLatitude'] as num).toDouble(),
      pickupLongitude: (json['pickupLongitude'] as num).toDouble(),
      pickupAddress: json['pickupAddress'] as String,
      pickupContactName: json['pickupContactName'] as String,
      pickupContactPhone: json['pickupContactPhone'] as String,
      dropoffLatitude: (json['dropoffLatitude'] as num).toDouble(),
      dropoffLongitude: (json['dropoffLongitude'] as num).toDouble(),
      dropoffAddress: json['dropoffAddress'] as String,
      dropoffContactName: json['dropoffContactName'] as String,
      dropoffContactPhone: json['dropoffContactPhone'] as String,
      packageSize: json['packageSize'] as String,
      packageDescription: json['packageDescription'] as String,
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      driver: json['driver'] == null
          ? null
          : DriverDto.fromJson(json['driver'] as Map<String, dynamic>),
      vehicle: json['vehicle'] == null
          ? null
          : VehicleDto.fromJson(json['vehicle'] as Map<String, dynamic>),
      packageWeight: (json['packageWeight'] as num?)?.toDouble(),
      isFragile: json['isFragile'] as bool?,
      requiresSignature: json['requiresSignature'] as bool?,
      estimatedFare: (json['estimatedFare'] as num?)?.toDouble(),
      finalFare: (json['finalFare'] as num?)?.toDouble(),
      distance: (json['distance'] as num?)?.toDouble(),
      duration: (json['duration'] as num?)?.toInt(),
      eta: (json['eta'] as num?)?.toInt(),
      paymentMethodId: json['paymentMethodId'] as String?,
      paymentStatus: json['paymentStatus'] as String?,
      scheduledTime: json['scheduledTime'] == null
          ? null
          : DateTime.parse(json['scheduledTime'] as String),
      pickupNotes: json['pickupNotes'] as String?,
      dropoffNotes: json['dropoffNotes'] as String?,
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
      signatureImageUrl: json['signatureImageUrl'] as String?,
      proofOfDeliveryImageUrl: json['proofOfDeliveryImageUrl'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
      trackingCode: json['trackingCode'] as String?,
    );

Map<String, dynamic> _$DeliveryDtoToJson(DeliveryDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'pickupLatitude': instance.pickupLatitude,
      'pickupLongitude': instance.pickupLongitude,
      'pickupAddress': instance.pickupAddress,
      'pickupContactName': instance.pickupContactName,
      'pickupContactPhone': instance.pickupContactPhone,
      'dropoffLatitude': instance.dropoffLatitude,
      'dropoffLongitude': instance.dropoffLongitude,
      'dropoffAddress': instance.dropoffAddress,
      'dropoffContactName': instance.dropoffContactName,
      'dropoffContactPhone': instance.dropoffContactPhone,
      'packageSize': instance.packageSize,
      'packageDescription': instance.packageDescription,
      'currency': instance.currency,
      'createdAt': instance.createdAt.toIso8601String(),
      'driver': instance.driver,
      'vehicle': instance.vehicle,
      'packageWeight': instance.packageWeight,
      'isFragile': instance.isFragile,
      'requiresSignature': instance.requiresSignature,
      'estimatedFare': instance.estimatedFare,
      'finalFare': instance.finalFare,
      'distance': instance.distance,
      'duration': instance.duration,
      'eta': instance.eta,
      'paymentMethodId': instance.paymentMethodId,
      'paymentStatus': instance.paymentStatus,
      'scheduledTime': instance.scheduledTime?.toIso8601String(),
      'pickupNotes': instance.pickupNotes,
      'dropoffNotes': instance.dropoffNotes,
      'pickedUpAt': instance.pickedUpAt?.toIso8601String(),
      'deliveredAt': instance.deliveredAt?.toIso8601String(),
      'cancelledAt': instance.cancelledAt?.toIso8601String(),
      'cancellationReason': instance.cancellationReason,
      'signatureImageUrl': instance.signatureImageUrl,
      'proofOfDeliveryImageUrl': instance.proofOfDeliveryImageUrl,
      'rating': instance.rating,
      'trackingCode': instance.trackingCode,
    };

CancelDeliveryDto _$CancelDeliveryDtoFromJson(Map<String, dynamic> json) =>
    CancelDeliveryDto(
      reason: json['reason'] as String,
      otherReason: json['otherReason'] as String?,
    );

Map<String, dynamic> _$CancelDeliveryDtoToJson(CancelDeliveryDto instance) =>
    <String, dynamic>{
      'reason': instance.reason,
      'otherReason': instance.otherReason,
    };

RateDeliveryDto _$RateDeliveryDtoFromJson(Map<String, dynamic> json) =>
    RateDeliveryDto(
      rating: (json['rating'] as num).toInt(),
      comment: json['comment'] as String?,
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$RateDeliveryDtoToJson(RateDeliveryDto instance) =>
    <String, dynamic>{
      'rating': instance.rating,
      'comment': instance.comment,
      'tags': instance.tags,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _DeliveryService implements DeliveryService {
  _DeliveryService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<DeliveryEstimateDto> getEstimate(
      DeliveryEstimateRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<DeliveryEstimateDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/estimate',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late DeliveryEstimateDto _value;
    try {
      _value = DeliveryEstimateDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<DeliveryDto> requestDelivery(DeliveryRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<DeliveryDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/request',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late DeliveryDto _value;
    try {
      _value = DeliveryDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<DeliveryDto> getDeliveryById(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<DeliveryDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late DeliveryDto _value;
    try {
      _value = DeliveryDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<DeliveryDto> cancelDelivery(
    String id,
    CancelDeliveryDto request,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<DeliveryDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/${id}/cancel',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late DeliveryDto _value;
    try {
      _value = DeliveryDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> rateDelivery(
    String id,
    RateDeliveryDto request,
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
          '/deliveries/${id}/rate',
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
  Future<List<DeliveryDto>> getActiveDeliveries() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<DeliveryDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/active',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<DeliveryDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => DeliveryDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<DeliveryDto>> getDeliveryHistory(
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
    final _options = _setStreamType<List<DeliveryDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/deliveries/history',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<DeliveryDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => DeliveryDto.fromJson(i as Map<String, dynamic>))
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
