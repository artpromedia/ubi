/// User Collection
///
/// Isar collection for caching user data.
library;

import 'package:isar/isar.dart';

part 'user_collection.g.dart';

/// Cached user entity
@collection
class CachedUser {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  late String firstName;
  late String lastName;
  late String phoneNumber;
  late String countryCode;
  String? email;
  String? profileImageUrl;
  
  @Index()
  late bool isCurrentUser;

  // Preferences
  String? preferredLanguage;
  String? preferredCurrency;
  String? defaultPaymentMethodId;
  String? defaultVehicleType;
  bool? notificationsEnabled;

  // Verification
  bool isPhoneVerified = false;
  bool isEmailVerified = false;
  bool isIdentityVerified = false;

  // Metadata
  DateTime? createdAt;
  DateTime? updatedAt;
  DateTime cachedAt = DateTime.now();

  /// Full name
  String get fullName => '$firstName $lastName';

  /// Phone with country code
  String get fullPhone => '$countryCode$phoneNumber';
}

/// Cached saved place entity
@collection
class CachedSavedPlace {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  late String name;
  late String address;
  late double latitude;
  late double longitude;
  String? placeType; // home, work, favorite

  String? instructions;
  String? iconName;

  DateTime cachedAt = DateTime.now();
}
