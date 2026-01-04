part of 'profile_bloc.dart';

/// Base class for profile events
sealed class ProfileEvent extends Equatable {
  const ProfileEvent();

  @override
  List<Object?> get props => [];
}

/// Event to load user profile
class ProfileRequested extends ProfileEvent {
  const ProfileRequested();
}

/// Event to update profile
class ProfileUpdated extends ProfileEvent {
  const ProfileUpdated({
    this.firstName,
    this.lastName,
    this.email,
    this.photoUrl,
  });

  final String? firstName;
  final String? lastName;
  final String? email;
  final String? photoUrl;

  @override
  List<Object?> get props => [firstName, lastName, email, photoUrl];
}

/// Event to upload profile photo
class ProfilePhotoUpdated extends ProfileEvent {
  const ProfilePhotoUpdated(this.imagePath);

  final String imagePath;

  @override
  List<Object?> get props => [imagePath];
}

/// Event to delete profile photo
class ProfilePhotoDeleted extends ProfileEvent {
  const ProfilePhotoDeleted();
}

/// Event to load saved places
class SavedPlacesRequested extends ProfileEvent {
  const SavedPlacesRequested();
}

/// Event to add a saved place
class SavedPlaceAdded extends ProfileEvent {
  const SavedPlaceAdded({
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.type,
  });

  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? type;

  @override
  List<Object?> get props => [name, address, latitude, longitude, type];
}

/// Event to update a saved place
class SavedPlaceUpdated extends ProfileEvent {
  const SavedPlaceUpdated({
    required this.placeId,
    this.name,
    this.address,
    this.latitude,
    this.longitude,
  });

  final String placeId;
  final String? name;
  final String? address;
  final double? latitude;
  final double? longitude;

  @override
  List<Object?> get props => [placeId, name, address, latitude, longitude];
}

/// Event to delete a saved place
class SavedPlaceDeleted extends ProfileEvent {
  const SavedPlaceDeleted(this.placeId);

  final String placeId;

  @override
  List<Object?> get props => [placeId];
}

/// Event to set default saved place
class SavedPlaceSetDefault extends ProfileEvent {
  const SavedPlaceSetDefault(this.placeId);

  final String placeId;

  @override
  List<Object?> get props => [placeId];
}

/// Event to load payment methods
class PaymentMethodsRequested extends ProfileEvent {
  const PaymentMethodsRequested();
}

/// Event to add a payment method
class PaymentMethodAdded extends ProfileEvent {
  const PaymentMethodAdded({
    required this.type,
    required this.details,
    this.isDefault = false,
  });

  final PaymentMethodType type;
  final Map<String, dynamic> details;
  final bool isDefault;

  @override
  List<Object?> get props => [type, details, isDefault];
}

/// Event to delete a payment method
class PaymentMethodDeleted extends ProfileEvent {
  const PaymentMethodDeleted(this.paymentMethodId);

  final String paymentMethodId;

  @override
  List<Object?> get props => [paymentMethodId];
}

/// Event to set default payment method
class PaymentMethodSetDefault extends ProfileEvent {
  const PaymentMethodSetDefault(this.paymentMethodId);

  final String paymentMethodId;

  @override
  List<Object?> get props => [paymentMethodId];
}

/// Event to load user statistics
class UserStatsRequested extends ProfileEvent {
  const UserStatsRequested();
}

/// Event to load transaction history
class TransactionHistoryRequested extends ProfileEvent {
  const TransactionHistoryRequested({
    this.page = 1,
    this.limit = 20,
    this.type,
  });

  final int page;
  final int limit;
  final TransactionType? type;

  @override
  List<Object?> get props => [page, limit, type];
}

/// Event to load settings
class SettingsRequested extends ProfileEvent {
  const SettingsRequested();
}

/// Event to update settings
class SettingsUpdated extends ProfileEvent {
  const SettingsUpdated({
    this.language,
    this.currency,
    this.pushNotifications,
    this.emailNotifications,
    this.smsNotifications,
    this.darkMode,
    this.biometricAuth,
  });

  final String? language;
  final String? currency;
  final bool? pushNotifications;
  final bool? emailNotifications;
  final bool? smsNotifications;
  final bool? darkMode;
  final bool? biometricAuth;

  @override
  List<Object?> get props => [
        language,
        currency,
        pushNotifications,
        emailNotifications,
        smsNotifications,
        darkMode,
        biometricAuth,
      ];
}

/// Event to clear local data cache
class LocalDataCleared extends ProfileEvent {
  const LocalDataCleared();
}

/// Event to request data export
class DataExportRequested extends ProfileEvent {
  const DataExportRequested();
}

/// Event to request account deletion
class AccountDeletionRequested extends ProfileEvent {
  const AccountDeletionRequested({this.reason});

  final String? reason;

  @override
  List<Object?> get props => [reason];
}

/// Event to load notifications
class NotificationsRequested extends ProfileEvent {
  const NotificationsRequested();
}

/// Event to mark notification as read
class NotificationMarkedAsRead extends ProfileEvent {
  const NotificationMarkedAsRead(this.notificationId);

  final String notificationId;

  @override
  List<Object?> get props => [notificationId];
}

/// Event to mark all notifications as read
class AllNotificationsMarkedAsRead extends ProfileEvent {
  const AllNotificationsMarkedAsRead();
}

/// Event to delete notification
class NotificationDeleted extends ProfileEvent {
  const NotificationDeleted(this.notificationId);

  final String notificationId;

  @override
  List<Object?> get props => [notificationId];
}

/// Event to load promotions
class PromotionsRequested extends ProfileEvent {
  const PromotionsRequested();
}

/// Event to apply promo code
class PromoCodeSubmitted extends ProfileEvent {
  const PromoCodeSubmitted(this.code);

  final String code;

  @override
  List<Object?> get props => [code];
}

/// Event to verify phone number
class PhoneVerificationRequested extends ProfileEvent {
  const PhoneVerificationRequested(this.phoneNumber);

  final String phoneNumber;

  @override
  List<Object?> get props => [phoneNumber];
}

/// Event to verify email
class EmailVerificationRequested extends ProfileEvent {
  const EmailVerificationRequested(this.email);

  final String email;

  @override
  List<Object?> get props => [email];
}

/// Event to log out
class LogoutRequested extends ProfileEvent {
  const LogoutRequested();
}
