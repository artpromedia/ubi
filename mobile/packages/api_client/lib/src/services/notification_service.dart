/// Notification Service
///
/// API service for push notifications and in-app notifications.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

import 'user_service.dart';

part 'notification_service.g.dart';

/// Notification API Service
///
/// Handles notification endpoints including:
/// - Device registration
/// - Notification preferences
/// - Notification history
@RestApi()
abstract class NotificationService {
  factory NotificationService(Dio dio, {String baseUrl}) = _NotificationService;

  // === Device Registration ===

  /// Register device for push notifications
  @POST('/notifications/device')
  Future<DeviceRegistrationResponseDto> registerDevice(
    @Body() RegisterDeviceDto request,
  );

  /// Unregister device
  @DELETE('/notifications/device/{deviceId}')
  Future<void> unregisterDevice(@Path('deviceId') String deviceId);

  // === Notifications ===

  /// Get notifications
  @GET('/notifications')
  Future<PaginatedResponseDto<NotificationDto>> getNotifications(
    @Query('page') int page,
    @Query('limit') int limit,
    @Query('unreadOnly') bool? unreadOnly,
  );

  /// Get notification by ID
  @GET('/notifications/{id}')
  Future<NotificationDto> getNotificationById(@Path('id') String id);

  /// Mark notification as read
  @POST('/notifications/{id}/read')
  Future<void> markAsRead(@Path('id') String id);

  /// Mark all notifications as read
  @POST('/notifications/read-all')
  Future<void> markAllAsRead();

  /// Delete notification
  @DELETE('/notifications/{id}')
  Future<void> deleteNotification(@Path('id') String id);

  /// Get unread count
  @GET('/notifications/unread-count')
  Future<UnreadCountDto> getUnreadCount();

  // === Preferences ===

  /// Get notification preferences
  @GET('/notifications/preferences')
  Future<NotificationPreferencesDto> getPreferences();

  /// Update notification preferences
  @PATCH('/notifications/preferences')
  Future<NotificationPreferencesDto> updatePreferences(
    @Body() UpdateNotificationPreferencesDto request,
  );
}

// === Device Registration DTOs ===

@JsonSerializable()
class RegisterDeviceDto {
  const RegisterDeviceDto({
    required this.token,
    required this.platform,
    required this.deviceId,
    this.deviceName,
    this.appVersion,
    this.osVersion,
  });

  factory RegisterDeviceDto.fromJson(Map<String, dynamic> json) =>
      _$RegisterDeviceDtoFromJson(json);

  final String token; // FCM token
  final String platform; // 'ios', 'android'
  final String deviceId;
  final String? deviceName;
  final String? appVersion;
  final String? osVersion;

  Map<String, dynamic> toJson() => _$RegisterDeviceDtoToJson(this);
}

@JsonSerializable()
class DeviceRegistrationResponseDto {
  const DeviceRegistrationResponseDto({
    required this.deviceId,
    required this.registered,
  });

  factory DeviceRegistrationResponseDto.fromJson(Map<String, dynamic> json) =>
      _$DeviceRegistrationResponseDtoFromJson(json);

  final String deviceId;
  final bool registered;

  Map<String, dynamic> toJson() => _$DeviceRegistrationResponseDtoToJson(this);
}

// === Notification DTOs ===

@JsonSerializable()
class NotificationDto {
  const NotificationDto({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    this.imageUrl,
    this.isRead,
    this.readAt,
    this.data,
    this.action,
  });

  factory NotificationDto.fromJson(Map<String, dynamic> json) =>
      _$NotificationDtoFromJson(json);

  final String id;
  final String type;
  final String title;
  final String body;
  final DateTime createdAt;
  final String? imageUrl;
  final bool? isRead;
  final DateTime? readAt;
  final Map<String, dynamic>? data;
  final NotificationActionDto? action;

  Map<String, dynamic> toJson() => _$NotificationDtoToJson(this);
}

@JsonSerializable()
class NotificationActionDto {
  const NotificationActionDto({
    required this.type,
    this.targetId,
    this.targetType,
    this.deepLink,
  });

  factory NotificationActionDto.fromJson(Map<String, dynamic> json) =>
      _$NotificationActionDtoFromJson(json);

  final String type; // 'navigate', 'open_url', 'dismiss'
  final String? targetId;
  final String? targetType; // 'ride', 'order', 'delivery', 'promo'
  final String? deepLink;

  Map<String, dynamic> toJson() => _$NotificationActionDtoToJson(this);
}

@JsonSerializable()
class UnreadCountDto {
  const UnreadCountDto({required this.count});

  factory UnreadCountDto.fromJson(Map<String, dynamic> json) =>
      _$UnreadCountDtoFromJson(json);

  final int count;

  Map<String, dynamic> toJson() => _$UnreadCountDtoToJson(this);
}

// === Preferences DTOs ===

@JsonSerializable()
class NotificationPreferencesDto {
  const NotificationPreferencesDto({
    this.pushEnabled,
    this.emailEnabled,
    this.smsEnabled,
    this.rideUpdates,
    this.orderUpdates,
    this.deliveryUpdates,
    this.promotions,
    this.announcements,
    this.paymentAlerts,
    this.securityAlerts,
    this.quietHoursEnabled,
    this.quietHoursStart,
    this.quietHoursEnd,
  });

  factory NotificationPreferencesDto.fromJson(Map<String, dynamic> json) =>
      _$NotificationPreferencesDtoFromJson(json);

  final bool? pushEnabled;
  final bool? emailEnabled;
  final bool? smsEnabled;
  final bool? rideUpdates;
  final bool? orderUpdates;
  final bool? deliveryUpdates;
  final bool? promotions;
  final bool? announcements;
  final bool? paymentAlerts;
  final bool? securityAlerts;
  final bool? quietHoursEnabled;
  final String? quietHoursStart; // HH:mm format
  final String? quietHoursEnd; // HH:mm format

  Map<String, dynamic> toJson() => _$NotificationPreferencesDtoToJson(this);
}

@JsonSerializable()
class UpdateNotificationPreferencesDto {
  const UpdateNotificationPreferencesDto({
    this.pushEnabled,
    this.emailEnabled,
    this.smsEnabled,
    this.rideUpdates,
    this.orderUpdates,
    this.deliveryUpdates,
    this.promotions,
    this.announcements,
    this.paymentAlerts,
    this.securityAlerts,
    this.quietHoursEnabled,
    this.quietHoursStart,
    this.quietHoursEnd,
  });

  factory UpdateNotificationPreferencesDto.fromJson(Map<String, dynamic> json) =>
      _$UpdateNotificationPreferencesDtoFromJson(json);

  final bool? pushEnabled;
  final bool? emailEnabled;
  final bool? smsEnabled;
  final bool? rideUpdates;
  final bool? orderUpdates;
  final bool? deliveryUpdates;
  final bool? promotions;
  final bool? announcements;
  final bool? paymentAlerts;
  final bool? securityAlerts;
  final bool? quietHoursEnabled;
  final String? quietHoursStart;
  final String? quietHoursEnd;

  Map<String, dynamic> toJson() => _$UpdateNotificationPreferencesDtoToJson(this);
}

/// Notification types for filtering and handling
enum NotificationType {
  rideAccepted('ride_accepted'),
  rideArrived('ride_arrived'),
  rideStarted('ride_started'),
  rideCompleted('ride_completed'),
  rideCancelled('ride_cancelled'),
  orderConfirmed('order_confirmed'),
  orderPreparing('order_preparing'),
  orderReady('order_ready'),
  orderPickedUp('order_picked_up'),
  orderDelivered('order_delivered'),
  orderCancelled('order_cancelled'),
  deliveryPickedUp('delivery_picked_up'),
  deliveryDelivered('delivery_delivered'),
  deliveryCancelled('delivery_cancelled'),
  paymentReceived('payment_received'),
  paymentFailed('payment_failed'),
  refundProcessed('refund_processed'),
  promotion('promotion'),
  announcement('announcement'),
  securityAlert('security_alert'),
  accountUpdate('account_update'),
  chat('chat');

  const NotificationType(this.value);

  final String value;

  static NotificationType? fromValue(String value) {
    try {
      return NotificationType.values.firstWhere((e) => e.value == value);
    } catch (_) {
      return null;
    }
  }
}
