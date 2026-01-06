import 'package:equatable/equatable.dart';
import 'package:ubi_core/ubi_core.dart';

/// States for RideBloc
abstract class RideState extends Equatable {
  const RideState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class RideInitial extends RideState {
  const RideInitial();
}

/// Loading state
class RideLoading extends RideState {
  const RideLoading();
}

/// Ride estimates loaded
class RideEstimatesLoaded extends RideState {
  final Location pickup;
  final Location dropoff;
  final List<RideEstimateUI> estimates;

  const RideEstimatesLoaded({
    required this.pickup,
    required this.dropoff,
    required this.estimates,
  });

  @override
  List<Object?> get props => [pickup, dropoff, estimates];
}

/// Ride requested, searching for driver
class RideSearchingDriver extends RideState {
  final Ride ride;

  const RideSearchingDriver(this.ride);

  @override
  List<Object?> get props => [ride];
}

/// Driver assigned, en route to pickup
class RideDriverAssigned extends RideState {
  final Ride ride;
  final Location? driverLocation;

  const RideDriverAssigned({
    required this.ride,
    this.driverLocation,
  });

  @override
  List<Object?> get props => [ride, driverLocation];
}

/// Driver arrived at pickup
class RideDriverArrived extends RideState {
  final Ride ride;

  const RideDriverArrived(this.ride);

  @override
  List<Object?> get props => [ride];
}

/// Ride in progress
class RideInProgress extends RideState {
  final Ride ride;
  final Location? driverLocation;

  const RideInProgress({
    required this.ride,
    this.driverLocation,
  });

  @override
  List<Object?> get props => [ride, driverLocation];
}

/// Ride completed
class RideCompleted extends RideState {
  final Ride ride;
  final bool rated;

  const RideCompleted({
    required this.ride,
    this.rated = false,
  });

  @override
  List<Object?> get props => [ride, rated];
}

/// Ride cancelled
class RideCancelledState extends RideState {
  final String rideId;
  final CancellationReason? reason;

  const RideCancelledState({
    required this.rideId,
    this.reason,
  });

  @override
  List<Object?> get props => [rideId, reason];
}

/// Place search results
class PlaceSearchResults extends RideState {
  final String query;
  final List<PlaceResultUI> results;

  const PlaceSearchResults({
    required this.query,
    required this.results,
  });

  @override
  List<Object?> get props => [query, results];
}

/// Nearby drivers loaded
class NearbyDriversLoaded extends RideState {
  final List<Location> driverLocations;

  const NearbyDriversLoaded(this.driverLocations);

  @override
  List<Object?> get props => [driverLocations];
}

/// Error state
class RideError extends RideState {
  final String message;

  const RideError(this.message);

  @override
  List<Object?> get props => [message];
}

/// Local ride estimate model for UI display
class RideEstimateUI {
  final String vehicleType;
  final String displayName;
  final double price;
  final String currency;
  final int etaMinutes;
  final String? surgeMultiplier;

  const RideEstimateUI({
    required this.vehicleType,
    required this.displayName,
    required this.price,
    required this.currency,
    required this.etaMinutes,
    this.surgeMultiplier,
  });
}

/// Local place search result model for UI display
class PlaceResultUI {
  final String placeId;
  final String name;
  final String address;
  final double? lat;
  final double? lng;

  const PlaceResultUI({
    required this.placeId,
    required this.name,
    required this.address,
    this.lat,
    this.lng,
  });
}
