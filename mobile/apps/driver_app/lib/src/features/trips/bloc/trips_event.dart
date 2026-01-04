part of 'trips_bloc.dart';

/// Base class for all trips events
sealed class TripsEvent extends Equatable {
  const TripsEvent();

  @override
  List<Object?> get props => [];
}

/// Load active trip
class TripsLoadActive extends TripsEvent {
  const TripsLoadActive({required this.tripId});

  final String tripId;

  @override
  List<Object?> get props => [tripId];
}

/// Arrive at pickup location
class TripsArrivedAtPickup extends TripsEvent {
  const TripsArrivedAtPickup();
}

/// Start the trip (rider picked up / food collected)
class TripsStarted extends TripsEvent {
  const TripsStarted();
}

/// Complete the trip
class TripsCompleted extends TripsEvent {
  const TripsCompleted();
}

/// Cancel the trip
class TripsCancelled extends TripsEvent {
  const TripsCancelled({required this.reason});

  final String reason;

  @override
  List<Object?> get props => [reason];
}

/// Update driver location during trip
class TripsLocationUpdated extends TripsEvent {
  const TripsLocationUpdated({
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

/// Contact rider/customer
class TripsContactCustomer extends TripsEvent {
  const TripsContactCustomer({required this.method});

  final ContactMethod method;

  @override
  List<Object?> get props => [method];
}

/// Report issue with trip
class TripsReportIssue extends TripsEvent {
  const TripsReportIssue({
    required this.issueType,
    this.description,
  });

  final TripIssueType issueType;
  final String? description;

  @override
  List<Object?> get props => [issueType, description];
}

/// Add extra stop
class TripsAddStop extends TripsEvent {
  const TripsAddStop({
    required this.address,
    required this.latitude,
    required this.longitude,
  });

  final String address;
  final double latitude;
  final double longitude;

  @override
  List<Object?> get props => [address, latitude, longitude];
}

/// Skip current stop
class TripsSkipStop extends TripsEvent {
  const TripsSkipStop();
}

/// Update trip route
class TripsRouteUpdated extends TripsEvent {
  const TripsRouteUpdated({required this.routePoints});

  final List<LatLng> routePoints;

  @override
  List<Object?> get props => [routePoints];
}

/// Collect cash payment
class TripsCollectCash extends TripsEvent {
  const TripsCollectCash({required this.amount});

  final double amount;

  @override
  List<Object?> get props => [amount];
}

/// Reset trip state
class TripsReset extends TripsEvent {
  const TripsReset();
}

// Enums
enum ContactMethod { call, message }

enum TripIssueType {
  riderNoShow,
  wrongAddress,
  safetyIssue,
  vehicleIssue,
  roadClosed,
  other,
}

enum TripStage {
  enRouteToPickup,
  arrivedAtPickup,
  inProgress,
  enRouteToDropoff,
  arrivedAtDropoff,
  completed,
  cancelled,
}

// Models
class LatLng extends Equatable {
  const LatLng({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  @override
  List<Object?> get props => [latitude, longitude];
}

class TripStop extends Equatable {
  const TripStop({
    required this.id,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.type,
    this.notes,
    this.completedAt,
  });

  final String id;
  final String address;
  final double latitude;
  final double longitude;
  final StopType type;
  final String? notes;
  final DateTime? completedAt;

  bool get isCompleted => completedAt != null;

  @override
  List<Object?> get props => [id, address, latitude, longitude, type, notes, completedAt];
}

enum StopType { pickup, dropoff, extra }

class ActiveTrip extends Equatable {
  const ActiveTrip({
    required this.id,
    required this.type,
    required this.stage,
    required this.stops,
    required this.currentStopIndex,
    required this.fare,
    required this.paymentMethod,
    required this.startedAt,
    this.customer,
    this.routePoints = const [],
    this.estimatedArrival,
    this.distanceRemaining,
    this.durationRemaining,
    this.notes,
  });

  final String id;
  final String type; // ride, food, delivery
  final TripStage stage;
  final List<TripStop> stops;
  final int currentStopIndex;
  final double fare;
  final String paymentMethod;
  final DateTime startedAt;
  final CustomerInfo? customer;
  final List<LatLng> routePoints;
  final DateTime? estimatedArrival;
  final double? distanceRemaining;
  final int? durationRemaining;
  final String? notes;

  TripStop get currentStop => stops[currentStopIndex];
  bool get isLastStop => currentStopIndex == stops.length - 1;
  bool get isCashPayment => paymentMethod == 'cash';

  ActiveTrip copyWith({
    String? id,
    String? type,
    TripStage? stage,
    List<TripStop>? stops,
    int? currentStopIndex,
    double? fare,
    String? paymentMethod,
    DateTime? startedAt,
    CustomerInfo? customer,
    List<LatLng>? routePoints,
    DateTime? estimatedArrival,
    double? distanceRemaining,
    int? durationRemaining,
    String? notes,
  }) {
    return ActiveTrip(
      id: id ?? this.id,
      type: type ?? this.type,
      stage: stage ?? this.stage,
      stops: stops ?? this.stops,
      currentStopIndex: currentStopIndex ?? this.currentStopIndex,
      fare: fare ?? this.fare,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      startedAt: startedAt ?? this.startedAt,
      customer: customer ?? this.customer,
      routePoints: routePoints ?? this.routePoints,
      estimatedArrival: estimatedArrival ?? this.estimatedArrival,
      distanceRemaining: distanceRemaining ?? this.distanceRemaining,
      durationRemaining: durationRemaining ?? this.durationRemaining,
      notes: notes ?? this.notes,
    );
  }

  @override
  List<Object?> get props => [
        id,
        type,
        stage,
        stops,
        currentStopIndex,
        fare,
        paymentMethod,
        startedAt,
        customer,
        routePoints,
        estimatedArrival,
        distanceRemaining,
        durationRemaining,
        notes,
      ];
}

class CustomerInfo extends Equatable {
  const CustomerInfo({
    required this.id,
    required this.name,
    this.phoneNumber,
    this.photoUrl,
    this.rating,
  });

  final String id;
  final String name;
  final String? phoneNumber;
  final String? photoUrl;
  final double? rating;

  @override
  List<Object?> get props => [id, name, phoneNumber, photoUrl, rating];
}
