// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'notification_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RegisterDeviceDto _$RegisterDeviceDtoFromJson(Map<String, dynamic> json) =>
    RegisterDeviceDto(
      token: json['token'] as String,
      platform: json['platform'] as String,
      deviceId: json['deviceId'] as String,
      deviceName: json['deviceName'] as String?,
      appVersion: json['appVersion'] as String?,
      osVersion: json['osVersion'] as String?,
    );

Map<String, dynamic> _$RegisterDeviceDtoToJson(RegisterDeviceDto instance) =>
    <String, dynamic>{
      'token': instance.token,
      'platform': instance.platform,
      'deviceId': instance.deviceId,
      'deviceName': instance.deviceName,
      'appVersion': instance.appVersion,
      'osVersion': instance.osVersion,
    };

DeviceRegistrationResponseDto _$DeviceRegistrationResponseDtoFromJson(
        Map<String, dynamic> json) =>
    DeviceRegistrationResponseDto(
      deviceId: json['deviceId'] as String,
      registered: json['registered'] as bool,
    );

Map<String, dynamic> _$DeviceRegistrationResponseDtoToJson(
        DeviceRegistrationResponseDto instance) =>
    <String, dynamic>{
      'deviceId': instance.deviceId,
      'registered': instance.registered,
    };

NotificationDto _$NotificationDtoFromJson(Map<String, dynamic> json) =>
    NotificationDto(
      id: json['id'] as String,
      type: json['type'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      imageUrl: json['imageUrl'] as String?,
      isRead: json['isRead'] as bool?,
      readAt: json['readAt'] == null
          ? null
          : DateTime.parse(json['readAt'] as String),
      data: json['data'] as Map<String, dynamic>?,
      action: json['action'] == null
          ? null
          : NotificationActionDto.fromJson(
              json['action'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$NotificationDtoToJson(NotificationDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'title': instance.title,
      'body': instance.body,
      'createdAt': instance.createdAt.toIso8601String(),
      'imageUrl': instance.imageUrl,
      'isRead': instance.isRead,
      'readAt': instance.readAt?.toIso8601String(),
      'data': instance.data,
      'action': instance.action,
    };

NotificationActionDto _$NotificationActionDtoFromJson(
        Map<String, dynamic> json) =>
    NotificationActionDto(
      type: json['type'] as String,
      targetId: json['targetId'] as String?,
      targetType: json['targetType'] as String?,
      deepLink: json['deepLink'] as String?,
    );

Map<String, dynamic> _$NotificationActionDtoToJson(
        NotificationActionDto instance) =>
    <String, dynamic>{
      'type': instance.type,
      'targetId': instance.targetId,
      'targetType': instance.targetType,
      'deepLink': instance.deepLink,
    };

UnreadCountDto _$UnreadCountDtoFromJson(Map<String, dynamic> json) =>
    UnreadCountDto(
      count: (json['count'] as num).toInt(),
    );

Map<String, dynamic> _$UnreadCountDtoToJson(UnreadCountDto instance) =>
    <String, dynamic>{
      'count': instance.count,
    };

NotificationPreferencesDto _$NotificationPreferencesDtoFromJson(
        Map<String, dynamic> json) =>
    NotificationPreferencesDto(
      pushEnabled: json['pushEnabled'] as bool?,
      emailEnabled: json['emailEnabled'] as bool?,
      smsEnabled: json['smsEnabled'] as bool?,
      rideUpdates: json['rideUpdates'] as bool?,
      orderUpdates: json['orderUpdates'] as bool?,
      deliveryUpdates: json['deliveryUpdates'] as bool?,
      promotions: json['promotions'] as bool?,
      announcements: json['announcements'] as bool?,
      paymentAlerts: json['paymentAlerts'] as bool?,
      securityAlerts: json['securityAlerts'] as bool?,
      quietHoursEnabled: json['quietHoursEnabled'] as bool?,
      quietHoursStart: json['quietHoursStart'] as String?,
      quietHoursEnd: json['quietHoursEnd'] as String?,
    );

Map<String, dynamic> _$NotificationPreferencesDtoToJson(
        NotificationPreferencesDto instance) =>
    <String, dynamic>{
      'pushEnabled': instance.pushEnabled,
      'emailEnabled': instance.emailEnabled,
      'smsEnabled': instance.smsEnabled,
      'rideUpdates': instance.rideUpdates,
      'orderUpdates': instance.orderUpdates,
      'deliveryUpdates': instance.deliveryUpdates,
      'promotions': instance.promotions,
      'announcements': instance.announcements,
      'paymentAlerts': instance.paymentAlerts,
      'securityAlerts': instance.securityAlerts,
      'quietHoursEnabled': instance.quietHoursEnabled,
      'quietHoursStart': instance.quietHoursStart,
      'quietHoursEnd': instance.quietHoursEnd,
    };

UpdateNotificationPreferencesDto _$UpdateNotificationPreferencesDtoFromJson(
        Map<String, dynamic> json) =>
    UpdateNotificationPreferencesDto(
      pushEnabled: json['pushEnabled'] as bool?,
      emailEnabled: json['emailEnabled'] as bool?,
      smsEnabled: json['smsEnabled'] as bool?,
      rideUpdates: json['rideUpdates'] as bool?,
      orderUpdates: json['orderUpdates'] as bool?,
      deliveryUpdates: json['deliveryUpdates'] as bool?,
      promotions: json['promotions'] as bool?,
      announcements: json['announcements'] as bool?,
      paymentAlerts: json['paymentAlerts'] as bool?,
      securityAlerts: json['securityAlerts'] as bool?,
      quietHoursEnabled: json['quietHoursEnabled'] as bool?,
      quietHoursStart: json['quietHoursStart'] as String?,
      quietHoursEnd: json['quietHoursEnd'] as String?,
    );

Map<String, dynamic> _$UpdateNotificationPreferencesDtoToJson(
        UpdateNotificationPreferencesDto instance) =>
    <String, dynamic>{
      'pushEnabled': instance.pushEnabled,
      'emailEnabled': instance.emailEnabled,
      'smsEnabled': instance.smsEnabled,
      'rideUpdates': instance.rideUpdates,
      'orderUpdates': instance.orderUpdates,
      'deliveryUpdates': instance.deliveryUpdates,
      'promotions': instance.promotions,
      'announcements': instance.announcements,
      'paymentAlerts': instance.paymentAlerts,
      'securityAlerts': instance.securityAlerts,
      'quietHoursEnabled': instance.quietHoursEnabled,
      'quietHoursStart': instance.quietHoursStart,
      'quietHoursEnd': instance.quietHoursEnd,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _NotificationService implements NotificationService {
  _NotificationService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<DeviceRegistrationResponseDto> registerDevice(
      RegisterDeviceDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<DeviceRegistrationResponseDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/device',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late DeviceRegistrationResponseDto _value;
    try {
      _value = DeviceRegistrationResponseDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> unregisterDevice(String deviceId) async {
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
          '/notifications/device/${deviceId}',
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
  Future<PaginatedResponseDto<NotificationDto>> getNotifications(
    int page,
    int limit,
    bool? unreadOnly,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'page': page,
      r'limit': limit,
      r'unreadOnly': unreadOnly,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<PaginatedResponseDto<NotificationDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
            .compose(
              _dio.options,
              '/notifications',
              queryParameters: queryParameters,
              data: _data,
            )
            .copyWith(
                baseUrl: _combineBaseUrls(
              _dio.options.baseUrl,
              baseUrl,
            )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<NotificationDto> _value;
    try {
      _value = PaginatedResponseDto<NotificationDto>.fromJson(
        _result.data!,
        (json) => NotificationDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<NotificationDto> getNotificationById(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<NotificationDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/${id}',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late NotificationDto _value;
    try {
      _value = NotificationDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<void> markAsRead(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<void>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/${id}/read',
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
  Future<void> markAllAsRead() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<void>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/read-all',
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
  Future<void> deleteNotification(String id) async {
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
          '/notifications/${id}',
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
  Future<UnreadCountDto> getUnreadCount() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<UnreadCountDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/unread-count',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late UnreadCountDto _value;
    try {
      _value = UnreadCountDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<NotificationPreferencesDto> getPreferences() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<NotificationPreferencesDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/preferences',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late NotificationPreferencesDto _value;
    try {
      _value = NotificationPreferencesDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<NotificationPreferencesDto> updatePreferences(
      UpdateNotificationPreferencesDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<NotificationPreferencesDto>(Options(
      method: 'PATCH',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/notifications/preferences',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late NotificationPreferencesDto _value;
    try {
      _value = NotificationPreferencesDto.fromJson(_result.data!);
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
