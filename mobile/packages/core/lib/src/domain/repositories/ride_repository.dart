import '../../core/result/result.dart';
import '../entities/ride.dart';
import '../entities/location.dart';

/// Ride repository interface
abstract class RideRepository {
  /// Get ride estimates for a route
  Future<Result<List<RideEstimate>>> getEstimates({
    required GeoLocation pickup,
    required GeoLocation dropoff,
  });

  /// Request a new ride
  Future<Result<Ride>> requestRide({required RideRequest request});

  /// Get ride by ID
  Future<Result<Ride>> getRideById(String rideId);

  /// Get current active ride
  Future<Result<Ride?>> getActiveRide();

  /// Get ride history
  Future<Result<List<Ride>>> getRideHistory({
    int page = 1,
    int limit = 20,
  });

  /// Cancel a ride
  Future<Result<Ride>> cancelRide(
    String rideId, {
    CancellationReason? reason,
    String? note,
  });

  /// Rate a completed ride
  Future<Result<void>> rateRide({
    required String rideId,
    required int rating,
    String? review,
  });

  /// Add tip to a ride
  Future<Result<Ride>> addTip({
    required String rideId,
    required double amount,
  });

  /// Get nearby available drivers
  Future<Result<List<Driver>>> getNearbyDrivers({
    required GeoLocation location,
    VehicleType? vehicleType,
  });

  /// Watch ride updates in real-time
  Stream<Ride> watchRide(String rideId);

  /// Watch driver location updates
  Stream<GeoLocation> watchDriverLocation(String rideId);

  /// Get driver location stream (returns Result for error handling)
  Stream<Result<GeoLocation>> getDriverLocationStream(String rideId);

  /// Get ride status stream (returns Result for error handling)
  Stream<Result<Ride>> getRideStatusStream(String rideId);

  /// Get saved places
  Future<Result<List<SavedPlace>>> getSavedPlaces();

  /// Add saved place
  Future<Result<SavedPlace>> addSavedPlace(SavedPlace place);

  /// Remove saved place
  Future<Result<void>> removeSavedPlace(String placeId);

  /// Search places
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? location,
  });

  /// Autocomplete places for search input
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    GeoLocation? location,
  });

  /// Get place details
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId);

  /// Reverse geocode location to place details
  Future<Result<PlaceDetails>> reverseGeocode(GeoLocation location);

  /// Get route polyline
  Future<Result<List<GeoLocation>>> getRoutePolyline(
    GeoLocation pickup,
    GeoLocation dropoff,
  );
}

