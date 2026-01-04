/// Ride Collection
///
/// Isar collection for caching ride data.
library;

import 'package:isar/isar.dart';

part 'ride_collection.g.dart';

/// Cached ride entity
@collection
class CachedRide {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  // Status
  late String status;
  
  @Index()
  late bool isActive;

  // Locations
  late double pickupLatitude;
  late double pickupLongitude;
  late String pickupAddress;
  late double dropoffLatitude;
  late double dropoffLongitude;
  late String dropoffAddress;

  // Vehicle
  late String vehicleType;

  // Driver
  String? driverId;
  String? driverName;
  String? driverPhotoUrl;
  double? driverRating;
  String? vehicleMake;
  String? vehicleModel;
  String? vehicleColor;
  String? vehiclePlate;

  // Pricing
  late double estimatedFare;
  double? actualFare;
  String? currency;
  double? tip;

  // Times
  DateTime? requestedAt;
  DateTime? acceptedAt;
  DateTime? arrivedAt;
  DateTime? startedAt;
  DateTime? completedAt;
  DateTime? cancelledAt;
  int? estimatedDuration; // seconds
  double? estimatedDistance; // meters

  // Rating
  int? userRating;
  String? userReview;

  // Metadata
  @Index()
  DateTime? createdAt;
  DateTime cachedAt = DateTime.now();
}
