part of 'profile_bloc.dart';

/// Base class for profile states
sealed class ProfileState extends Equatable {
  const ProfileState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class ProfileInitial extends ProfileState {
  const ProfileInitial();
}

/// Loading profile
class ProfileLoading extends ProfileState {
  const ProfileLoading();
}

/// Profile loaded
class ProfileLoaded extends ProfileState {
  const ProfileLoaded({
    required this.user,
    this.stats,
  });

  final UserProfile user;
  final UserStats? stats;

  @override
  List<Object?> get props => [user, stats];

  ProfileLoaded copyWith({
    UserProfile? user,
    UserStats? stats,
  }) {
    return ProfileLoaded(
      user: user ?? this.user,
      stats: stats ?? this.stats,
    );
  }
}

/// Profile update in progress
class ProfileUpdating extends ProfileState {
  const ProfileUpdating();
}

/// Profile updated successfully
class ProfileUpdateSuccess extends ProfileState {
  const ProfileUpdateSuccess({
    required this.user,
    this.message,
  });

  final UserProfile user;
  final String? message;

  @override
  List<Object?> get props => [user, message];
}

/// Profile photo uploading
class ProfilePhotoUploading extends ProfileState {
  const ProfilePhotoUploading({
    this.progress = 0,
  });

  final double progress;

  @override
  List<Object?> get props => [progress];
}

/// Saved places loading
class SavedPlacesLoading extends ProfileState {
  const SavedPlacesLoading();
}

/// Saved places loaded
class SavedPlacesLoaded extends ProfileState {
  const SavedPlacesLoaded({
    required this.places,
  });

  final List<SavedPlace> places;

  @override
  List<Object?> get props => [places];

  SavedPlace? get homePlace =>
      places.where((p) => p.type == 'home').firstOrNull;

  SavedPlace? get workPlace =>
      places.where((p) => p.type == 'work').firstOrNull;

  List<SavedPlace> get otherPlaces =>
      places.where((p) => p.type != 'home' && p.type != 'work').toList();
}

/// Saved place added
class SavedPlaceAddedState extends ProfileState {
  const SavedPlaceAddedState({
    required this.place,
  });

  final SavedPlace place;

  @override
  List<Object?> get props => [place];
}

/// Saved place deleted
class SavedPlaceDeletedState extends ProfileState {
  const SavedPlaceDeletedState({
    required this.placeId,
  });

  final String placeId;

  @override
  List<Object?> get props => [placeId];
}

/// Payment methods loading
class PaymentMethodsLoading extends ProfileState {
  const PaymentMethodsLoading();
}

/// Payment methods loaded
class PaymentMethodsLoaded extends ProfileState {
  const PaymentMethodsLoaded({
    required this.paymentMethods,
  });

  final List<PaymentMethod> paymentMethods;

  @override
  List<Object?> get props => [paymentMethods];

  PaymentMethod? get defaultMethod =>
      paymentMethods.where((m) => m.isDefault).firstOrNull;
}

/// Payment method added
class PaymentMethodAddedState extends ProfileState {
  const PaymentMethodAddedState({
    required this.paymentMethod,
  });

  final PaymentMethod paymentMethod;

  @override
  List<Object?> get props => [paymentMethod];
}

/// Payment method deleted
class PaymentMethodDeletedState extends ProfileState {
  const PaymentMethodDeletedState({
    required this.paymentMethodId,
  });

  final String paymentMethodId;

  @override
  List<Object?> get props => [paymentMethodId];
}

/// User stats loaded
class UserStatsLoaded extends ProfileState {
  const UserStatsLoaded({
    required this.stats,
  });

  final UserStats stats;

  @override
  List<Object?> get props => [stats];
}

/// Transaction history loading
class TransactionHistoryLoading extends ProfileState {
  const TransactionHistoryLoading();
}

/// Transaction history loaded
class TransactionHistoryLoaded extends ProfileState {
  const TransactionHistoryLoaded({
    required this.transactions,
    required this.hasMore,
    this.currentPage = 1,
  });

  final List<Transaction> transactions;
  final bool hasMore;
  final int currentPage;

  @override
  List<Object?> get props => [transactions, hasMore, currentPage];
}

/// Settings loading
class SettingsLoading extends ProfileState {
  const SettingsLoading();
}

/// Settings loaded
class SettingsLoaded extends ProfileState {
  const SettingsLoaded({
    required this.settings,
  });

  final UserSettings settings;

  @override
  List<Object?> get props => [settings];
}

/// Settings updated
class SettingsUpdatedState extends ProfileState {
  const SettingsUpdatedState({
    required this.settings,
  });

  final UserSettings settings;

  @override
  List<Object?> get props => [settings];
}

/// Local data cleared
class LocalDataClearedState extends ProfileState {
  const LocalDataClearedState();
}

/// Data export requested
class DataExportRequestedState extends ProfileState {
  const DataExportRequestedState({
    this.downloadUrl,
    this.message,
  });

  final String? downloadUrl;
  final String? message;

  @override
  List<Object?> get props => [downloadUrl, message];
}

/// Account deletion requested
class AccountDeletionRequestedState extends ProfileState {
  const AccountDeletionRequestedState({
    this.message,
  });

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Notifications loading
class NotificationsLoading extends ProfileState {
  const NotificationsLoading();
}

/// Notifications loaded
class NotificationsLoaded extends ProfileState {
  const NotificationsLoaded({
    required this.notifications,
  });

  final List<AppNotification> notifications;

  @override
  List<Object?> get props => [notifications];

  int get unreadCount => notifications.where((n) => !n.isRead).length;
}

/// Promotions loading
class PromotionsLoading extends ProfileState {
  const PromotionsLoading();
}

/// Promotions loaded
class PromotionsLoaded extends ProfileState {
  const PromotionsLoaded({
    required this.promotions,
  });

  final List<Promotion> promotions;

  @override
  List<Object?> get props => [promotions];
}

/// Promo code submitted
class PromoCodeSubmittedState extends ProfileState {
  const PromoCodeSubmittedState({
    required this.promotion,
  });

  final Promotion promotion;

  @override
  List<Object?> get props => [promotion];
}

/// Promo code invalid
class PromoCodeInvalidState extends ProfileState {
  const PromoCodeInvalidState({
    required this.message,
  });

  final String message;

  @override
  List<Object?> get props => [message];
}

/// Verification sent
class VerificationSentState extends ProfileState {
  const VerificationSentState({
    required this.verificationType,
    required this.destination,
  });

  final String verificationType;
  final String destination;

  @override
  List<Object?> get props => [verificationType, destination];
}

/// Logged out
class LoggedOutState extends ProfileState {
  const LoggedOutState();
}

/// Error state
class ProfileError extends ProfileState {
  const ProfileError({
    required this.message,
    this.previousState,
  });

  final String message;
  final ProfileState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}

// Supporting models

/// User profile model
class UserProfile {
  const UserProfile({
    required this.id,
    required this.phoneNumber,
    this.firstName,
    this.lastName,
    this.email,
    this.photoUrl,
    this.isEmailVerified = false,
    this.isPhoneVerified = true,
    this.createdAt,
  });

  final String id;
  final String phoneNumber;
  final String? firstName;
  final String? lastName;
  final String? email;
  final String? photoUrl;
  final bool isEmailVerified;
  final bool isPhoneVerified;
  final DateTime? createdAt;

  String get fullName {
    if (firstName != null && lastName != null) {
      return '$firstName $lastName';
    }
    return firstName ?? lastName ?? 'User';
  }

  String get initials {
    final first = firstName?.isNotEmpty == true ? firstName![0] : '';
    final last = lastName?.isNotEmpty == true ? lastName![0] : '';
    return '$first$last'.toUpperCase();
  }

  UserProfile copyWith({
    String? id,
    String? phoneNumber,
    String? firstName,
    String? lastName,
    String? email,
    String? photoUrl,
    bool? isEmailVerified,
    bool? isPhoneVerified,
    DateTime? createdAt,
  }) {
    return UserProfile(
      id: id ?? this.id,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      firstName: firstName ?? this.firstName,
      lastName: lastName ?? this.lastName,
      email: email ?? this.email,
      photoUrl: photoUrl ?? this.photoUrl,
      isEmailVerified: isEmailVerified ?? this.isEmailVerified,
      isPhoneVerified: isPhoneVerified ?? this.isPhoneVerified,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}

/// User statistics
class UserStats {
  const UserStats({
    required this.totalRides,
    required this.totalFoodOrders,
    required this.totalDeliveries,
    required this.totalSpent,
    this.rating,
    this.memberSince,
  });

  final int totalRides;
  final int totalFoodOrders;
  final int totalDeliveries;
  final double totalSpent;
  final double? rating;
  final DateTime? memberSince;
}

/// Saved place model
class SavedPlace {
  const SavedPlace({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.type,
    this.isDefault = false,
  });

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? type;
  final bool isDefault;

  SavedPlace copyWith({
    String? id,
    String? name,
    String? address,
    double? latitude,
    double? longitude,
    String? type,
    bool? isDefault,
  }) {
    return SavedPlace(
      id: id ?? this.id,
      name: name ?? this.name,
      address: address ?? this.address,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      type: type ?? this.type,
      isDefault: isDefault ?? this.isDefault,
    );
  }
}

/// Payment method type
enum PaymentMethodType {
  mpesa,
  mtnMomo,
  airtelMoney,
  card,
  cash,
}

extension PaymentMethodTypeExtension on PaymentMethodType {
  String get displayName {
    switch (this) {
      case PaymentMethodType.mpesa:
        return 'M-Pesa';
      case PaymentMethodType.mtnMomo:
        return 'MTN Mobile Money';
      case PaymentMethodType.airtelMoney:
        return 'Airtel Money';
      case PaymentMethodType.card:
        return 'Card';
      case PaymentMethodType.cash:
        return 'Cash';
    }
  }

  String get icon {
    switch (this) {
      case PaymentMethodType.mpesa:
        return 'assets/icons/mpesa.png';
      case PaymentMethodType.mtnMomo:
        return 'assets/icons/mtn.png';
      case PaymentMethodType.airtelMoney:
        return 'assets/icons/airtel.png';
      case PaymentMethodType.card:
        return 'assets/icons/card.png';
      case PaymentMethodType.cash:
        return 'assets/icons/cash.png';
    }
  }
}

/// Payment method model
class PaymentMethod {
  const PaymentMethod({
    required this.id,
    required this.type,
    required this.displayName,
    this.details,
    this.lastFour,
    this.isDefault = false,
    this.isVerified = true,
  });

  final String id;
  final PaymentMethodType type;
  final String displayName;
  final Map<String, dynamic>? details;
  final String? lastFour;
  final bool isDefault;
  final bool isVerified;
}

/// Transaction type
enum TransactionType {
  ride,
  food,
  delivery,
  topUp,
  refund,
  promotion,
}

/// Transaction model
class Transaction {
  const Transaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.currency,
    required this.description,
    required this.createdAt,
    this.status,
    this.referenceId,
  });

  final String id;
  final TransactionType type;
  final double amount;
  final String currency;
  final String description;
  final DateTime createdAt;
  final String? status;
  final String? referenceId;
}

/// User settings
class UserSettings {
  const UserSettings({
    this.language = 'en',
    this.currency = 'KES',
    this.pushNotifications = true,
    this.emailNotifications = true,
    this.smsNotifications = false,
    this.darkMode = false,
    this.biometricAuth = false,
  });

  final String language;
  final String currency;
  final bool pushNotifications;
  final bool emailNotifications;
  final bool smsNotifications;
  final bool darkMode;
  final bool biometricAuth;

  UserSettings copyWith({
    String? language,
    String? currency,
    bool? pushNotifications,
    bool? emailNotifications,
    bool? smsNotifications,
    bool? darkMode,
    bool? biometricAuth,
  }) {
    return UserSettings(
      language: language ?? this.language,
      currency: currency ?? this.currency,
      pushNotifications: pushNotifications ?? this.pushNotifications,
      emailNotifications: emailNotifications ?? this.emailNotifications,
      smsNotifications: smsNotifications ?? this.smsNotifications,
      darkMode: darkMode ?? this.darkMode,
      biometricAuth: biometricAuth ?? this.biometricAuth,
    );
  }
}

/// App notification
class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    this.type,
    this.imageUrl,
    this.actionUrl,
    this.isRead = false,
  });

  final String id;
  final String title;
  final String body;
  final DateTime createdAt;
  final String? type;
  final String? imageUrl;
  final String? actionUrl;
  final bool isRead;
}

/// Promotion model
class Promotion {
  const Promotion({
    required this.id,
    required this.code,
    required this.title,
    required this.description,
    required this.discountType,
    required this.discountValue,
    this.minimumAmount,
    this.maximumDiscount,
    this.validFrom,
    this.validUntil,
    this.usageLimit,
    this.usedCount = 0,
    this.applicableServices,
  });

  final String id;
  final String code;
  final String title;
  final String description;
  final String discountType; // 'percentage' or 'fixed'
  final double discountValue;
  final double? minimumAmount;
  final double? maximumDiscount;
  final DateTime? validFrom;
  final DateTime? validUntil;
  final int? usageLimit;
  final int usedCount;
  final List<String>? applicableServices;

  bool get isValid {
    final now = DateTime.now();
    if (validFrom != null && now.isBefore(validFrom!)) return false;
    if (validUntil != null && now.isAfter(validUntil!)) return false;
    if (usageLimit != null && usedCount >= usageLimit!) return false;
    return true;
  }
}
