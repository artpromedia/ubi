/// Notification Entity
///
/// Domain entities for notifications.
library;

import 'package:equatable/equatable.dart';

/// Type of notification
enum NotificationType {
  // Ride notifications
  rideAccepted('ride_accepted', 'Ride Accepted'),
  rideArrived('ride_arrived', 'Driver Arrived'),
  rideStarted('ride_started', 'Ride Started'),
  rideCompleted('ride_completed', 'Ride Completed'),
  rideCancelled('ride_cancelled', 'Ride Cancelled'),

  // Order notifications
  orderConfirmed('order_confirmed', 'Order Confirmed'),
  orderPreparing('order_preparing', 'Preparing Order'),
  orderReady('order_ready', 'Order Ready'),
  orderPickedUp('order_picked_up', 'Order Picked Up'),
  orderDelivered('order_delivered', 'Order Delivered'),
  orderCancelled('order_cancelled', 'Order Cancelled'),

  // Delivery notifications
  deliveryPickedUp('delivery_picked_up', 'Package Picked Up'),
  deliveryDelivered('delivery_delivered', 'Package Delivered'),
  deliveryCancelled('delivery_cancelled', 'Delivery Cancelled'),

  // Payment notifications
  paymentReceived('payment_received', 'Payment Received'),
  paymentFailed('payment_failed', 'Payment Failed'),
  refundProcessed('refund_processed', 'Refund Processed'),

  // General notifications
  promotion('promotion', 'Promotion'),
  announcement('announcement', 'Announcement'),
  securityAlert('security_alert', 'Security Alert'),
  accountUpdate('account_update', 'Account Update'),
  chat('chat', 'Message');

  const NotificationType(this.value, this.displayName);

  final String value;
  final String displayName;

  /// Whether this is a ride-related notification
  bool get isRideRelated => value.startsWith('ride_');

  /// Whether this is an order-related notification
  bool get isOrderRelated => value.startsWith('order_');

  /// Whether this is a delivery-related notification
  bool get isDeliveryRelated => value.startsWith('delivery_');

  /// Whether this is a payment-related notification
  bool get isPaymentRelated => value.startsWith('payment_') || value == 'refund_processed';

  /// Parse from string value
  static NotificationType? fromValue(String value) {
    try {
      return NotificationType.values.firstWhere((e) => e.value == value);
    } catch (_) {
      return null;
    }
  }
}

/// Notification action type
enum NotificationActionType {
  navigate('navigate'),
  openUrl('open_url'),
  dismiss('dismiss');

  const NotificationActionType(this.value);

  final String value;
}

/// Notification entity
class AppNotification extends Equatable {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    this.imageUrl,
    this.isRead = false,
    this.readAt,
    this.data,
    this.action,
  });

  final String id;
  final NotificationType type;
  final String title;
  final String body;
  final DateTime createdAt;
  final String? imageUrl;
  final bool isRead;
  final DateTime? readAt;
  final Map<String, dynamic>? data;
  final NotificationAction? action;

  /// Time since notification was created
  String get timeAgo {
    final diff = DateTime.now().difference(createdAt);

    if (diff.inDays > 7) {
      return '${(diff.inDays / 7).floor()}w ago';
    } else if (diff.inDays > 0) {
      return '${diff.inDays}d ago';
    } else if (diff.inHours > 0) {
      return '${diff.inHours}h ago';
    } else if (diff.inMinutes > 0) {
      return '${diff.inMinutes}m ago';
    } else {
      return 'Just now';
    }
  }

  @override
  List<Object?> get props => [id, type, title, body, createdAt, isRead];

  AppNotification copyWith({
    String? id,
    NotificationType? type,
    String? title,
    String? body,
    DateTime? createdAt,
    String? imageUrl,
    bool? isRead,
    DateTime? readAt,
    Map<String, dynamic>? data,
    NotificationAction? action,
  }) {
    return AppNotification(
      id: id ?? this.id,
      type: type ?? this.type,
      title: title ?? this.title,
      body: body ?? this.body,
      createdAt: createdAt ?? this.createdAt,
      imageUrl: imageUrl ?? this.imageUrl,
      isRead: isRead ?? this.isRead,
      readAt: readAt ?? this.readAt,
      data: data ?? this.data,
      action: action ?? this.action,
    );
  }
}

/// Action associated with a notification
class NotificationAction extends Equatable {
  const NotificationAction({
    required this.type,
    this.targetId,
    this.targetType,
    this.deepLink,
  });

  final NotificationActionType type;
  final String? targetId;
  final String? targetType;
  final String? deepLink;

  @override
  List<Object?> get props => [type, targetId, targetType, deepLink];
}

/// Notification preferences
class NotificationPreferences extends Equatable {
  const NotificationPreferences({
    this.pushEnabled = true,
    this.emailEnabled = true,
    this.smsEnabled = true,
    this.rideUpdates = true,
    this.orderUpdates = true,
    this.deliveryUpdates = true,
    this.promotions = true,
    this.announcements = true,
    this.paymentAlerts = true,
    this.securityAlerts = true,
    this.quietHoursEnabled = false,
    this.quietHoursStart,
    this.quietHoursEnd,
  });

  final bool pushEnabled;
  final bool emailEnabled;
  final bool smsEnabled;
  final bool rideUpdates;
  final bool orderUpdates;
  final bool deliveryUpdates;
  final bool promotions;
  final bool announcements;
  final bool paymentAlerts;
  final bool securityAlerts;
  final bool quietHoursEnabled;
  final String? quietHoursStart; // HH:mm format
  final String? quietHoursEnd; // HH:mm format

  /// Check if currently in quiet hours
  bool get isInQuietHours {
    if (!quietHoursEnabled || quietHoursStart == null || quietHoursEnd == null) {
      return false;
    }

    final now = DateTime.now();
    final currentMinutes = now.hour * 60 + now.minute;

    final startParts = quietHoursStart!.split(':');
    final startMinutes = int.parse(startParts[0]) * 60 + int.parse(startParts[1]);

    final endParts = quietHoursEnd!.split(':');
    final endMinutes = int.parse(endParts[0]) * 60 + int.parse(endParts[1]);

    if (startMinutes < endMinutes) {
      // Same day range (e.g., 10:00 - 18:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00 - 07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }

  @override
  List<Object?> get props => [
        pushEnabled,
        emailEnabled,
        smsEnabled,
        rideUpdates,
        orderUpdates,
        deliveryUpdates,
        promotions,
        announcements,
        paymentAlerts,
        securityAlerts,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
      ];

  NotificationPreferences copyWith({
    bool? pushEnabled,
    bool? emailEnabled,
    bool? smsEnabled,
    bool? rideUpdates,
    bool? orderUpdates,
    bool? deliveryUpdates,
    bool? promotions,
    bool? announcements,
    bool? paymentAlerts,
    bool? securityAlerts,
    bool? quietHoursEnabled,
    String? quietHoursStart,
    String? quietHoursEnd,
  }) {
    return NotificationPreferences(
      pushEnabled: pushEnabled ?? this.pushEnabled,
      emailEnabled: emailEnabled ?? this.emailEnabled,
      smsEnabled: smsEnabled ?? this.smsEnabled,
      rideUpdates: rideUpdates ?? this.rideUpdates,
      orderUpdates: orderUpdates ?? this.orderUpdates,
      deliveryUpdates: deliveryUpdates ?? this.deliveryUpdates,
      promotions: promotions ?? this.promotions,
      announcements: announcements ?? this.announcements,
      paymentAlerts: paymentAlerts ?? this.paymentAlerts,
      securityAlerts: securityAlerts ?? this.securityAlerts,
      quietHoursEnabled: quietHoursEnabled ?? this.quietHoursEnabled,
      quietHoursStart: quietHoursStart ?? this.quietHoursStart,
      quietHoursEnd: quietHoursEnd ?? this.quietHoursEnd,
    );
  }
}
