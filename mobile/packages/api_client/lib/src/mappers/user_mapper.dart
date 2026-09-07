/// User Mapper
///
/// Maps between User DTOs and domain entities.
library;

import 'package:ubi_core/ubi_core.dart';

import '../services/auth_service.dart';
import '../services/user_service.dart';

/// Mapper for User-related DTOs to domain entities
class UserMapper {
  const UserMapper._();

  /// Map AuthUserDto to User entity
  static User fromAuthUserDto(AuthUserDto dto) {
    return User(
      id: dto.id,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      profileImageUrl: dto.profileImageUrl,
      role: _mapRole(dto.role),
      verificationStatus: dto.isVerified == true
          ? VerificationStatus.verified
          : VerificationStatus.pending,
      createdAt: dto.createdAt ?? DateTime.now(),
    );
  }

  /// Map UserDto to User entity
  static User fromUserDto(UserDto dto) {
    return User(
      id: dto.id,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      profileImageUrl: dto.profileImageUrl,
      role: _mapRole(dto.role),
      verificationStatus: dto.isVerified == true
          ? VerificationStatus.verified
          : VerificationStatus.pending,
      rating: dto.rating,
      totalTrips: dto.totalRides ?? 0,
      createdAt: dto.createdAt ?? DateTime.now(),
      updatedAt: dto.updatedAt,
    );
  }

  /// Map UserPreferencesDto to UserPreferences entity
  static UserPreferences fromUserPreferencesDto(UserPreferencesDto dto) {
    return UserPreferences(
      language: dto.language ?? 'en',
      currency: dto.currency,
      pushNotifications:
          dto.pushNotifications ?? dto.notificationsEnabled ?? true,
      emailNotifications: dto.emailNotifications ?? true,
      smsNotifications: dto.smsNotifications ?? true,
      darkMode: dto.darkMode ?? false,
    );
  }

  /// Map SavedPlaceDto to SavedPlace entity
  static SavedPlace fromSavedPlaceDto(SavedPlaceDto dto) {
    return SavedPlace(
      id: dto.id,
      name: dto.name,
      address: dto.address,
      location: GeoLocation(
        latitude: dto.latitude,
        longitude: dto.longitude,
      ),
      type: _mapSavedPlaceType(dto.placeType),
      createdAt: dto.createdAt,
    );
  }

  /// Map User entity to UpdateProfileDto
  static UpdateProfileDto toUpdateProfileDto(User user) {
    return UpdateProfileDto(
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    );
  }

  /// Map SavedPlace to CreateSavedPlaceDto
  static CreateSavedPlaceDto toCreateSavedPlaceDto(SavedPlace place) {
    return CreateSavedPlaceDto(
      name: place.name,
      address: place.address,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      placeType: _savedPlaceTypeToWire(place.type),
    );
  }

  /// Map role string to UserRole enum
  static UserRole _mapRole(String? role) {
    switch (role?.toLowerCase()) {
      case 'driver':
        return UserRole.driver;
      case 'both':
        return UserRole.both;
      case 'rider':
      default:
        return UserRole.rider;
    }
  }

  /// Map saved-place type string to SavedPlaceType enum
  static SavedPlaceType _mapSavedPlaceType(String? placeType) {
    switch (placeType?.toLowerCase()) {
      case 'home':
        return SavedPlaceType.home;
      case 'work':
        return SavedPlaceType.work;
      default:
        return SavedPlaceType.other;
    }
  }

  /// Map SavedPlaceType enum to its wire string
  static String _savedPlaceTypeToWire(SavedPlaceType type) {
    switch (type) {
      case SavedPlaceType.home:
        return 'home';
      case SavedPlaceType.work:
        return 'work';
      case SavedPlaceType.other:
        return 'other';
    }
  }
}

/// Extension for convenient mapping
extension AuthUserDtoExtension on AuthUserDto {
  User toUser() => UserMapper.fromAuthUserDto(this);
}

extension UserDtoExtension on UserDto {
  User toUser() => UserMapper.fromUserDto(this);
}

extension UserPreferencesDtoExtension on UserPreferencesDto {
  UserPreferences toUserPreferences() => UserMapper.fromUserPreferencesDto(this);
}

extension SavedPlaceDtoExtension on SavedPlaceDto {
  SavedPlace toSavedPlace() => UserMapper.fromSavedPlaceDto(this);
}
