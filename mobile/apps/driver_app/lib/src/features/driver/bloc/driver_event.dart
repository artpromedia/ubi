part of 'driver_bloc.dart';

/// Base class for all driver events
sealed class DriverEvent extends Equatable {
  const DriverEvent();

  @override
  List<Object?> get props => [];
}

/// Initialize driver state
class DriverInitialized extends DriverEvent {
  const DriverInitialized();
}

/// Toggle online/offline status
class DriverStatusToggled extends DriverEvent {
  const DriverStatusToggled();
}

/// Go online
class DriverWentOnline extends DriverEvent {
  const DriverWentOnline();
}

/// Go offline
class DriverWentOffline extends DriverEvent {
  const DriverWentOffline();
}

/// Update driver location
class DriverLocationUpdated extends DriverEvent {
  const DriverLocationUpdated({
    required this.latitude,
    required this.longitude,
    this.heading,
    this.speed,
  });

  final double latitude;
  final double longitude;
  final double? heading;
  final double? speed;

  @override
  List<Object?> get props => [latitude, longitude, heading, speed];
}

/// Load driver profile
class DriverProfileLoaded extends DriverEvent {
  const DriverProfileLoaded();
}

/// Update service types (ride, food, delivery)
class DriverServiceTypesUpdated extends DriverEvent {
  const DriverServiceTypesUpdated({required this.serviceTypes});

  final List<ServiceType> serviceTypes;

  @override
  List<Object?> get props => [serviceTypes];
}

/// Toggle specific service type
class DriverServiceTypeToggled extends DriverEvent {
  const DriverServiceTypeToggled({required this.serviceType});

  final ServiceType serviceType;

  @override
  List<Object?> get props => [serviceType];
}

/// Update vehicle info
class DriverVehicleUpdated extends DriverEvent {
  const DriverVehicleUpdated({required this.vehicle});

  final VehicleInfo vehicle;

  @override
  List<Object?> get props => [vehicle];
}

/// Load today's stats
class DriverStatsLoaded extends DriverEvent {
  const DriverStatsLoaded();
}

/// New trip request received
class DriverTripRequestReceived extends DriverEvent {
  const DriverTripRequestReceived({required this.request});

  final TripRequest request;

  @override
  List<Object?> get props => [request];
}

/// Accept trip request
class DriverTripRequestAccepted extends DriverEvent {
  const DriverTripRequestAccepted({required this.requestId});

  final String requestId;

  @override
  List<Object?> get props => [requestId];
}

/// Decline trip request
class DriverTripRequestDeclined extends DriverEvent {
  const DriverTripRequestDeclined({required this.requestId});

  final String requestId;

  @override
  List<Object?> get props => [requestId];
}

/// Trip request timed out
class DriverTripRequestTimedOut extends DriverEvent {
  const DriverTripRequestTimedOut({required this.requestId});

  final String requestId;

  @override
  List<Object?> get props => [requestId];
}

/// Start break
class DriverBreakStarted extends DriverEvent {
  const DriverBreakStarted();
}

/// End break
class DriverBreakEnded extends DriverEvent {
  const DriverBreakEnded();
}

/// Check documents status
class DriverDocumentsChecked extends DriverEvent {
  const DriverDocumentsChecked();
}

/// Update notification preferences
class DriverNotificationPrefsUpdated extends DriverEvent {
  const DriverNotificationPrefsUpdated({
    this.soundEnabled,
    this.vibrationEnabled,
    this.autoAccept,
  });

  final bool? soundEnabled;
  final bool? vibrationEnabled;
  final bool? autoAccept;

  @override
  List<Object?> get props => [soundEnabled, vibrationEnabled, autoAccept];
}

/// Reset driver state
class DriverReset extends DriverEvent {
  const DriverReset();
}

/// Enums and models
enum ServiceType { ride, food, delivery, courier }

enum DriverStatus { offline, online, busy, onBreak }

class VehicleInfo extends Equatable {
  const VehicleInfo({
    required this.id,
    required this.make,
    required this.model,
    required this.year,
    required this.color,
    required this.licensePlate,
    required this.vehicleType,
    this.photoUrl,
  });

  final String id;
  final String make;
  final String model;
  final int year;
  final String color;
  final String licensePlate;
  final String vehicleType;
  final String? photoUrl;

  String get displayName => '$year $make $model';

  @override
  List<Object?> get props => [
        id,
        make,
        model,
        year,
        color,
        licensePlate,
        vehicleType,
        photoUrl,
      ];
}

class TripRequest extends Equatable {
  const TripRequest({
    required this.id,
    required this.type,
    required this.pickupAddress,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffAddress,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.estimatedFare,
    required this.estimatedDistance,
    required this.estimatedDuration,
    required this.expiresAt,
    this.riderName,
    this.riderRating,
    this.surgeMultiplier,
    this.notes,
  });

  final String id;
  final ServiceType type;
  final String pickupAddress;
  final double pickupLatitude;
  final double pickupLongitude;
  final String dropoffAddress;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final double estimatedFare;
  final double estimatedDistance;
  final int estimatedDuration;
  final DateTime expiresAt;
  final String? riderName;
  final double? riderRating;
  final double? surgeMultiplier;
  final String? notes;

  bool get isExpired => DateTime.now().isAfter(expiresAt);
  int get secondsRemaining => expiresAt.difference(DateTime.now()).inSeconds;

  @override
  List<Object?> get props => [
        id,
        type,
        pickupAddress,
        pickupLatitude,
        pickupLongitude,
        dropoffAddress,
        dropoffLatitude,
        dropoffLongitude,
        estimatedFare,
        estimatedDistance,
        estimatedDuration,
        expiresAt,
        riderName,
        riderRating,
        surgeMultiplier,
        notes,
      ];
}

class DriverStats extends Equatable {
  const DriverStats({
    required this.todayTrips,
    required this.todayEarnings,
    required this.todayHoursOnline,
    required this.acceptanceRate,
    required this.cancellationRate,
    required this.rating,
  });

  factory DriverStats.empty() => const DriverStats(
        todayTrips: 0,
        todayEarnings: 0,
        todayHoursOnline: 0,
        acceptanceRate: 0,
        cancellationRate: 0,
        rating: 0,
      );

  final int todayTrips;
  final double todayEarnings;
  final double todayHoursOnline;
  final double acceptanceRate;
  final double cancellationRate;
  final double rating;

  @override
  List<Object?> get props => [
        todayTrips,
        todayEarnings,
        todayHoursOnline,
        acceptanceRate,
        cancellationRate,
        rating,
      ];
}
