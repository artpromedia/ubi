import 'package:freezed_annotation/freezed_annotation.dart';
import 'location.dart';

part 'ride.freezed.dart';
part 'ride.g.dart';

/// Ride status
enum RideStatus {
  @JsonValue('pending')
  pending,
  @JsonValue('searching')
  searching,
  @JsonValue('driver_assigned')
  driverAssigned,
  @JsonValue('driver_arriving')
  driverArriving,
  @JsonValue('driver_arrived')
  driverArrived,
  @JsonValue('in_progress')
  inProgress,
  @JsonValue('completed')
  completed,
  @JsonValue('cancelled')
  cancelled,
  @JsonValue('no_drivers')
  noDrivers,
}

/// Vehicle type for rides
enum VehicleType {
  @JsonValue('ubi_x')
  ubiX,
  @JsonValue('ubi_comfort')
  ubiComfort,
  @JsonValue('ubi_xl')
  ubiXL,
  @JsonValue('ubi_lux')
  ubiLux,
  @JsonValue('ubi_moto')
  ubiMoto,
}

/// Cancellation reason
enum CancellationReason {
  @JsonValue('changed_mind')
  changedMind,
  @JsonValue('driver_too_far')
  driverTooFar,
  @JsonValue('wrong_pickup')
  wrongPickup,
  @JsonValue('driver_asked')
  driverAsked,
  @JsonValue('other')
  other,
}

/// Ride entity
@freezed
class Ride with _$Ride {
  const Ride._();

  const factory Ride({
    required String id,
    required String riderId,
    required GeoLocation pickupLocation,
    required GeoLocation dropoffLocation,
    required String pickupAddress,
    required String dropoffAddress,
    required VehicleType vehicleType,
    required RideStatus status,
    String? driverId,
    Driver? driver,
    Vehicle? vehicle,
    double? estimatedFare,
    double? actualFare,
    String? currency,
    int? estimatedDurationMinutes,
    double? estimatedDistanceKm,
    int? actualDurationMinutes,
    double? actualDistanceKm,
    DateTime? requestedAt,
    DateTime? acceptedAt,
    DateTime? arrivedAt,
    DateTime? startedAt,
    DateTime? completedAt,
    DateTime? cancelledAt,
    CancellationReason? cancellationReason,
    String? cancellationNote,
    String? cancelledBy,
    double? driverRating,
    String? driverReview,
    double? riderRating,
    String? riderReview,
    String? paymentMethodId,
    String? paymentId,
    List<GeoLocation>? routePolyline,
    Map<String, dynamic>? metadata,
  }) = _Ride;

  factory Ride.fromJson(Map<String, dynamic> json) => _$RideFromJson(json);

  /// Check if ride is active
  bool get isActive {
    return status == RideStatus.searching ||
        status == RideStatus.driverAssigned ||
        status == RideStatus.driverArriving ||
        status == RideStatus.driverArrived ||
        status == RideStatus.inProgress;
  }

  /// Check if ride can be cancelled
  bool get canCancel {
    return status == RideStatus.pending ||
        status == RideStatus.searching ||
        status == RideStatus.driverAssigned ||
        status == RideStatus.driverArriving;
  }

  /// Check if ride is completed
  bool get isCompleted => status == RideStatus.completed;

  /// Check if ride is cancelled
  bool get isCancelled => status == RideStatus.cancelled;

  /// Get display fare
  String get displayFare {
    final fare = actualFare ?? estimatedFare;
    if (fare == null) return '--';
    final curr = currency ?? 'NGN';
    return '$curr ${fare.toStringAsFixed(0)}';
  }

  /// Get ETA display
  String get etaDisplay {
    final duration = estimatedDurationMinutes;
    if (duration == null) return '--';
    if (duration < 60) return '$duration min';
    final hours = duration ~/ 60;
    final mins = duration % 60;
    return '${hours}h ${mins}m';
  }

  /// Get distance display
  String get distanceDisplay {
    final distance = estimatedDistanceKm ?? actualDistanceKm;
    if (distance == null) return '--';
    return '${distance.toStringAsFixed(1)} km';
  }
}

/// Driver information for ride
@freezed
class Driver with _$Driver {
  const factory Driver({
    required String id,
    required String name,
    String? phoneNumber,
    String? profileImageUrl,
    double? rating,
    int? totalTrips,
    GeoLocation? currentLocation,
    int? etaMinutes,
  }) = _Driver;

  factory Driver.fromJson(Map<String, dynamic> json) => _$DriverFromJson(json);
}

/// Vehicle information for ride
@freezed
class Vehicle with _$Vehicle {
  const factory Vehicle({
    required String id,
    required String make,
    required String model,
    required String color,
    required String plateNumber,
    int? year,
    VehicleType? type,
    String? imageUrl,
  }) = _Vehicle;

  factory Vehicle.fromJson(Map<String, dynamic> json) => _$VehicleFromJson(json);
}

/// Ride estimate for booking
@freezed
class RideEstimate with _$RideEstimate {
  const factory RideEstimate({
    required VehicleType vehicleType,
    required double estimatedFare,
    required String currency,
    required int estimatedDurationMinutes,
    required double estimatedDistanceKm,
    required int etaMinutes,
    double? surgePriceMultiplier,
    String? promoCode,
    double? discount,
    bool? isAvailable,
    String? unavailableReason,
  }) = _RideEstimate;

  factory RideEstimate.fromJson(Map<String, dynamic> json) =>
      _$RideEstimateFromJson(json);
}

/// Ride request parameters
@freezed
class RideRequest with _$RideRequest {
  const factory RideRequest({
    required GeoLocation pickupLocation,
    required GeoLocation dropoffLocation,
    required String pickupAddress,
    required String dropoffAddress,
    required VehicleType vehicleType,
    String? paymentMethodId,
    String? promoCode,
    String? note,
    List<GeoLocation>? stops,
  }) = _RideRequest;

  factory RideRequest.fromJson(Map<String, dynamic> json) =>
      _$RideRequestFromJson(json);
}
