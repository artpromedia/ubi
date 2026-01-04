/// User Service
///
/// API service for user profile and settings endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

part 'user_service.g.dart';

/// User API Service
///
/// Handles user profile, preferences, and account management.
@RestApi()
abstract class UserService {
  factory UserService(Dio dio, {String baseUrl}) = _UserService;

  /// Get current user profile
  @GET('/users/me')
  Future<UserDto> getCurrentUser();

  /// Update user profile
  @PATCH('/users/me')
  Future<UserDto> updateProfile(@Body() UpdateProfileDto request);

  /// Update profile image
  @POST('/users/me/profile-image')
  @MultiPart()
  Future<ProfileImageResponseDto> updateProfileImage(
    @Part(name: 'image') List<int> imageBytes,
    @Part(name: 'filename') String filename,
  );

  /// Delete profile image
  @DELETE('/users/me/profile-image')
  Future<void> deleteProfileImage();

  /// Get user preferences
  @GET('/users/preferences')
  Future<UserPreferencesDto> getPreferences();

  /// Update user preferences
  @PATCH('/users/preferences')
  Future<UserPreferencesDto> updatePreferences(
    @Body() UpdatePreferencesDto request,
  );

  /// Get saved places
  @GET('/users/saved-places')
  Future<List<SavedPlaceDto>> getSavedPlaces();

  /// Add saved place
  @POST('/users/saved-places')
  Future<SavedPlaceDto> addSavedPlace(@Body() CreateSavedPlaceDto request);

  /// Update saved place
  @PATCH('/users/saved-places/{id}')
  Future<SavedPlaceDto> updateSavedPlace(
    @Path('id') String id,
    @Body() UpdateSavedPlaceDto request,
  );

  /// Delete saved place
  @DELETE('/users/saved-places/{id}')
  Future<void> deleteSavedPlace(@Path('id') String id);

  /// Get payment methods
  @GET('/users/payment-methods')
  Future<List<PaymentMethodDto>> getPaymentMethods();

  /// Add payment method
  @POST('/users/payment-methods')
  Future<PaymentMethodDto> addPaymentMethod(@Body() CreatePaymentMethodDto request);

  /// Set default payment method
  @POST('/users/payment-methods/{id}/default')
  Future<PaymentMethodDto> setDefaultPaymentMethod(@Path('id') String id);

  /// Delete payment method
  @DELETE('/users/payment-methods/{id}')
  Future<void> deletePaymentMethod(@Path('id') String id);

  /// Get ride history
  @GET('/users/rides')
  Future<PaginatedResponseDto<RideHistoryItemDto>> getRideHistory(
    @Query('page') int page,
    @Query('limit') int limit,
  );

  /// Get order history
  @GET('/users/orders')
  Future<PaginatedResponseDto<OrderHistoryItemDto>> getOrderHistory(
    @Query('page') int page,
    @Query('limit') int limit,
  );

  /// Get wallet balance
  @GET('/users/wallet')
  Future<WalletDto> getWallet();

  /// Get wallet transactions
  @GET('/users/wallet/transactions')
  Future<PaginatedResponseDto<WalletTransactionDto>> getWalletTransactions(
    @Query('page') int page,
    @Query('limit') int limit,
  );

  /// Delete account
  @DELETE('/users/me')
  Future<void> deleteAccount(@Body() DeleteAccountDto request);
}

// === User DTOs ===

@JsonSerializable()
class UserDto {
  const UserDto({
    required this.id,
    required this.phoneNumber,
    this.email,
    this.firstName,
    this.lastName,
    this.profileImageUrl,
    this.rating,
    this.totalRides,
    this.totalOrders,
    this.isVerified,
    this.role,
    this.createdAt,
    this.updatedAt,
  });

  factory UserDto.fromJson(Map<String, dynamic> json) =>
      _$UserDtoFromJson(json);

  final String id;
  final String phoneNumber;
  final String? email;
  final String? firstName;
  final String? lastName;
  final String? profileImageUrl;
  final double? rating;
  final int? totalRides;
  final int? totalOrders;
  final bool? isVerified;
  final String? role;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  Map<String, dynamic> toJson() => _$UserDtoToJson(this);
}

@JsonSerializable()
class UpdateProfileDto {
  const UpdateProfileDto({
    this.firstName,
    this.lastName,
    this.email,
  });

  factory UpdateProfileDto.fromJson(Map<String, dynamic> json) =>
      _$UpdateProfileDtoFromJson(json);

  final String? firstName;
  final String? lastName;
  final String? email;

  Map<String, dynamic> toJson() => _$UpdateProfileDtoToJson(this);
}

@JsonSerializable()
class ProfileImageResponseDto {
  const ProfileImageResponseDto({required this.imageUrl});

  factory ProfileImageResponseDto.fromJson(Map<String, dynamic> json) =>
      _$ProfileImageResponseDtoFromJson(json);

  final String imageUrl;

  Map<String, dynamic> toJson() => _$ProfileImageResponseDtoToJson(this);
}

// === Preferences DTOs ===

@JsonSerializable()
class UserPreferencesDto {
  const UserPreferencesDto({
    this.language,
    this.currency,
    this.notificationsEnabled,
    this.emailNotifications,
    this.smsNotifications,
    this.pushNotifications,
    this.darkMode,
    this.defaultPaymentMethodId,
    this.defaultVehicleType,
  });

  factory UserPreferencesDto.fromJson(Map<String, dynamic> json) =>
      _$UserPreferencesDtoFromJson(json);

  final String? language;
  final String? currency;
  final bool? notificationsEnabled;
  final bool? emailNotifications;
  final bool? smsNotifications;
  final bool? pushNotifications;
  final bool? darkMode;
  final String? defaultPaymentMethodId;
  final String? defaultVehicleType;

  Map<String, dynamic> toJson() => _$UserPreferencesDtoToJson(this);
}

@JsonSerializable()
class UpdatePreferencesDto {
  const UpdatePreferencesDto({
    this.language,
    this.currency,
    this.notificationsEnabled,
    this.emailNotifications,
    this.smsNotifications,
    this.pushNotifications,
    this.darkMode,
    this.defaultPaymentMethodId,
    this.defaultVehicleType,
  });

  factory UpdatePreferencesDto.fromJson(Map<String, dynamic> json) =>
      _$UpdatePreferencesDtoFromJson(json);

  final String? language;
  final String? currency;
  final bool? notificationsEnabled;
  final bool? emailNotifications;
  final bool? smsNotifications;
  final bool? pushNotifications;
  final bool? darkMode;
  final String? defaultPaymentMethodId;
  final String? defaultVehicleType;

  Map<String, dynamic> toJson() => _$UpdatePreferencesDtoToJson(this);
}

// === Saved Places DTOs ===

@JsonSerializable()
class SavedPlaceDto {
  const SavedPlaceDto({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.icon,
    this.placeType,
    this.createdAt,
  });

  factory SavedPlaceDto.fromJson(Map<String, dynamic> json) =>
      _$SavedPlaceDtoFromJson(json);

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? icon;
  final String? placeType;
  final DateTime? createdAt;

  Map<String, dynamic> toJson() => _$SavedPlaceDtoToJson(this);
}

@JsonSerializable()
class CreateSavedPlaceDto {
  const CreateSavedPlaceDto({
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.icon,
    this.placeType,
  });

  factory CreateSavedPlaceDto.fromJson(Map<String, dynamic> json) =>
      _$CreateSavedPlaceDtoFromJson(json);

  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? icon;
  final String? placeType;

  Map<String, dynamic> toJson() => _$CreateSavedPlaceDtoToJson(this);
}

@JsonSerializable()
class UpdateSavedPlaceDto {
  const UpdateSavedPlaceDto({
    this.name,
    this.address,
    this.latitude,
    this.longitude,
    this.icon,
    this.placeType,
  });

  factory UpdateSavedPlaceDto.fromJson(Map<String, dynamic> json) =>
      _$UpdateSavedPlaceDtoFromJson(json);

  final String? name;
  final String? address;
  final double? latitude;
  final double? longitude;
  final String? icon;
  final String? placeType;

  Map<String, dynamic> toJson() => _$UpdateSavedPlaceDtoToJson(this);
}

// === Payment Method DTOs ===

@JsonSerializable()
class PaymentMethodDto {
  const PaymentMethodDto({
    required this.id,
    required this.type,
    required this.displayName,
    this.last4,
    this.brand,
    this.expiryMonth,
    this.expiryYear,
    this.isDefault,
    this.phoneNumber,
    this.provider,
    this.createdAt,
  });

  factory PaymentMethodDto.fromJson(Map<String, dynamic> json) =>
      _$PaymentMethodDtoFromJson(json);

  final String id;
  final String type; // 'card', 'mpesa', 'mtn', 'wallet', 'cash'
  final String displayName;
  final String? last4;
  final String? brand;
  final int? expiryMonth;
  final int? expiryYear;
  final bool? isDefault;
  final String? phoneNumber;
  final String? provider;
  final DateTime? createdAt;

  Map<String, dynamic> toJson() => _$PaymentMethodDtoToJson(this);
}

@JsonSerializable()
class CreatePaymentMethodDto {
  const CreatePaymentMethodDto({
    required this.type,
    this.stripePaymentMethodId,
    this.phoneNumber,
    this.provider,
  });

  factory CreatePaymentMethodDto.fromJson(Map<String, dynamic> json) =>
      _$CreatePaymentMethodDtoFromJson(json);

  final String type;
  final String? stripePaymentMethodId;
  final String? phoneNumber;
  final String? provider;

  Map<String, dynamic> toJson() => _$CreatePaymentMethodDtoToJson(this);
}

// === History DTOs ===

@JsonSerializable()
class RideHistoryItemDto {
  const RideHistoryItemDto({
    required this.id,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.fare,
    required this.currency,
    required this.createdAt,
    this.driverName,
    this.driverRating,
    this.vehicleType,
    this.distance,
    this.duration,
    this.rating,
  });

  factory RideHistoryItemDto.fromJson(Map<String, dynamic> json) =>
      _$RideHistoryItemDtoFromJson(json);

  final String id;
  final String status;
  final String pickupAddress;
  final String dropoffAddress;
  final double fare;
  final String currency;
  final DateTime createdAt;
  final String? driverName;
  final double? driverRating;
  final String? vehicleType;
  final double? distance;
  final int? duration;
  final int? rating;

  Map<String, dynamic> toJson() => _$RideHistoryItemDtoToJson(this);
}

@JsonSerializable()
class OrderHistoryItemDto {
  const OrderHistoryItemDto({
    required this.id,
    required this.type,
    required this.status,
    required this.total,
    required this.currency,
    required this.createdAt,
    this.restaurantName,
    this.itemCount,
    this.deliveryAddress,
    this.rating,
  });

  factory OrderHistoryItemDto.fromJson(Map<String, dynamic> json) =>
      _$OrderHistoryItemDtoFromJson(json);

  final String id;
  final String type; // 'food', 'delivery'
  final String status;
  final double total;
  final String currency;
  final DateTime createdAt;
  final String? restaurantName;
  final int? itemCount;
  final String? deliveryAddress;
  final int? rating;

  Map<String, dynamic> toJson() => _$OrderHistoryItemDtoToJson(this);
}

// === Wallet DTOs ===

@JsonSerializable()
class WalletDto {
  const WalletDto({
    required this.balance,
    required this.currency,
    this.pendingBalance,
  });

  factory WalletDto.fromJson(Map<String, dynamic> json) =>
      _$WalletDtoFromJson(json);

  final double balance;
  final String currency;
  final double? pendingBalance;

  Map<String, dynamic> toJson() => _$WalletDtoToJson(this);
}

@JsonSerializable()
class WalletTransactionDto {
  const WalletTransactionDto({
    required this.id,
    required this.type,
    required this.amount,
    required this.currency,
    required this.status,
    required this.createdAt,
    this.description,
    this.referenceId,
  });

  factory WalletTransactionDto.fromJson(Map<String, dynamic> json) =>
      _$WalletTransactionDtoFromJson(json);

  final String id;
  final String type; // 'credit', 'debit', 'refund', 'topup', 'withdrawal'
  final double amount;
  final String currency;
  final String status;
  final DateTime createdAt;
  final String? description;
  final String? referenceId;

  Map<String, dynamic> toJson() => _$WalletTransactionDtoToJson(this);
}

// === Common DTOs ===

@JsonSerializable(genericArgumentFactories: true)
class PaginatedResponseDto<T> {
  const PaginatedResponseDto({
    required this.data,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  factory PaginatedResponseDto.fromJson(
    Map<String, dynamic> json,
    T Function(Object? json) fromJsonT,
  ) =>
      _$PaginatedResponseDtoFromJson(json, fromJsonT);

  final List<T> data;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  bool get hasMore => page < totalPages;

  Map<String, dynamic> toJson(Object? Function(T value) toJsonT) =>
      _$PaginatedResponseDtoToJson(this, toJsonT);
}

@JsonSerializable()
class DeleteAccountDto {
  const DeleteAccountDto({
    required this.confirmation,
    this.reason,
  });

  factory DeleteAccountDto.fromJson(Map<String, dynamic> json) =>
      _$DeleteAccountDtoFromJson(json);

  final String confirmation; // Must be 'DELETE'
  final String? reason;

  Map<String, dynamic> toJson() => _$DeleteAccountDtoToJson(this);
}
