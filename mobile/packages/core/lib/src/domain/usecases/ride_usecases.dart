/// Ride Use Cases
///
/// Business logic for ride operations.
library;

import '../../../core.dart';

/// Get ride fare estimates
class GetRideEstimatesUseCase implements UseCase<List<RideEstimate>, GetRideEstimatesParams> {
  const GetRideEstimatesUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<List<RideEstimate>>> call(GetRideEstimatesParams params) {
    return repository.getEstimates(
      pickup: params.pickup,
      dropoff: params.dropoff,
      vehicleType: params.vehicleType,
    );
  }
}

class GetRideEstimatesParams {
  const GetRideEstimatesParams({
    required this.pickup,
    required this.dropoff,
    this.vehicleType,
  });

  final GeoLocation pickup;
  final GeoLocation dropoff;
  final VehicleType? vehicleType;
}

/// Request a ride
class RequestRideUseCase implements UseCase<Ride, RequestRideParams> {
  const RequestRideUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<Ride>> call(RequestRideParams params) {
    return repository.requestRide(request: params.request);
  }
}

class RequestRideParams {
  const RequestRideParams({required this.request});

  final RideRequest request;
}

/// Get ride details
class GetRideDetailsUseCase implements UseCase<Ride, String> {
  const GetRideDetailsUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<Ride>> call(String rideId) {
    return repository.getRideById(rideId);
  }
}

/// Get active ride
class GetActiveRideUseCase implements UseCase<Ride?, NoParams> {
  const GetActiveRideUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<Ride?>> call(NoParams params) {
    return repository.getActiveRide();
  }
}

/// Cancel a ride
class CancelRideUseCase implements UseCase<Ride, CancelRideParams> {
  const CancelRideUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<Ride>> call(CancelRideParams params) {
    return repository.cancelRide(
      params.rideId,
      reason: params.reason,
    );
  }
}

class CancelRideParams {
  const CancelRideParams({
    required this.rideId,
    this.reason,
  });

  final String rideId;
  final CancellationReason? reason;
}

/// Rate a ride
class RateRideUseCase implements UseCase<void, RateRideParams> {
  const RateRideUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<void>> call(RateRideParams params) {
    return repository.rateRide(
      rideId: params.rideId,
      rating: params.rating,
      review: params.review,
    );
  }
}

class RateRideParams {
  const RateRideParams({
    required this.rideId,
    required this.rating,
    this.review,
  });

  final String rideId;
  final int rating;
  final String? review;
}

/// Add tip to a ride
class AddRideTipUseCase implements UseCase<Ride, AddTipParams> {
  const AddRideTipUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<Ride>> call(AddTipParams params) {
    return repository.addTip(
      rideId: params.rideId,
      amount: params.amount,
    );
  }
}

class AddTipParams {
  const AddTipParams({
    required this.rideId,
    required this.amount,
  });

  final String rideId;
  final double amount;
}

/// Get nearby drivers
class GetNearbyDriversUseCase implements UseCase<List<Driver>, GetNearbyDriversParams> {
  const GetNearbyDriversUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<List<Driver>>> call(GetNearbyDriversParams params) {
    return repository.getNearbyDrivers(
      location: params.location,
      vehicleType: params.vehicleType,
    );
  }
}

class GetNearbyDriversParams {
  const GetNearbyDriversParams({
    required this.location,
    this.vehicleType,
  });

  final GeoLocation location;
  final VehicleType? vehicleType;
}

/// Watch ride updates in real-time
class WatchRideUseCase implements StreamUseCase<Ride, String> {
  const WatchRideUseCase(this.repository);

  final RideRepository repository;

  @override
  Stream<Ride> call(String rideId) {
    return repository.watchRide(rideId);
  }
}

/// Watch driver location updates
class WatchDriverLocationUseCase implements StreamUseCase<GeoLocation, String> {
  const WatchDriverLocationUseCase(this.repository);

  final RideRepository repository;

  @override
  Stream<GeoLocation> call(String rideId) {
    return repository.watchDriverLocation(rideId);
  }
}

/// Search places
class SearchPlacesUseCase implements UseCase<List<PlaceSearchResult>, SearchPlacesParams> {
  const SearchPlacesUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<List<PlaceSearchResult>>> call(SearchPlacesParams params) {
    return repository.searchPlaces(
      query: params.query,
      location: params.location,
    );
  }
}

class SearchPlacesParams {
  const SearchPlacesParams({
    required this.query,
    this.location,
  });

  final String query;
  final GeoLocation? location;
}

/// Autocomplete places for search input
class AutocompletePlacesUseCase implements UseCase<List<PlaceSearchResult>, AutocompletePlacesParams> {
  const AutocompletePlacesUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<List<PlaceSearchResult>>> call(AutocompletePlacesParams params) {
    return repository.autocompletePlaces(
      input: params.input,
      sessionToken: params.sessionToken,
      location: params.location,
    );
  }
}

class AutocompletePlacesParams {
  const AutocompletePlacesParams({
    required this.input,
    required this.sessionToken,
    this.location,
  });

  final String input;
  final String sessionToken;
  final GeoLocation? location;
}

/// Get place details
class GetPlaceDetailsUseCase implements UseCase<PlaceDetails, String> {
  const GetPlaceDetailsUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<PlaceDetails>> call(String placeId) {
    return repository.getPlaceDetails(placeId);
  }
}

/// Reverse geocode location to address
class ReverseGeocodeUseCase implements UseCase<PlaceDetails, GeoLocation> {
  const ReverseGeocodeUseCase(this.repository);

  final RideRepository repository;

  @override
  Future<Result<PlaceDetails>> call(GeoLocation location) {
    return repository.reverseGeocode(location);
  }
}
