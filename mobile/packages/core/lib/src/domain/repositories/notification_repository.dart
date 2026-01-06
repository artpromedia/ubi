/// Notification Repository Interface
///
/// Contract for notification data operations.
library;

import '../../core/result/result.dart';
import '../entities/notification.dart';

/// Repository for notification operations
abstract class NotificationRepository {
  /// Register device for push notifications
  Future<Result<void>> registerDevice({
    required String deviceToken,
    required String platform, // ios, android
    String? deviceId,
    String? deviceName,
  });

  /// Unregister device from push notifications
  Future<Result<void>> unregisterDevice(String deviceToken);

  /// Get notifications with pagination
  Future<Result<List<AppNotification>>> getNotifications({
    int page = 1,
    int perPage = 20,
    NotificationType? type,
    bool? unreadOnly,
  });

  /// Get unread notification count
  Future<Result<int>> getUnreadCount();

  /// Mark notification as read
  Future<Result<void>> markAsRead(String notificationId);

  /// Mark all notifications as read
  Future<Result<void>> markAllAsRead();

  /// Delete a notification
  Future<Result<void>> deleteNotification(String notificationId);

  /// Delete all notifications
  Future<Result<void>> deleteAllNotifications();

  /// Get notification preferences
  Future<Result<NotificationPreferences>> getPreferences();

  /// Update notification preferences
  Future<Result<NotificationPreferences>> updatePreferences(
    NotificationPreferences preferences,
  );

  /// Stream real-time notifications
  Stream<AppNotification> watchNotifications();

  /// Stream unread count updates
  Stream<int> watchUnreadCount();
}

