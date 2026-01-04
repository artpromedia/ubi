part of 'driver_bloc.dart';

/// Base class for all driver states
sealed class DriverState extends Equatable {
  const DriverState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class DriverInitial extends DriverState {
  const DriverInitial();
}

/// Loading state
class DriverLoading extends DriverState {
  const DriverLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Driver is offline
class DriverOffline extends DriverState {
  const DriverOffline({
    this.stats,
    this.vehicle,
    this.activeServiceTypes = const [],
    this.documentsValid = false,
  });

  final DriverStats? stats;
  final VehicleInfo? vehicle;
  final List<ServiceType> activeServiceTypes;
  final bool documentsValid;

  @override
  List<Object?> get props => [stats, vehicle, activeServiceTypes, documentsValid];
}

/// Driver is online and available
class DriverOnline extends DriverState {
  const DriverOnline({
    required this.latitude,
    required this.longitude,
    this.heading,
    this.speed,
    this.stats,
    this.vehicle,
    this.activeServiceTypes = const [],
    this.pendingRequest,
  });

  final double latitude;
  final double longitude;
  final double? heading;
  final double? speed;
  final DriverStats? stats;
  final VehicleInfo? vehicle;
  final List<ServiceType> activeServiceTypes;
  final TripRequest? pendingRequest;

  bool get hasRequest => pendingRequest != null;

  DriverOnline copyWith({
    double? latitude,
    double? longitude,
    double? heading,
    double? speed,
    DriverStats? stats,
    VehicleInfo? vehicle,
    List<ServiceType>? activeServiceTypes,
    TripRequest? pendingRequest,
    bool clearPendingRequest = false,
  }) {
    return DriverOnline(
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      heading: heading ?? this.heading,
      speed: speed ?? this.speed,
      stats: stats ?? this.stats,
      vehicle: vehicle ?? this.vehicle,
      activeServiceTypes: activeServiceTypes ?? this.activeServiceTypes,
      pendingRequest: clearPendingRequest ? null : (pendingRequest ?? this.pendingRequest),
    );
  }

  @override
  List<Object?> get props => [
        latitude,
        longitude,
        heading,
        speed,
        stats,
        vehicle,
        activeServiceTypes,
        pendingRequest,
      ];
}

/// Driver is busy with active trip
class DriverBusy extends DriverState {
  const DriverBusy({
    required this.tripId,
    required this.tripType,
    required this.latitude,
    required this.longitude,
    this.heading,
    this.speed,
    this.stats,
    this.vehicle,
  });

  final String tripId;
  final ServiceType tripType;
  final double latitude;
  final double longitude;
  final double? heading;
  final double? speed;
  final DriverStats? stats;
  final VehicleInfo? vehicle;

  DriverBusy copyWith({
    String? tripId,
    ServiceType? tripType,
    double? latitude,
    double? longitude,
    double? heading,
    double? speed,
    DriverStats? stats,
    VehicleInfo? vehicle,
  }) {
    return DriverBusy(
      tripId: tripId ?? this.tripId,
      tripType: tripType ?? this.tripType,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      heading: heading ?? this.heading,
      speed: speed ?? this.speed,
      stats: stats ?? this.stats,
      vehicle: vehicle ?? this.vehicle,
    );
  }

  @override
  List<Object?> get props => [
        tripId,
        tripType,
        latitude,
        longitude,
        heading,
        speed,
        stats,
        vehicle,
      ];
}

/// Driver is on break
class DriverOnBreak extends DriverState {
  const DriverOnBreak({
    required this.breakStartedAt,
    this.stats,
    this.vehicle,
  });

  final DateTime breakStartedAt;
  final DriverStats? stats;
  final VehicleInfo? vehicle;

  Duration get breakDuration => DateTime.now().difference(breakStartedAt);

  @override
  List<Object?> get props => [breakStartedAt, stats, vehicle];
}

/// Trip request received - waiting for response
class DriverRequestPending extends DriverState {
  const DriverRequestPending({
    required this.request,
    required this.latitude,
    required this.longitude,
    this.heading,
    this.speed,
    this.stats,
    this.vehicle,
  });

  final TripRequest request;
  final double latitude;
  final double longitude;
  final double? heading;
  final double? speed;
  final DriverStats? stats;
  final VehicleInfo? vehicle;

  @override
  List<Object?> get props => [
        request,
        latitude,
        longitude,
        heading,
        speed,
        stats,
        vehicle,
      ];
}

/// Error state
class DriverError extends DriverState {
  const DriverError({
    required this.message,
    this.previousState,
  });

  final String message;
  final DriverState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}
