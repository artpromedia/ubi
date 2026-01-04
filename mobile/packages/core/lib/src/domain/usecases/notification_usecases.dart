/// Notification Use Cases
///
/// Business logic for notification operations.
library;

import '../../../core.dart';

/// Register device for push notifications
class RegisterDeviceUseCase implements UseCase<void, RegisterDeviceParams> {
  const RegisterDeviceUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(RegisterDeviceParams params) {
    return repository.registerDevice(
      deviceToken: params.deviceToken,
      platform: params.platform,
      deviceId: params.deviceId,
      deviceName: params.deviceName,
    );
  }
}

class RegisterDeviceParams {
  const RegisterDeviceParams({
    required this.deviceToken,
    required this.platform,
    this.deviceId,
    this.deviceName,
  });

  final String deviceToken;
  final String platform;
  final String? deviceId;
  final String? deviceName;
}

/// Unregister device from push notifications
class UnregisterDeviceUseCase implements UseCase<void, String> {
  const UnregisterDeviceUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(String deviceToken) {
    return repository.unregisterDevice(deviceToken);
  }
}

/// Get notifications
class GetNotificationsUseCase implements UseCase<List<AppNotification>, GetNotificationsParams> {
  const GetNotificationsUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<List<AppNotification>>> call(GetNotificationsParams params) {
    return repository.getNotifications(
      page: params.page,
      perPage: params.perPage,
      type: params.type,
      unreadOnly: params.unreadOnly,
    );
  }
}

class GetNotificationsParams {
  const GetNotificationsParams({
    this.page = 1,
    this.perPage = 20,
    this.type,
    this.unreadOnly,
  });

  final int page;
  final int perPage;
  final NotificationType? type;
  final bool? unreadOnly;
}

/// Get unread notification count
class GetUnreadCountUseCase implements UseCase<int, NoParams> {
  const GetUnreadCountUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<int>> call(NoParams params) {
    return repository.getUnreadCount();
  }
}

/// Mark notification as read
class MarkNotificationReadUseCase implements UseCase<void, String> {
  const MarkNotificationReadUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(String notificationId) {
    return repository.markAsRead(notificationId);
  }
}

/// Mark all notifications as read
class MarkAllNotificationsReadUseCase implements UseCase<void, NoParams> {
  const MarkAllNotificationsReadUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(NoParams params) {
    return repository.markAllAsRead();
  }
}

/// Delete a notification
class DeleteNotificationUseCase implements UseCase<void, String> {
  const DeleteNotificationUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(String notificationId) {
    return repository.deleteNotification(notificationId);
  }
}

/// Delete all notifications
class DeleteAllNotificationsUseCase implements UseCase<void, NoParams> {
  const DeleteAllNotificationsUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<void>> call(NoParams params) {
    return repository.deleteAllNotifications();
  }
}

/// Get notification preferences
class GetNotificationPreferencesUseCase implements UseCase<NotificationPreferences, NoParams> {
  const GetNotificationPreferencesUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<NotificationPreferences>> call(NoParams params) {
    return repository.getPreferences();
  }
}

/// Update notification preferences
class UpdateNotificationPreferencesUseCase implements UseCase<NotificationPreferences, NotificationPreferences> {
  const UpdateNotificationPreferencesUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Future<Result<NotificationPreferences>> call(NotificationPreferences preferences) {
    return repository.updatePreferences(preferences);
  }
}

/// Watch real-time notifications
class WatchNotificationsUseCase implements StreamUseCase<AppNotification, NoParams> {
  const WatchNotificationsUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Stream<AppNotification> call(NoParams params) {
    return repository.watchNotifications();
  }
}

/// Watch unread notification count
class WatchUnreadCountUseCase implements StreamUseCase<int, NoParams> {
  const WatchUnreadCountUseCase(this.repository);

  final NotificationRepository repository;

  @override
  Stream<int> call(NoParams params) {
    return repository.watchUnreadCount();
  }
}
