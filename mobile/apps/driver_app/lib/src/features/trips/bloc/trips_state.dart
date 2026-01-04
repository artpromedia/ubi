part of 'trips_bloc.dart';

/// Base class for all trips states
sealed class TripsState extends Equatable {
  const TripsState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class TripsInitial extends TripsState {
  const TripsInitial();
}

/// Loading state
class TripsLoading extends TripsState {
  const TripsLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// En route to pickup location
class TripsEnRouteToPickup extends TripsState {
  const TripsEnRouteToPickup({
    required this.trip,
    required this.driverLatitude,
    required this.driverLongitude,
    this.driverHeading,
  });

  final ActiveTrip trip;
  final double driverLatitude;
  final double driverLongitude;
  final double? driverHeading;

  TripsEnRouteToPickup copyWith({
    ActiveTrip? trip,
    double? driverLatitude,
    double? driverLongitude,
    double? driverHeading,
  }) {
    return TripsEnRouteToPickup(
      trip: trip ?? this.trip,
      driverLatitude: driverLatitude ?? this.driverLatitude,
      driverLongitude: driverLongitude ?? this.driverLongitude,
      driverHeading: driverHeading ?? this.driverHeading,
    );
  }

  @override
  List<Object?> get props => [trip, driverLatitude, driverLongitude, driverHeading];
}

/// Arrived at pickup location
class TripsArrivedPickup extends TripsState {
  const TripsArrivedPickup({
    required this.trip,
    required this.arrivedAt,
    required this.driverLatitude,
    required this.driverLongitude,
  });

  final ActiveTrip trip;
  final DateTime arrivedAt;
  final double driverLatitude;
  final double driverLongitude;

  Duration get waitingTime => DateTime.now().difference(arrivedAt);

  @override
  List<Object?> get props => [trip, arrivedAt, driverLatitude, driverLongitude];
}

/// Trip in progress (rider on board / food collected)
class TripsInProgress extends TripsState {
  const TripsInProgress({
    required this.trip,
    required this.driverLatitude,
    required this.driverLongitude,
    this.driverHeading,
    this.driverSpeed,
  });

  final ActiveTrip trip;
  final double driverLatitude;
  final double driverLongitude;
  final double? driverHeading;
  final double? driverSpeed;

  TripsInProgress copyWith({
    ActiveTrip? trip,
    double? driverLatitude,
    double? driverLongitude,
    double? driverHeading,
    double? driverSpeed,
  }) {
    return TripsInProgress(
      trip: trip ?? this.trip,
      driverLatitude: driverLatitude ?? this.driverLatitude,
      driverLongitude: driverLongitude ?? this.driverLongitude,
      driverHeading: driverHeading ?? this.driverHeading,
      driverSpeed: driverSpeed ?? this.driverSpeed,
    );
  }

  @override
  List<Object?> get props => [
        trip,
        driverLatitude,
        driverLongitude,
        driverHeading,
        driverSpeed,
      ];
}

/// Arrived at dropoff location
class TripsArrivedDropoff extends TripsState {
  const TripsArrivedDropoff({
    required this.trip,
    required this.driverLatitude,
    required this.driverLongitude,
  });

  final ActiveTrip trip;
  final double driverLatitude;
  final double driverLongitude;

  @override
  List<Object?> get props => [trip, driverLatitude, driverLongitude];
}

/// Collecting cash payment
class TripsCollectingCash extends TripsState {
  const TripsCollectingCash({
    required this.trip,
    required this.amountDue,
  });

  final ActiveTrip trip;
  final double amountDue;

  @override
  List<Object?> get props => [trip, amountDue];
}

/// Trip completed
class TripsComplete extends TripsState {
  const TripsComplete({
    required this.tripId,
    required this.summary,
  });

  final String tripId;
  final TripSummary summary;

  @override
  List<Object?> get props => [tripId, summary];
}

/// Trip cancelled
class TripsCancelled extends TripsState {
  const TripsCancelled({
    required this.tripId,
    required this.reason,
    this.cancellationFee,
  });

  final String tripId;
  final String reason;
  final double? cancellationFee;

  @override
  List<Object?> get props => [tripId, reason, cancellationFee];
}

/// Error state
class TripsError extends TripsState {
  const TripsError({
    required this.message,
    this.previousState,
  });

  final String message;
  final TripsState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}

// Summary model
class TripSummary extends Equatable {
  const TripSummary({
    required this.tripId,
    required this.type,
    required this.baseFare,
    required this.distanceFare,
    required this.timeFare,
    required this.tips,
    required this.totalFare,
    required this.driverEarnings,
    required this.distance,
    required this.duration,
    required this.startTime,
    required this.endTime,
    this.surgeMultiplier,
    this.bonuses,
    this.tolls,
    this.customerRating,
    this.customerFeedback,
  });

  final String tripId;
  final String type;
  final double baseFare;
  final double distanceFare;
  final double timeFare;
  final double tips;
  final double totalFare;
  final double driverEarnings;
  final double distance;
  final int duration;
  final DateTime startTime;
  final DateTime endTime;
  final double? surgeMultiplier;
  final double? bonuses;
  final double? tolls;
  final int? customerRating;
  final String? customerFeedback;

  @override
  List<Object?> get props => [
        tripId,
        type,
        baseFare,
        distanceFare,
        timeFare,
        tips,
        totalFare,
        driverEarnings,
        distance,
        duration,
        startTime,
        endTime,
        surgeMultiplier,
        bonuses,
        tolls,
        customerRating,
        customerFeedback,
      ];
}
