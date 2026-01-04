import 'package:equatable/equatable.dart';
import 'package:ubi_core/ubi_core.dart';

/// Events for RideBloc
abstract class RideEvent extends Equatable {
  const RideEvent();

  @override
  List<Object?> get props => [];
}

/// Request ride estimates for a route
class RideEstimatesRequested extends RideEvent {
  final Location pickup;
  final Location dropoff;

  const RideEstimatesRequested({
    required this.pickup,
    required this.dropoff,
  });

  @override
  List<Object?> get props => [pickup, dropoff];
}

/// Request a ride with selected vehicle type
class RideRequested extends RideEvent {
  final Location pickup;
  final Location dropoff;
  final String vehicleType;
  final String? promoCode;

  const RideRequested({
    required this.pickup,
    required this.dropoff,
    required this.vehicleType,
    this.promoCode,
  });

  @override
  List<Object?> get props => [pickup, dropoff, vehicleType, promoCode];
}

/// Cancel a pending or active ride
class RideCancelled extends RideEvent {
  final String rideId;
  final String? reason;

  const RideCancelled({
    required this.rideId,
    this.reason,
  });

  @override
  List<Object?> get props => [rideId, reason];
}

/// Rate a completed ride
class RideRated extends RideEvent {
  final String rideId;
  final int rating;
  final String? comment;

  const RideRated({
    required this.rideId,
    required this.rating,
    this.comment,
  });

  @override
  List<Object?> get props => [rideId, rating, comment];
}

/// Add tip to a completed ride
class RideTipAdded extends RideEvent {
  final String rideId;
  final double amount;

  const RideTipAdded({
    required this.rideId,
    required this.amount,
  });

  @override
  List<Object?> get props => [rideId, amount];
}

/// Watch current ride status updates
class RideWatchStarted extends RideEvent {
  final String rideId;

  const RideWatchStarted({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

/// Stop watching ride updates
class RideWatchStopped extends RideEvent {
  const RideWatchStopped();
}

/// Ride status update received
class RideStatusUpdated extends RideEvent {
  final Ride ride;

  const RideStatusUpdated(this.ride);

  @override
  List<Object?> get props => [ride];
}

/// Driver location update received
class DriverLocationUpdated extends RideEvent {
  final Location location;

  const DriverLocationUpdated(this.location);

  @override
  List<Object?> get props => [location];
}

/// Search for places
class PlaceSearchRequested extends RideEvent {
  final String query;

  const PlaceSearchRequested(this.query);

  @override
  List<Object?> get props => [query];
}

/// Get nearby drivers for display on map
class NearbyDriversRequested extends RideEvent {
  final Location location;

  const NearbyDriversRequested(this.location);

  @override
  List<Object?> get props => [location];
}

/// Clear current ride state
class RideCleared extends RideEvent {
  const RideCleared();
}
