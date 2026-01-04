import 'package:freezed_annotation/freezed_annotation.dart';

part 'user.freezed.dart';
part 'user.g.dart';

/// User role in the UBI platform
enum UserRole {
  @JsonValue('rider')
  rider,
  @JsonValue('driver')
  driver,
  @JsonValue('both')
  both,
}

/// User verification status
enum VerificationStatus {
  @JsonValue('unverified')
  unverified,
  @JsonValue('pending')
  pending,
  @JsonValue('verified')
  verified,
  @JsonValue('rejected')
  rejected,
}

/// User entity
@freezed
class User with _$User {
  const User._();

  const factory User({
    required String id,
    required String phoneNumber,
    String? email,
    String? firstName,
    String? lastName,
    String? profileImageUrl,
    @Default(UserRole.rider) UserRole role,
    @Default(VerificationStatus.unverified) VerificationStatus verificationStatus,
    double? rating,
    int? totalTrips,
    DateTime? createdAt,
    DateTime? updatedAt,
    UserPreferences? preferences,
  }) = _User;

  factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);

  /// Get full name
  String get fullName {
    if (firstName == null && lastName == null) return 'User';
    return '${firstName ?? ''} ${lastName ?? ''}'.trim();
  }

  /// Get initials
  String get initials {
    if (firstName == null && lastName == null) return 'U';
    final first = firstName?.isNotEmpty == true ? firstName![0] : '';
    final last = lastName?.isNotEmpty == true ? lastName![0] : '';
    return '$first$last'.toUpperCase();
  }

  /// Check if profile is complete
  bool get isProfileComplete {
    return firstName != null &&
        lastName != null &&
        email != null &&
        verificationStatus == VerificationStatus.verified;
  }

  /// Check if user is a driver
  bool get isDriver => role == UserRole.driver || role == UserRole.both;

  /// Check if user is a rider
  bool get isRider => role == UserRole.rider || role == UserRole.both;
}

/// User preferences
@freezed
class UserPreferences with _$UserPreferences {
  const factory UserPreferences({
    @Default('en') String language,
    @Default('NGN') String currency,
    @Default(true) bool pushNotifications,
    @Default(true) bool emailNotifications,
    @Default(true) bool smsNotifications,
    @Default(false) bool darkMode,
    String? defaultPaymentMethodId,
    String? homeAddressId,
    String? workAddressId,
  }) = _UserPreferences;

  factory UserPreferences.fromJson(Map<String, dynamic> json) =>
      _$UserPreferencesFromJson(json);
}
